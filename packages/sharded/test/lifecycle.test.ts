import { insert, remove, update, upsert } from 'zbsearch'
import { describe, expect, it } from 'vitest'
import { MemoryStorage, openShardedDatabase, type ShardStorage, type ShardedSearchParams } from '../src/index.js'
import { SCHEMA, corpusWords, makeCorpus, type Passage } from './corpus.js'
import { expectParity, singleInstance } from './helpers.js'

const DOCS = makeCorpus(400, 7, 800, 2)
const EXTRA = makeCorpus(520, 99, 800, 2).slice(400)
const WORDS = corpusWords(7)
const EXTRA_WORDS = corpusWords(99)
const docs = () => structuredClone(DOCS)

function queries(): ShardedSearchParams[] {
  return [
    { term: WORDS[0] },
    { term: `${WORDS[2]} ${WORDS[30]}` },
    { term: WORDS[200] },
    { term: EXTRA_WORDS[1] },
    { term: `${WORDS[4]} ${EXTRA_WORDS[9]}`, threshold: 0 },
    { term: WORDS[1], where: { collection: { eq: 'history' } }, limit: 20 },
    { term: WORDS[3], where: { itemKey: 'ITEM2' } },
    { where: { year: { lte: 1995 } } },
    { mode: 'vector', vector: { value: DOCS[5].embedding, property: 'embedding' }, similarity: 0.4 },
    {
      mode: 'hybrid',
      term: WORDS[6],
      vector: { value: DOCS[250].embedding, property: 'embedding' },
      similarity: 0.4
    },
    { limit: 20, offset: 380 }
  ]
}

/** The same writes against a single instance (core) and a sharded database. */
async function applyWrites(
  single: Awaited<ReturnType<typeof singleInstance>>,
  sharded: Awaited<ReturnType<typeof openShardedDatabase>>
): Promise<void> {
  const extra = structuredClone(EXTRA)
  for (const doc of extra.slice(0, 60)) {
    await insert(single, structuredClone(doc) as never)
  }
  await sharded.insertMultiple(extra.slice(0, 60))

  for (const id of ['p3', 'p57', 'p58', 'p200', 'p399', 'p401']) {
    await remove(single, id)
  }
  expect(await sharded.removeMultiple(['p3', 'p57', 'p58', 'p200', 'p399', 'p401', 'missing'])).toBe(6)

  const changed: Passage = { ...structuredClone(DOCS[10]), text: `${WORDS[0]} ${WORDS[0]} rewritten`, year: 1980 }
  await update(single, 'p10', structuredClone(changed) as never)
  await sharded.update('p10', changed)

  // Moves the document to another partition.
  const moved: Passage = { ...structuredClone(DOCS[20]), itemKey: 'ITEM40', collection: 'law' }
  await upsert(single, structuredClone(moved) as never)
  await sharded.upsert(moved)

  // Re-inserting a removed ID keeps its place in the insertion order, as in core.
  await insert(single, structuredClone(DOCS[57]) as never)
  await sharded.insert(structuredClone(DOCS[57]))

  for (const doc of extra.slice(60)) {
    await upsert(single, structuredClone(doc) as never)
    await sharded.upsert(doc)
  }
}

