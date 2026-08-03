import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { handleRequest, toResponse } from '../src/router.js'
import { NoopShardCache } from '../src/storage.js'
import { createIndex, rebuildIndex, bufferUpsert } from '../src/service.js'
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
    const unauthorized = await handleRequest(ctx(storage, 'secret-key'), makeRequest('GET', '/v1/indexes'))
    assert.equal(unauthorized.status, 401)

    const authorized = await handleRequest(
      ctx(storage, 'secret-key'),
      makeRequest('GET', '/v1/indexes', { headers: { authorization: 'Bearer secret-key' } })
    )
    assert.equal(authorized.status, 200)
  })

  it('read key reads but cannot write', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'rw', schema: { title: 'string' } })
    await bufferUpsert(storage, 'rw', '1', { title: 'Readable' })
    await rebuildIndex(storage, 'rw')
    const auth = { storage, cache: new NoopShardCache(), readApiKey: 'read-key', writeApiKey: 'write-key' }

    const read = await handleRequest(
      auth,
      makeRequest('GET', '/v1/indexes', { headers: { authorization: 'Bearer read-key' } })
    )
    assert.equal(read.status, 200)

    const search = await handleRequest(
      auth,
      makeRequest('POST', '/v1/indexes/rw/search', {
        headers: { authorization: 'Bearer read-key' },
        body: { term: 'x' }
      })
    )
    assert.equal(search.status, 200)

    const write = await handleRequest(
      auth,
      makeRequest('PUT', '/v1/indexes/rw/documents/1', {
        headers: { authorization: 'Bearer read-key' },
        body: { title: 'Nope' }
      })
    )
    assert.equal(write.status, 401)

    const create = await handleRequest(
      auth,
      makeRequest('POST', '/v1/indexes', {
        headers: { authorization: 'Bearer read-key' },
        body: { name: 'nope', schema: { title: 'string' } }
      })
    )
    assert.equal(create.status, 401)

    const rebuild = await handleRequest(
      auth,
      makeRequest('POST', '/v1/indexes/rw/rebuild', { headers: { authorization: 'Bearer read-key' } })
    )
    assert.equal(rebuild.status, 401)
  })

  it('write key has full access', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'admin', schema: { title: 'string' } })
    const auth = { storage, cache: new NoopShardCache(), readApiKey: 'read-key', writeApiKey: 'write-key' }

    const write = await handleRequest(
      auth,
      makeRequest('PUT', '/v1/indexes/admin/documents/1', {
        headers: { authorization: 'Bearer write-key' },
        body: { title: 'Yes' }
      })
    )
    assert.equal(write.status, 202)

    const read = await handleRequest(
      auth,
      makeRequest('GET', '/v1/indexes', { headers: { authorization: 'Bearer write-key' } })
    )
    assert.equal(read.status, 200)
  })

  it('rejects all writes when only a read key is configured', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'ro', schema: { title: 'string' } })
    const auth = { storage, cache: new NoopShardCache(), readApiKey: 'read-key' }

    const write = await handleRequest(
      auth,
      makeRequest('PUT', '/v1/indexes/ro/documents/1', {
        headers: { authorization: 'Bearer read-key' },
        body: { title: 'Nope' }
      })
    )
    assert.equal(write.status, 403)

    const anonWrite = await handleRequest(
      auth,
      makeRequest('PUT', '/v1/indexes/ro/documents/1', { body: { title: 'Nope' } })
    )
    assert.equal(anonWrite.status, 403)
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

    const del = await handleRequest(ctx(storage), makeRequest('DELETE', '/v1/indexes/docs/documents/sku-1'))
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

    const rebuild = await handleRequest(ctx(storage), makeRequest('POST', '/v1/indexes/search/rebuild'))
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

    await handleRequest(routerCtx, makeRequest('PUT', '/v1/indexes/auto-flush/documents/1', { body: { title: 'One' } }))
    assert.equal(scheduled.length, 0)

    await handleRequest(routerCtx, makeRequest('PUT', '/v1/indexes/auto-flush/documents/2', { body: { title: 'Two' } }))
    assert.equal(scheduled.length, 1)

    await scheduled[0]
    const search = await handleRequest(
      routerCtx,
      makeRequest('POST', '/v1/indexes/auto-flush/search', { body: { term: 'two' } })
    )
    assert.equal(search.status, 200)
    assert.equal((search.body as { includesBuffer: boolean }).includesBuffer, false)
  })

  it('returns 202 before background rebuild completes', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, {
      name: 'async-flush',
      schema: { title: 'string' },
      settings: { rebuildThresholdOps: 1 }
    })

    let rebuildFinished = false
    const routerCtx = {
      ...ctx(storage),
      scheduleBackground: (task: Promise<unknown>) => {
        void task.then(() => {
          rebuildFinished = true
        })
      },
      rebuildThresholdOps: 1
    }

    const res = await handleRequest(
      routerCtx,
      makeRequest('PUT', '/v1/indexes/async-flush/documents/1', { body: { title: 'One' } })
    )
    assert.equal(res.status, 202)
    assert.equal(rebuildFinished, false)
  })

  it('batch write schedules a single background rebuild', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, {
      name: 'batch-flush',
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
      makeRequest('POST', '/v1/indexes/batch-flush/documents/batch', {
        body: {
          operations: [
            { op: 'upsert', id: '1', doc: { title: 'One' } },
            { op: 'upsert', id: '2', doc: { title: 'Two' } },
            { op: 'upsert', id: '3', doc: { title: 'Three' } }
          ]
        }
      })
    )

    assert.equal(scheduled.length, 1)
    await scheduled[0]
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
