import { create, insert, search } from 'zbsearch'
import t from 'tap'
import { persistToStorage, restoreFromStorage } from '../src/storage.js'
import type { PersistenceStorage } from '../src/storage.js'
import { IndexedDBStorage } from '../src/indexeddb.js'
import { STORAGE_KEY_NOT_FOUND, INDEXEDDB_NOT_AVAILABLE } from '../src/errors.js'
import type { PersistenceFormat } from '../src/types.js'

// In-memory storage backend implementing the PersistenceStorage contract.
// Records byte payloads so we can assert on what was written.
class MemoryStorage implements PersistenceStorage {
  store = new Map<string, Uint8Array>()

  async get(key: string): Promise<{ body: Uint8Array } | null> {
    const body = this.store.get(key)
    return body ? { body } : null
  }

  async put(key: string, body: Uint8Array): Promise<{ etag: string }> {
    this.store.set(key, body)
    return { etag: '' }
  }
}

async function generateTestDBInstance() {
  const db = await create({
    schema: {
      quote: 'string',
      author: 'string'
    } as const
  })

  await insert(db, { quote: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' })
  await insert(db, { quote: 'I have not failed. I have found 10,000 ways that will not work.', author: 'Thomas A. Edison' })
  await insert(db, { quote: 'Be yourself; everyone else is already taken.', author: 'Oscar Wilde' })

  return db
}

const formats: PersistenceFormat[] = ['json', 'dpack', 'binary', 'seqproto']

t.test('persistToStorage / restoreFromStorage', async (t) => {
  t.plan(formats.length + 3)

  for (const format of formats) {
    t.test(`round-trips through a storage backend (${format})`, async (t) => {
      t.plan(3)
      const db = await generateTestDBInstance()
      const original = await search(db, { mode: 'fulltext', term: 'way' })

      const storage = new MemoryStorage()
      await persistToStorage(db, storage, 'my-index', { format })

      t.ok(storage.store.has('my-index'), 'wrote a payload under the key')

      const restored = await restoreFromStorage(storage, 'my-index', { format })
      const restoredResults = await search(restored, { mode: 'fulltext', term: 'way' })

      t.equal(restoredResults.count, original.count, 'same hit count after restore')
      t.same(
        restoredResults.hits.map((h) => h.id),
        original.hits.map((h) => h.id),
        'same hit ids after restore'
      )
    })
  }

  t.test('defaults to the compact binary format (no hex doubling)', async (t) => {
    t.plan(1)
    const db = await generateTestDBInstance()
    const storage = new MemoryStorage()
    await persistToStorage(db, storage, 'default-format')
    // The binary format used to be persisted as a hex string (2 chars/byte).
    // Raw msgpack bytes must be materially smaller than that hex encoding.
    const jsonStorage = new MemoryStorage()
    await persistToStorage(db, jsonStorage, 'as-json', { format: 'json' })
    const binarySize = storage.store.get('default-format')!.byteLength
    const jsonSize = jsonStorage.store.get('as-json')!.byteLength
    t.ok(binarySize < jsonSize, `binary (${binarySize}B) should be smaller than json (${jsonSize}B)`)
  })

  t.test('throws a clear error when the key is missing', async (t) => {
    t.plan(1)
    const storage = new MemoryStorage()
    await t.rejects(restoreFromStorage(storage, 'nope'), new Error(STORAGE_KEY_NOT_FOUND('nope')))
  })

  t.test('restore respects a non-default format', async (t) => {
    t.plan(1)
    const db = await generateTestDBInstance()
    const storage = new MemoryStorage()
    await persistToStorage(db, storage, 'k', { format: 'json' })
    const restored = await restoreFromStorage(storage, 'k', { format: 'json' })
    const results = await search(restored, { mode: 'fulltext', term: 'yourself' })
    t.equal(results.count, 1, 'restored index is queryable')
  })
})

t.test('IndexedDBStorage', async (t) => {
  let fakeFactory: IDBFactory | undefined
  try {
    // fake-indexeddb ships an IDBFactory we can inject without touching globals.
    const mod = await import('fake-indexeddb')
    fakeFactory = new (mod.IDBFactory ?? (mod as any).default)()
  } catch {
    fakeFactory = undefined
  }

  t.test('throws when IndexedDB is unavailable and no factory is given', async (t) => {
    t.plan(1)
    const savedGlobal = (globalThis as any).indexedDB
    // Ensure no ambient indexedDB leaks into the constructor.
    delete (globalThis as any).indexedDB
    t.throws(() => new IndexedDBStorage(), new Error(INDEXEDDB_NOT_AVAILABLE()))
    if (savedGlobal !== undefined) {
      ;(globalThis as any).indexedDB = savedGlobal
    }
  })

  if (!fakeFactory) {
    t.comment('fake-indexeddb not installed — skipping IndexedDB round-trip test')
    return
  }

  t.test('round-trips a database through IndexedDB', async (t) => {
    t.plan(3)
    const db = await generateTestDBInstance()
    const original = await search(db, { mode: 'fulltext', term: 'way' })

    const storage = new IndexedDBStorage({ indexedDB: fakeFactory })
    await persistToStorage(db, storage, 'idb-index')

    const restored = await restoreFromStorage(storage, 'idb-index')
    const restoredResults = await search(restored, { mode: 'fulltext', term: 'way' })

    t.equal(restoredResults.count, original.count, 'same hit count after restore')

    // get on a missing key returns null (surfaced as a clear restore error)
    await t.rejects(restoreFromStorage(storage, 'missing'), new Error(STORAGE_KEY_NOT_FOUND('missing')))

    await storage.delete('idb-index')
    const afterDelete = await storage.get('idb-index')
    t.equal(afterDelete, null, 'delete removes the snapshot')

    await storage.close()
  })
})
