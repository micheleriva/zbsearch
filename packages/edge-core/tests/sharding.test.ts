import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { handleRequest } from '../src/router.js'
import { NoopShardCache } from '../src/storage.js'
import {
  bufferBatch,
  bufferUpsert,
  createIndex,
  getIndexManifest,
  getStatus,
  rebuildIndex,
  runSearch
} from '../src/service.js'
import { getIndexMeta, saveIndexMeta } from '../src/registry.js'
import { snapshotKey } from '../src/paths.js'
import { fnv1a32, shardForDoc, shardIndexId, shardIndexIds } from '../src/shards.js'
import { importShardedDocuments, mergeShardSearchResults } from '../src/shard-group.js'
import type { IndexMeta, BufferedWriteResponse, IndexStatusResponse } from '../src/types.js'
import { MemoryObjectStorage } from './helpers/memory-storage.js'
import { makeRequest } from './helpers/http-request.js'

const schema = { title: 'string' }

function ctx(storage: MemoryObjectStorage) {
  return { storage, cache: new NoopShardCache() }
}

function idsForShard(shard: number, total: number, n: number): string[] {
  const ids: string[] = []
  for (let i = 0; ids.length < n && i < 100000; i++) {
    const id = `doc-${i}`
    if (shardForDoc(id, total) === shard) {
      ids.push(id)
    }
  }
  return ids
}

describe('shard routing', () => {
  it('fnv1a32 matches known vectors', () => {
    assert.equal(fnv1a32(''), 0x811c9dc5)
    assert.equal(fnv1a32('a'), 0xe40c292c)
  })

  it('routes deterministically and distributes across shards', () => {
    const counts = new Array<number>(4).fill(0)
    for (let i = 0; i < 200; i++) {
      const id = `doc-${i}`
      const shard = shardForDoc(id, 4)
      assert.equal(shard, shardForDoc(id, 4))
      assert.ok(shard >= 0 && shard < 4)
      counts[shard]!++
    }
    assert.equal(
      counts.reduce((a, b) => a + b, 0),
      200
    )
    for (const count of counts) {
      assert.ok(count > 0, 'every shard should receive at least one doc')
    }
  })
})

describe('shard group creation', () => {
  it('creates a group meta plus N ordinary shard indexes', async () => {
    const storage = new MemoryObjectStorage()
    const group = await createIndex(storage, { name: 'products', schema, shards: 3 })

    assert.deepEqual(group.shards, { count: 3 })
    assert.equal(group.liveVersion, null)
    assert.equal(group.documents, 0)

    for (const shardId of shardIndexIds('products', 3)) {
      const shardMeta = await getIndexMeta(storage, shardId)
      assert.equal(shardMeta.id, shardId)
      assert.equal(shardMeta.shards, undefined)
      assert.deepEqual(shardMeta.schema, schema)
    }
  })

  it('rejects invalid shard counts', async () => {
    const storage = new MemoryObjectStorage()
    await assert.rejects(() => createIndex(storage, { name: 'a', schema, shards: 1 }), /shards must be/)
    await assert.rejects(() => createIndex(storage, { name: 'b', schema, shards: 1.5 }), /shards must be/)
    await assert.rejects(() => createIndex(storage, { name: 'c', schema, shards: 0 }), /shards must be/)
  })

  it('leaves unsharded metas untouched (no shards key in stored JSON)', async () => {
    const storage = new MemoryObjectStorage()
    const meta = await createIndex(storage, { name: 'plain', schema })
    assert.equal(meta.shards, undefined)

    const raw = await storage.get('indexes/plain/meta.json')
    assert.ok(raw)
    assert.ok(!new TextDecoder().decode(raw.body).includes('"shards"'))
  })
})

