import { describe, expect, it } from 'vitest'
import { openShardedDatabase, type ShardedSearchParams } from '../src/index.js'
import { COLLECTIONS, DIMS, SCHEMA, corpusWords, makeCorpus, rng } from './corpus.js'
import { expectParity, rankSharded, rankSingle, singleInstance, expectSameRanking } from './helpers.js'

const DOCS = makeCorpus(640)
const docs = () => structuredClone(DOCS)
const WORDS = corpusWords()

function textQueries(): ShardedSearchParams[] {
  const common = WORDS.slice(0, 3)
  const mid = WORDS.slice(40, 44)
  const rare = WORDS.slice(500, 503)
  return [
    { term: common[0] },
    { term: `${common[1]} ${mid[0]}` },
    { term: rare[0] },
    { term: `${rare[1]} ${common[2]} ${mid[1]}` },
    { term: mid[2], properties: ['title'] },
    { term: mid[3], properties: ['text', 'section'] },
    { term: `${common[0]} ${mid[0]}`, boost: { title: 3, section: 1.5 } },
    { term: mid[0].slice(0, 3) },
    { term: mid[1].slice(0, 4), prefix: false },
    { term: `${mid[2].slice(0, -1)}x`, tolerance: 1 },
    { term: `${common[1]} ${mid[1]}`, threshold: 0 },
    { term: `${common[1]} ${mid[1]} ${rare[2]}`, threshold: 0.4 },
    { term: common[0], relevance: { k: 1.5, b: 0.5, d: 0.25 } },
    { term: common[0], limit: 7, offset: 9 },
    { term: common[2], exact: true },
    { term: common[0], where: { collection: { eq: 'law' } } },
    { term: mid[0], where: { year: { between: [1995, 2002] } } },
    { term: common[1], where: { itemKey: 'ITEM12' } },
    { term: common[1], where: { or: [{ itemKey: 'ITEM3' }, { collection: { in: ['art', 'history'] } }] } },
    { term: common[2], where: { and: [{ open: true }, { page: { gte: 4 } }] } },
    { term: common[0], where: { not: { collection: { eq: 'physics' } } } },
    { term: common[0], where: { tags: WORDS[1] } },
    { term: common[0], where: { year: { gt: 3000 } } },
    { term: 'nonexistentterm' },
    { where: { collection: { eq: 'biology' } }, limit: 15 },
    { where: { itemKey: 'ITEM7' } },
    { term: '', properties: ['section'], limit: 5 },
    {},
    { limit: 5, offset: 630 }
  ]
}

function vector(seed: number): number[] {
  const random = rng(seed)
  return Array.from({ length: DIMS }, () => random() * 2 - 1)
}

function vectorQueries(): ShardedSearchParams[] {
  const near = DOCS[17].embedding
  return [
    { mode: 'vector', vector: { value: near, property: 'embedding' } },
    { mode: 'vector', vector: { value: near, property: 'embedding' }, similarity: 0.3, limit: 20 },
    { mode: 'vector', vector: { value: vector(1), property: 'embedding' }, similarity: 0.1 },
    { mode: 'vector', vector: { value: near, property: 'embedding' }, similarity: 0.5, where: { year: { lt: 2000 } } },
    { mode: 'vector', vector: { value: DOCS[300].embedding, property: 'embedding' }, includeVectors: true },
    { mode: 'hybrid', term: WORDS[0], vector: { value: near, property: 'embedding' }, similarity: 0.4 },
    {
      mode: 'hybrid',
      term: `${WORDS[3]} ${WORDS[60]}`,
      vector: { value: vector(2), property: 'embedding' },
      similarity: 0.2,
      hybridWeights: { text: 0.8, vector: 0.2 }
    },
    {
      mode: 'hybrid',
      term: WORDS[5],
      vector: { value: near, property: 'embedding' },
      similarity: 0.3,
      where: { collection: { nin: ['law'] } },
      threshold: 0.5,
      limit: 12
    },
    { mode: 'hybrid', vector: { value: near, property: 'embedding' }, similarity: 0.5 }
  ]
}

