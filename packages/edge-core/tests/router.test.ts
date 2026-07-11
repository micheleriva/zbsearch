import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { handleRequest, toResponse } from '../src/router.js'
import { NoopShardCache } from '../src/storage.js'
import { createIndex, rebuildIndex } from '../src/service.js'
import { MemoryObjectStorage } from './helpers/memory-storage.js'
import { makeRequest } from './helpers/http-request.js'

function ctx(storage: MemoryObjectStorage, apiKey?: string) {
  return { storage, cache: new NoopShardCache(), apiKey }
}

describe('router', () => {
  it('returns health without auth', async () => {
    const storage = new MemoryObjectStorage()
    const res = await handleRequest(ctx(storage), makeRequest('GET', '/health'))
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { ok: true })
  })

  it('returns info without auth', async () => {
    const storage = new MemoryObjectStorage()
    const res = await handleRequest(ctx(storage), makeRequest('GET', '/v1/info'))
    assert.equal(res.status, 200)
    assert.deepEqual((res.body as { name: string }).name, 'zbsearch-edge')
  })

  it('returns 404 for unknown routes', async () => {
    const storage = new MemoryObjectStorage()
    const res = await handleRequest(ctx(storage), makeRequest('GET', '/v1/unknown'))
    assert.equal(res.status, 404)
  })

  it('enforces bearer auth when api key is set', async () => {
    const storage = new MemoryObjectStorage()
    const unauthorized = await handleRequest(
      ctx(storage, 'secret-key'),
      makeRequest('GET', '/v1/indexes')
    )
    assert.equal(unauthorized.status, 401)

    const authorized = await handleRequest(
      ctx(storage, 'secret-key'),
      makeRequest('GET', '/v1/indexes', { headers: { authorization: 'Bearer secret-key' } })
    )
    assert.equal(authorized.status, 200)
  })

  it('creates and lists indexes', async () => {
    const storage = new MemoryObjectStorage()
    const create = await handleRequest(
      ctx(storage),
      makeRequest('POST', '/v1/indexes', {
        body: { name: 'Products', schema: { title: 'string' } }
      })
    )
    assert.equal(create.status, 201)
    assert.deepEqual((create.body as { id: string }).id, 'products')

    const list = await handleRequest(ctx(storage), makeRequest('GET', '/v1/indexes'))
    assert.equal((list.body as { indexes: unknown[] }).indexes.length, 1)
  })

  it('gets, patches, and deletes index', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'patch-me', schema: { title: 'string' } })

    const get = await handleRequest(ctx(storage), makeRequest('GET', '/v1/indexes/patch-me'))
    assert.equal(get.status, 200)

    const patch = await handleRequest(
      ctx(storage),
      makeRequest('PATCH', '/v1/indexes/patch-me', {
        body: { settings: { rebuildThresholdOps: 100 } }
      })
    )
    assert.equal((patch.body as { settings: { rebuildThresholdOps: number } }).settings.rebuildThresholdOps, 100)

    const del = await handleRequest(ctx(storage), makeRequest('DELETE', '/v1/indexes/patch-me'))
    assert.equal(del.status, 202)
  })

  it('returns status and manifest', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'status-index', schema: { title: 'string' } })

    const status = await handleRequest(ctx(storage), makeRequest('GET', '/v1/indexes/status-index/status'))
    assert.equal(status.status, 200)
    assert.equal((status.body as { indexId: string }).indexId, 'status-index')

    const manifest = await handleRequest(ctx(storage), makeRequest('GET', '/v1/indexes/status-index/manifest'))
    assert.equal((manifest.body as { name: string }).name, 'status-index')
  })

  it('buffers document via PUT and POST collection', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'docs', schema: { title: 'string' } })

    const put = await handleRequest(
      ctx(storage),
      makeRequest('PUT', '/v1/indexes/docs/documents/sku-1', {
        body: { title: 'Widget' }
      })
    )
    assert.equal(put.status, 202)
    assert.equal((put.body as { status: string }).status, 'buffered')

    const post = await handleRequest(
      ctx(storage),
      makeRequest('POST', '/v1/indexes/docs/documents', {
        body: { id: 'sku-2', document: { title: 'Gadget' } }
      })
    )
    assert.equal(post.status, 202)
  })

  it('buffers document delete', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'docs', schema: { title: 'string' } })

    const del = await handleRequest(
      ctx(storage),
      makeRequest('DELETE', '/v1/indexes/docs/documents/sku-1')
    )
    assert.equal(del.status, 202)
  })

  it('handles batch operations', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'batch', schema: { title: 'string' } })

    const res = await handleRequest(
      ctx(storage),
      makeRequest('POST', '/v1/indexes/batch/documents/batch', {
        body: {
          operations: [
            { op: 'upsert', id: '1', doc: { title: 'One' } },
            { op: 'upsert', id: '2', doc: { title: 'Two' } },
            { op: 'delete', id: '1' }
          ]
        }
      })
    )
    assert.equal(res.status, 202)
    assert.equal((res.body as { status: string }).status, 'buffered')
  })

  it('rebuilds and searches via HTTP', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'search', schema: { title: 'string' } })
    await handleRequest(
      ctx(storage),
      makeRequest('PUT', '/v1/indexes/search/documents/a', { body: { title: 'Alpha Search Term' } })
    )

    const rebuild = await handleRequest(
      ctx(storage),
      makeRequest('POST', '/v1/indexes/search/rebuild')
    )
    assert.equal(rebuild.status, 202)
    assert.equal((rebuild.body as { status: string }).status, 'rebuilt')

    const search = await handleRequest(
      ctx(storage),
      makeRequest('POST', '/v1/indexes/search/search', { body: { term: 'alpha' } })
    )
    assert.equal(search.status, 200)
    assert.ok((search.body as { count: number }).count >= 1)
  })

  it('returns 404 when searching missing index', async () => {
    const storage = new MemoryObjectStorage()
    const res = await handleRequest(
      ctx(storage),
      makeRequest('POST', '/v1/indexes/nope/search', { body: { term: 'x' } })
    )
    assert.equal(res.status, 404)
  })

  it('schedules background rebuild when buffer threshold is reached on write', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, {
      name: 'auto-flush',
      schema: { title: 'string' },
      settings: { rebuildThresholdOps: 2 }
    })

    const scheduled: Promise<unknown>[] = []
    const routerCtx = {
      ...ctx(storage),
      scheduleBackground: (task: Promise<unknown>) => {
        scheduled.push(task)
      },
      rebuildThresholdOps: 2
    }

    await handleRequest(
      routerCtx,
      makeRequest('PUT', '/v1/indexes/auto-flush/documents/1', { body: { title: 'One' } })
    )
    assert.equal(scheduled.length, 0)

    await handleRequest(
      routerCtx,
      makeRequest('PUT', '/v1/indexes/auto-flush/documents/2', { body: { title: 'Two' } })
    )
    assert.equal(scheduled.length, 1)

    await scheduled[0]
    const search = await handleRequest(
      routerCtx,
      makeRequest('POST', '/v1/indexes/auto-flush/search', { body: { term: 'two' } })
    )
    assert.equal(search.status, 200)
    assert.equal((search.body as { includesBuffer: boolean }).includesBuffer, false)
  })

  it('toResponse serializes JSON body', async () => {
    const response = toResponse({ status: 200, headers: { 'content-type': 'application/json' }, body: { ok: true } })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  })

  it('toResponse handles empty body', async () => {
    const response = toResponse({ status: 204 })
    assert.equal(response.status, 204)
    assert.equal(await response.text(), '')
  })
})
