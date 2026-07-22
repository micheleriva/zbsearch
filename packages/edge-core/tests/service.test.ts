import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { EdgeApiError } from '../src/errors.js'
import {
  bufferDelete,
  bufferUpsert,
  createIndex,
  getIndexManifest,
  getStatus,
  maybeScheduleRebuild,
  rebuildIndex,
  runSearch
} from '../src/service.js'
import { getIndexMeta, saveIndexMeta } from '../src/registry.js'
import { indexMetaKey, snapshotKey } from '../src/paths.js'
import { encodeJson } from '../src/codec.js'
import type { ObjectStorage } from '../src/storage.js'
import { NoopShardCache } from '../src/storage.js'
import { MemoryObjectStorage } from './helpers/memory-storage.js'
import { MemoryShardCache } from './helpers/memory-cache.js'

describe('service', () => {
  it('creates index with slugified id', async () => {
    const storage = new MemoryObjectStorage()
    const meta = await createIndex(storage, {
      name: 'My Products',
      schema: { title: 'string', price: 'number' }
    })
    assert.equal(meta.id, 'my-products')
    assert.equal(meta.status, 'empty')
    assert.equal(meta.settings.mode, 'edge')
    assert.equal(meta.settings.rebuildThresholdOps, 500)
  })

  it('rejects duplicate index creation', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'dup', schema: { title: 'string' } })
    await assert.rejects(
      () => createIndex(storage, { name: 'dup', schema: { title: 'string' } }),
      (err: unknown) => {
        assert.ok(err instanceof EdgeApiError)
        assert.equal((err as EdgeApiError).status, 400)
        return true
      }
    )
  })

  it('rejects invalid index name', async () => {
    const storage = new MemoryObjectStorage()
    await assert.rejects(() => createIndex(storage, { name: '!!!', schema: { title: 'string' } }))
  })

  it('buffers upsert and tracks pending ops', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'items', schema: { title: 'string' } })
    const res = await bufferUpsert(storage, 'items', 'doc-1', { title: 'Hello' })
    assert.equal(res.status, 'buffered')
    assert.match(res.changeId, /^chg_/)
    const status = await getStatus(storage, 'items')
    assert.equal(status.pendingOps, 1)
  })

  it('buffers delete', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'items', schema: { title: 'string' } })
    await bufferUpsert(storage, 'items', 'doc-1', { title: 'Hello' })
    const res = await bufferDelete(storage, 'items', 'doc-1')
    assert.equal(res.status, 'buffered')
    assert.equal((await getStatus(storage, 'items')).pendingOps, 2)
  })

  it('rebuild produces searchable snapshot', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'catalog', schema: { title: 'string', category: 'string' } })
    await bufferUpsert(storage, 'catalog', '1', { title: 'Red Shoes', category: 'footwear' })
    await bufferUpsert(storage, 'catalog', '2', { title: 'Blue Hat', category: 'accessories' })

    const meta = await rebuildIndex(storage, 'catalog')
    assert.equal(meta.status, 'ready')
    assert.equal(meta.documents, 2)
    assert.ok(meta.liveVersion)
    assert.equal(meta.pendingOps, 0)
    assert.ok(meta.indexSizeBytes > 0)
    assert.ok(meta.lastRebuildAt)
  })

  it('search fails when index has no documents', async () => {
    const storage = new MemoryObjectStorage()
    const cache = new NoopShardCache()
    await createIndex(storage, { name: 'empty', schema: { title: 'string' } })
    await assert.rejects(() => runSearch(storage, cache, 'empty', { term: 'x' }))
  })

  it('search includes buffered documents before rebuild', async () => {
    const storage = new MemoryObjectStorage()
    const cache = new NoopShardCache()
    await createIndex(storage, { name: 'buffered', schema: { title: 'string' } })
    await bufferUpsert(storage, 'buffered', 'b1', { title: 'Buffered Doc' })

    const results = await runSearch(storage, cache, 'buffered', { term: 'buffered' })
    assert.ok((results.count as number) >= 1)
    assert.equal(results.includesBuffer, true)
    assert.equal(results.indexVersion, null)
  })

  it('search reflects buffered updates before rebuild', async () => {
    const storage = new MemoryObjectStorage()
    const cache = new NoopShardCache()
    await createIndex(storage, { name: 'merge-search', schema: { title: 'string' } })
    await bufferUpsert(storage, 'merge-search', '1', { title: 'Original Title' })
    await rebuildIndex(storage, 'merge-search')
    await bufferUpsert(storage, 'merge-search', '1', { title: 'Buffered Update' })

    const results = await runSearch(storage, cache, 'merge-search', { term: 'buffered update' })
    assert.ok((results.count as number) >= 1)
    assert.equal(results.includesBuffer, true)
  })

  it('search returns results after rebuild', async () => {
    const storage = new MemoryObjectStorage()
    const cache = new NoopShardCache()
    await createIndex(storage, { name: 'books', schema: { title: 'string', author: 'string' } })
    await bufferUpsert(storage, 'books', 'b1', { title: 'Dune', author: 'Herbert' })
    await bufferUpsert(storage, 'books', 'b2', { title: 'Foundation', author: 'Asimov' })
    await rebuildIndex(storage, 'books')

    const results = await runSearch(storage, cache, 'books', { term: 'dune' })
    assert.ok((results.count as number) >= 1)
    assert.ok(results.indexVersion)
    assert.ok(Array.isArray(results.hits))
  })

  it('search respects limit and offset', async () => {
    const storage = new MemoryObjectStorage()
    const cache = new NoopShardCache()
    await createIndex(storage, { name: 'nums', schema: { label: 'string' } })
    for (let i = 0; i < 5; i++) {
      await bufferUpsert(storage, 'nums', String(i), { label: `item ${i}` })
    }
    await rebuildIndex(storage, 'nums')

    const page = await runSearch(storage, cache, 'nums', { term: 'item', limit: 2, offset: 1 })
    assert.equal((page.hits as unknown[]).length, 2)
  })

  it('rebuild merges buffered updates into existing snapshot', async () => {
    const storage = new MemoryObjectStorage()
    const cache = new NoopShardCache()
    await createIndex(storage, { name: 'merge', schema: { title: 'string' } })
    await bufferUpsert(storage, 'merge', '1', { title: 'Original Title' })
    await rebuildIndex(storage, 'merge')
    await bufferUpsert(storage, 'merge', '1', { title: 'Updated Title' })
    await bufferDelete(storage, 'merge', '2')
    await bufferUpsert(storage, 'merge', '2', { title: 'New Doc' })
    await rebuildIndex(storage, 'merge')

    const results = await runSearch(storage, cache, 'merge', { term: 'updated' })
    assert.ok((results.count as number) >= 1)
    const meta = await getIndexMeta(storage, 'merge')
    assert.equal(meta.documents, 2)
  })

  it('rebuild clears buffer after success', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'clear', schema: { title: 'string' } })
    await bufferUpsert(storage, 'clear', '1', { title: 'X' })
    await rebuildIndex(storage, 'clear')
    assert.equal((await getStatus(storage, 'clear')).pendingOps, 0)
  })

  it('delete via buffer removes doc on rebuild', async () => {
    const storage = new MemoryObjectStorage()
    const cache = new NoopShardCache()
    await createIndex(storage, { name: 'del', schema: { title: 'string' } })
    await bufferUpsert(storage, 'del', 'keep', { title: 'Keep Me' })
    await bufferUpsert(storage, 'del', 'remove', { title: 'Remove Me' })
    await rebuildIndex(storage, 'del')
    await bufferDelete(storage, 'del', 'remove')
    await rebuildIndex(storage, 'del')

    const meta = await getIndexMeta(storage, 'del')
    assert.equal(meta.documents, 1)
    const results = await runSearch(storage, cache, 'del', { term: 'remove' })
    assert.equal(results.count, 0)
  })

  it('getIndexManifest returns schema and stats', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, {
      name: 'manifest-test',
      schema: { title: 'string' },
      settings: { language: 'english' }
    })
    await bufferUpsert(storage, 'manifest-test', '1', { title: 'Doc' })
    await rebuildIndex(storage, 'manifest-test')

    const manifest = await getIndexManifest(storage, 'manifest-test')
    assert.equal(manifest.indexId, 'manifest-test')
    assert.equal(manifest.status, 'ready')
    assert.deepEqual(manifest.schema, { title: 'string' })
    assert.equal(manifest.stats.documents, 1)
    assert.ok(manifest.stats.totalBytes > 0)
  })

  it('uses shard cache on repeated searches', async () => {
    const storage = new MemoryObjectStorage()
    const cache = new MemoryShardCache()
    await createIndex(storage, { name: 'cached', schema: { title: 'string' } })
    await bufferUpsert(storage, 'cached', '1', { title: 'Cached Doc' })
    await rebuildIndex(storage, 'cached')

    const meta = await getIndexMeta(storage, 'cached')
    const cacheKey = `snapshot:indexes/cached/${meta.liveVersion}/snapshot.msgpack`

    await runSearch(storage, cache, 'cached', { term: 'cached' })
    assert.ok(cache.has(cacheKey))

    await runSearch(storage, cache, 'cached', { term: 'cached' })
    assert.ok(cache.has(cacheKey))
  })

  it('maybeScheduleRebuild schedules when pending ops reach threshold', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, {
      name: 'flush',
      schema: { title: 'string' },
      settings: { rebuildThresholdOps: 2 }
    })
    await bufferUpsert(storage, 'flush', '1', { title: 'One' })

    const scheduled: Promise<unknown>[] = []
    await maybeScheduleRebuild(storage, 'flush', {
      threshold: 2,
      schedule: (task) => {
        scheduled.push(task)
      }
    })
    assert.equal(scheduled.length, 0)

    await bufferUpsert(storage, 'flush', '2', { title: 'Two' })
    await maybeScheduleRebuild(storage, 'flush', {
      threshold: 2,
      schedule: (task) => {
        scheduled.push(task)
      }
    })
    assert.equal(scheduled.length, 1)
    await scheduled[0]
    assert.equal((await getStatus(storage, 'flush')).pendingOps, 0)
  })

  it('maybeScheduleRebuild runInline rebuilds immediately without a schedule fn', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, {
      name: 'inline',
      schema: { title: 'string' },
      settings: { rebuildThresholdOps: 1 }
    })
    await bufferUpsert(storage, 'inline', '1', { title: 'One' })

    await maybeScheduleRebuild(storage, 'inline', { threshold: 1, runInline: true })

    const status = await getStatus(storage, 'inline')
    assert.equal(status.pendingOps, 0)
    assert.equal(status.status, 'ready')

    const results = await runSearch(storage, new NoopShardCache(), 'inline', { term: 'one' })
    assert.ok(results.count >= 1)
  })

  it('maybeScheduleRebuild skips when index is already building', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, {
      name: 'building',
      schema: { title: 'string' },
      settings: { rebuildThresholdOps: 1 }
    })
    await bufferUpsert(storage, 'building', '1', { title: 'One' })

    const meta = await getIndexMeta(storage, 'building')
    meta.status = 'building'
    await import('../src/registry.js').then((m) => m.saveIndexMeta(storage, meta))

    const scheduled: Promise<unknown>[] = []
    await maybeScheduleRebuild(storage, 'building', {
      threshold: 1,
      schedule: (task) => {
        scheduled.push(task)
      }
    })
    assert.equal(scheduled.length, 0)
  })

  it('maybeScheduleRebuild proceeds when a building status is stale', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, {
      name: 'stale',
      schema: { title: 'string' },
      settings: { rebuildThresholdOps: 1 }
    })
    await bufferUpsert(storage, 'stale', '1', { title: 'One' })

    const meta = await getIndexMeta(storage, 'stale')
    meta.status = 'building'
    await saveIndexMeta(storage, meta)
    // age the status past the 15-minute stale window (saveIndexMeta bumps updatedAt)
    meta.updatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    await storage.put(indexMetaKey('stale'), encodeJson(meta), { contentType: 'application/json' })

    const scheduled: Promise<unknown>[] = []
    await maybeScheduleRebuild(storage, 'stale', {
      threshold: 1,
      schedule: (task) => {
        scheduled.push(task)
      }
    })
    assert.equal(scheduled.length, 1)
    await scheduled[0]

    const rebuilt = await getIndexMeta(storage, 'stale')
    assert.equal(rebuilt.status, 'ready')
    assert.equal(rebuilt.pendingOps, 0)
  })

  it('rebuildIndex resets status when the rebuild fails', async () => {
    class FailingSnapshotStorage extends MemoryObjectStorage {
      override async put(
        key: string,
        body: Uint8Array,
        opts?: { contentType?: string }
      ): Promise<{ etag: string }> {
        if (key.endsWith('/snapshot.msgpack')) {
          throw new Error('simulated storage failure')
        }
        return super.put(key, body, opts)
      }
    }

    const storage = new FailingSnapshotStorage()
    await createIndex(storage, { name: 'failrebuild', schema: { title: 'string' } })
    await bufferUpsert(storage, 'failrebuild', '1', { title: 'One' })

    await assert.rejects(() => rebuildIndex(storage, 'failrebuild'), /simulated storage failure/)

    const meta = await getIndexMeta(storage, 'failrebuild')
    assert.equal(meta.status, 'empty')
    assert.equal(meta.buildingVersion, null)
  })

  it('maybeScheduleRebuild posts to builder webhook instead of rebuilding inline', async () => {
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
      const storage = new MemoryObjectStorage()
      await createIndex(storage, {
        name: 'webhook',
        schema: { title: 'string' },
        settings: { rebuildThresholdOps: 1 }
      })
      await bufferUpsert(storage, 'webhook', '1', { title: 'One' })

      const scheduled: Promise<unknown>[] = []
      await maybeScheduleRebuild(storage, 'webhook', {
        threshold: 1,
        builderWebhookUrl: 'https://builder.example/hook',
        source: 'threshold',
        schedule: (task) => {
          scheduled.push(task)
        }
      })

      assert.equal(scheduled.length, 1)
      await scheduled[0]
      assert.equal(calls.length, 1)
      assert.equal(calls[0]!.url, 'https://builder.example/hook')
      assert.deepEqual(calls[0]!.body, { indexId: 'webhook', source: 'threshold' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('rebuildIndex returns without duplicating work when already building', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'idempotent', schema: { title: 'string' } })
    await bufferUpsert(storage, 'idempotent', '1', { title: 'One' })

    const meta = await getIndexMeta(storage, 'idempotent')
    meta.status = 'building'
    await saveIndexMeta(storage, meta)

    const result = await rebuildIndex(storage, 'idempotent')
    assert.equal(result.status, 'building')
    assert.equal((await getStatus(storage, 'idempotent')).pendingOps, 1)
  })

  it('rebuildIndex keeps buffer writes that land after freeze', async () => {
    const storage = new MemoryObjectStorage()
    const cache = new NoopShardCache()
    let injectDuringFreeze = false

    const wrappedStorage: ObjectStorage = {
      get: (key) => storage.get(key),
      put: async (key, body, opts) => {
        const result = await storage.put(key, body, opts)
        if (injectDuringFreeze && key.endsWith('/snapshot.msgpack')) {
          injectDuringFreeze = false
          await bufferUpsert(storage, 'concurrent', '3', { title: 'During Flush' })
        }
        return result
      },
      delete: (key) => storage.delete(key),
      list: (prefix) => storage.list(prefix)
    }

    await createIndex(storage, { name: 'concurrent', schema: { title: 'string' } })
    await bufferUpsert(storage, 'concurrent', '1', { title: 'Snapshot Doc' })
    await rebuildIndex(storage, 'concurrent')
    await bufferUpsert(storage, 'concurrent', '2', { title: 'Buffered Doc' })

    injectDuringFreeze = true
    await rebuildIndex(wrappedStorage, 'concurrent')

    const status = await getStatus(storage, 'concurrent')
    assert.equal(status.pendingOps, 1)

    const bufferedHit = await runSearch(storage, cache, 'concurrent', { term: 'buffered' })
    assert.ok((bufferedHit as { count: number }).count >= 1)

    const bufferHit = await runSearch(storage, cache, 'concurrent', { term: 'during' })
    assert.equal((bufferHit as { includesBuffer: boolean }).includesBuffer, true)
    assert.ok((bufferHit as { count: number }).count >= 1)
  })

  it('repairs stale pendingOps count from actual buffer segments', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'stale-meta', schema: { title: 'string' } })
    await bufferUpsert(storage, 'stale-meta', '1', { title: 'One' })

    const meta = await getIndexMeta(storage, 'stale-meta')
    meta.pendingOps = 99
    await saveIndexMeta(storage, meta)

    const results = await runSearch(storage, new NoopShardCache(), 'stale-meta', { term: 'one' })
    assert.ok((results as { count: number }).count >= 1)
    assert.equal((await getStatus(storage, 'stale-meta')).pendingOps, 1)
  })
})
