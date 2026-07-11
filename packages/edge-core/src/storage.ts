export interface ObjectGetResult {
  body: Uint8Array
  etag: string
}

export interface ObjectStorage {
  get(key: string, opts?: { etag?: string; ifNoneMatch?: string }): Promise<ObjectGetResult | null>
  put(key: string, body: Uint8Array, opts?: { contentType?: string }): Promise<{ etag: string }>
  delete(key: string): Promise<void>
  list(prefix: string): AsyncIterable<{ key: string; size: number }>
}

export interface ShardCache {
  get(key: string): Promise<Uint8Array | null>
  set(key: string, body: Uint8Array, ttlSec: number): Promise<void>
  delete(key: string): Promise<void>
}

export class NoopShardCache implements ShardCache {
  async get(): Promise<Uint8Array | null> {
    return null
  }

  async set(): Promise<void> {}

  async delete(): Promise<void> {}
}
