import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import type { ObjectStorage } from '@zbsearch/edge-core'
import { afterAll, describe, expect, it } from 'vitest'
import {
  IndexedDBStorage,
  MemoryStorage,
  jsonShardCodec,
  openShardedDatabase,
  type ShardCodec,
  type ShardStorage
} from '../src/index.js'
import { FileSystemStorage } from '../src/node.js'
import { SCHEMA, corpusWords, makeCorpus } from './corpus.js'
import { expectParity, singleInstance } from './helpers.js'

// Edge runtime adapters (R2, S3) implement edge-core's ObjectStorage; they must plug in unchanged.
const edgeStorageIsAccepted: (storage: ObjectStorage) => ShardStorage = (storage) => storage
void edgeStorageIsAccepted

;(globalThis as { IDBKeyRange?: unknown }).IDBKeyRange ??= IDBKeyRange

const directories: string[] = []
afterAll(async () => {
  for (const directory of directories) await rm(directory, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zbsearch-sharded-'))
  directories.push(directory)
  return directory
}

const bytes = (text: string) => new TextEncoder().encode(text)
const text = (value: { body: Uint8Array } | null) => (value ? new TextDecoder().decode(value.body) : null)

async function keys(storage: ShardStorage, prefix: string): Promise<string[]> {
  const out: string[] = []
  for await (const { key } of storage.list(prefix)) out.push(key)
  return out
}

const adapters: [string, () => Promise<ShardStorage>][] = [
  ['MemoryStorage', async () => new MemoryStorage()],
  ['FileSystemStorage', async () => new FileSystemStorage(await tempDir())],
  ['IndexedDBStorage', async () => new IndexedDBStorage({ name: `db-${Math.random()}`, indexedDB: new IDBFactory() })]
]

describe.each(adapters)('%s', (_, make) => {
  it('gets, puts, overwrites, deletes and lists by prefix in order', async () => {
    const storage = await make()
    expect(await storage.get('state.json')).toBeNull()

    const body = bytes('first')
    await storage.put('state.json', body)
    body[0] = 0 // callers may reuse their buffers
    expect(text(await storage.get('state.json'))).toBe('first')
    await storage.put('state.json', bytes('second'))
    expect(text(await storage.get('state.json'))).toBe('second')

    await storage.put('wal/0000000000000002', bytes('b'))
    await storage.put('wal/0000000000000001', bytes('a'))
    await storage.put('shards/1/3', bytes('s'))
    await storage.put('shards/10/4', bytes('t'))
    expect(await keys(storage, 'wal/')).toEqual(['wal/0000000000000001', 'wal/0000000000000002'])
    expect(await keys(storage, 'shards/1/')).toEqual(['shards/1/3'])
    expect(await keys(storage, 'shards/')).toEqual(['shards/1/3', 'shards/10/4'])

    await storage.delete('wal/0000000000000001')
    await storage.delete('missing')
    expect(await keys(storage, 'wal/')).toEqual(['wal/0000000000000002'])
  })

  it('holds a sharded database across reopenings', async () => {
    const docs = makeCorpus(150, 3, 300, 1)
    const words = corpusWords(3, 300)
    const single = await singleInstance(docs)
    const storage = await make()

    const db = await openShardedDatabase({ schema: SCHEMA, storage, maxDocsPerShard: 40, compactEvery: 2 })
    await db.insertMultiple(structuredClone(docs.slice(0, 100)))
    await db.compact()
    await db.insertMultiple(structuredClone(docs.slice(100)))

    const queries = [
      { term: words[0] },
      { term: `${words[1]} ${words[20]}`, where: { collection: { eq: 'art' } } },
      { mode: 'vector' as const, vector: { value: docs[4].embedding, property: 'embedding' }, similarity: 0.5 }
    ]
    const reopened = await openShardedDatabase({ storage, memoryBudget: 1 })
    await expectParity(reopened, single, queries)
    await reopened.close()
    await expect(reopened.search({ term: 'x' })).rejects.toThrow(/closed/)

    const again = await openShardedDatabase({ storage })
    await expectParity(again, single, queries)
  })
})

describe('FileSystemStorage', () => {
  it('rejects keys escaping its directory and never lists temporary files', async () => {
    const directory = await tempDir()
    const storage = new FileSystemStorage(directory)
    await expect(storage.put('../evil', bytes('x'))).rejects.toThrow(/invalid storage key/)
    await expect(storage.get('/abs')).rejects.toThrow(/invalid storage key/)
    await storage.put('wal/0000000000000001', bytes('a'))
    expect(await readdir(join(directory, 'wal'))).toEqual(['0000000000000001'])
    expect(await keys(storage, '')).toEqual(['wal/0000000000000001'])
  })
})

describe('ShardCodec', () => {
  it('is pluggable: a custom codec sees every shard write and read', async () => {
    let encoded = 0
    let decoded = 0
    const counting: ShardCodec = {
      encode(db) {
        encoded++
        return jsonShardCodec.encode(db)
      },
      async decode(db, source) {
        decoded++
        // Streaming sources (chunk iterables) are accepted too.
        const all = source as Uint8Array
        await jsonShardCodec.decode(db, [all.subarray(0, 10), all.subarray(10)])
      }
    }
    const storage = new MemoryStorage()
    const db = await openShardedDatabase({ schema: SCHEMA, storage, codec: counting, maxDocsPerShard: 50 })
    await db.insertMultiple(makeCorpus(120, 5, 300, 1))
    await db.compact()
    expect(encoded).toBe(3)

    const reopened = await openShardedDatabase({ storage, codec: counting })
    expect((await reopened.search({ term: corpusWords(5, 300)[0] })).count).toBeGreaterThan(0)
    expect(decoded).toBe(3)
  })
})
