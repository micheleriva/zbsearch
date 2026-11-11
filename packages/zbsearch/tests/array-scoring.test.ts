import { describe, expect, it } from 'vitest'
import { create, insert, remove, search, update } from '../src/index.js'
import { getInternalDocumentId } from '../src/components/internal-document-id-store.js'

function internalIdOf(db: ReturnType<typeof createDb>, id: string) {
  return getInternalDocumentId(db.internalDocumentIDStore, id)
}

function createDb() {
  return create({ schema: { tags: 'string[]' } as const })
}

function createScalarDb() {
  return create({ schema: { tags: 'string' } as const })
}

describe('string[] scoring', () => {
  it('records one field length per document, summed across the elements', async () => {
    const db = createDb()
    await insert(db, { id: 'a', tags: ['red apple', 'green'] })
    await insert(db, { id: 'b', tags: ['red', 'blue sky'] })
    await insert(db, { id: 'c', tags: ['red'] })

    const { fieldLengths, avgFieldLength } = db.data.index
    expect(fieldLengths.tags[internalIdOf(db, 'a')]).toBe(3)
    expect(fieldLengths.tags[internalIdOf(db, 'b')]).toBe(3)
    expect(fieldLengths.tags[internalIdOf(db, 'c')]).toBe(1)
    expect(avgFieldLength.tags).toBeCloseTo(7 / 3, 10)
  })

  it('accumulates term frequencies across the elements', async () => {
    const db = createDb()
    await insert(db, { id: 'a', tags: ['red apple', 'red', 'green'] })

    expect(db.data.index.frequencies.tags[internalIdOf(db, 'a')]).toStrictEqual({ red: 2, apple: 1, green: 1 })
  })

  it('posts a document once per word even when the word is in several elements', async () => {
    const db = createDb()
    await insert(db, { id: 'a', tags: ['red apple', 'red'] })
    await insert(db, { id: 'b', tags: ['red'] })

    const node = db.data.index.indexes.tags.node as any
    expect(node.postings.get('red')).toStrictEqual([internalIdOf(db, 'a'), internalIdOf(db, 'b')])

    const { hits, count } = search(db, { term: 'red' })
    expect(count).toBe(2)
    expect(hits.map((h) => h.id).sort()).toStrictEqual(['a', 'b'])
  })

  it('scores a string[] value like the same tokens in a single string', async () => {
    const arrays = createDb()
    const scalars = createScalarDb()
    const docs = [
      { id: 'a', tags: ['red apple', 'red', 'green'] },
      { id: 'b', tags: ['red', 'blue sky'] },
      { id: 'c', tags: ['green tea'] }
    ]
    for (const doc of docs) {
      await insert(arrays, doc)
      await insert(scalars, { id: doc.id, tags: doc.tags.join(' ') })
    }

    for (const term of ['red', 'green', 'red green', 'sky']) {
      const fromArrays = search(arrays, { term }).hits.map((h) => [h.id, h.score])
      const fromScalars = search(scalars, { term }).hits.map((h) => [h.id, h.score])
      expect(fromArrays).toStrictEqual(fromScalars)
    }
  })

  it('keeps the statistics finite after removing a document with several elements', async () => {
    const db = createDb()
    await insert(db, { id: 'a', tags: ['red apple', 'green'] })
    await insert(db, { id: 'b', tags: ['red', 'blue sky'] })
    await insert(db, { id: 'c', tags: ['red'] })
    await remove(db, 'b')

    expect(db.data.index.avgFieldLength.tags).toBeCloseTo(2, 10)
    expect(db.data.index.fieldLengths.tags[internalIdOf(db, 'b')]).toBeUndefined()

    const { hits } = search(db, { term: 'red' })
    expect(hits.map((h) => h.id).sort()).toStrictEqual(['a', 'c'])
    for (const hit of hits) {
      expect(Number.isFinite(hit.score)).toBe(true)
    }

    expect(search(db, { term: 'sky' }).count).toBe(0)
  })

  it('matches a freshly built index after removals and updates', async () => {
    const mutated = createDb()
    await insert(mutated, { id: 'a', tags: ['red apple', 'green'] })
    await insert(mutated, { id: 'b', tags: ['red', 'blue sky', 'red'] })
    await insert(mutated, { id: 'c', tags: ['red'] })
    await insert(mutated, { id: 'd', tags: ['green', 'green tea'] })
    await remove(mutated, 'b')
    await update(mutated, 'd', { id: 'd', tags: ['green red', 'tea'] })

    const fresh = createDb()
    await insert(fresh, { id: 'a', tags: ['red apple', 'green'] })
    await insert(fresh, { id: 'c', tags: ['red'] })
    await insert(fresh, { id: 'd', tags: ['green red', 'tea'] })

    expect(mutated.data.index.avgFieldLength.tags).toBeCloseTo(fresh.data.index.avgFieldLength.tags, 10)

    for (const term of ['red', 'green', 'tea', 'apple']) {
      const scoresOf = (db: typeof fresh) => Object.fromEntries(search(db, { term }).hits.map((h) => [h.id, h.score]))
      const mutatedScores = scoresOf(mutated)
      const freshScores = scoresOf(fresh)
      expect(Object.keys(mutatedScores).sort()).toStrictEqual(Object.keys(freshScores).sort())
      for (const id of Object.keys(freshScores)) {
        expect(mutatedScores[id]).toBeCloseTo(freshScores[id], 10)
      }
    }
  })

  it('leaves the statistics untouched for an empty array', async () => {
    const db = createDb()
    await insert(db, { id: 'a', tags: ['red'] })
    await insert(db, { id: 'b', tags: [] })
    const avg = db.data.index.avgFieldLength.tags
    await remove(db, 'b')

    expect(db.data.index.avgFieldLength.tags).toBe(avg)
    expect(search(db, { term: 'red' }).hits.map((h) => h.id)).toStrictEqual(['a'])
  })
})
