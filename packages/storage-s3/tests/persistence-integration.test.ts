import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { create, insert, search } from 'zbsearch'
import { persistToStorage, restoreFromStorage } from '@zbsearch/plugin-data-persistence'

import { S3ObjectStorage } from '../src/index.js'
import { MockS3Backend } from './mock-s3.js'

// Proves that S3ObjectStorage satisfies the plugin's PersistenceStorage contract
// out of the box, so `persistToStorage` / `restoreFromStorage` work against S3/R2
// with no adapter in between.

async function generateTestDBInstance() {
  const db = await create({
    schema: {
      quote: 'string',
      author: 'string'
    } as const
  })

  await insert(db, { quote: 'He who is brave is free', author: 'Seneca' })
  await insert(db, { quote: 'Make each day your masterpiece', author: 'John Wooden' })
  await insert(db, { quote: 'You must be the change you wish to see in the world', author: 'Mahatma Gandhi' })

  return db
}

function makeStorage() {
  const backend = new MockS3Backend()
  const storage = new S3ObjectStorage({
    bucket: 'b',
    accessKeyId: 'k',
    secretAccessKey: 's',
    client: backend.createClient('b')
  })
  return { backend, storage }
}

describe('persistToStorage / restoreFromStorage with S3ObjectStorage', () => {
  it('round-trips a database through S3 (default binary format)', async () => {
    const db = await generateTestDBInstance()
    const original = await search(db, { term: 'brave' })

    const { backend, storage } = makeStorage()
    await persistToStorage(db, storage, 'indexes/quotes.msp')

    // The snapshot is stored under the exact key we asked for.
    assert.ok(backend.objects.has('indexes/quotes.msp'))

    const restored = await restoreFromStorage(storage, 'indexes/quotes.msp')
    const restoredResults = await search(restored, { term: 'brave' })

    assert.equal(restoredResults.count, original.count)
    assert.deepEqual(
      restoredResults.hits.map((h) => h.id),
      original.hits.map((h) => h.id)
    )
  })

  it('round-trips using the json format', async () => {
    const db = await generateTestDBInstance()
    const { storage } = makeStorage()

    await persistToStorage(db, storage, 'quotes.json', { format: 'json' })
    const restored = await restoreFromStorage(storage, 'quotes.json', { format: 'json' })

    const results = await search(restored, { term: 'masterpiece' })
    assert.equal(results.count, 1)
  })

  it('forwards contentType through to S3', async () => {
    const db = await generateTestDBInstance()
    const { backend, storage } = makeStorage()

    await persistToStorage(db, storage, 'quotes.json', { format: 'json', contentType: 'application/json' })
    assert.equal(backend.objects.get('quotes.json')?.contentType, 'application/json')
  })

  it('throws a clear error when the key does not exist', async () => {
    const { storage } = makeStorage()
    await assert.rejects(restoreFromStorage(storage, 'missing'), /No persisted snapshot was found for key "missing"/)
  })
})