describe('write path', () => {
  it('stays identical to a single instance after inserts, updates, upserts and removals', async () => {
    const single = await singleInstance(DOCS)
    const sharded = await openShardedDatabase({ schema: SCHEMA, partitionBy: 'itemKey', maxDocsPerShard: 64 })
    await sharded.insertMultiple(docs())
    await expectParity(sharded, single, queries())

    await applyWrites(single, sharded)
    expect(sharded.count()).toBe(DOCS.length + EXTRA.length - 5)
    await expectParity(sharded, single, queries())

    expect(await sharded.getByID('p10')).toMatchObject({ year: 1980 })
    expect(await sharded.getByID('p3')).toBeUndefined()
  })

  it('updates the average length of a stored string[] property once per removed document, as core does', async () => {
    const corpus = makeCorpus(120, 11, 300, 3)
    const words = corpusWords(11, 300)
    const single = await singleInstance(corpus)
    const sharded = await openShardedDatabase({ schema: SCHEMA, maxDocsPerShard: 32 })
    await sharded.insertMultiple(structuredClone(corpus))

    for (const id of ['p0', 'p7', 'p64', 'p100']) await remove(single, id)
    expect(await sharded.removeMultiple(['p0', 'p7', 'p64', 'p100'])).toBe(4)

    await expectParity(sharded, single, [
      { term: words[0], properties: ['tags'] },
      { term: `${words[1]} ${words[5]}`, properties: ['tags'] },
      { term: `${words[2]} ${words[3]}` }
    ])
  })

  it('rejects duplicate IDs and schema violations before writing anything', async () => {
    const sharded = await openShardedDatabase({ schema: SCHEMA })
    await sharded.insertMultiple(docs().slice(0, 5))
    await expect(sharded.insert(docs()[0])).rejects.toThrow(/already exists/)
    await expect(sharded.insertMultiple([docs()[6], docs()[6]])).rejects.toThrow(/already exists/)
    await expect(sharded.insert({ ...docs()[7], year: 'nope' })).rejects.toThrow(/schema/)
    expect(sharded.count()).toBe(5)
    expect(sharded.getStats().pendingWalRecords).toBe(1)
  })

  it('assigns IDs to documents without one, durably', async () => {
    const storage = new MemoryStorage()
    const sharded = await openShardedDatabase({ schema: SCHEMA, storage })
    const { id: _id, ...anonymous } = docs()[0]
    const id = await sharded.insert(anonymous)
    expect(typeof id).toBe('string')
    const reopened = await openShardedDatabase({ storage })
    expect(await reopened.getByID(id)).toMatchObject({ text: DOCS[0].text })
  })
})

describe('memory budget', () => {
  it('returns the same results while evicting under a tiny budget', async () => {
    const single = await singleInstance(DOCS)
    const sharded = await openShardedDatabase({
      schema: SCHEMA,
      maxDocsPerShard: 50,
      memoryBudget: 1, // nothing fits: only the shard in use stays loaded
      compactEvery: 0
    })
    await sharded.insertMultiple(docs())
    expect(sharded.getStats().residentShards).toBe(0)

    await expectParity(sharded, single, queries())
    const stats = sharded.getStats()
    expect(stats.residentShards).toBe(0)
    expect(stats.evictions).toBeGreaterThan(stats.shards)
    expect(stats.loads).toBeGreaterThan(stats.shards)

    await applyWrites(single, sharded)
    await expectParity(sharded, single, queries())
    expect(sharded.getStats().residentShards).toBe(0)
  })

  it('keeps the estimated resident size under the budget and reports cold loads', async () => {
    const sharded = await openShardedDatabase({ schema: SCHEMA, maxDocsPerShard: 40 })
    await sharded.insertMultiple(docs())
    await sharded.compact()
    const shardBytes = sharded.getStats().residentBytes / sharded.getStats().shards

    const budget = Math.round(sharded.getStats().globalBytes + shardBytes * 3.5)
    const storage = new MemoryStorage()
    const limited = await openShardedDatabase({ schema: SCHEMA, maxDocsPerShard: 40, memoryBudget: budget, storage })
    await limited.insertMultiple(docs())
    for (const params of queries()) {
      await limited.search(params)
      const stats = limited.getStats()
      expect(stats.residentBytes + stats.globalBytes).toBeLessThanOrEqual(budget)
      expect(stats.residentShards).toBeLessThanOrEqual(3)
    }

    const cold = await limited.search({ term: WORDS[0], where: { itemKey: 'ITEM1' } })
    const warm = await limited.search({ term: WORDS[0], where: { itemKey: 'ITEM1' } })
    expect(cold.shards.candidates).toBe(1)
    expect(warm.shards.loaded).toBe(0)
    expect(warm.hits).toEqual(cold.hits)
  })
})

/** Storage that fails every put (`failOn`) or get (`failGet`) of matching keys while armed. */
class FailingStorage extends MemoryStorage {
  failOn: ((key: string) => boolean) | undefined
  failGet: ((key: string) => boolean) | undefined

  async get(key: string): ReturnType<MemoryStorage['get']> {
    if (this.failGet?.(key)) {
      throw new Error(`simulated read failure of ${key}`)
    }
    return super.get(key)
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    if (this.failOn?.(key)) {
      throw new Error(`simulated crash writing ${key}`)
    }
    return super.put(key, body)
  }
}

