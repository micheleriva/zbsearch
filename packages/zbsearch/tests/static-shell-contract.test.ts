import { describe, expect, it } from 'vitest'
import { create, insertMultiple, save, search } from '../src/index.js'
import type { AnyZBSearch, RawData } from '../src/index.js'
import type { Index } from '../src/components/index.js'
import { RadixTree, type RadixNodeJSON } from '../src/trees/radix.js'
import { decodePostings, type SerializedPostings } from '../src/trees/postings.js'

// These tests pin down the engine behaviors the static-sharded browser client
// (packages/static) is built on: a dictionary-only trie must report matched
// words without postings, and a shell database hydrated from manifest stats
// plus lazily merged postings must score identically to the full database.

const SCHEMA = { title: 'string', content: 'string' } as const

const DOCS = [
  { id: '1', title: 'Getting started', content: 'Install the search engine and run your first query' },
  { id: '2', title: 'Query syntax', content: 'The query language supports prefix and fuzzy search' },
  { id: '3', title: 'Fuzzy search', content: 'Typo tolerance uses bounded Levenshtein distance' },
  { id: '4', title: 'Ranking', content: 'Results are ranked with BM25 and per-field boosts' },
  { id: '5', title: 'Sharding', content: 'Postings can be split into shards and fetched lazily' },
  { id: '6', title: 'Query performance', content: 'A query against a warm shard cache is instant' }
]

type RawIndex = {
  indexes: Record<string, { type: string; node: RadixNodeJSON; isArray: boolean }>
  frequencies: Record<string, Record<number, Record<string, number> | undefined>>
  avgFieldLength: Record<string, number>
  fieldLengths: Record<string, Record<number, number | undefined>>
}

async function buildFullDb() {
  const db = create({ schema: SCHEMA, language: 'english', inferSchema: false, sort: { enabled: false } })
  await insertMultiple(db, DOCS)
  return db
}

function dictionaryOnlyNode(node: RadixNodeJSON): RadixNodeJSON {
  return { ...node, postings: {} }
}

// Builds a shell db the way the static client does: dictionary tries without
// postings, global stats injected, everything else empty until merged.
function buildShellDb(raw: RawData) {
  const rawIndex = raw.index as RawIndex
  const rawIds = raw.internalDocumentIDStore as { internalIdToId: string[] }

  const shell = create({ schema: SCHEMA, language: 'english', inferSchema: false, sort: { enabled: false } })
  const shellIndex = shell.data.index as Index

  for (const prop of Object.keys(rawIndex.indexes)) {
    shellIndex.indexes[prop] = {
      type: 'Radix',
      node: RadixTree.fromJSON(dictionaryOnlyNode(rawIndex.indexes[prop].node)),
      isArray: false
    }
    shellIndex.avgFieldLength[prop] = rawIndex.avgFieldLength[prop]
    shellIndex.frequencies[prop] = {}
    shellIndex.fieldLengths[prop] = {}
  }

  shell.internalDocumentIDStore.load(shell as AnyZBSearch, { internalIdToId: rawIds.internalIdToId })
  shell.data.docs.count = rawIds.internalIdToId.length

  return shell
}

// Simulates fetching the postings shard for `word` on `prop` and merging it
// into the live shell structures.
function mergeTerm(shell: ReturnType<typeof create>, raw: RawData, prop: string, word: string) {
  const rawIndex = raw.index as RawIndex
  const shellIndex = shell.data.index as Index

  const serialized = (rawIndex.indexes[prop].node.postings ?? {}) as SerializedPostings
  const encoded = serialized[word]
  if (!encoded) return

  const ids = decodePostings(encoded)
  const tree = shellIndex.indexes[prop].node as RadixTree
  if (!tree.postings.has(word)) {
    tree.postings.set(word, ids)
  }

  for (const docId of ids) {
    const tf = rawIndex.frequencies[prop][docId]?.[word]
    if (tf !== undefined) {
      shellIndex.frequencies[prop][docId] ??= {}
      shellIndex.frequencies[prop][docId]![word] = tf
    }
    shellIndex.fieldLengths[prop][docId] = rawIndex.fieldLengths[prop][docId]
  }
}

