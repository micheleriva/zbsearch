import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { fileURLToPath } from 'node:url'

import { assignDocIds, loadImportDocuments, slugifyDocId } from '../src/import-documents.js'

describe('import-documents', () => {
  it('slugifies company names into ids', () => {
    assert.equal(slugifyDocId('OpenAI'), 'openai')
    assert.equal(slugifyDocId('  Foo Bar!! '), 'foo-bar')
  })

  it('assigns unique ids for duplicate names', () => {
    const docs = assignDocIds([{ company_name: 'Acme' }, { company_name: 'Acme' }, { company_name: 'Beta' }])
    assert.deepEqual(
      docs.map((doc) => doc.id),
      ['acme', 'acme-2', 'beta']
    )
  })

  it('loads JSON with data array', async () => {
    const file = fileURLToPath(new URL('./fixtures/unicorns-sample.json', import.meta.url))
    const docs = await loadImportDocuments(file)
    assert.equal(docs.length, 2)
    assert.equal(docs[0]!.id, 'openai')
  })
})