describe('sharded writes', () => {
  it('routes a single upsert to exactly one shard', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'g', schema, shards: 3 })

    const docId = idsForShard(1, 3, 1)[0]!
    const result = await bufferUpsert(storage, 'g', docId, { title: 'hello world' })
    assert.equal(result.status, 'buffered')
    assert.equal(result.shards, undefined)

    for (let i = 0; i < 3; i++) {
      const shardMeta = await getIndexMeta(storage, shardIndexId('g', i))
      assert.equal(shardMeta.pendingOps, i === 1 ? 1 : 0)
    }
    const groupMeta = await getIndexMeta(storage, 'g')
    assert.equal(groupMeta.pendingOps, 0)
  })

  it('splits a batch into per-shard batches and aggregates the response', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'g', schema, shards: 2 })

    const shard0Ids = idsForShard(0, 2, 3)
    const shard1Ids = idsForShard(1, 2, 2)
    const operations = [
      ...shard0Ids.map((id) => ({ op: 'upsert' as const, id, doc: { title: `t ${id}` } })),
      ...shard1Ids.map((id) => ({ op: 'upsert' as const, id, doc: { title: `t ${id}` } })),
      { op: 'delete' as const, id: shard1Ids[0]! }
    ]

    const result = await bufferBatch(storage, 'g', operations)
    assert.equal(result.status, 'buffered')
    assert.ok(result.changeId)
    assert.equal(result.shards!.length, 2)

    const byShard = new Map(result.shards!.map((s) => [s.indexId, s]))
    assert.equal(byShard.get(shardIndexId('g', 0))!.ops, 3)
    assert.equal(byShard.get(shardIndexId('g', 1))!.ops, 3)
    assert.equal(
      result.shards!.reduce((sum, s) => sum + s.ops, 0),
      operations.length
    )

    assert.equal((await getIndexMeta(storage, shardIndexId('g', 0))).pendingOps, 3)
    assert.equal((await getIndexMeta(storage, shardIndexId('g', 1))).pendingOps, 3)
  })
})

describe('scatter-gather search', () => {
  async function populatedGroup() {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'g', schema, shards: 2 })

    const [a1, a2] = idsForShard(0, 2, 2)
    const [b1] = idsForShard(1, 2, 1)
    await importShardedDocuments(
      storage,
      'g',
      [
        { id: a1!, doc: { title: 'alpha alpha alpha alpha alpha alpha alpha alpha alpha alpha' } },
        { id: a2!, doc: { title: 'alpha beta gamma delta epsilon zeta eta theta iota kappa' } },
        { id: b1!, doc: { title: 'alpha alpha alpha' } }
      ],
      { shards: 2 }
    )

    return { storage, ids: [a1!, a2!, b1!] }
  }

  it('merges hits by score across shards and sums count', async () => {
    const { storage, ids } = await populatedGroup()
    const result = await runSearch(storage, new NoopShardCache(), 'g', { term: 'alpha', limit: 10 })

    assert.equal(result.count, 3)
    const hits = result.hits as Array<{ id: string; score: number }>
    assert.equal(hits.length, 3)
    assert.deepEqual(new Set(hits.map((h) => h.id)), new Set(ids))
    for (let i = 1; i < hits.length; i++) {
      assert.ok(hits[i - 1]!.score >= hits[i]!.score, 'hits must be sorted by score desc')
    }
    assert.equal(result.indexVersion, null)
    assert.equal(result.includesBuffer, false)
    assert.equal((result.shards as unknown[]).length, 2)
  })

  it('fans out through executeShardSearch when provided', async () => {
    const { storage, ids } = await populatedGroup()

    const calls: Array<{ shardId: string; params: Record<string, unknown> }> = []
    const result = await runSearch(
      storage,
      new NoopShardCache(),
      'g',
      { term: 'alpha', limit: 10 },
      {
        executeShardSearch: async (shardId, params) => {
          calls.push({ shardId, params: params as Record<string, unknown> })
          // In-process stand-in for a remote shard worker.
          const { runSearch: searchShard } = await import('../src/service.js')
          return searchShard(storage, new NoopShardCache(), shardId, params)
        }
      }
    )

    assert.deepEqual(new Set(calls.map((c) => c.shardId)), new Set(shardIndexIds('g', 2)))
    for (const call of calls) {
      assert.equal(call.params.offset, 0, 'shards must search from offset 0 for correct merging')
      assert.equal(call.params.limit, 10)
    }
    assert.equal(result.count, 3)
    assert.deepEqual(new Set((result.hits as Array<{ id: string }>).map((h) => h.id)), new Set(ids))
  })

  it('applies offset/limit to the merged list (not per shard)', async () => {
    const { storage } = await populatedGroup()

    const all = await runSearch(storage, new NoopShardCache(), 'g', { term: 'alpha', limit: 10 })
    const allIds = (all.hits as Array<{ id: string }>).map((h) => h.id)

    // Page through with limit 1: the pages must reconstruct the full merged list.
    for (let offset = 0; offset < 3; offset++) {
      const page = await runSearch(storage, new NoopShardCache(), 'g', { term: 'alpha', limit: 1, offset })
      const pageIds = (page.hits as Array<{ id: string }>).map((h) => h.id)
      assert.deepEqual(pageIds, [allIds[offset]!])
      assert.equal(page.count, 3)
    }
  })

  it('searches buffered (pre-rebuild) documents across shards', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'g', schema, shards: 3 })
    await bufferUpsert(storage, 'g', idsForShard(0, 3, 1)[0]!, { title: 'buffered alpha doc' })
    await bufferUpsert(storage, 'g', idsForShard(2, 3, 1)[0]!, { title: 'another buffered alpha' })

    const result = await runSearch(storage, new NoopShardCache(), 'g', { term: 'alpha' })
    assert.equal(result.count, 2)
    assert.equal(result.includesBuffer, true)
  })

  it('returns 404 for a group with no searchable documents', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'g', schema, shards: 2 })
    await assert.rejects(
      () => runSearch(storage, new NoopShardCache(), 'g', { term: 'alpha' }),
      /no searchable documents/
    )
  })
})

