/**
 * Where a sharded database keeps its shard snapshots, its write-ahead log and
 * its global state. The interface is the subset of `@zbsearch/edge-core`'s
 * `ObjectStorage` that a sharded database needs, so every edge storage
 * adapter (R2, S3, ...) can be passed as is.
 *
 * A `put` must replace the value of a key atomically: a reader sees either
 * the old bytes or the new ones, never a mix. Keys use `/` as separator and
 * never contain `..`.
 */
export interface ShardStorage {
  get(key: string): Promise<{ body: Uint8Array } | null>
  put(key: string, body: Uint8Array): Promise<unknown>
  delete(key: string): Promise<void>
  list(prefix: string): AsyncIterable<{ key: string }>
}

/** Keeps everything in a Map: for tests, and for databases that only need the memory budget, not persistence. */
export class MemoryStorage implements ShardStorage {
  readonly entries = new Map<string, Uint8Array>()

  async get(key: string): Promise<{ body: Uint8Array } | null> {
    const body = this.entries.get(key)
    return body ? { body } : null
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    // Copy: the caller may reuse its buffer.
    this.entries.set(key, body.slice())
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key)
  }

  async *list(prefix: string): AsyncIterable<{ key: string }> {
    const keys = [...this.entries.keys()].filter((key) => key.startsWith(prefix)).sort()
    for (const key of keys) {
      yield { key }
    }
  }

  /** Total stored bytes, for diagnostics. */
  get bytes(): number {
    let total = 0
    for (const body of this.entries.values()) {
      total += body.byteLength
    }
    return total
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('[zbsearch-sharded] IndexedDB transaction aborted'))
  })
}

export interface IndexedDBStorageOptions {
  /** Database name. */
  name: string
  /** Object store name, default "zbsearch-sharded". */
  storeName?: string
  /** Defaults to `globalThis.indexedDB`. */
  indexedDB?: IDBFactory
}

/** Stores every key as one record of an IndexedDB object store, in browsers, workers and Gecko-based hosts. */
export class IndexedDBStorage implements ShardStorage {
  private readonly storeName: string
  private readonly factory: IDBFactory
  private dbPromise: Promise<IDBDatabase> | undefined

  constructor(private readonly options: IndexedDBStorageOptions) {
    this.storeName = options.storeName ?? 'zbsearch-sharded'
    const factory = options.indexedDB ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB
    if (!factory) {
      throw new Error('[zbsearch-sharded] IndexedDB is not available in this environment')
    }
    this.factory = factory
  }

  private open(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const request = this.factory.open(this.options.name, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.storeName)) {
          request.result.createObjectStore(this.storeName)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return this.dbPromise
  }

  async get(key: string): Promise<{ body: Uint8Array } | null> {
    const db = await this.open()
    const value = await requestToPromise(
      db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(key)
    )
    if (value === undefined) {
      return null
    }
    return { body: value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer) }
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    const db = await this.open()
    const transaction = db.transaction(this.storeName, 'readwrite')
    transaction.objectStore(this.storeName).put(body.slice(), key)
    await transactionDone(transaction)
  }

  async delete(key: string): Promise<void> {
    const db = await this.open()
    const transaction = db.transaction(this.storeName, 'readwrite')
    transaction.objectStore(this.storeName).delete(key)
    await transactionDone(transaction)
  }

  async *list(prefix: string): AsyncIterable<{ key: string }> {
    const db = await this.open()
    const range = IDBKeyRange.bound(prefix, `${prefix}￿`)
    const keys = await requestToPromise(
      db.transaction(this.storeName, 'readonly').objectStore(this.storeName).getAllKeys(range)
    )
    for (const key of keys) {
      yield { key: String(key) }
    }
  }

  /** Closes the underlying connection. */
  async close(): Promise<void> {
    if (this.dbPromise) {
      ;(await this.dbPromise).close()
      this.dbPromise = undefined
    }
  }
}
