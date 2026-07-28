import type { PersistenceStorage } from './storage.js'
import { INDEXEDDB_NOT_AVAILABLE } from './errors.js'

export interface IndexedDBStorageOptions {
  databaseName?: string
  storeName?: string
  indexedDB?: IDBFactory
}

/**
 * Durable, in-browser storage backend for ZBSearch snapshots, backed by
 * IndexedDB. Implements the {@link PersistenceStorage} contract (and the
 * `delete`/`clear` extras), so it plugs straight into `persistToStorage` /
 * `restoreFromStorage`:
 *
 * ```ts
 * import { persistToStorage, restoreFromStorage } from '@zbsearch/plugin-data-persistence'
 * import { IndexedDBStorage } from '@zbsearch/plugin-data-persistence/indexeddb'
 *
 * const storage = new IndexedDBStorage()
 * await persistToStorage(db, storage, 'my-index')
 * // later, after a reload:
 * const db = await restoreFromStorage(storage, 'my-index')
 * ```
 */
export class IndexedDBStorage implements PersistenceStorage {
  private readonly databaseName: string
  private readonly storeName: string
  private readonly factory: IDBFactory
  private dbPromise?: Promise<IDBDatabase>

  constructor(options: IndexedDBStorageOptions = {}) {
    const factory = options.indexedDB ?? (typeof indexedDB !== 'undefined' ? indexedDB : undefined)
    if (!factory) {
      throw new Error(INDEXEDDB_NOT_AVAILABLE())
    }
    this.factory = factory
    this.databaseName = options.databaseName ?? 'zbsearch'
    this.storeName = options.storeName ?? 'indexes'
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory.open(this.databaseName)

        request.onupgradeneeded = () => {
          const database = request.result
          if (!database.objectStoreNames.contains(this.storeName)) {
            database.createObjectStore(this.storeName)
          }
        }

        request.onsuccess = () => {
          const database = request.result
          // A store name unseen at open time means the existing database was
          // created without it. Bump the version to trigger onupgradeneeded.
          if (!database.objectStoreNames.contains(this.storeName)) {
            const nextVersion = database.version + 1
            database.close()
            const upgrade = this.factory.open(this.databaseName, nextVersion)
            upgrade.onupgradeneeded = () => {
              upgrade.result.createObjectStore(this.storeName)
            }
            upgrade.onsuccess = () => resolve(upgrade.result)
            upgrade.onerror = () => reject(upgrade.error)
            return
          }
          resolve(database)
        }

        request.onerror = () => reject(request.error)
      })
    }
    return this.dbPromise
  }

  private async run<R>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<R>): Promise<R> {
    const database = await this.openDatabase()
    return new Promise<R>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, mode)
      const request = fn(transaction.objectStore(this.storeName))
      transaction.onabort = () => reject(transaction.error ?? request.error)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
    })
  }

  async get(key: string): Promise<{ body: Uint8Array } | null> {
    const value = await this.run<ArrayBuffer | Uint8Array | undefined>('readonly', (store) => store.get(key))
    if (value === undefined || value === null) {
      return null
    }
    return { body: value instanceof Uint8Array ? value : new Uint8Array(value) }
  }

  async put(key: string, body: Uint8Array): Promise<{ etag: string }> {
    // Store a standalone copy so we never persist a view into a larger buffer.
    const copy = new Uint8Array(body.byteLength)
    copy.set(body)
    await this.run('readwrite', (store) => store.put(copy, key))
    return { etag: '' }
  }

  async delete(key: string): Promise<void> {
    await this.run('readwrite', (store) => store.delete(key))
  }

  async clear(): Promise<void> {
    await this.run('readwrite', (store) => store.clear())
  }

  async close(): Promise<void> {
    if (this.dbPromise) {
      const database = await this.dbPromise
      database.close()
      this.dbPromise = undefined
    }
  }
}