describe('mergeShardSearchResults', () => {
  it('interleaves hits by score where naive concat would fail', () => {
    const merged = mergeShardSearchResults(
      [
        {
          indexId: 'g--shard-0',
          result: {
            count: 5,
            hits: [
              { id: 'a1', score: 0.9, document: {} },
              { id: 'a2', score: 0.1, document: {} }
            ],
            elapsed: { raw: 3, formatted: '3ms' },
            indexVersion: 'v0',
            includesBuffer: false
          }
        },
        {
          indexId: 'g--shard-1',
          result: {
            count: 7,
            hits: [{ id: 'b1', score: 0.5, document: {} }],
            elapsed: { raw: 8, formatted: '8ms' },
            indexVersion: 'v1',
            includesBuffer: true
          }
        }
      ],
      { limit: 2, offset: 0 }
    )

    assert.deepEqual(
      (merged.hits as Array<{ id: string }>).map((h) => h.id),
      ['a1', 'b1']
    )
    assert.equal(merged.count, 12)
    assert.deepEqual(merged.elapsed, { raw: 8, formatted: '8ms' })
    assert.equal(merged.indexVersion, null)
    assert.equal(merged.includesBuffer, true)
    assert.deepEqual(merged.shards, [
      { indexId: 'g--shard-0', liveVersion: 'v0', includesBuffer: false, count: 5 },
      { indexId: 'g--shard-1', liveVersion: 'v1', includesBuffer: true, count: 7 }
    ])
  })

  it('applies offset after merging and breaks score ties by doc id', () => {
    const merged = mergeShardSearchResults(
      [
        {
          indexId: 'g--shard-0',
          result: {
            count: 2,
            hits: [
              { id: 'b2', score: 0.5, document: {} },
              { id: 'c1', score: 0.2, document: {} }
            ],
            elapsed: { raw: 1, formatted: '1ms' }
          }
        },
        {
          indexId: 'g--shard-1',
          result: {
            count: 2,
            hits: [
              { id: 'a9', score: 0.5, document: {} },
              { id: 'd1', score: 0.1, document: {} }
            ],
            elapsed: { raw: 1, formatted: '1ms' }
          }
        }
      ],
      { limit: 2, offset: 1 }
    )

    assert.deepEqual(
      (merged.hits as Array<{ id: string }>).map((h) => h.id),
      ['b2', 'c1']
    )
  })

  it('merges facets additively when present', () => {
    const merged = mergeShardSearchResults(
      [
        {
          indexId: 'g--shard-0',
          result: {
            count: 2,
            hits: [],
            elapsed: { raw: 1, formatted: '1ms' },
            facets: { category: { count: 2, values: { x: 1, y: 1 } } }
          }
        },
        {
          indexId: 'g--shard-1',
          result: {
            count: 3,
            hits: [],
            elapsed: { raw: 1, formatted: '1ms' },
            facets: { category: { count: 3, values: { x: 2 } } }
          }
        }
      ],
      { limit: 10, offset: 0 }
    )

    assert.deepEqual(merged.facets, { category: { count: 5, values: { x: 3, y: 1 } } })
  })
})

