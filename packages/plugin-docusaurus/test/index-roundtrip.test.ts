import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { create, load, search } from 'zbsearch'
import { buildIndex, writePayload } from '../src/node/build-index.js'
import { DEFAULT_BOOST, GENERATED_DIR, PAYLOAD_FILE, PAYLOAD_VERSION, RECORD_SCHEMA } from '../src/shared/index.js'
import type { SearchIndexPayload, SearchRecord } from '../src/shared/index.js'

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

function rehydrate(payload: SearchIndexPayload) {
  const db = create({ schema: RECORD_SCHEMA, language: payload.language, inferSchema: false })
  load(db, payload.index)

  return db
}

test('buildIndex stamps the payload with the current version and language', async () => {
  const payload = await buildIndex(records, 'english')

  assert.equal(payload.version, PAYLOAD_VERSION)
  assert.equal(payload.language, 'english')
  assert.equal(payload.recordCount, 3)
})

test('the serialized index survives a JSON round trip', async () => {
  const payload = await buildIndex(records, 'english')
  const restored: SearchIndexPayload = JSON.parse(JSON.stringify(payload))
  const results = await search(rehydrate(restored), { term: 'embeddings' })
  assert.equal(results.count, 1)
  assert.equal((results.hits[0].document as unknown as SearchRecord).url, '/docs/vector#embeddings')
})

test('a restored index returns the stored url and category', async () => {
  const payload: SearchIndexPayload = JSON.parse(JSON.stringify(await buildIndex(records, 'english')))
  const results = await search(rehydrate(payload), { term: 'npm' })
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
  const payload: SearchIndexPayload = JSON.parse(JSON.stringify(await buildIndex(records, 'english')))
  assert.equal((await search(rehydrate(payload), { term: 'docs' })).count, 0)
})

test('boosting ranks a title match above a body match', async () => {
  const payload: SearchIndexPayload = JSON.parse(JSON.stringify(await buildIndex(records, 'english')))
  const results = await search(rehydrate(payload), {
    term: 'hybrid',
    properties: ['title', 'section', 'hierarchy', 'content'],
    boost: { ...DEFAULT_BOOST }
  })

  assert.equal((results.hits[0].document as unknown as SearchRecord).url, '/docs/hybrid')
})

test('buildIndex handles a site with no content', async () => {
  const payload = await buildIndex([], 'english')

  assert.equal(payload.recordCount, 0)
  assert.equal((await search(rehydrate(JSON.parse(JSON.stringify(payload))), { term: 'anything' })).count, 0)
})

test('writePayload writes where the theme imports from', async () => {
  const generatedFilesDir = await mkdtemp(path.join(tmpdir(), 'zbsearch-generated-'))
  const file = await writePayload(generatedFilesDir, await buildIndex(records, 'english'))

  assert.equal(file, path.join(generatedFilesDir, GENERATED_DIR, PAYLOAD_FILE))

  const written: SearchIndexPayload = JSON.parse(await readFile(file, 'utf8'))

  assert.equal(written.recordCount, 3)
  assert.equal((await search(rehydrate(written), { term: 'cosine' })).count, 1)
})
