import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { fileURLToPath } from 'node:url'

import { createIndex, importDocuments } from '@zbsearch/edge-core'
import { MemoryObjectStorage } from './helpers/memory-storage.js'
import { loadImportDocuments } from '../src/import-documents.js'

describe('edge-index-builder import logic', () => {
  it('imports documents from JSON data array', async () => {
    const storage = new MemoryObjectStorage()
    const file = fileURLToPath(new URL('./fixtures/unicorns-sample.json', import.meta.url))
    const documents = await loadImportDocuments(file)

    const meta = await importDocuments(storage, 'unicorns', documents, {
      create: {
        name: 'unicorns',
        schema: {
          company_name: 'string',
          industry: 'string'
        }
      }
    })

    assert.equal(meta.documents, 2)
    assert.equal(meta.status, 'ready')
    assert.equal(meta.pendingOps, 0)
  })
})
