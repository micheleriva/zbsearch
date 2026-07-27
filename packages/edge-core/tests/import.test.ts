import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createIndex, importDocuments, runSearch } from '../src/service.js'
import { NoopShardCache } from '../src/storage.js'
import { MemoryObjectStorage } from './helpers/memory-storage.js'

describe('importDocuments', () => {
  it('builds a searchable snapshot from documents', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'products', schema: { title: 'string' } })

    const meta = await importDocuments(storage, 'products', [
      { id: '1', doc: { title: 'Alpha' } },
      { id: '2', doc: { title: 'Beta' } }
    ])

    assert.equal(meta.documents, 2)
    assert.equal(meta.pendingOps, 0)
    assert.equal(meta.status, 'ready')
    assert.ok(meta.liveVersion)

    const results = await runSearch(storage, new NoopShardCache(), 'products', { term: 'alpha' })
    assert.equal((results as { count: number }).count, 1)
    assert.equal((results as { includesBuffer: boolean }).includesBuffer, false)
  })

  it('creates index when --create options are provided', async () => {
    const storage = new MemoryObjectStorage()

    const meta = await importDocuments(storage, 'new-catalog', [{ id: 'sku-1', doc: { title: 'Widget' } }], {
      create: { name: 'New Catalog', schema: { title: 'string' } }
    })

    assert.equal(meta.id, 'new-catalog')
    assert.equal(meta.documents, 1)
  })

  it('clears buffered ops when importing', async () => {
    const storage = new MemoryObjectStorage()
    const { bufferUpsert } = await import('../src/service.js')
    await createIndex(storage, { name: 'reset', schema: { title: 'string' } })
    await bufferUpsert(storage, 'reset', 'old', { title: 'Old' })

    const meta = await importDocuments(storage, 'reset', [{ id: 'new', doc: { title: 'Fresh' } }])
    assert.equal(meta.pendingOps, 0)
    assert.equal(meta.documents, 1)

    const results = await runSearch(storage, new NoopShardCache(), 'reset', { term: 'fresh' })
    assert.equal((results as { count: number }).count, 1)
  })

  it('infers the schema from documents when the index has no schema', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'schemaless' })

    await importDocuments(storage, 'schemaless', [
      { id: '1', doc: { title: 'Alpha', price: 10 } },
      { id: '2', doc: { title: 'Beta', price: 20 } }
    ])

    const results = await runSearch(storage, new NoopShardCache(), 'schemaless', {
      term: 'alpha',
      where: { price: { gte: 5 } }
    })
    assert.equal((results as { count: number }).count, 1)
  })

  it('indexes undeclared fields when inferSchema is enabled on a partial schema', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, {
      name: 'hybrid',
      schema: { embedding: 'vector[3]' },
      settings: { inferSchema: true }
    })

    await importDocuments(storage, 'hybrid', [
      { id: '1', doc: { title: 'Gamma', embedding: [1, 0, 0] } },
      { id: '2', doc: { title: 'Delta', embedding: [0, 1, 0] } }
    ])

    const results = await runSearch(storage, new NoopShardCache(), 'hybrid', { term: 'gamma' })
    assert.equal((results as { count: number }).count, 1)
  })

  it('ignores undeclared fields on a partial schema without inferSchema', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, {
      name: 'strict-partial',
      schema: { embedding: 'vector[3]' }
    })

    await importDocuments(storage, 'strict-partial', [{ id: '1', doc: { title: 'Epsilon', embedding: [1, 0, 0] } }])

    const results = await runSearch(storage, new NoopShardCache(), 'strict-partial', { term: 'epsilon' })
    assert.equal((results as { count: number }).count, 0)
  })
})
