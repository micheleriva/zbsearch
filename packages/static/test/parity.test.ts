import { beforeAll, describe, expect, it } from 'vitest'
import { create, insertMultiple, search } from 'zbsearch'
import type { Results } from 'zbsearch'
import { buildStaticIndex, type StaticFileSet } from '../src/builder.js'
import { createStaticSearchClient, type StaticSearchClient, type StaticSearchParams } from '../src/client.js'
import { CORPUS_SCHEMA, corpusVocabulary, makeCorpus } from './corpus.js'

const records = makeCorpus(3)

let fileSet: StaticFileSet
let reference: ReturnType<typeof create>

function newClient(): StaticSearchClient {
  return createStaticSearchClient({
    fetchBytes: async (path: string) => {
      const bytes = fileSet.files.get(path)
      if (!bytes) {
        throw new Error(`missing file: ${path}`)
      }
      return bytes
    }
  })
}

function comparable(results: Results<Record<string, unknown>>) {
  return {
    count: results.count,
    hits: results.hits.map((hit) => [hit.id, hit.score, hit.document])
  }
}

async function expectParity(client: StaticSearchClient, params: StaticSearchParams): Promise<void> {
  const expected = await search(reference, params as never)
  const actual = await client.search(params)
  expect(comparable(actual as Results<Record<string, unknown>>), `query: ${JSON.stringify(params)}`).toEqual(
    comparable(expected as Results<Record<string, unknown>>)
  )
}

beforeAll(async () => {
  fileSet = await buildStaticIndex({
    records: records as unknown as Array<Record<string, unknown>>,
    schema: CORPUS_SCHEMA,
    // Small shards on purpose, so queries genuinely span multiple files.
    targetShardBytes: 1024,
    fragmentGroupSize: 8
  })

  reference = create({ schema: CORPUS_SCHEMA, language: 'english', inferSchema: false, sort: { enabled: false } })
  await insertMultiple(
    reference,
    records.map((record, i) => ({ id: String(i + 1), ...record }))
  )
})

