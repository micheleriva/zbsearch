import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import {
  bufferUpsert,
  clearSnapshotDbCache,
  configureSnapshotDbCache,
  createIndex,
  rebuildIndex,
  runSearch
} from '../src/service.js'
import type { ObjectStorage } from '../src/storage.js'
import { NoopShardCache } from '../src/storage.js'
import { MemoryObjectStorage } from './helpers/memory-storage.js'

function countSnapshotGets(storage: MemoryObjectStorage): { storage: ObjectStorage; snapshotGets: () => number } {
  let gets = 0
  return {
    storage: {
      get: async (key) => {
        if (key.endsWith('/snapshot.msgpack')) {
          gets += 1
        }
        return storage.get(key)
      },
      put: (key, body, opts) => storage.put(key, body, opts),
      delete: (key) => storage.delete(key),
      list: (prefix) => storage.list(prefix)
    },
    snapshotGets: () => gets
  }
}

async function createReadyIndex(storage: ObjectStorage, name: string): Promise<void> {
  await createIndex(storage, { name, schema: { title: 'string' } })
  await bufferUpsert(storage, name, '1', { title: `${name} doc` })
  await rebuildIndex(storage, name)
}

describe('snapshot db cache', () => {
  it('reuses the deserialized db on repeated searches', async () => {
    clearSnapshotDbCache()
    const memory = new MemoryObjectStorage()
    const { storage, snapshotGets } = countSnapshotGets(memory)
    const cache = new NoopShardCache()
    await createReadyIndex(storage, 'cached-db')

    await runSearch(storage, cache, 'cached-db', { term: 'doc' })
    await runSearch(storage, cache, 'cached-db', { term: 'doc' })

    assert.equal(snapshotGets(), 1)
  })

  it('reuses the cached db docs on the dirty (pending ops) path', async () => {
    clearSnapshotDbCache()
    const memory = new MemoryObjectStorage()
    const { storage, snapshotGets } = countSnapshotGets(memory)
    const cache = new NoopShardCache()
    await createReadyIndex(storage, 'dirty-db')

    await runSearch(storage, cache, 'dirty-db', { term: 'doc' })
    await bufferUpsert(storage, 'dirty-db', '2', { title: 'buffered doc' })
    const results = await runSearch(storage, cache, 'dirty-db', { term: 'doc' })

    assert.equal(results.includesBuffer, true)
    assert.equal(snapshotGets(), 1)
  })

  it('misses the cache when the live version changes', async () => {
    clearSnapshotDbCache()
    const memory = new MemoryObjectStorage()
    const { storage, snapshotGets } = countSnapshotGets(memory)
    const cache = new NoopShardCache()
    await createReadyIndex(storage, 'versioned-db')

    await runSearch(storage, cache, 'versioned-db', { term: 'doc' })
    assert.equal(snapshotGets(), 1)

    await bufferUpsert(storage, 'versioned-db', '2', { title: 'new doc' })
    await rebuildIndex(storage, 'versioned-db')
    const results = await runSearch(storage, cache, 'versioned-db', { term: 'new' })

    assert.ok((results.count as number) >= 1)
    assert.equal(snapshotGets(), 2)
  })

  it('evicts the least-recently-used db when maxEntries is exceeded', async () => {
    clearSnapshotDbCache()
    configureSnapshotDbCache({ maxEntries: 2 })
    try {
      const memory = new MemoryObjectStorage()
      const { storage, snapshotGets } = countSnapshotGets(memory)
      const cache = new NoopShardCache()
      await createReadyIndex(storage, 'lru-a')
      await createReadyIndex(storage, 'lru-b')
      await createReadyIndex(storage, 'lru-c')

      await runSearch(storage, cache, 'lru-a', { term: 'doc' })
      await runSearch(storage, cache, 'lru-b', { term: 'doc' })
      // Refresh lru-a so lru-b becomes the least recently used.
      await runSearch(storage, cache, 'lru-a', { term: 'doc' })
      await runSearch(storage, cache, 'lru-c', { term: 'doc' })
      assert.equal(snapshotGets(), 3)

      // lru-b was evicted; lru-a and lru-c are still cached.
      await runSearch(storage, cache, 'lru-b', { term: 'doc' })
      assert.equal(snapshotGets(), 4)
      // Re-inserting lru-b evicted lru-a (now oldest); lru-c is still cached.
      await runSearch(storage, cache, 'lru-c', { term: 'doc' })
      assert.equal(snapshotGets(), 4)
      await runSearch(storage, cache, 'lru-a', { term: 'doc' })
      assert.equal(snapshotGets(), 5)
    } finally {
      clearSnapshotDbCache()
    }
  })

  it('does not cache dbs larger than the byte budget', async () => {
    clearSnapshotDbCache()
    configureSnapshotDbCache({ maxBytes: 1 })
    try {
      const memory = new MemoryObjectStorage()
      const { storage, snapshotGets } = countSnapshotGets(memory)
      const cache = new NoopShardCache()
      await createReadyIndex(storage, 'too-big')

      await runSearch(storage, cache, 'too-big', { term: 'doc' })
      await runSearch(storage, cache, 'too-big', { term: 'doc' })

      assert.equal(snapshotGets(), 2)
    } finally {
      clearSnapshotDbCache()
    }
  })

  it('accepts cache limits through runSearch options', async () => {
    clearSnapshotDbCache()
    const memory = new MemoryObjectStorage()
    const { storage, snapshotGets } = countSnapshotGets(memory)
    const cache = new NoopShardCache()
    await createReadyIndex(storage, 'opts-db')

    const options = { snapshotCache: { maxBytes: 1 } }
    await runSearch(storage, cache, 'opts-db', { term: 'doc' }, options)
    await runSearch(storage, cache, 'opts-db', { term: 'doc' }, options)

    assert.equal(snapshotGets(), 2)
    clearSnapshotDbCache()
  })
})