// Resolves the words a query would touch (the client's superset prefetch) and
// merges each of them, then copies the documents for hit hydration.
function prefetchAndMerge(
  shell: ReturnType<typeof create>,
  raw: RawData,
  term: string,
  { tolerance = 0, exact = false } = {}
) {
  const shellIndex = shell.data.index as Index
  const tokens = shell.tokenizer.tokenize(term, 'english')

  for (const prop of Object.keys(shellIndex.indexes)) {
    const tree = shellIndex.indexes[prop].node as RadixTree
    for (const token of tokens) {
      const matched = tree.find({ term: token, exact, tolerance })
      for (const word of Object.keys(matched)) {
        mergeTerm(shell, raw, prop, word)
      }
    }
  }

  const rawDocs = (raw.docs as { docs: Record<number, unknown> }).docs
  for (const [internalId, doc] of Object.entries(rawDocs)) {
    shell.data.docs.docs[Number(internalId)] = doc as never
  }
}

describe('static shell contract', () => {
  it('a dictionary-only trie reports matched words with empty postings', async () => {
    const full = await buildFullDb()
    const raw = save(full) as RawData
    const rawIndex = raw.index as RawIndex

    const dict = RadixTree.fromJSON(dictionaryOnlyNode(rawIndex.indexes['content'].node))

    // Exact word
    const exact = dict.find({ term: 'query' })
    expect(Object.keys(exact)).toContain('query')
    expect(exact['query']).toEqual([])

    // Prefix expansion still enumerates words
    const prefix = dict.find({ term: 'shar' })
    expect(Object.keys(prefix).sort()).toEqual(['shard', 'shards'])

    // Typo tolerance walks the trie without postings
    const fuzzy = dict.find({ term: 'quary', tolerance: 1 })
    expect(Object.keys(fuzzy)).toContain('query')
  })

  it('postings merged after a dictionary-only find are picked up by later finds', async () => {
    const full = await buildFullDb()
    const raw = save(full) as RawData
    const rawIndex = raw.index as RawIndex

    const dict = RadixTree.fromJSON(dictionaryOnlyNode(rawIndex.indexes['content'].node))

    // First find caches nothing for missing lists...
    expect(dict.find({ term: 'query' })['query']).toEqual([])

    // ...so a merge into the live map is visible to the next find.
    const ids = decodePostings((rawIndex.indexes['content'].node.postings as SerializedPostings)['query'])
    dict.postings.set('query', ids)
    expect(dict.find({ term: 'query' })['query']).toEqual(ids)
    expect(dict.getDocumentFrequency('query')).toBe(ids.length)
  })

  const queries: Array<{ name: string; term: string; options?: Record<string, unknown> }> = [
    { name: 'single token', term: 'query' },
    { name: 'multi token AND path (threshold 0)', term: 'fuzzy search', options: { threshold: 0 } },
    { name: 'multi token threshold 1', term: 'query search', options: { threshold: 1 } },
    { name: 'prefix expansion', term: 'shar' },
    { name: 'typo tolerance', term: 'quary', options: { tolerance: 1 } },
    { name: 'boosted properties', term: 'query', options: { boost: { title: 4, content: 1 } } }
  ]

  for (const { name, term, options = {} } of queries) {
    it(`shell search matches full search: ${name}`, async () => {
      const full = await buildFullDb()
      const raw = save(full) as RawData
      const shell = buildShellDb(raw)

      prefetchAndMerge(shell, raw, term, { tolerance: (options.tolerance as number) ?? 0 })

      const params = { term, ...options }
      const expected = await search(full, params)
      const actual = await search(shell, params)

      expect(actual.count).toBe(expected.count)
      expect(actual.hits.map((h) => [h.id, h.score])).toEqual(expected.hits.map((h) => [h.id, h.score]))
      expect(actual.hits.map((h) => h.document)).toEqual(expected.hits.map((h) => h.document))
    })
  }

  it('shell search scores identically when only the queried terms are merged', async () => {
    const full = await buildFullDb()
    const raw = save(full) as RawData
    const shell = buildShellDb(raw)

    // Merge strictly the words the query resolves to; every other term in the
    // index stays unfetched, as it would be in the browser.
    prefetchAndMerge(shell, raw, 'levenshtein', {})

    const expected = await search(full, { term: 'levenshtein' })
    const actual = await search(shell, { term: 'levenshtein' })

    expect(actual.hits.map((h) => [h.id, h.score])).toEqual(expected.hits.map((h) => [h.id, h.score]))
    expect(actual.count).toBe(expected.count)
  })
})
