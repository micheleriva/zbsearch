import type { ObjectGetResult, ObjectStorage } from '@zbsearch/edge-core'

export class R2ObjectStorage implements ObjectStorage {
  constructor(private readonly bucket: R2Bucket) {}

  async get(key: string): Promise<ObjectGetResult | null> {
    const obj = await this.bucket.get(key)
    if (!obj) {
      return null
    }
    const body = new Uint8Array(await obj.arrayBuffer())
    return {
      body,
      etag: obj.httpEtag
    }
  }

  async put(key: string, body: Uint8Array, opts?: { contentType?: string }): Promise<{ etag: string }> {
    const result = await this.bucket.put(key, body, {
      httpMetadata: opts?.contentType ? { contentType: opts.contentType } : undefined
    })
    return { etag: result?.httpEtag ?? '' }
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key)
  }

  async *list(prefix: string): AsyncIterable<{ key: string; size: number }> {
    let cursor: string | undefined
    do {
      const listed = await this.bucket.list({ prefix, cursor })
      for (const obj of listed.objects) {
        yield { key: obj.key, size: obj.size }
      }
      cursor = listed.truncated ? listed.cursor : undefined
    } while (cursor)
  }
}

export class WorkersShardCache {
  constructor(private readonly cache: Cache) {}

  async get(key: string): Promise<Uint8Array | null> {
    const res = await this.cache.match(key)
    if (!res) {
      return null
    }
    return new Uint8Array(await res.arrayBuffer())
  }

  async set(key: string, body: Uint8Array, ttlSec: number): Promise<void> {
    await this.cache.put(
      key,
      new Response(body, {
        headers: {
          'cache-control': `public, max-age=${ttlSec}`
        }
      })
    )
  }

  async delete(key: string): Promise<void> {
    await this.cache.delete(key)
  }
}
