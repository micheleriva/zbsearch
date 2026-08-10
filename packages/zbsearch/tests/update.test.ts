import { describe, expect, it } from 'vitest'
import { create, insert, getByID, update, updateMultiple, count } from '../src/index.js'

describe('update method', () => {
  it('should remove a document the old document and insert the new one', async () => {
    const db = create({
      schema: {
        quote: 'string',
        author: 'string',
        meta: {
          tags: 'string'
        }
      } as const
    })

    const oldDocId = insert(db, {
      quote: "Life is what happens when you're busy making other plans",
      author: 'John Lennon',
      meta: {
        tags: 'music, life, music'
      }
    }) as string

    const newDocId = await update(db, oldDocId, {
      quote: 'What I cannot create, I do not understand',
      author: 'Richard Feynman',
      meta: {
        tags: 'physics, science, philosophy'
      }
    })

    const oldDoc = getByID(db, oldDocId)
    expect(oldDoc).toBeFalsy()

    const newDoc = getByID(db, newDocId)
    expect(newDoc).toBeTruthy()

    expect(count(db)).toBe(1)
  })
})

describe('updateMultiple', () => {
  it('should update the documents', async () => {
    const db = create({
      schema: {
        quote: 'string',
        author: 'string'
      } as const
    })

    const oldDocId1 = await insert(db, {
      quote: "Life is what happens when you're busy making other plans",
      author: 'John Lennon'
    })
    const oldDocId2 = await insert(db, {
      quote: 'What I cannot create, I do not understand'
    })

    const [id1, id2] = await updateMultiple(
      db,
      [oldDocId1, oldDocId2],
      [
        {
          quote: 'He who is brave is free',
          author: 'Seneca'
        },
        {
          quote: 'You must be the change you wish to see in the world',
          author: 'Mahatma Gandhi'
        }
      ]
    )

    expect(getByID(db, oldDocId1)).toBeFalsy()
    expect(getByID(db, oldDocId2)).toBeFalsy()

    expect(getByID(db, id1)).toBeTruthy()
    expect(getByID(db, id2)).toBeTruthy()
  })

  it('should skip the update if a document is not valid', async () => {
    const db = create({
      schema: {
        quote: 'string'
      } as const
    })

    const oldDocId = await insert(db, {
      quote: "Life is what happens when you're busy making other plans",
      author: 'John Lennon'
    })

    expect(() => updateMultiple(db, [oldDocId], [{ quote: 55 }] as any)).toThrow()

    expect(getByID(db, oldDocId)).toBeTruthy()
    expect(count(db)).toBe(1)
  })
})
