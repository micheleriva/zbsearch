import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  createIndex,
  listIndexMetas,
  rebuildIndex,
  bufferUpsert
} from '@zbsearch/edge-core'
import { MemoryObjectStorage } from './helpers/memory-storage.js'

async function rebuildAll(storage: MemoryObjectStorage): Promise<void> {
  const indexes = await listIndexMetas(storage)
  for (const index of indexes) {
    if (index.pendingOps === 0 && index.status === 'ready' && index.liveVersion) {
      continue
    }
    await rebuildIndex(storage, index.id)
  }
}

describe('edge-index-builder rebuild logic', () => {
  it('rebuilds a single index with pending ops', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'one', schema: { title: 'string' } })
    await bufferUpsert(storage, 'one', '1', { title: 'Doc' })

    const meta = await rebuildIndex(storage, 'one')
    assert.equal(meta.status, 'ready')
    assert.equal(meta.documents, 1)
  })

  it('rebuild --all skips ready indexes with no pending ops', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'ready', schema: { title: 'string' } })
    await bufferUpsert(storage, 'ready', '1', { title: 'Ready' })
    await rebuildIndex(storage, 'ready')

    const before = await listIndexMetas(storage)
    const readyBefore = before.find((i) => i.id === 'ready')!
    assert.equal(readyBefore.pendingOps, 0)

    await rebuildAll(storage)

    const after = await listIndexMetas(storage)
    const readyAfter = after.find((i) => i.id === 'ready')!
    assert.equal(readyAfter.liveVersion, readyBefore.liveVersion)
  })

  it('rebuild --all rebuilds indexes with pending ops', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'pending', schema: { title: 'string' } })
    await bufferUpsert(storage, 'pending', '1', { title: 'Pending' })

    await rebuildAll(storage)

    const meta = (await listIndexMetas(storage)).find((i) => i.id === 'pending')!
    assert.equal(meta.status, 'ready')
    assert.equal(meta.pendingOps, 0)
  })
})
