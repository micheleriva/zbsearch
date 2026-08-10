import { describe, it, beforeEach } from 'vitest'
import assert from 'node:assert/strict'

import { clearSnapshotDbCache, createIndex, bufferUpsert, rebuildIndex } from '@zbsearch/edge-core'

import { ShardSearch } from '../src/search-node.js'
import { MockCache, MockDurableObjectState, MockR2Bucket } from './mocks/cloudflare.js'
import type { Env } from '../src/worker.js'

const mockCache = new MockCache()

beforeEach(() => {
  ;(globalThis as { caches?: { default: Cache } }).caches = {
    default: mockCache as unknown as Cache
  }
  clearSnapshotDbCache()
})

function makeNode() {
  const bucket = new MockR2Bucket()
  const env = { BUCKET: bucket as unknown as R2Bucket } as Env
  const state = new MockDurableObjectState() as unknown as DurableObjectState
  return { bucket, env, node: new ShardSearch(state, env) }
}

describe('ShardSearch', () => {
  it('serves searches for a shard through the DO fetch handler', async () => {
    const { bucket, env, node } = makeNode()
    const storage = new (await import('../src/storage.js')).R2ObjectStorage(bucket as unknown as R2Bucket)

    await createIndex(storage, { name: 'shard-0', schema: { title: 'string' } })
    await bufferUpsert(storage, 'shard-0', '1', { title: 'alpha document' })
    await rebuildIndex(storage, 'shard-0')

    const res = await node.fetch(
      new Request('https://shard-search/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ indexId: 'shard-0', params: { term: 'alpha' } })
      })
    )

    assert.equal(res.status, 200)
    const body = (await res.json()) as { count: number }
    assert.ok(body.count >= 1)
    void env
  })

  it('returns the edge error body for a missing index', async () => {
    const { node } = makeNode()

    const res = await node.fetch(
      new Request('https://shard-search/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ indexId: 'nope', params: { term: 'alpha' } })
      })
    )

    assert.equal(res.status, 404)
    const body = (await res.json()) as { error: { code: string } }
    assert.equal(body.error.code, 'NOT_FOUND')
  })

  it('404s on unknown routes', async () => {
    const { node } = makeNode()
    const res = await node.fetch(new Request('https://shard-search/other', { method: 'POST', body: '{}' }))
    assert.equal(res.status, 404)
  })
})
