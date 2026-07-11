import type { ShardCache } from '../../src/storage.js'

export class MemoryShardCache implements ShardCache {
  private readonly entries = new Map<string, Uint8Array>()

  async get(key: string): Promise<Uint8Array | null> {
    return this.entries.get(key) ?? null
  }

  async set(key: string, body: Uint8Array, _ttlSec: number): Promise<void> {
    this.entries.set(key, body)
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key)
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }
}
