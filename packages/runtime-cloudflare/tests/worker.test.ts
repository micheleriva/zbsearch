import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import worker, { type Env } from '../src/worker.js'
import { MockCache, MockR2Bucket } from './mocks/cloudflare.js'

const mockCache = new MockCache()

beforeEach(() => {
  ;(globalThis as { caches?: { default: Cache } }).caches = {
    default: mockCache as unknown as Cache
  }
})

function makeEnv(overrides?: Partial<Env>): Env {
  return {
    BUCKET: new MockR2Bucket() as unknown as R2Bucket,
    ...overrides
  }
}

async function fetchWorker(
  path: string,
  env: Env,
  init?: RequestInit,
  execCtx?: ExecutionContext
): Promise<Response> {
  const request = new Request(`http://localhost${path}`, init)
  const waitUntilTasks: Promise<unknown>[] = []
  const context =
    execCtx ??
    ({
      waitUntil: (promise: Promise<unknown>) => {
        waitUntilTasks.push(promise)
      }
    } as ExecutionContext)
  const response = await worker.fetch(request, env, context)
  await Promise.all(waitUntilTasks)
  return response
}

describe('worker fetch', () => {
  it('handles OPTIONS with CORS headers', async () => {
    const res = await fetchWorker('/', makeEnv(), { method: 'OPTIONS' })
    assert.equal(res.status, 204)
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    assert.ok(res.headers.get('access-control-allow-methods')?.includes('POST'))
  })

  it('adds CORS to JSON responses', async () => {
    const res = await fetchWorker('/health', makeEnv())
    assert.equal(res.headers.get('access-control-allow-origin'), '*')
    assert.deepEqual(await res.json(), { ok: true })
  })

  it('creates index and searches after rebuild', async () => {
    const env = makeEnv()

    let res = await fetchWorker('/v1/indexes', env, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Worker Index', schema: { title: 'string' } })
    })
    assert.equal(res.status, 201)

    res = await fetchWorker('/v1/indexes/worker-index/documents/doc-1', env, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Cloudflare Worker Doc' })
    })
    assert.equal(res.status, 202)

    res = await fetchWorker('/v1/indexes/worker-index/rebuild', env, { method: 'POST' })
    assert.equal(res.status, 202)

    res = await fetchWorker('/v1/indexes/worker-index/search', env, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ term: 'cloudflare' })
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { count: number }
    assert.ok(body.count >= 1)
  })

  it('enforces API key when configured', async () => {
    const env = makeEnv({ API_KEY: 'test-secret' })

    const denied = await fetchWorker('/v1/indexes', env, { method: 'GET' })
    assert.equal(denied.status, 401)

    const allowed = await fetchWorker('/v1/indexes', env, {
      method: 'GET',
      headers: { authorization: 'Bearer test-secret' }
    })
    assert.equal(allowed.status, 200)
  })

  it('health and info remain public when API key is set', async () => {
    const env = makeEnv({ API_KEY: 'test-secret' })
    assert.equal((await fetchWorker('/health', env)).status, 200)
    assert.equal((await fetchWorker('/v1/info', env)).status, 200)
  })

  it('returns 404 for unknown routes', async () => {
    const res = await fetchWorker('/v1/does-not-exist', makeEnv())
    assert.equal(res.status, 404)
  })

  it('lists indexes after creation', async () => {
    const env = makeEnv()
    await fetchWorker('/v1/indexes', env, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Listed', schema: { x: 'string' } })
    })

    const res = await fetchWorker('/v1/indexes', env)
    const body = (await res.json()) as { indexes: Array<{ id: string }> }
    assert.equal(body.indexes.some((i) => i.id === 'listed'), true)
  })

  it('returns status and manifest endpoints', async () => {
    const env = makeEnv()
    await fetchWorker('/v1/indexes', env, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'meta', schema: { title: 'string' } })
    })

    const status = await fetchWorker('/v1/indexes/meta/status', env)
    assert.equal(status.status, 200)

    const manifest = await fetchWorker('/v1/indexes/meta/manifest', env)
    assert.equal(manifest.status, 200)
    assert.equal(((await manifest.json()) as { indexId: string }).indexId, 'meta')
  })

  it('supports batch document writes', async () => {
    const env = makeEnv()
    await fetchWorker('/v1/indexes', env, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'batch', schema: { title: 'string' } })
    })

    const res = await fetchWorker('/v1/indexes/batch/documents/batch', env, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [
          { op: 'upsert', id: '1', doc: { title: 'One' } },
          { op: 'upsert', id: '2', doc: { title: 'Two' } }
        ]
      })
    })
    assert.equal(res.status, 202)
  })
  it('flushes buffer in background when write reaches threshold', async () => {
    const env = makeEnv({ REBUILD_THRESHOLD_OPS: '2' })

    await fetchWorker('/v1/indexes', env, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'write-flush', schema: { title: 'string' } })
    })

    await fetchWorker('/v1/indexes/write-flush/documents/1', env, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'First' })
    })

    const put = await fetchWorker('/v1/indexes/write-flush/documents/2', env, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Second' })
    })
    assert.equal(put.status, 202)

    const search = await fetchWorker('/v1/indexes/write-flush/search', env, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ term: 'second' })
    })
    assert.equal(search.status, 200)
    assert.equal(((await search.json()) as { includesBuffer: boolean }).includesBuffer, false)
  })
})

