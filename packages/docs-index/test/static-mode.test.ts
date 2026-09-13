import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIndexLoader, createSearcher, isShardedPayload, type SearchRecord } from '../src/index.js'
import { buildIndex } from '../src/build.js'
import { buildIndexAuto, shardBuiltPayload } from '../src/static.js'

function makeRecords(count: number): SearchRecord[] {
  const records: SearchRecord[] = []
  for (let i = 0; i < count; i++) {
    records.push({
      title: `Page ${i} sharded search`,
      section: `Section ${i % 7}`,
      hierarchy: `Guides › Section ${i % 7} › Page ${i}`,
      content: `Content for page number ${i}: lazy loading keeps the payload small while typo tolerance and ranking stay intact. Keyword anchor${i % 13}.`,
      url: `/docs/page-${i}`,
      category: 'Docs',
      path: `Guides › Page ${i}`
    })
  }
  return records
}

const BASE_URL = '/zbsearch-static/'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildIndexAuto', () => {
  it('stays inline below the limit', async () => {
    const result = await buildIndexAuto(makeRecords(3), 'english', { baseUrl: BASE_URL })
    expect(isShardedPayload(result.payload)).toBe(false)
    expect(result.staticFiles).toBeUndefined()
  })

  it('measures the limit in encoded bytes, not UTF-16 code units', async () => {
    // CJK text: ~3 UTF-8 bytes per character, 1 UTF-16 code unit each.
    const records = makeRecords(4).map((record) => ({
      ...record,
      content: '検索インデックスの遅延読み込みは帯域幅を節約します。'.repeat(40)
    }))

    const inline = JSON.stringify(await buildIndex(records, 'english'))
    expect(Buffer.byteLength(inline, 'utf8')).toBeGreaterThan(inline.length)

    // A limit between the code-unit count and the byte count must shard.
    const limit = Math.floor((inline.length + Buffer.byteLength(inline, 'utf8')) / 2)
    const result = await buildIndexAuto(records, 'english', { baseUrl: BASE_URL, inlineLimitBytes: limit })
    expect(isShardedPayload(result.payload)).toBe(true)
  })

  it('shards above the limit', async () => {
    const result = await buildIndexAuto(makeRecords(50), 'english', { baseUrl: BASE_URL, inlineLimitBytes: 4096 })
    expect(isShardedPayload(result.payload)).toBe(true)
    expect(result.staticFiles!.size).toBeGreaterThan(2)
    expect(JSON.parse(result.payloadJson).baseUrl).toBe(BASE_URL)
    expect(result.payloadJson.length).toBeLessThan(512)
  })
})

describe('shardBuiltPayload', () => {
  it('recovers the records from a built inline payload and shards them', async () => {
    const records = makeRecords(40)
    const inlineJson = JSON.stringify(await buildIndex(records, 'english'))

    const result = await shardBuiltPayload(inlineJson, { baseUrl: BASE_URL, inlineLimitBytes: 4096 })
    expect(isShardedPayload(result.payload)).toBe(true)

    // The fragment files carry the very same records.
    let recovered = 0
    for (const [file, bytes] of result.staticFiles!) {
      if (file.startsWith('fragments/')) {
        const docs = JSON.parse(new TextDecoder().decode(bytes)).docs as Record<string, SearchRecord>
        recovered += Object.keys(docs).length
      }
    }
    expect(recovered).toBe(records.length)
  })

  it('leaves small payloads untouched', async () => {
    const inlineJson = JSON.stringify(await buildIndex(makeRecords(2), 'english'))
    const result = await shardBuiltPayload(inlineJson, { baseUrl: BASE_URL })
    expect(result.payloadJson).toBe(inlineJson)
    expect(result.staticFiles).toBeUndefined()
  })
})

describe('sharded payload through the searchbox pipeline', () => {
  it('createIndexLoader + createSearcher work end to end against sharded files', async () => {
    const records = makeRecords(60)
    const { payload, staticFiles } = await buildIndexAuto(records, 'english', {
      baseUrl: BASE_URL,
      inlineLimitBytes: 1024
    })
    expect(staticFiles).toBeDefined()

    // The static client fetches shards over HTTP; serve them from memory.
    let fetchCalls = 0
    vi.stubGlobal('fetch', async (url: string) => {
      fetchCalls++
      const file = String(url).replace(BASE_URL, '')
      const bytes = staticFiles!.get(file)
      if (!bytes) {
        return new Response(null, { status: 404 })
      }
      return new Response(bytes.slice().buffer, { status: 200 })
    })

    const loadIndex = createIndexLoader(async () => payload)

    // Hydration preloads manifest and dictionary, so the hover/focus
    // prefetch leaves the index ready-to-query like in inline mode.
    await loadIndex()
    expect(fetchCalls).toBe(2)
    const searcher = createSearcher(loadIndex, {
      boost: { title: 4, section: 3, hierarchy: 1.5, content: 1 },
      maxResults: 8,
      tolerance: 1,
      threshold: 0,
      snippetLength: 120
    })

    const hits = await searcher('sharded search', new AbortController().signal)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].url).toMatch(/^\/docs\/page-/)
    expect(hits[0].title).toContain('sharded search')
    expect(hits[0].snippet).toBeTruthy()

    // Typo tolerance goes through the resident dictionary ("sharted" is one
    // substitution away from "sharded", within the tolerance of 1).
    const typo = await searcher('sharted search', new AbortController().signal)
    expect(typo.length).toBeGreaterThan(0)
  })
})
