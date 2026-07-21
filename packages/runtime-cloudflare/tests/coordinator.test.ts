import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  clearSnapshotDbCache,
  createIndex,
  getBufferHead,
  getIndexMeta,
  readBufferOps,
  rebuildIndex,
  walOpenSegmentKey,
  walSegmentsPrefix,
  type BufferOp
} from '@zbsearch/edge-core'

import { createWalCoordinator, IndexCoordinator } from '../src/coordinator.js'
import worker, { type Env } from '../src/worker.js'
import { MockCache, MockDurableObjectNamespace, MockDurableObjectState, MockR2Bucket } from './mocks/cloudflare.js'

const mockCache = new MockCache()

beforeEach(() => {
  ;(globalThis as { caches?: { default: Cache } }).caches = {
    default: mockCache as unknown as Cache
  }
  clearSnapshotDbCache()
})

function makeCoordinator() {
  const bucket = new MockR2Bucket()
  const env = { BUCKET: bucket as unknown as R2Bucket } as Env
  const state = new MockDurableObjectState() as unknown as DurableObjectState
  const coordinator = new IndexCoordinator(state, env)
  return { bucket, env, coordinator }
}

function op(id: string, n: number): BufferOp {
  return { op: 'upsert', id, ts: `t${n}`, doc: { n } }
}

describe('IndexCoordinator', () => {
  it('serializes concurrent appends without lost updates', async () => {
    const { bucket, coordinator } = makeCoordinator()

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => coordinator.appendOps('idx', [op(String(i), i + 1)]))
    )

    const head = await getBufferHead(storageOf(bucket), 'idx')
    assert.equal(head.opCount, 20)
    assert.equal(head.pendingOps, 20)

    const ops = await readBufferOps(storageOf(bucket), 'idx')
    assert.equal(ops.length, 20)
    assert.deepEqual(
      ops.map((o) => (o as { id: string }).id),
      Array.from({ length: 20 }, (_, i) => String(i))
    )
    assert.ok(bucket.keys().includes(walOpenSegmentKey('idx')))
  })

  it('finalizes the open segment when it fills up', async () => {
    const { bucket, coordinator } = makeCoordinator()

    for (let i = 1; i <= 105; i++) {
      await coordinator.appendOps('idx', [op(String(i), i)])
    }

    const segmentKeys = bucket.keys().filter((k) => k.startsWith(walSegmentsPrefix('idx')))
    assert.equal(segmentKeys.length, 2)
    assert.ok(segmentKeys.some((k) => k.startsWith(`${walSegmentsPrefix('idx')}0000000001-0000000100_`)))
    assert.ok(segmentKeys.includes(walOpenSegmentKey('idx')))

    const ops = await readBufferOps(storageOf(bucket), 'idx')
    assert.equal(ops.length, 105)
    assert.equal((ops[104] as { id: string }).id, '105')
  })

  it('freeze finalizes the open segment and finalize deletes consumed keys', async () => {
    const { bucket, coordinator } = makeCoordinator()
    await coordinator.appendOps('idx', [op('1', 1), op('2', 2)])

    const frozen = await coordinator.freezeForRebuild('idx')
    assert.equal(frozen.ops.length, 2)
    assert.equal(frozen.frozenSegmentKeys.length, 1)
    assert.ok(frozen.frozenSegmentKeys[0]!.startsWith(`${walSegmentsPrefix('idx')}0000000001-0000000002_`))
    assert.ok(!bucket.keys().includes(walOpenSegmentKey('idx')))

    const meta = await coordinator.finalizeAfterRebuild('idx', frozen.frozenSegmentKeys, {
      version: 'v1',
      documents: 2,
      indexSizeBytes: 100,
      lastRebuildAt: new Date().toISOString()
    }).catch(() => null)

    assert.equal(meta, null)
    assert.equal((await readBufferOps(storageOf(bucket), 'idx')).length, 0)
  })

  it('grants the rebuild lock to one holder at a time', async () => {
    const { coordinator } = makeCoordinator()

    assert.equal(await coordinator.acquireRebuildLock('idx'), true)
    assert.equal(await coordinator.acquireRebuildLock('idx'), false)
    await coordinator.releaseRebuildLock('idx')
    assert.equal(await coordinator.acquireRebuildLock('idx'), true)
  })

  it('clears buffered state including coordinator-side open segment', async () => {
    const { bucket, coordinator } = makeCoordinator()
    await coordinator.appendOps('idx', [op('1', 1)])
    await coordinator.clearBuffer('idx')

    assert.equal(bucket.keys().filter((k) => k.startsWith('wal/')).length, 0)

    const result = await coordinator.appendOps('idx', [op('2', 2)])
    assert.equal(result.head.opCount, 1)
  })

  it('serves the fetch stub protocol', async () => {
    const { coordinator } = makeCoordinator()
    const res = await coordinator.fetch(
      new Request('https://index-coordinator/append', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ indexId: 'idx', ops: [op('1', 1)] })
      })
    )
    assert.equal(res.status, 200)
    const body = (await res.json()) as { head: { pendingOps: number } }
    assert.equal(body.head.pendingOps, 1)

    const notFound = await coordinator.fetch(
      new Request('https://index-coordinator/nope', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ indexId: 'idx' })
      })
    )
    assert.equal(notFound.status, 404)
  })
})

