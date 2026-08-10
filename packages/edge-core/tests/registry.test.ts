import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import {
  deleteIndexMeta,
  getIndexMeta,
  listIndexMetas,
  loadRegistry,
  registerIndex,
  saveIndexMeta
} from '../src/registry.js'
import { EdgeApiError } from '../src/errors.js'
import type { IndexMeta } from '../src/types.js'
import { MemoryObjectStorage } from './helpers/memory-storage.js'

function sampleMeta(id: string): IndexMeta {
  return {
    id,
    name: id,
    schema: { title: 'string' },
    settings: { mode: 'edge' },
    liveVersion: null,
    buildingVersion: null,
    status: 'empty',
    documents: 0,
    indexSizeBytes: 0,
    pendingOps: 0,
    lastAppliedOffset: null,
    lastRebuildAt: null,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z'
  }
}

describe('registry', () => {
  it('starts with empty registry', async () => {
    const storage = new MemoryObjectStorage()
    const registry = await loadRegistry(storage)
    assert.deepEqual(registry, { indexes: [] })
  })

  it('registers and lists indexes', async () => {
    const storage = new MemoryObjectStorage()
    await registerIndex(storage, sampleMeta('alpha'))
    await registerIndex(storage, sampleMeta('beta'))

    const indexes = await listIndexMetas(storage)
    assert.equal(indexes.length, 2)
    assert.deepEqual(indexes.map((i) => i.id).sort(), ['alpha', 'beta'])
  })

  it('does not duplicate registry entries', async () => {
    const storage = new MemoryObjectStorage()
    const meta = sampleMeta('once')
    await registerIndex(storage, meta)
    await registerIndex(storage, meta)

    const registry = await loadRegistry(storage)
    assert.deepEqual(registry.indexes, ['once'])
  })

  it('gets index meta by id', async () => {
    const storage = new MemoryObjectStorage()
    await registerIndex(storage, sampleMeta('items'))
    const meta = await getIndexMeta(storage, 'items')
    assert.equal(meta.name, 'items')
  })

  it('throws notFound for missing index', async () => {
    const storage = new MemoryObjectStorage()
    await assert.rejects(
      () => getIndexMeta(storage, 'missing'),
      (err: unknown) => {
        assert.ok(err instanceof EdgeApiError)
        assert.equal((err as EdgeApiError).status, 404)
        return true
      }
    )
  })

  it('updates index meta timestamp on save', async () => {
    const storage = new MemoryObjectStorage()
    const meta = sampleMeta('ts')
    await registerIndex(storage, meta)
    meta.documents = 5
    await saveIndexMeta(storage, meta)
    const loaded = await getIndexMeta(storage, 'ts')
    assert.equal(loaded.documents, 5)
    assert.notEqual(loaded.updatedAt, '2020-01-01T00:00:00.000Z')
  })

  it('deletes index from registry and storage', async () => {
    const storage = new MemoryObjectStorage()
    await registerIndex(storage, sampleMeta('gone'))
    await deleteIndexMeta(storage, 'gone')

    const registry = await loadRegistry(storage)
    assert.deepEqual(registry.indexes, [])
    await assert.rejects(() => getIndexMeta(storage, 'gone'))
  })
})
