import { insert, remove, search } from 'zbsearch'
import { flat } from 'zbsearch/trees/vector-flat'
import { describe, expect, it } from 'vitest'
import { MemoryStorage, openShardedDatabase, type ShardCreateOptions, type ShardedSearchParams } from '../src/index.js'
import { DIMS, SCHEMA, corpusWords, makeCorpus } from './corpus.js'
import { expectParity, singleInstance } from './helpers.js'

const DOCS = makeCorpus(360, 11, 600, 1)
const WORDS = corpusWords(11, 600)
const docs = () => structuredClone(DOCS)

function queries(): ShardedSearchParams[] {
  return [
    { term: WORDS[0] },
    { term: `${WORDS[2]} ${WORDS[25]}`, threshold: 0 },
    { term: WORDS[1], exact: true },
    { term: `${WORDS[3]} ${WORDS[4]}`, exact: true, threshold: 0 },
    { term: WORDS[2], where: { year: { gte: 2005 } } },
    { term: WORDS[5], where: { collection: { eq: 'art' }, open: true } },
    { where: { year: { lt: 1993 } } },
    { mode: 'vector', vector: { value: DOCS[9].embedding, property: 'embedding' }, similarity: 0.3 },
    {
      mode: 'hybrid',
      term: WORDS[0],
      vector: { value: DOCS[200].embedding, property: 'embedding' },
      similarity: 0.3,
      where: { page: { between: [2, 6] } }
    }
  ]
}

async function pair(createOptions: ShardCreateOptions, options: Record<string, unknown> = {}) {
  const single = await singleInstance(DOCS, createOptions as Record<string, unknown>)
  const storage = new MemoryStorage()
  const sharded = await openShardedDatabase({
    schema: SCHEMA,
    storage,
    maxDocsPerShard: 45,
    createOptions,
    ...options
  })
  await sharded.insertMultiple(docs())
  return { single, sharded, storage }
}

async function removeBoth(
  single: Awaited<ReturnType<typeof singleInstance>>,
  sharded: Awaited<ReturnType<typeof openShardedDatabase>>
) {
  for (const id of ['p1', 'p50', 'p51', 'p300']) await remove(single, id)
  await sharded.removeMultiple(['p1', 'p50', 'p51', 'p300'])
  const extra = makeCorpus(380, 12, 600, 1).slice(360)
  for (const doc of extra) await insert(single, structuredClone(doc) as never)
  await sharded.insertMultiple(structuredClone(extra))
}

describe('documents store settings (indexed but not stored)', () => {
  it('vectors are not stored by default: hits rebuild them from the shard vector index', async () => {
    const { single, sharded } = await pair({})
    const params = {
      mode: 'vector' as const,
      vector: { value: DOCS[9].embedding, property: 'embedding' },
      similarity: 0.3,
      includeVectors: true
    }
    const expected = await search(single, params as never)
    const actual = await sharded.search(params)
    expect(actual.hits.map((hit) => hit.id)).toEqual(expected.hits.map((hit) => hit.id))
    for (let i = 0; i < expected.hits.length; i++) {
      expect(actual.hits[i].document.embedding).toEqual(expected.hits[i].document.embedding)
      expect(actual.hits[i].document.embedding).toHaveLength(DIMS)
    }

    const without = await sharded.search({ ...params, includeVectors: false })
    expect(without.hits[0].document.embedding).toBeNull()
    expect((await sharded.getByID('p9'))?.embedding).toBeUndefined()

    // Vector cones are rebuilt from the index when a shard is written.
    const byCollection = await openShardedDatabase({ schema: SCHEMA, partitionBy: 'collection', maxDocsPerShard: 40 })
    await byCollection.insertMultiple(docs())
    await byCollection.compact()
    const pruned = await byCollection.search({ ...params, similarity: 0.95 })
    expect(pruned.hits[0].id).toBe('p9')
    expect(pruned.shards.candidates).toBeLessThan(byCollection.getStats().shards / 2)
  })

  it('store.vectors keeps them in the documents store', async () => {
    const { single, sharded } = await pair({ store: { vectors: true } })
    await expectParity(sharded, single, queries())
    expect((await sharded.getByID('p9'))?.embedding).toHaveLength(DIMS)
  })

  it('store.exclude: same rankings, filters and pruning on excluded fields, through removals', async () => {
    const createOptions = { store: { exclude: ['text', 'year', 'collection', 'tags'] } }
    const { single, sharded, storage } = await pair(createOptions)
    await expectParity(sharded, single, queries())

    const doc = await sharded.getByID('p7')
    expect(doc).toBeDefined()
    expect(doc).not.toHaveProperty('text')
    expect(doc).not.toHaveProperty('year')

    // Summaries of excluded number/enum fields come from the index, so they still prune.
    await sharded.compact()
    const result = await sharded.search({ term: WORDS[0], where: { year: { gt: 3000 } } })
    expect(result.shards.candidates).toBe(0)

    await removeBoth(single, sharded)
    await expectParity(sharded, single, queries())

    const reopened = await openShardedDatabase({ storage, createOptions })
    await expectParity(reopened, single, queries())
  })
})

describe('vector index configuration', () => {
  it("flat({ quantization: 'none' }) stays exact", async () => {
    const createOptions = { indexes: { embedding: flat({ quantization: 'none' }) } }
    const { single, sharded, storage } = await pair(createOptions)
    await expectParity(sharded, single, queries())
    await removeBoth(single, sharded)
    await sharded.compact()
    const reopened = await openShardedDatabase({ storage, createOptions, memoryBudget: 1 })
    await expectParity(reopened, single, queries())
  })

  it('quantized indexes are passed to every shard and survive snapshots', async () => {
    const createOptions = { indexes: { embedding: flat({ quantization: 'int8' }) } }
    const { sharded, storage } = await pair(createOptions)
    await sharded.compact()
    const reopened = await openShardedDatabase({ storage, createOptions, memoryBudget: 1 })

    for (const i of [3, 120, 333]) {
      const result = await reopened.search({
        mode: 'vector',
        vector: { value: DOCS[i].embedding, property: 'embedding' },
        similarity: 0.5
      })
      // Approximate scores: no shard is pruned by similarity bounds, and the document itself ranks first.
      expect(result.shards.candidates).toBe(reopened.getStats().shards)
      expect(result.hits[0].id).toBe(`p${i}`)
      expect(result.hits[0].score).toBeGreaterThan(0.95)
    }
  })
})
