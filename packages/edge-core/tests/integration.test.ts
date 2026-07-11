import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { EdgeApiError } from '../src/errors.js'
import { NoopShardCache } from '../src/storage.js'
import { createIndex, rebuildIndex, runSearch, bufferUpsert, bufferDelete } from '../src/service.js'
import { handleRequest } from '../src/router.js'
import { MemoryObjectStorage } from './helpers/memory-storage.js'
import { makeRequest } from './helpers/http-request.js'

describe('integration', () => {
  it('buffers writes, rebuilds, and searches end-to-end', async () => {
    const storage = new MemoryObjectStorage()
    const cache = new NoopShardCache()

    await createIndex(storage, {
      name: 'products',
      schema: { title: 'string', price: 'number' }
    })

    await bufferUpsert(storage, 'products', 'sku-1', { title: 'Wireless Headphones', price: 99 })
    await bufferUpsert(storage, 'products', 'sku-2', { title: 'Wired Keyboard', price: 49 })

    await rebuildIndex(storage, 'products')

    const results = await runSearch(storage, cache, 'products', { term: 'wireless headphones' })
    assert.equal((results.count as number) >= 1, true)
    assert.equal(results.indexVersion != null, true)
  })

  it('full HTTP lifecycle across two rebuilds', async () => {
    const storage = new MemoryObjectStorage()
    const ctx = { storage, cache: new NoopShardCache() }

    await handleRequest(
      ctx,
      makeRequest('POST', '/v1/indexes', {
        body: { name: 'inventory', schema: { sku: 'string', name: 'string' } }
      })
    )

    await handleRequest(
      ctx,
      makeRequest('PUT', '/v1/indexes/inventory/documents/a', { body: { sku: 'A', name: 'Apple' } })
    )
    await handleRequest(ctx, makeRequest('POST', '/v1/indexes/inventory/rebuild'))

    let search = await handleRequest(
      ctx,
      makeRequest('POST', '/v1/indexes/inventory/search', { body: { term: 'apple' } })
    )
    assert.ok((search.body as { count: number }).count >= 1)

    await handleRequest(
      ctx,
      makeRequest('PUT', '/v1/indexes/inventory/documents/b', { body: { sku: 'B', name: 'Banana' } })
    )
    await handleRequest(ctx, makeRequest('POST', '/v1/indexes/inventory/rebuild'))

    search = await handleRequest(
      ctx,
      makeRequest('POST', '/v1/indexes/inventory/search', { body: { term: 'banana' } })
    )
    assert.ok((search.body as { count: number }).count >= 1)
  })

  it('supports multiple indexes in one storage backend', async () => {
    const storage = new MemoryObjectStorage()
    const cache = new NoopShardCache()

    await createIndex(storage, { name: 'alpha', schema: { label: 'string' } })
    await createIndex(storage, { name: 'beta', schema: { label: 'string' } })

    await bufferUpsert(storage, 'alpha', '1', { label: 'Alpha Only' })
    await bufferUpsert(storage, 'beta', '1', { label: 'Beta Only' })
    await rebuildIndex(storage, 'alpha')
    await rebuildIndex(storage, 'beta')

    const alphaResults = await runSearch(storage, cache, 'alpha', { term: 'alpha' })
    const betaResults = await runSearch(storage, cache, 'beta', { term: 'beta' })
    assert.ok((alphaResults.count as number) >= 1)
    assert.ok((betaResults.count as number) >= 1)
  })

  it('batch write then rebuild reflects deletes', async () => {
    const storage = new MemoryObjectStorage()
    const cache = new NoopShardCache()
    const ctx = { storage, cache }

    await createIndex(storage, { name: 'batch', schema: { title: 'string' } })
    await handleRequest(
      ctx,
      makeRequest('POST', '/v1/indexes/batch/documents/batch', {
        body: {
          operations: [
            { op: 'upsert', id: '1', doc: { title: 'Keep' } },
            { op: 'upsert', id: '2', doc: { title: 'Drop' } }
          ]
        }
      })
    )
    await rebuildIndex(storage, 'batch')
    await bufferDelete(storage, 'batch', '2')
    await rebuildIndex(storage, 'batch')

    const results = await runSearch(storage, cache, 'batch', { term: 'drop' })
    assert.equal(results.count, 0)
    const keep = await runSearch(storage, cache, 'batch', { term: 'keep' })
    assert.ok((keep.count as number) >= 1)
  })

  it('rejects duplicate index via HTTP', async () => {
    const storage = new MemoryObjectStorage()
    const ctx = { storage, cache: new NoopShardCache() }

    await handleRequest(
      ctx,
      makeRequest('POST', '/v1/indexes', { body: { name: 'dup', schema: { x: 'string' } } })
    )
    const dup = await handleRequest(
      ctx,
      makeRequest('POST', '/v1/indexes', { body: { name: 'dup', schema: { x: 'string' } } })
    )
    assert.equal(dup.status, 400)
    assert.equal((dup.body as { error: { code: string } }).error.code, 'BAD_REQUEST')
  })

  it('returns not found for missing index routes', async () => {
    const storage = new MemoryObjectStorage()
    const ctx = { storage, cache: new NoopShardCache() }
    const res = await handleRequest(ctx, makeRequest('GET', '/v1/indexes/missing/status'))
    assert.equal(res.status, 404)
    assert.ok((res.body as { error: unknown }).error)
  })

  it('auto-flushes buffer end-to-end over HTTP without blocking search', async () => {
    const storage = new MemoryObjectStorage()
    const scheduled: Promise<unknown>[] = []
    const routerCtx = {
      storage,
      cache: new NoopShardCache(),
      scheduleBackground: (task: Promise<unknown>) => {
        scheduled.push(task)
      },
      rebuildThresholdOps: 2
    }

    await handleRequest(
      routerCtx,
      makeRequest('POST', '/v1/indexes', {
        body: { name: 'auto', schema: { title: 'string' } }
      })
    )

    await handleRequest(
      routerCtx,
      makeRequest('PUT', '/v1/indexes/auto/documents/1', { body: { title: 'Alpha' } })
    )

    const write = await handleRequest(
      routerCtx,
      makeRequest('PUT', '/v1/indexes/auto/documents/2', { body: { title: 'Beta' } })
    )
    assert.equal(write.status, 202)
    assert.equal(scheduled.length, 1)

    const bufferedSearch = await handleRequest(
      routerCtx,
      makeRequest('POST', '/v1/indexes/auto/search', { body: { term: 'beta' } })
    )
    assert.equal(bufferedSearch.status, 200)
    assert.equal((bufferedSearch.body as { includesBuffer: boolean }).includesBuffer, true)

    await scheduled[0]

    const flushedSearch = await handleRequest(
      routerCtx,
      makeRequest('POST', '/v1/indexes/auto/search', { body: { term: 'beta' } })
    )
    assert.equal(flushedSearch.status, 200)
    assert.equal((flushedSearch.body as { includesBuffer: boolean }).includesBuffer, false)
  })
})

describe('registry errors', () => {
  it('getIndexMeta throws EdgeApiError for missing index', async () => {
    const { getIndexMeta } = await import('../src/registry.js')
    const storage = new MemoryObjectStorage()
    await assert.rejects(() => getIndexMeta(storage, 'missing'), (err: unknown) => {
      assert.ok(err instanceof EdgeApiError)
      assert.equal((err as EdgeApiError).status, 404)
      return true
    })
  })
})
