import { describe, expect, it } from 'vitest'
import { create, insert, search } from 'zbsearch'
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
  await insert(db, {
    quote: 'I have not failed. I have found 10,000 ways that will not work.',
    author: 'Thomas A. Edison'
  })
  await insert(db, { quote: 'Be yourself; everyone else is already taken.', author: 'Oscar Wilde' })

  return db
}

const formats: PersistenceFormat[] = ['json', 'dpack', 'binary', 'seqproto']

describe('persistToStorage / restoreFromStorage', () => {
  for (const format of formats) {
    it(`round-trips through a storage backend (${format})`, async () => {
      const db = await generateTestDBInstance()
      const original = await search(db, { mode: 'fulltext', term: 'way' })

      const storage = new MemoryStorage()
      await persistToStorage(db, storage, 'my-index', { format })

      expect(storage.store.has('my-index'), 'wrote a payload under the key').toBeTruthy()

      const restored = await restoreFromStorage(storage, 'my-index', { format })
      const restoredResults = await search(restored, { mode: 'fulltext', term: 'way' })

      expect(restoredResults.count, 'same hit count after restore').toBe(original.count)
      expect(
        restoredResults.hits.map((h) => h.id),
        'same hit ids after restore'
      ).toEqual(original.hits.map((h) => h.id))
    })
  }

  it('defaults to the compact binary format (no hex doubling)', async () => {
    const db = await generateTestDBInstance()
    const storage = new MemoryStorage()
    await persistToStorage(db, storage, 'default-format')
    // The binary format used to be persisted as a hex string (2 chars/byte).
    // Raw msgpack bytes must be materially smaller than that hex encoding.
    const jsonStorage = new MemoryStorage()
    await persistToStorage(db, jsonStorage, 'as-json', { format: 'json' })
    const binarySize = storage.store.get('default-format')!.byteLength
    const jsonSize = jsonStorage.store.get('as-json')!.byteLength
    expect(binarySize < jsonSize, `binary (${binarySize}B) should be smaller than json (${jsonSize}B)`).toBeTruthy()
  })

  it('throws a clear error when the key is missing', async () => {
    const storage = new MemoryStorage()
    await expect(restoreFromStorage(storage, 'nope'), undefined).rejects.toThrow(
      new Error(STORAGE_KEY_NOT_FOUND('nope'))
    )
  })

  it('restore respects a non-default format', async () => {
    const db = await generateTestDBInstance()
    const storage = new MemoryStorage()
    await persistToStorage(db, storage, 'k', { format: 'json' })
    const restored = await restoreFromStorage(storage, 'k', { format: 'json' })
    const results = await search(restored, { mode: 'fulltext', term: 'yourself' })
    expect(results.count, 'restored index is queryable').toBe(1)
  })
})

describe('IndexedDBStorage', async () => {
  let fakeFactory: IDBFactory | undefined
  try {
    // fake-indexeddb ships an IDBFactory we can inject without touching globals.
    const mod = await import('fake-indexeddb')
    fakeFactory = new (mod.IDBFactory ?? (mod as any).default)()
  } catch {
    fakeFactory = undefined
  }

  it('throws when IndexedDB is unavailable and no factory is given', async () => {
    const savedGlobal = (globalThis as any).indexedDB
    // Ensure no ambient indexedDB leaks into the constructor.
    delete (globalThis as any).indexedDB
    expect(() => new IndexedDBStorage()).toThrow(new Error(INDEXEDDB_NOT_AVAILABLE()))
    if (savedGlobal !== undefined) {
      ;(globalThis as any).indexedDB = savedGlobal
    }
  })

  if (!fakeFactory) {
    return
  }

  it('recovers after an open failure instead of bricking', async () => {
    // A factory whose first open() fails, then delegates to the real one.
    let failedOnce = false
    const flakyFactory = {
      open(name: string, version?: number) {
        if (!failedOnce) {
          failedOnce = true
          const request: any = { onerror: null, onsuccess: null, onupgradeneeded: null, error: new Error('boom') }
          Promise.resolve().then(() => request.onerror && request.onerror())
          return request
        }
        return (fakeFactory as IDBFactory).open(name, version)
      }
    } as unknown as IDBFactory

    const storage = new IndexedDBStorage({ indexedDB: flakyFactory })

    // First operation fails because the initial open() errors...
    await expect(storage.get('anything'), 'first open rejects').rejects.toThrow()

    // ...but the instance must not be permanently bricked: a retry re-opens.
    const db = await generateTestDBInstance()
    await persistToStorage(db, storage, 'after-recovery')
    const restored = await restoreFromStorage(storage, 'after-recovery')
    const results = await search(restored, { mode: 'fulltext', term: 'yourself' })
    expect(results.count, 'instance recovered and round-trips after the failure').toBe(1)

    await storage.close()
  })

  it('round-trips a database through IndexedDB', async () => {
    const db = await generateTestDBInstance()
    const original = await search(db, { mode: 'fulltext', term: 'way' })

    const storage = new IndexedDBStorage({ indexedDB: fakeFactory })
    await persistToStorage(db, storage, 'idb-index')

    const restored = await restoreFromStorage(storage, 'idb-index')
    const restoredResults = await search(restored, { mode: 'fulltext', term: 'way' })

    expect(restoredResults.count, 'same hit count after restore').toBe(original.count)

    // get on a missing key returns null (surfaced as a clear restore error)
    await expect(restoreFromStorage(storage, 'missing'), undefined).rejects.toThrow(
      new Error(STORAGE_KEY_NOT_FOUND('missing'))
    )

    await storage.delete('idb-index')
    const afterDelete = await storage.get('idb-index')
    expect(afterDelete, 'delete removes the snapshot').toBe(null)

    await storage.close()
  })
})