describe('sharded search matches a single instance on the same data', () => {
  for (const [label, options] of [
    ['size-based shards', { maxDocsPerShard: 48 }],
    ['packed by itemKey', { partitionBy: 'itemKey', packPartitions: true, maxDocsPerShard: 40 }],
    ['partitioned by collection', { partitionBy: 'collection', maxDocsPerShard: 1000 }]
  ] as const) {
    it(`${label}: full-text, filters, vector and hybrid`, async () => {
      const single = await singleInstance(DOCS)
      const sharded = await openShardedDatabase({ schema: SCHEMA, ...options })
      await sharded.insertMultiple(docs())
      expect(sharded.getStats().shards).toBeGreaterThan(label.endsWith('collection') ? 4 : 10)

      await expectParity(sharded, single, [...textQueries(), ...vectorQueries()])
    })
  }

  it('prunes shards by filters, terms and vector bounds', async () => {
    const sharded = await openShardedDatabase({
      schema: SCHEMA,
      partitionBy: 'itemKey',
      packPartitions: true,
      maxDocsPerShard: 40
    })
    await sharded.insertMultiple(docs())
    const total = sharded.getStats().shards

    expect((await sharded.search({ term: WORDS[0], where: { itemKey: 'ITEM12' } })).shards.candidates).toBe(1)
    expect((await sharded.search({ term: WORDS[0], where: { year: { gt: 3000 } } })).shards.candidates).toBe(0)
    expect((await sharded.search({ term: 'nonexistentterm' })).shards.candidates).toBe(0)
    expect((await sharded.search({ term: WORDS[0] })).shards.candidates).toBe(total)

    const byCollection = await openShardedDatabase({ schema: SCHEMA, partitionBy: 'collection' })
    await byCollection.insertMultiple(docs())
    const result = await byCollection.search({
      mode: 'vector',
      vector: { value: DOCS[17].embedding, property: 'embedding' },
      similarity: 0.9
    })
    expect(result.count).toBeGreaterThan(0)
    expect(result.shards.candidates).toBeLessThan(byCollection.getStats().shards)
    expect(COLLECTIONS.length).toBe(byCollection.getStats().shards)
  })

  it('approximate vector routing probes only the nearest shards', async () => {
    const sharded = await openShardedDatabase({ schema: SCHEMA, partitionBy: 'collection' })
    await sharded.insertMultiple(docs())
    const params: ShardedSearchParams = {
      mode: 'vector',
      vector: { value: DOCS[17].embedding, property: 'embedding' },
      similarity: 0.5
    }
    const probed = await sharded.search({ ...params, vectorProbe: 1 })
    expect(probed.shards.candidates).toBe(1)
    expect(probed.hits[0].id).toBe('p17')
  })

  it('rejects options it cannot merge exactly', async () => {
    const sharded = await openShardedDatabase({ schema: SCHEMA })
    await sharded.insertMultiple(docs().slice(0, 10))
    await expect(sharded.search({ term: 'a', facets: {} } as never)).rejects.toThrow(/facets/)
    await expect(sharded.search({ term: 'a', exact: true, threshold: 0.5 })).rejects.toThrow(/threshold/)
    await expect(sharded.search({ term: 'a', properties: ['nope'] })).rejects.toThrow()
    await expect(sharded.search({ term: 'a', where: { nope: 'x' } })).rejects.toThrow()
  })

  it('matches across every corpus word on a single-property query', async () => {
    const single = await singleInstance(DOCS)
    const sharded = await openShardedDatabase({ schema: SCHEMA, maxDocsPerShard: 64 })
    await sharded.insertMultiple(docs())
    for (const word of WORDS.filter((_, i) => i % 7 === 0)) {
      const params = { term: word, properties: ['text'] }
      expectSameRanking(await rankSharded(sharded, params), await rankSingle(single, params), word)
    }
  })
})