describe('worker scheduled', () => {
  it('rebuilds indexes when pending ops exceed threshold', async () => {
    const env = makeEnv({ REBUILD_THRESHOLD_OPS: '1' })

    await fetchWorker('/v1/indexes', env, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'cron', schema: { title: 'string' } })
    })

    await fetchWorker('/v1/indexes/cron/documents/1', env, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Scheduled Rebuild' })
    })

    const waitUntilTasks: Promise<unknown>[] = []
    await worker.scheduled({} as ScheduledEvent, env, {
      waitUntil: (promise: Promise<unknown>) => {
        waitUntilTasks.push(promise)
      }
    } as ExecutionContext)
    await Promise.all(waitUntilTasks)

    const search = await fetchWorker('/v1/indexes/cron/search', env, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ term: 'scheduled' })
    })
    assert.equal(search.status, 200)
    assert.ok(((await search.json()) as { count: number }).count >= 1)
  })

  it('calls external webhook instead of inline rebuild when configured', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input, init) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null
      })
      return new Response('ok')
    }) as typeof fetch

    try {
      const env = makeEnv({
        REBUILD_THRESHOLD_OPS: '1',
        BUILDER_WEBHOOK_URL: 'https://builder.example/hook'
      })

      await fetchWorker('/v1/indexes', env, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'webhook', schema: { title: 'string' } })
      })

      await fetchWorker('/v1/indexes/webhook/documents/1', env, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Webhook Test' })
      })

      calls.length = 0

      await worker.scheduled({} as ScheduledEvent, env, {
        waitUntil: (promise: Promise<unknown>) => promise
      } as ExecutionContext)

      assert.equal(calls.length, 1)
      assert.equal(calls[0]!.url, 'https://builder.example/hook')
      assert.deepEqual(calls[0]!.body, { indexId: 'webhook', source: 'scheduler' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('skips rebuild when pending ops below threshold', async () => {
    const env = makeEnv({ REBUILD_THRESHOLD_OPS: '999' })

    await fetchWorker('/v1/indexes', env, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'skip', schema: { title: 'string' } })
    })

    await fetchWorker('/v1/indexes/skip/documents/1', env, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Not Yet' })
    })

    await worker.scheduled({} as ScheduledEvent, env, {
      waitUntil: (promise: Promise<unknown>) => promise
    } as ExecutionContext)

    const search = await fetchWorker('/v1/indexes/skip/search', env, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ term: 'not' })
    })
    assert.equal(search.status, 200)
    assert.equal(((await search.json()) as { includesBuffer: boolean }).includesBuffer, true)
  })
})
