import type { ObjectGetResult, ObjectStorage } from '../src/storage.js'

export class MemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, { body: Uint8Array; etag: string; contentType?: string }>()

  async get(key: string): Promise<ObjectGetResult | null> {
    const obj = this.objects.get(key)
    if (!obj) {
      return null
    }
    return { body: obj.body, etag: obj.etag }
  }

  async put(key: string, body: Uint8Array, opts?: { contentType?: string }): Promise<{ etag: string }> {
    const etag = `"${crypto.randomUUID()}"`
    this.objects.set(key, { body, etag, contentType: opts?.contentType })
    return { etag }
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }

  async *list(prefix: string): AsyncIterable<{ key: string; size: number }> {
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) {
        yield { key, size: this.objects.get(key)!.body.byteLength }
      }
    }
  }
}
