import assert from 'node:assert/strict'
import { test } from 'vitest'
import { buildIndex } from '../src/build.js'
import { assertPayloadVersion, createSearcher, hydrateIndex } from '../src/client.js'
import { DEFAULT_BOOST, PAYLOAD_VERSION } from '../src/records.js'
import type { SearchIndexPayload, SearchRecord } from '../src/records.js'

const records: SearchRecord[] = [
  {
    title: 'Getting Started',
    section: '',
    hierarchy: 'Getting Started',
    content: 'Install ZBSearch with npm, yarn, pnpm or bun.',
    url: '/docs/intro',
    category: 'Docs',
    path: ''
  },
  {
    title: 'Vector Search',
    section: 'Embeddings',
    hierarchy: 'Guides › Vector Search',
    content: 'Vector search compares embeddings using cosine similarity.',
    url: '/docs/vector#embeddings',
    category: 'Docs',
    path: ''
  },
  {
    title: 'Hybrid Search',
    section: '',
    hierarchy: 'Guides › Hybrid Search',
    content: 'Hybrid search blends full-text scoring with vector similarity.',
    url: '/docs/hybrid',
    category: 'Docs',
    path: ''
  }
]

function roundTrip(payload: SearchIndexPayload): SearchIndexPayload {
  return JSON.parse(JSON.stringify(payload))
}

async function rehydrate(payload: SearchIndexPayload) {
  const { db, search } = await hydrateIndex(assertPayloadVersion(payload))

  return { db, search }
}

test('buildIndex stamps the payload with the current version and language', async () => {
  const payload = await buildIndex(records, 'english')

  assert.equal(payload.version, PAYLOAD_VERSION)
  assert.equal(payload.language, 'english')
  assert.equal(payload.recordCount, 3)
})

test('the serialized index survives a JSON round trip', async () => {
  const { db, search } = await rehydrate(roundTrip(await buildIndex(records, 'english')))
  const results = await search(db, { term: 'embeddings' })
  assert.equal(results.count, 1)
  assert.equal((results.hits[0].document as unknown as SearchRecord).url, '/docs/vector#embeddings')
})

test('a restored index returns the stored url and category', async () => {
  const { db, search } = await rehydrate(roundTrip(await buildIndex(records, 'english')))
  const results = await search(db, { term: 'npm' })
  const document = results.hits[0].document as unknown as SearchRecord

  assert.equal(document.url, '/docs/intro')
  assert.equal(document.category, 'Docs')
  assert.equal(document.title, 'Getting Started')
})

test('only the declared properties are indexed', async () => {
  const payload = await buildIndex(records, 'english')
  const index = payload.index.index as { searchableProperties: string[] }
  assert.deepEqual(index.searchableProperties.toSorted(), ['content', 'hierarchy', 'section', 'title'])
})

test('permalinks are not searchable', async () => {
  const { db, search } = await rehydrate(roundTrip(await buildIndex(records, 'english')))
  assert.equal((await search(db, { term: 'docs' })).count, 0)
})

test('boosting ranks a title match above a body match', async () => {
  const { db, search } = await rehydrate(roundTrip(await buildIndex(records, 'english')))
  const results = await search(db, {
    term: 'hybrid',
    properties: ['title', 'section', 'hierarchy', 'content'],
    boost: { ...DEFAULT_BOOST }
  })

  assert.equal((results.hits[0].document as unknown as SearchRecord).url, '/docs/hybrid')
})

test('buildIndex handles a site with no content', async () => {
  const payload = await buildIndex([], 'english')

  assert.equal(payload.recordCount, 0)

  const { db, search } = await rehydrate(roundTrip(payload))
  assert.equal((await search(db, { term: 'anything' })).count, 0)
})

test('buildIndex disables sorting so the payload carries no sort index', async () => {
  const payload = await buildIndex(records, 'english')
  const sorting = payload.index.sorting as { enabled?: boolean; sorts?: Record<string, unknown> }

  assert.equal(sorting.enabled, false)
  assert.equal(Object.keys(sorting.sorts ?? {}).length, 0)
})

test('hydrateIndex rejects a payload built by a different version', async () => {
  const payload = roundTrip(await buildIndex(records, 'english'))
  payload.version = PAYLOAD_VERSION + 1

  await assert.rejects(() => rehydrate(payload), /does not match the expected/)
})

test('createSearcher searches a hydrated index and maps hits to search results', async () => {
  const payload = roundTrip(await buildIndex(records, 'english'))
  const getIndex = () => hydrateIndex(assertPayloadVersion(payload))
  const searcher = createSearcher(getIndex, {
    boost: { ...DEFAULT_BOOST },
    maxResults: 5,
    tolerance: 0,
    threshold: 0,
    snippetLength: 60
  })

  const hits = await searcher('hybrid', new AbortController().signal)

  assert.equal(hits[0].url, '/docs/hybrid')
  assert.equal(hits[0].title, 'Hybrid Search')
  assert.equal(hits[0].category, 'Docs')
  assert.ok(hits[0].snippet?.toLowerCase().includes('hybrid'))
})
