import { describe, expect, it } from 'vitest'
import { create, insertMultiple, load, save, search, internals } from '../src/index.js'
import type { AnyZBSearch } from '../src/index.js'
import type { CorpusStatistics } from '../src/internals.js'
import type { Index } from '../src/components/index.js'

// These tests pin the primitive a sharded index is built on: a database that
// holds only part of a corpus, given the whole corpus' BM25 statistics, scores
// its documents exactly as the database holding the whole corpus does.

const SCHEMA = { title: 'string', body: 'string', tag: 'enum' } as const

const DOCS = [
  { id: '1', title: 'Getting started', body: 'Install the search engine and run your first query', tag: 'a' },
  { id: '2', title: 'Query syntax', body: 'The query language supports prefix and fuzzy search queries', tag: 'b' },
  { id: '3', title: 'Fuzzy search', body: 'Typo tolerance uses bounded Levenshtein distance', tag: 'a' },
  { id: '4', title: 'Ranking', body: 'Results are ranked with BM25 and per-field boosts', tag: 'b' },
  { id: '5', title: 'Sharding', body: 'Postings can be split into shards and searched lazily', tag: 'a' },
  { id: '6', title: 'Query performance', body: 'A query against a warm shard cache is instant', tag: 'b' },
  { id: '7', title: 'Searching shards', body: 'Search every shard, then merge the scores of each search', tag: 'a' },
  { id: '8', title: 'Search engine internals', body: 'The engine keeps a radix tree of terms per property', tag: 'b' }
]

function newDb() {
  return create({ schema: SCHEMA, language: 'english', sort: { enabled: false } }) as AnyZBSearch
}

function statsOf(full: AnyZBSearch): CorpusStatistics {
  const index = full.data.index as Index
  return {
    docsCount: DOCS.length,
    avgFieldLength: { ...index.avgFieldLength },
    documentFrequency: (prop, term) => {
      const tree = index.indexes[prop]
      return tree?.type === 'Radix' ? tree.node.getDocumentFrequency(term) : 0
    }
  }
}

async function setup() {
  const full = newDb()
  await insertMultiple(full, DOCS)

  const shards = [newDb(), newDb(), newDb()]
  await insertMultiple(shards[0], DOCS.slice(0, 3))
  await insertMultiple(shards[1], DOCS.slice(3, 5))
  await insertMultiple(shards[2], DOCS.slice(5))

  const stats = statsOf(full)
  for (const shard of shards) {
    internals.setCorpusStatistics(shard, stats)
  }

  return { full, shards, stats }
}

async function mergedSearch(shards: AnyZBSearch[], params: Record<string, unknown>) {
  const hits: { id: string; score: number }[] = []
  for (const shard of shards) {
    const result = await search(shard, { ...params, limit: 100 } as never)
    hits.push(...result.hits.map(({ id, score }) => ({ id, score })))
  }
  return hits.sort((a, b) => b.score - a.score || Number(a.id) - Number(b.id))
}

const QUERIES: Record<string, unknown>[] = [
  { term: 'search' },
  { term: 'query engine' },
  { term: 'shard', properties: ['title'] },
  { term: 'que' },
  { term: 'serch', tolerance: 1 },
  { term: 'search engine', boost: { title: 3 } },
  { term: 'search query', threshold: 0 },
  { term: 'search', where: { tag: { eq: 'a' } } },
  { term: 'search', relevance: { k: 1.5, b: 0.5, d: 0.25 } }
]

describe('setCorpusStatistics', () => {
  it.each(QUERIES)('scores shards bit-identically to the full corpus: %o', async (params) => {
    const { full, shards } = await setup()
    const expected = (await search(full, { ...params, limit: 100 } as never)).hits.map(({ id, score }) => ({
      id,
      score
    }))

    expect(expected.length).toBeGreaterThan(0)
    expect(await mergedSearch(shards, params)).toEqual(expected)
  })

  it('differs from the full corpus without statistics, and getCorpusStatistics reads them back', async () => {
    const { full, shards, stats } = await setup()
    expect(internals.getCorpusStatistics(shards[0])).toBe(stats)

    for (const shard of shards) {
      internals.setCorpusStatistics(shard, undefined)
    }
    expect(internals.getCorpusStatistics(shards[0])).toBeUndefined()

    const expected = (await search(full, { term: 'search', limit: 100 })).hits.map(({ id, score }) => ({ id, score }))
    expect(await mergedSearch(shards, { term: 'search' })).not.toEqual(expected)
  })

  it('is read at search time and survives load()', async () => {
    const { full, shards, stats } = await setup()
    const reloaded = newDb()
    internals.setCorpusStatistics(reloaded, stats)
    load(reloaded, save(shards[0]))

    const before = (await search(reloaded, { term: 'search' })).hits.map((hit) => hit.score)
    stats.docsCount *= 10
    const after = (await search(reloaded, { term: 'search' })).hits.map((hit) => hit.score)
    expect(after).not.toEqual(before)

    stats.docsCount /= 10
    const expected = new Map((await search(full, { term: 'search', limit: 100 })).hits.map((h) => [h.id, h.score]))
    for (const hit of (await search(reloaded, { term: 'search' })).hits) {
      expect(hit.score).toBe(expected.get(hit.id))
    }
  })
})
