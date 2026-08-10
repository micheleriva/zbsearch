import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import {
  NoopShardCache,
  getIndexMeta,
  importShardedDocuments,
  runSearch,
  shardForDoc,
  shardIndexId,
  snapshotKey
} from '@zbsearch/edge-core'
import { MemoryObjectStorage } from './helpers/memory-storage.js'

const schema = { title: 'string' }

describe('edge-index-builder sharded import logic', () => {
  it('creates the group, routes docs by hash, and uploads one snapshot per shard', async () => {
    const storage = new MemoryObjectStorage()
    const documents = Array.from({ length: 20 }, (_, i) => ({
      id: `doc-${i}`,
      doc: { title: `sharded title ${i}` }
    }))

    const result = await importShardedDocuments(storage, 'bulk', documents, {
      shards: 3,
      create: { name: 'bulk', schema }
    })

    assert.equal(result.indexId, 'bulk')
    assert.equal(result.shardCount, 3)
    assert.equal(result.documents, 20)
    assert.equal(result.shards.length, 3)
    assert.equal(
      result.shards.reduce((sum, s) => sum + s.documents, 0),
      20
    )
    assert.ok(result.indexSizeBytes > 0)

    const groupMeta = await getIndexMeta(storage, 'bulk')
    assert.deepEqual(groupMeta.shards, { count: 3 })

    const expectedBuckets = new Array<number>(3).fill(0)
    for (const { id } of documents) {
      expectedBuckets[shardForDoc(id, 3)]!++
    }
    for (let i = 0; i < 3; i++) {
      const shardMeta = await getIndexMeta(storage, shardIndexId('bulk', i))
      assert.equal(shardMeta.documents, expectedBuckets[i])
      assert.equal(shardMeta.status, expectedBuckets[i]! > 0 ? 'ready' : 'empty')
      assert.ok((await storage.get(snapshotKey(shardMeta.id, shardMeta.liveVersion!))) !== null)
    }

    const search = await runSearch(storage, new NoopShardCache(), 'bulk', { term: 'sharded', limit: 25 })
    assert.equal(search.count, 20)
    assert.equal((search.hits as unknown[]).length, 20)
  })

  it('imports into an existing group without create options', async () => {
    const storage = new MemoryObjectStorage()
    await importShardedDocuments(storage, 'bulk', [{ id: 'doc-1', doc: { title: 'first' } }], {
      shards: 2,
      create: { name: 'bulk', schema }
    })

    const result = await importShardedDocuments(storage, 'bulk', [{ id: 'doc-2', doc: { title: 'second' } }], {
      shards: 2
    })

    assert.equal(result.documents, 1)
  })
})