describe('worker with INDEX_COORDINATOR', () => {
  function makeCoordinatedEnv(overrides?: Partial<Env>) {
    const env = {
      BUCKET: new MockR2Bucket() as unknown as R2Bucket,
      ...overrides
    } as Env
    env.INDEX_COORDINATOR = new MockDurableObjectNamespace(env) as unknown as DurableObjectNamespace
    return env
  }

  async function fetchWorker(path: string, env: Env, init?: RequestInit): Promise<Response> {
    const request = new Request(`http://localhost${path}`, init)
    const waitUntilTasks: Promise<unknown>[] = []
    const response = await worker.fetch(request, env, {
      waitUntil: (promise: Promise<unknown>) => {
        waitUntilTasks.push(promise)
      }
    } as ExecutionContext)
    await Promise.all(waitUntilTasks)
    return response
  }

  function bucketOf(env: Env): MockR2Bucket {
    return env.BUCKET as unknown as MockR2Bucket
  }

  it('buffers writes into the open segment and rebuilds via the coordinator', async () => {
    const env = makeCoordinatedEnv()
    const bucket = bucketOf(env)

    await fetchWorker('/v1/indexes', env, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'coord', schema: { title: 'string' } })
    })

    const put = await fetchWorker('/v1/indexes/coord/documents/doc-1', env, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Coordinated Doc' })
    })
    assert.equal(put.status, 202)
    assert.ok(bucket.keys().includes(walOpenSegmentKey('coord')))
    assert.equal(bucket.keys().filter((k) => k.includes('/entries/')).length, 0)

    const rebuild = await fetchWorker('/v1/indexes/coord/rebuild', env, { method: 'POST' })
    assert.equal(rebuild.status, 202)
    assert.equal(bucket.keys().filter((k) => k.startsWith(walSegmentsPrefix('coord'))).length, 0)

    const search = await fetchWorker('/v1/indexes/coord/search', env, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ term: 'coordinated' })
    })
    assert.equal(search.status, 200)
    assert.ok(((await search.json()) as { count: number }).count >= 1)
  })

  it('runs the scheduled rebuild through the coordinator', async () => {
    const env = makeCoordinatedEnv({ REBUILD_THRESHOLD_OPS: '1' })

    await fetchWorker('/v1/indexes', env, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'cron-coord', schema: { title: 'string' } })
    })
    await fetchWorker('/v1/indexes/cron-coord/documents/1', env, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Scheduled Coordinated' })
    })

    const waitUntilTasks: Promise<unknown>[] = []
    await worker.scheduled({} as ScheduledEvent, env, {
      waitUntil: (promise: Promise<unknown>) => {
        waitUntilTasks.push(promise)
      }
    } as ExecutionContext)
    await Promise.all(waitUntilTasks)

    const meta = await getIndexMeta(storageOf(bucketOf(env)), 'cron-coord')
    assert.equal(meta.status, 'ready')
    assert.equal(meta.pendingOps, 0)
  })

  it('skips a second rebuild while the coordinator lock is held', async () => {
    const env = makeCoordinatedEnv()
    const bucket = bucketOf(env)
    const storage = storageOf(bucket)

    await createIndex(storage, { name: 'mtx', schema: { title: 'string' } })
    const walCoordinator = createWalCoordinator(env.INDEX_COORDINATOR)!

    assert.equal(await walCoordinator.acquireRebuildLock('mtx'), true)

    const before = await getIndexMeta(storage, 'mtx')
    const after = await rebuildIndex(storage, 'mtx', { walCoordinator })
    assert.equal(after.liveVersion, before.liveVersion)
    assert.equal(after.status, before.status)
    assert.equal(bucket.keys().filter((k) => k.endsWith('/snapshot.msgpack')).length, 0)
  })
})

function storageOf(bucket: MockR2Bucket) {
  return {
    get: async (key: string) => {
      const obj = await bucket.get(key)
      if (!obj) {
        return null
      }
      return { body: new Uint8Array(await obj.arrayBuffer()), etag: obj.httpEtag }
    },
    put: async (key: string, body: Uint8Array, opts?: { contentType?: string }) => {
      const result = await bucket.put(key, body, {
        httpMetadata: opts?.contentType ? { contentType: opts.contentType } : undefined
      })
      return { etag: result.httpEtag }
    },
    delete: (key: string) => bucket.delete(key),
    list: async function* (prefix: string) {
      const listed = await bucket.list({ prefix })
      for (const obj of listed.objects) {
        yield { key: obj.key, size: obj.size }
      }
    }
  }
}
