import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { createS3StorageFromEnv, S3ObjectStorage } from '../src/index.js'
import { MockS3Backend } from './mock-s3.js'

describe('createS3StorageFromEnv', () => {
  it('throws when bucket credentials are missing', () => {
    assert.throws(() => createS3StorageFromEnv({}), /Missing R2_BUCKET/)
  })

  it('accepts R2 env vars', () => {
    const storage = createS3StorageFromEnv({
      R2_BUCKET: 'test-bucket',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com'
    })
    assert.ok(storage instanceof S3ObjectStorage)
  })

  it('accepts S3 env vars', () => {
    const storage = createS3StorageFromEnv({
      S3_BUCKET: 'aws-bucket',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      AWS_REGION: 'us-east-1'
    })
    assert.ok(storage instanceof S3ObjectStorage)
  })
})

describe('S3ObjectStorage', () => {
  it('puts and gets objects', async () => {
    const backend = new MockS3Backend()
    const storage = new S3ObjectStorage({
      bucket: 'b',
      accessKeyId: 'k',
      secretAccessKey: 's',
      client: backend.createClient('b')
    })

    const body = new TextEncoder().encode('hello')
    const put = await storage.put('path/file.txt', body, { contentType: 'text/plain' })
    assert.ok(put.etag)

    const got = await storage.get('path/file.txt')
    assert.ok(got)
    assert.equal(new TextDecoder().decode(got.body), 'hello')
  })

  it('returns null for missing keys', async () => {
    const backend = new MockS3Backend()
    const storage = new S3ObjectStorage({
      bucket: 'b',
      accessKeyId: 'k',
      secretAccessKey: 's',
      client: backend.createClient('b')
    })
    assert.equal(await storage.get('missing'), null)
  })

  it('deletes objects', async () => {
    const backend = new MockS3Backend()
    const storage = new S3ObjectStorage({
      bucket: 'b',
      accessKeyId: 'k',
      secretAccessKey: 's',
      client: backend.createClient('b')
    })
    await storage.put('gone.txt', new Uint8Array([1]))
    await storage.delete('gone.txt')
    assert.equal(await storage.get('gone.txt'), null)
  })

  it('lists objects by prefix', async () => {
    const backend = new MockS3Backend()
    const storage = new S3ObjectStorage({
      bucket: 'b',
      accessKeyId: 'k',
      secretAccessKey: 's',
      client: backend.createClient('b')
    })
    await storage.put('indexes/a/meta.json', new Uint8Array([1]))
    await storage.put('indexes/b/meta.json', new Uint8Array([2]))
    await storage.put('other/x', new Uint8Array([3]))

    const keys: string[] = []
    for await (const entry of storage.list('indexes/')) {
      keys.push(entry.key)
    }
    assert.deepEqual(keys.sort(), ['indexes/a/meta.json', 'indexes/b/meta.json'])
  })

  it('works with edge-core create and rebuild flow', async () => {
    const backend = new MockS3Backend()
    const storage = new S3ObjectStorage({
      bucket: 'edge',
      accessKeyId: 'k',
      secretAccessKey: 's',
      client: backend.createClient('edge')
    })

    const { createIndex, bufferUpsert, rebuildIndex, runSearch } = await import('@zbsearch/edge-core')
    const { NoopShardCache } = await import('@zbsearch/edge-core')

    await createIndex(storage, { name: 's3-index', schema: { title: 'string' } })
    await bufferUpsert(storage, 's3-index', '1', { title: 'S3 Document' })
    await rebuildIndex(storage, 's3-index')

    const results = await runSearch(storage, new NoopShardCache(), 's3-index', { term: 's3' })
    assert.ok((results.count as number) >= 1)
  })
})
