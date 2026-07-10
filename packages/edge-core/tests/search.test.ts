import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { handleRequest } from '../src/router.js'
import { NoopShardCache } from '../src/storage.js'
import { createIndex, rebuildIndex, bufferUpsert } from '../src/service.js'
import { MemoryObjectStorage } from './helpers/memory-storage.js'
import { MemoryShardCache } from './helpers/memory-cache.js'
import { makeRequest } from './helpers/http-request.js'

function ctx(storage: MemoryObjectStorage, apiKey?: string) {
  return { storage, cache: new NoopShardCache(), apiKey }
}

describe('router edge cases', () => {
  it('returns 404 when searching before rebuild', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'empty', schema: { title: 'string' } })
    await bufferUpsert(storage, 'empty', '1', { title: 'Not Searchable Yet' })

    const res = await handleRequest(
      ctx(storage),
      makeRequest('POST', '/v1/indexes/empty/search', { body: { term: 'not' } })
    )
    assert.equal(res.status, 404)
  })

  it('patches index settings', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'settings', schema: { title: 'string' } })

    const res = await handleRequest(
      ctx(storage),
      makeRequest('PATCH', '/v1/indexes/settings', {
        body: { settings: { language: 'english', rebuildIntervalSec: 60 } }
      })
    )
    const body = res.body as { settings: { language?: string; rebuildIntervalSec?: number } }
    assert.equal(body.settings.language, 'english')
    assert.equal(body.settings.rebuildIntervalSec, 60)
  })

  it('returns 400 for duplicate create via router', async () => {
    const storage = new MemoryObjectStorage()
    await handleRequest(
      ctx(storage),
      makeRequest('POST', '/v1/indexes', { body: { name: 'x', schema: { a: 'string' } } })
    )
    const dup = await handleRequest(
      ctx(storage),
      makeRequest('POST', '/v1/indexes', { body: { name: 'x', schema: { a: 'string' } } })
    )
    assert.equal(dup.status, 400)
  })

  it('GET index returns meta', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'get-me', schema: { title: 'string' } })
    const res = await handleRequest(ctx(storage), makeRequest('GET', '/v1/indexes/get-me'))
    assert.equal((res.body as { id: string }).id, 'get-me')
  })
})

describe('search behavior', () => {
  it('finds no results for unrelated terms', async () => {
    const storage = new MemoryObjectStorage()
    const cache = new NoopShardCache()
    await createIndex(storage, { name: 'terms', schema: { title: 'string' } })
    await bufferUpsert(storage, 'terms', '1', { title: 'Alpha Beta Gamma' })
    await rebuildIndex(storage, 'terms')

    const { runSearch } = await import('../src/service.js')
    const results = await runSearch(storage, cache, 'terms', { term: 'zzzznotfound' })
    assert.equal(results.count, 0)
  })

  it('uses memory cache across searches', async () => {
    const storage = new MemoryObjectStorage()
    const cache = new MemoryShardCache()
    await createIndex(storage, { name: 'cache-hit', schema: { title: 'string' } })
    await bufferUpsert(storage, 'cache-hit', '1', { title: 'Cache Hit Test' })
    await rebuildIndex(storage, 'cache-hit')

    const { runSearch } = await import('../src/service.js')
    await runSearch(storage, cache, 'cache-hit', { term: 'cache' })
    const { getIndexMeta } = await import('../src/registry.js')
    const meta = await getIndexMeta(storage, 'cache-hit')
    const cacheKey = `snapshot:indexes/cache-hit/${meta.liveVersion}/snapshot.msgpack`
    assert.ok(cache.has(cacheKey))
  })
})