describe('write-ahead log and compaction', () => {
  it('recovers every acknowledged write after a crash', async () => {
    const single = await singleInstance(DOCS)
    const storage = new MemoryStorage()
    const sharded = await openShardedDatabase({
      schema: SCHEMA,
      storage,
      partitionBy: 'collection',
      maxDocsPerShard: 60,
      compactEvery: 0
    })
    await sharded.insertMultiple(docs())
    await sharded.compact()
    expect([...storage.entries.keys()].filter((key) => key.startsWith('wal/'))).toEqual([])

    await applyWrites(single, sharded)
    expect(sharded.getStats().pendingWalRecords).toBeGreaterThan(0)

    // Crash: the process dies without compacting or closing.
    const recovered = await openShardedDatabase({ storage })
    expect(recovered.count()).toBe(sharded.count())
    await expectParity(recovered, single, queries())

    await recovered.close()
    const reopened = await openShardedDatabase({ storage, schema: SCHEMA })
    expect(reopened.getStats().pendingWalRecords).toBe(0)
    await expectParity(reopened, single, queries())
  })

  it('recovers from a crash in the middle of a compaction and cleans up its leftovers', async () => {
    const single = await singleInstance(DOCS)
    const storage = new FailingStorage()
    const sharded = await openShardedDatabase({ schema: SCHEMA, storage, maxDocsPerShard: 50, compactEvery: 0 })
    await sharded.insertMultiple(docs())
    await sharded.compact()
    const committed = new Set(storage.entries.keys())

    await applyWrites(single, sharded)
    // New snapshots get written, then the commit point (the state) fails.
    storage.failOn = (key) => key === 'state.json'
    await expect(sharded.compact()).rejects.toThrow(/simulated crash/)
    expect([...storage.entries.keys()].some((key) => !committed.has(key) && key.startsWith('shards/'))).toBe(true)
    storage.failOn = undefined

    const recovered = await openShardedDatabase({ storage })
    await expectParity(recovered, single, queries())
    // Snapshots the crashed compaction wrote were never committed: gone.
    const shardKeys = [...storage.entries.keys()].filter((key) => key.startsWith('shards/'))
    expect(shardKeys.every((key) => committed.has(key))).toBe(true)
  })

  it('evicting a modified shard writes it without committing it', async () => {
    const single = await singleInstance(DOCS)
    const storage = new MemoryStorage()
    const sharded = await openShardedDatabase({
      schema: SCHEMA,
      storage,
      maxDocsPerShard: 50,
      memoryBudget: 1,
      compactEvery: 0
    })
    await sharded.insertMultiple(docs())
    expect(sharded.getStats().flushes).toBeGreaterThan(0)
    await applyWrites(single, sharded)

    const recovered = await openShardedDatabase({ storage, memoryBudget: 1 })
    await expectParity(recovered, single, queries())
  })

  it('compacts automatically and the state survives reopening with another budget', async () => {
    const single = await singleInstance(DOCS)
    const storage = new MemoryStorage()
    const sharded = await openShardedDatabase({ schema: SCHEMA, storage, maxDocsPerShard: 64, compactEvery: 3 })
    await sharded.insertMultiple(docs())
    await applyWrites(single, sharded)
    expect(sharded.getStats().compactions).toBeGreaterThan(0)
    expect(sharded.getStats().pendingWalRecords).toBeLessThan(3)

    const reopened = await openShardedDatabase({ storage, memoryBudget: 2_000_000 })
    await expectParity(reopened, single, queries())
    await expect(openShardedDatabase({ storage, schema: { other: 'string' } })).rejects.toThrow(/schema/)
  })

  it('fails to open, keeping the WAL, when a shard cannot be read while replaying it', async () => {
    const storage = new FailingStorage()
    const sharded = await openShardedDatabase({ schema: SCHEMA, storage, maxDocsPerShard: 50, compactEvery: 0 })
    await sharded.insertMultiple(docs().slice(0, 120))
    await sharded.compact()
    await sharded.remove('p3')
    await sharded.insert(structuredClone(EXTRA[0]))
    const wal = [...storage.entries.keys()].filter((key) => key.startsWith('wal/'))
    expect(wal.length).toBe(2)

    // Crash, then the shard snapshots cannot be read while recovering.
    storage.failGet = (key) => key.startsWith('shards/')
    await expect(openShardedDatabase({ storage })).rejects.toThrow(/simulated read failure/)
    expect([...storage.entries.keys()].filter((key) => key.startsWith('wal/'))).toEqual(wal)

    storage.failGet = undefined
    const recovered = await openShardedDatabase({ storage })
    await recovered.compact()
    const reopened = await openShardedDatabase({ storage })
    expect(reopened.count()).toBe(120)
    expect(await reopened.getByID('p3')).toBeUndefined()
    expect(await reopened.getByID(EXTRA[0].id)).toMatchObject({ text: EXTRA[0].text })
  })

  it('logs the values an insert reads through inherited getters, nested and vector paths included', async () => {
    class Point {
      constructor(private readonly coords: [number, number]) {}
      get lat() {
        return this.coords[0]
      }
      get lon() {
        return this.coords[1]
      }
    }
    class Meta {
      constructor(private readonly raw: number) {}
      get pages() {
        return this.raw
      }
    }
    class Note {
      extra = 'kept'
      constructor(
        readonly id: string,
        private readonly body: string,
        private readonly raw: number
      ) {}
      get text() {
        return this.body
      }
      get meta() {
        return new Meta(this.raw)
      }
      get location() {
        return new Point([this.raw, this.raw / 2])
      }
      get embedding() {
        return [this.raw, 1, 0]
      }
    }

    const schema = {
      id: 'string',
      text: 'string',
      meta: { pages: 'number' },
      location: 'geopoint',
      embedding: 'vector[3]'
    } as const
    const storage = new MemoryStorage()
    // Partitioned on an inherited value: one shard per document.
    const sharded = await openShardedDatabase({ schema, storage, partitionBy: 'meta.pages', compactEvery: 0 })
    await sharded.insertMultiple([new Note('n1', 'inherited getter text', 12), new Note('n2', 'other words', 40)])

    const search = async (db: typeof sharded) => ({
      text: (await db.search({ term: 'inherited' })).hits.map((hit) => hit.id),
      pages: (await db.search({ where: { 'meta.pages': { eq: 12 } } })).hits.map((hit) => hit.id),
      geo: (
        await db.search({
          where: { location: { radius: { coordinates: { lat: 40, lon: 20 }, value: 10, unit: 'km' } } }
        })
      ).hits.map((hit) => hit.id),
      vector: (
        await db.search({ mode: 'vector', vector: { value: [12, 1, 0], property: 'embedding' }, similarity: 0.9999 })
      ).hits.map((hit) => hit.id)
    })
    const expected = { text: ['n1'], pages: ['n1'], geo: ['n2'], vector: ['n1'] }
    expect(await search(sharded)).toEqual(expected)

    // Crash before compacting: the WAL alone holds the documents.
    const recovered = await openShardedDatabase({ storage })
    expect(await search(recovered)).toEqual(expected)
    expect(recovered.getStats().shards).toBe(2)
    // The own properties the documents store keeps, plus the values the insert read
    expect(await recovered.getByID('n1')).toEqual({
      id: 'n1',
      extra: 'kept',
      body: 'inherited getter text',
      raw: 12,
      text: 'inherited getter text',
      meta: { raw: 12, pages: 12 },
      location: { coords: [12, 6], lat: 12, lon: 6 }
    })

    // The inserted documents are kept as they are in the live database.
    expect(await sharded.getByID('n1')).toBeInstanceOf(Note)
  })

  it('a WAL record whose write failed replays to the same state', async () => {
    const storage = new MemoryStorage() as ShardStorage
    const sharded = await openShardedDatabase({ schema: SCHEMA, storage, compactEvery: 0 })
    await sharded.insertMultiple(docs().slice(0, 20))
    await sharded.remove('p1')
    const before = await sharded.search({ term: WORDS[0] })
    const recovered = await openShardedDatabase({ storage })
    expect((await recovered.search({ term: WORDS[0] })).hits).toEqual(before.hits)
  })
})
