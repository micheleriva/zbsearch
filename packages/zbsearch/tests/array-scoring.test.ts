import { describe, expect, it } from 'vitest'
import { create, insert, remove, search, update } from '../src/index.js'
import { getInternalDocumentId } from '../src/components/internal-document-id-store.js'

// Complements array-score-parameters.test.ts: a word that occurs in several elements of a string[] value must be
// posted once for the document, so document frequency is not inflated and the document is not returned (and scored)
// more than once.
describe('string[] postings', () => {
  function createDb() {
    return create({ schema: { tags: 'string[]' } as const })
  }

  function postingsOf(db: ReturnType<typeof createDb>, word: string) {
    return (db.data.index.indexes.tags.node as any).postings.get(word)
  }

  it('posts a document once per word even when the word is in several elements', async () => {
    const db = createDb()
    await insert(db, { id: 'a', tags: ['red apple', 'red', 'apple red'] })
    await insert(db, { id: 'b', tags: ['red'] })

    const a = getInternalDocumentId(db.internalDocumentIDStore, 'a')
    const b = getInternalDocumentId(db.internalDocumentIDStore, 'b')
    expect(postingsOf(db, 'red')).toStrictEqual([a, b])
    expect(postingsOf(db, 'apple')).toStrictEqual([a])

    const { hits, count } = search(db, { term: 'red' })
    expect(count).toBe(2)
    expect(hits.map((h) => h.id).sort()).toStrictEqual(['a', 'b'])
  })

  it('keeps one posting per word through updates and removes the document from every word', async () => {
    const db = createDb()
    await insert(db, { id: 'a', tags: ['red', 'red sky'] })
    await insert(db, { id: 'b', tags: ['blue sky'] })
    await update(db, 'a', { id: 'a', tags: ['sky', 'red sky', 'red'] })

    const a = getInternalDocumentId(db.internalDocumentIDStore, 'a')
    const b = getInternalDocumentId(db.internalDocumentIDStore, 'b')
    expect(postingsOf(db, 'red')).toStrictEqual([a])
    expect(postingsOf(db, 'sky')).toStrictEqual([b, a])
    expect(search(db, { term: 'sky' }).count).toBe(2)

    await remove(db, 'a')
    expect(postingsOf(db, 'red')).toBeUndefined()
    expect(postingsOf(db, 'sky')).toStrictEqual([b])
    expect(search(db, { term: 'red' }).count).toBe(0)
  })
})