describe('aggregate status and manifest', () => {
  it('sums documents/pendingOps and reports worst-of status', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'g', schema, shards: 2 })
    await importShardedDocuments(
      storage,
      'g',
      [...idsForShard(0, 2, 2), ...idsForShard(1, 2, 1)].map((id) => ({ id, doc: { title: 'alpha' } })),
      { shards: 2 }
    )
    await bufferUpsert(storage, 'g', idsForShard(1, 2, 2)[1]!, { title: 'pending' })

    const status = await getStatus(storage, 'g')
    assert.equal(status.indexId, 'g')
    assert.equal(status.documents, 3)
    assert.equal(status.pendingOps, 1)
    assert.equal(status.status, 'ready')
    assert.equal(status.liveVersion, null)
    assert.ok(status.indexSizeBytes > 0)
    assert.equal(status.shards!.length, 2)
    assert.equal(
      status.shards!.reduce((sum, s) => sum + s.documents, 0),
      3
    )

    // Worst-of: a building shard dominates the aggregate.
    const shardMeta = await getIndexMeta(storage, shardIndexId('g', 0))
    shardMeta.status = 'building'
    await saveIndexMeta(storage, shardMeta)
    assert.equal((await getStatus(storage, 'g')).status, 'building')
  })

  it('aggregates the manifest with per-shard summaries', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'g', schema, shards: 2 })
    await importShardedDocuments(
      storage,
      'g',
      idsForShard(0, 2, 2).map((id) => ({ id, doc: { title: 'alpha' } })),
      { shards: 2 }
    )

    const manifest = await getIndexManifest(storage, 'g')
    assert.equal(manifest.indexId, 'g')
    assert.equal(manifest.stats.documents, 2)
    assert.ok(manifest.stats.totalBytes > 0)
    assert.equal(manifest.status, 'ready')
    assert.equal(manifest.shards!.length, 2)
    assert.deepEqual(manifest.schema, schema)
  })
})

describe('sharded rebuild', () => {
  it('rebuilds every shard of the group', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'g', schema, shards: 2 })
    await bufferUpsert(storage, 'g', idsForShard(0, 2, 1)[0]!, { title: 'alpha one' })
    await bufferUpsert(storage, 'g', idsForShard(1, 2, 1)[0]!, { title: 'alpha two' })

    const group = await rebuildIndex(storage, 'g')
    assert.equal(group.id, 'g')

    for (const shardId of shardIndexIds('g', 2)) {
      const shardMeta = await getIndexMeta(storage, shardId)
      assert.equal(shardMeta.status, 'ready')
      assert.equal(shardMeta.pendingOps, 0)
      assert.ok(shardMeta.liveVersion)
    }

    const result = await runSearch(storage, new NoopShardCache(), 'g', { term: 'alpha' })
    assert.equal(result.count, 2)
    assert.equal(result.includesBuffer, false)
  })
})

describe('importShardedDocuments', () => {
  it('creates group + shards with --create semantics and routes docs by hash', async () => {
    const storage = new MemoryObjectStorage()
    const documents = Array.from({ length: 12 }, (_, i) => ({
      id: `doc-${i}`,
      doc: { title: `title ${i}` }
    }))

    const result = await importShardedDocuments(storage, 'bulk', documents, {
      shards: 3,
      create: { name: 'bulk', schema }
    })

    assert.equal(result.indexId, 'bulk')
    assert.equal(result.shardCount, 3)
    assert.equal(result.documents, 12)
    assert.equal(result.shards.length, 3)

    // Every document must live in the shard its id hashes to.
    const expectedBuckets = new Array<number>(3).fill(0)
    for (const { id } of documents) {
      expectedBuckets[shardForDoc(id, 3)]!++
    }
    for (let i = 0; i < 3; i++) {
      const shardMeta = await getIndexMeta(storage, shardIndexId('bulk', i))
      assert.equal(shardMeta.documents, expectedBuckets[i])
      assert.ok(storage.has(snapshotKey(shardMeta.id, shardMeta.liveVersion!)))
    }
  })

  it('rejects imports into missing groups, non-groups, and count mismatches', async () => {
    const storage = new MemoryObjectStorage()
    await assert.rejects(() => importShardedDocuments(storage, 'missing', [], { shards: 2 }), /not found/)

    await createIndex(storage, { name: 'plain', schema })
    await assert.rejects(() => importShardedDocuments(storage, 'plain', [], { shards: 2 }), /not a shard group/)

    await createIndex(storage, { name: 'g', schema, shards: 2 })
    await assert.rejects(() => importShardedDocuments(storage, 'g', [], { shards: 3 }), /created with 2 shards/)
  })

  it('rejects direct importDocuments calls on a group', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'g', schema, shards: 2 })
    const { importDocuments } = await import('../src/service.js')
    await assert.rejects(() => importDocuments(storage, 'g', []), /shard group/)
  })
})

