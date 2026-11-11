import { describe, expect, it } from 'vitest'
import { Index } from '../src/components/index.js'
import { create, getByID, insert, remove, search, update } from '../src/index.js'

type TagsDB = ReturnType<typeof createTagsDB>

function createTagsDB() {
  return create({ schema: { tags: 'string[]' } as const })
}

function getIndex(db: TagsDB): Index {
  return db.data.index as Index
}

function internalIdOf(db: TagsDB, id: string): number {
  return db.internalDocumentIDStore.idToInternalId.get(id)!
}

describe('string[] score parameters', () => {
  it('stores the total number of tokens across all elements as the field length', async () => {
    const db = createTagsDB()
    await insert(db, { id: 'a', tags: ['red apple', 'green'] })
    await insert(db, { id: 'b', tags: ['red', 'blue sky'] })
    await insert(db, { id: 'c', tags: ['red'] })

    const index = getIndex(db)
    expect(index.fieldLengths.tags[internalIdOf(db, 'a')]).toBe(3)
    expect(index.fieldLengths.tags[internalIdOf(db, 'b')]).toBe(3)
    expect(index.fieldLengths.tags[internalIdOf(db, 'c')]).toBe(1)
    // One update of the average per document, not one per element
    expect(index.avgFieldLength.tags).toBeCloseTo(7 / 3, 10)
  })

  it('keeps the term frequencies of every element', async () => {
    const db = createTagsDB()
    await insert(db, { id: 'a', tags: ['red apple', 'green', 'red'] })

    const index = getIndex(db)
    expect(index.frequencies.tags[internalIdOf(db, 'a')]).toEqual({ red: 2, apple: 1, green: 1 })

    const { hits } = await search(db, { term: 'apple' })
    expect(hits.map((h) => h.id)).toEqual(['a'])
  })

  it('does not produce NaN averages or scores after removing a document', async () => {
    const db = createTagsDB()
    await insert(db, { id: 'a', tags: ['red apple', 'green'] })
    await insert(db, { id: 'b', tags: ['red', 'blue sky'] })
    await insert(db, { id: 'c', tags: ['red'] })

    expect(await remove(db, 'b')).toBe(true)

    const index = getIndex(db)
    expect(index.avgFieldLength.tags).toBeCloseTo(2, 10)
    expect(index.fieldLengths.tags[internalIdOf(db, 'a')]).toBe(3)
    expect(index.fieldLengths.tags[internalIdOf(db, 'c')]).toBe(1)

    const { hits } = await search(db, { term: 'red' })
    expect(hits.map((h) => h.id).sort()).toEqual(['a', 'c'])
    for (const hit of hits) {
      expect(Number.isFinite(hit.score)).toBe(true)
      expect(hit.score).toBeGreaterThan(0)
    }
    // The shorter field ranks higher for the same term frequency
    expect(hits[0].id).toBe('c')
  })

  it('scores as if the removed document had never been inserted', async () => {
    const withRemoval = createTagsDB()
    await insert(withRemoval, { id: 'a', tags: ['red apple', 'green'] })
    await insert(withRemoval, { id: 'b', tags: ['red', 'blue sky'] })
    await insert(withRemoval, { id: 'c', tags: ['red'] })
    await remove(withRemoval, 'b')

    const fresh = createTagsDB()
    await insert(fresh, { id: 'a', tags: ['red apple', 'green'] })
    await insert(fresh, { id: 'c', tags: ['red'] })

    expect(getIndex(withRemoval).avgFieldLength.tags).toBeCloseTo(getIndex(fresh).avgFieldLength.tags, 10)

    const scoresWithRemoval = (await search(withRemoval, { term: 'red' })).hits.map((h) => [h.id, h.score])
    const freshScores = (await search(fresh, { term: 'red' })).hits.map((h) => [h.id, h.score])
    expect(scoresWithRemoval.length).toBe(freshScores.length)
    for (let i = 0; i < freshScores.length; i++) {
      expect(scoresWithRemoval[i][0]).toBe(freshScores[i][0])
      expect(scoresWithRemoval[i][1] as number).toBeCloseTo(freshScores[i][1] as number, 10)
    }
  })

  it('matches a single string field with the same tokens', async () => {
    const arrays = createTagsDB()
    await insert(arrays, { id: 'a', tags: ['red apple', 'green'] })
    await insert(arrays, { id: 'b', tags: ['red', 'blue sky'] })

    const strings = create({ schema: { tags: 'string' } as const })
    await insert(strings, { id: 'a', tags: 'red apple green' })
    await insert(strings, { id: 'b', tags: 'red blue sky' })

    expect(getIndex(arrays).avgFieldLength.tags).toBeCloseTo(getIndex(strings).avgFieldLength.tags, 10)

    const arrayScores = (await search(arrays, { term: 'red' })).hits.map((h) => h.score)
    const stringScores = (await search(strings, { term: 'red' })).hits.map((h) => h.score)
    expect(arrayScores).toEqual(stringScores)
  })

  it('keeps the average consistent across updates and removing every document', async () => {
    const db = createTagsDB()
    await insert(db, { id: 'a', tags: ['red apple', 'green'] })
    await insert(db, { id: 'b', tags: ['red', 'blue sky'] })

    await update(db, 'b', { id: 'b', tags: ['red', 'blue', 'sky high'] })
    const index = getIndex(db)
    expect(index.avgFieldLength.tags).toBeCloseTo((3 + 4) / 2, 10)
    expect(getByID(db, 'b')!.tags).toEqual(['red', 'blue', 'sky high'])

    await remove(db, 'a')
    expect(index.avgFieldLength.tags).toBeCloseTo(4, 10)

    await remove(db, 'b')
    expect(index.fieldLengths.tags[internalIdOf(db, 'b')]).toBeUndefined()
    expect((await search(db, { term: 'red' })).hits).toEqual([])

    await insert(db, { id: 'c', tags: ['red'] })
    expect(index.avgFieldLength.tags).toBeCloseTo(1, 10)
    const { hits } = await search(db, { term: 'red' })
    expect(hits.map((h) => h.id)).toEqual(['c'])
    expect(Number.isFinite(hits[0].score)).toBe(true)
  })

  it('treats an empty array as a field with no tokens', async () => {
    const db = createTagsDB()
    await insert(db, { id: 'a', tags: ['red apple'] })
    await insert(db, { id: 'b', tags: [] })

    const index = getIndex(db)
    expect(index.fieldLengths.tags[internalIdOf(db, 'b')]).toBe(0)
    expect(index.avgFieldLength.tags).toBeCloseTo(1, 10)

    await remove(db, 'b')
    expect(index.avgFieldLength.tags).toBeCloseTo(2, 10)
    const { hits } = await search(db, { term: 'red' })
    expect(hits.map((h) => h.id)).toEqual(['a'])
    expect(Number.isFinite(hits[0].score)).toBe(true)
  })
})
