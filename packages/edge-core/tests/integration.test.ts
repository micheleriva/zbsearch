import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { NoopShardCache } from '../src/storage.js'
import { createIndex, rebuildIndex, runSearch } from '../src/service.js'
import { MemoryObjectStorage } from './memory-storage.js'

describe('integration', () => {
  it('buffers writes, rebuilds, and searches', async () => {
    const storage = new MemoryObjectStorage()
    const cache = new NoopShardCache()

    await createIndex(storage, {
      name: 'products',
      schema: { title: 'string', price: 'number' }
    })

    const { bufferUpsert } = await import('../src/service.js')
    await bufferUpsert(storage, 'products', 'sku-1', { title: 'Wireless Headphones', price: 99 })
    await bufferUpsert(storage, 'products', 'sku-2', { title: 'Wired Keyboard', price: 49 })

    await rebuildIndex(storage, 'products')

    const results = await runSearch(storage, cache, 'products', { term: 'wireless headphones' })
    assert.equal((results.count as number) >= 1, true)
    assert.equal(results.indexVersion != null, true)
  })
})
