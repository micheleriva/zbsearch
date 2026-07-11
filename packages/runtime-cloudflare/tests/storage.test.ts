import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { R2ObjectStorage, WorkersShardCache } from '../src/storage.js'
import { MockCache, MockR2Bucket } from './mocks/cloudflare.js'

describe('R2ObjectStorage', () => {
  it('gets null for missing object', async () => {
    const bucket = new MockR2Bucket()
    const storage = new R2ObjectStorage(bucket as unknown as R2Bucket)
    assert.equal(await storage.get('nope'), null)
  })

  it('puts and gets bytes', async () => {
    const bucket = new MockR2Bucket()
    const storage = new R2ObjectStorage(bucket as unknown as R2Bucket)
    const data = new TextEncoder().encode('payload')
    await storage.put('key', data, { contentType: 'text/plain' })
    const got = await storage.get('key')
    assert.ok(got)
    assert.deepEqual([...got.body], [...data])
    assert.ok(got.etag)
  })

  it('deletes objects', async () => {
    const bucket = new MockR2Bucket()
    const storage = new R2ObjectStorage(bucket as unknown as R2Bucket)
    await storage.put('x', new Uint8Array([1]))
    await storage.delete('x')
    assert.equal(await storage.get('x'), null)
  })

  it('lists with prefix', async () => {
    const bucket = new MockR2Bucket()
    const storage = new R2ObjectStorage(bucket as unknown as R2Bucket)
    await storage.put('buffer/a/segments/1', new Uint8Array([1]))
    await storage.put('buffer/b/segments/1', new Uint8Array([2]))

    const keys: string[] = []
    for await (const item of storage.list('buffer/a/')) {
      keys.push(item.key)
    }
    assert.deepEqual(keys, ['buffer/a/segments/1'])
  })
})

describe('WorkersShardCache', () => {
  it('stores and retrieves cached bytes', async () => {
    const cache = new MockCache()
    const shardCache = new WorkersShardCache(cache as unknown as Cache)
    const body = new Uint8Array([9, 8, 7])

    assert.equal(await shardCache.get('k'), null)
    await shardCache.set('k', body, 60)
    const got = await shardCache.get('k')
    assert.ok(got)
    assert.deepEqual([...got], [...body])
  })

  it('deletes cache entries', async () => {
    const cache = new MockCache()
    const shardCache = new WorkersShardCache(cache as unknown as Cache)
    await shardCache.set('k', new Uint8Array([1]), 60)
    await shardCache.delete('k')
    assert.equal(await shardCache.get('k'), null)
  })
})