describe('sharded search matches monolithic search exactly', () => {
  it('single-token queries over the whole vocabulary', async () => {
    const client = newClient()
    for (const word of corpusVocabulary(records)) {
      await expectParity(client, { term: word })
    }
  })

  it('prefix queries', async () => {
    const client = newClient()
    const vocabulary = corpusVocabulary(records)
    for (const word of vocabulary) {
      if (word.length > 4) {
        await expectParity(client, { term: word.slice(0, 3) })
      }
    }
  })

  it('typo-tolerant queries', async () => {
    const client = newClient()
    const vocabulary = corpusVocabulary(records).filter((word) => word.length > 4)
    for (const word of vocabulary) {
      // Swap two middle characters, then search with tolerance.
      const chars = word.split('')
      ;[chars[1], chars[2]] = [chars[2], chars[1]]
      await expectParity(client, { term: chars.join(''), tolerance: 1 })
      await expectParity(client, { term: word.slice(0, -1), tolerance: 2 })
    }
  })

  it('multi-token queries across threshold settings', async () => {
    const client = newClient()
    const pairs = [
      'query syntax',
      'fuzzy search',
      'field boosts',
      'shards fetched lazily',
      'average field length',
      'sharded query execution',
      'unknownword query',
      'typo tolerance distance'
    ]
    for (const term of pairs) {
      for (const threshold of [0, 0.3, 1]) {
        await expectParity(client, { term, threshold })
      }
    }
  })

  it('boosts, exact matching, and property subsets', async () => {
    const client = newClient()
    await expectParity(client, { term: 'query', boost: { title: 4, section: 2, content: 1 } })
    await expectParity(client, { term: 'query', properties: ['title'] })
    await expectParity(client, { term: 'query', properties: ['title', 'content'] })
    await expectParity(client, { term: 'fuzzy matching', exact: true })
    await expectParity(client, { term: 'search', prefix: false })
  })

  it('pagination', async () => {
    const client = newClient()
    for (const [limit, offset] of [
      [3, 0],
      [3, 3],
      [5, 10],
      [100, 0]
    ]) {
      await expectParity(client, { term: 'search', limit, offset })
    }
  })

  it('preflight and empty results', async () => {
    const client = newClient()
    await expectParity(client, { term: 'search', preflight: true })
    await expectParity(client, { term: 'xyzzynotaword' })
    await expectParity(client, { term: '' })
  })

  it('exact matching on a cold client, as the very first query', async () => {
    // Core verifies `exact` against the stored document text, so the client
    // must fetch every candidate's document before the final search runs -
    // including when no earlier query happened to warm the fragment cache.
    await expectParity(newClient(), { term: 'fuzzy matching', exact: true })
    await expectParity(newClient(), { term: 'sharding', exact: true })
    await expectParity(newClient(), { term: 'fuzzy matching', exact: true, preflight: true })
    await expectParity(newClient(), { term: 'levenshtein distance', exact: true, limit: 3 })
  })

  it('an empty where object is browsing, not filtering', async () => {
    await expectParity(newClient(), { where: {} })
    await expectParity(newClient(), { where: {}, limit: 5, offset: 5 })
  })

  it('property-only searches work on a cold client', async () => {
    await expectParity(newClient(), { properties: ['title'] })
    await expectParity(newClient(), { term: '', properties: ['title', 'content'], limit: 20 })
  })

  it('deep browse pagination fetches only the requested page', async () => {
    // IDs 41-48 are exactly one fragment group of 8. A regression back to
    // "fetch everything up to the offset" would fetch six groups here.
    const client = newClient()
    await expectParity(client, { offset: 40, limit: 8 })
    expect(client.stats().fragmentsFetched).toBe(1)

    // The tail page and a past-the-end offset stay exact too.
    await expectParity(client, { offset: records.length - 3, limit: 10 })
    await expectParity(client, { offset: records.length + 5, limit: 10 })
  })

  it('logical where clauses fetch the postings of their nested terms', async () => {
    const client = newClient()
    await expectParity(client, { term: 'search', where: { and: [{ section: 'basics' }] } })
    await expectParity(client, { term: 'query', where: { or: [{ section: 'filtering' }, { section: 'basics' }] } })
    await expectParity(client, { term: 'search', where: { not: { section: 'basics' } } })
    await expectParity(newClient(), {
      term: 'search',
      where: { and: [{ or: [{ section: 'basics' }, { section: 'relevance' }] }, { not: { title: 'thresholds' } }] }
    })
  })
})

describe('network behavior', () => {
  it('loads lazily, caches shards, and never refetches', async () => {
    const client = newClient()

    await client.preload()
    const afterPreload = client.stats()
    // Manifest + dictionary only.
    expect(afterPreload.requests).toBe(2)

    await client.search({ term: 'sharding' })
    const afterFirst = client.stats()
    expect(afterFirst.shardsFetched).toBeGreaterThan(0)
    expect(afterFirst.fragmentsFetched).toBeGreaterThan(0)

    // The same query again touches nothing on the network.
    await client.search({ term: 'sharding' })
    expect(client.stats().requests).toBe(afterFirst.requests)

    // A query over already-fetched terms reuses merged postings.
    await client.search({ term: 'sharding', limit: 5 })
    expect(client.stats().shardsFetched).toBe(afterFirst.shardsFetched)
  })

  it('fetches only a bounded slice of the index per query', async () => {
    const client = newClient()
    await client.search({ term: 'levenshtein' })

    const { bytesFetched } = client.stats()
    const totalBytes = fileSet.stats.totalBytes
    // A single query must not pull anywhere near the whole index.
    expect(bytesFetched).toBeLessThan(totalBytes * 0.5)
  })

  it('rejects unsupported options loudly', async () => {
    const client = newClient()
    await expect(client.search({ term: 'query', facets: {} } as StaticSearchParams)).rejects.toThrow(/facets/)
  })
})