describe('router on shard groups', () => {
  it('creates a group via POST /v1/indexes with shards and hides shards in listings', async () => {
    const storage = new MemoryObjectStorage()
    const created = await handleRequest(
      ctx(storage),
      makeRequest('POST', '/v1/indexes', { body: { name: 'products', schema, shards: 3 } })
    )
    assert.equal(created.status, 201)
    assert.deepEqual((created.body as IndexMeta).shards, { count: 3 })

    const list = await handleRequest(ctx(storage), makeRequest('GET', '/v1/indexes'))
    const ids = (list.body as { indexes: IndexMeta[] }).indexes.map((m) => m.id)
    assert.deepEqual(ids, ['products'])

    const bad = await handleRequest(
      ctx(storage),
      makeRequest('POST', '/v1/indexes', { body: { name: 'other', schema, shards: 1 } })
    )
    assert.equal(bad.status, 400)
  })

  it('serves writes, batch, search, status, and rebuild on a group', async () => {
    const storage = new MemoryObjectStorage()
    await handleRequest(ctx(storage), makeRequest('POST', '/v1/indexes', { body: { name: 'g', schema, shards: 2 } }))

    const shard0Ids = idsForShard(0, 2, 3)
    const upsert = await handleRequest(
      ctx(storage),
      makeRequest('PUT', `/v1/indexes/g/documents/${shard0Ids[0]!}`, {
        body: { title: 'alpha single' }
      })
    )
    assert.equal(upsert.status, 202)

    const batchOps = [...shard0Ids.slice(1), ...idsForShard(1, 2, 2)].map((id) => ({
      op: 'upsert' as const,
      id,
      doc: { title: 'alpha batched' }
    }))
    const batch = await handleRequest(
      ctx(storage),
      makeRequest('POST', '/v1/indexes/g/documents/batch', { body: { operations: batchOps } })
    )
    assert.equal(batch.status, 202)
    assert.equal((batch.body as BufferedWriteResponse).shards!.length, 2)

    const beforeRebuild = await handleRequest(
      ctx(storage),
      makeRequest('POST', '/v1/indexes/g/search', { body: { term: 'alpha' } })
    )
    assert.equal(beforeRebuild.status, 200)
    assert.equal((beforeRebuild.body as { count: number }).count, 5)

    const rebuild = await handleRequest(ctx(storage), makeRequest('POST', '/v1/indexes/g/rebuild'))
    assert.equal(rebuild.status, 202)

    const status = await handleRequest(ctx(storage), makeRequest('GET', '/v1/indexes/g/status'))
    const statusBody = status.body as IndexStatusResponse
    assert.equal(statusBody.documents, 5)
    assert.equal(statusBody.pendingOps, 0)
    assert.equal(statusBody.status, 'ready')
    assert.equal(statusBody.shards!.length, 2)
  })

  it('deletes a group together with its shard metas', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'g', schema, shards: 2 })

    const res = await handleRequest(ctx(storage), makeRequest('DELETE', '/v1/indexes/g'))
    assert.equal(res.status, 202)

    await assert.rejects(() => getIndexMeta(storage, 'g'), /not found/)
    for (const shardId of shardIndexIds('g', 2)) {
      await assert.rejects(() => getIndexMeta(storage, shardId), /not found/)
    }
  })

  it('propagates PATCHed settings to shards', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'g', schema, shards: 2 })

    const res = await handleRequest(
      ctx(storage),
      makeRequest('PATCH', '/v1/indexes/g', { body: { settings: { rebuildThresholdOps: 10 } } })
    )
    assert.equal(res.status, 200)

    for (const shardId of shardIndexIds('g', 2)) {
      const shardMeta = await getIndexMeta(storage, shardId)
      assert.equal(shardMeta.settings.rebuildThresholdOps, 10)
    }
  })
})
