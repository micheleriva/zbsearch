import { describe, expect, it } from 'vitest'
import { Index } from '../src/components/index.js'
import {
  SearchParams,
  TypedDocument,
  count,
  create,
  getByID,
  insert,
  remove,
  removeMultiple,
  search
} from '../src/index.js'

describe('remove method', () => {
  describe('removes the given document', async () => {
    const [db, id1, id2, id3, id4] = createSimpleDB()

    const doc1 = getByID(db, id1)!
    expect(getByID(db, id1)).toBeTruthy()

    const r = await remove(db, id1)
    expect(r).toBeTruthy()
    expect(getByID(db, id1)).toBeFalsy()

    const cases = [
      { name: 'and is not searchable anymore for name', params: { term: doc1.name } },
      {
        name: 'and is not searchable anymore for name - substr',
        params: { term: doc1.name.substring(0, 5) }
      },
      { name: 'and is not searchable anymore for rating - number - eq', params: { where: { rating: { eq: 5 } } } },
      { name: 'and is not searchable anymore for price - number - eq', params: { where: { price: { eq: 900 } } } },
      {
        name: 'and is not searchable anymore for meta.sales - number - eq',
        params: { where: { 'meta.sales': { eq: 100 } } }
      }
    ]
    for (const c of cases) {
      const { name, params } = c
      it(name, async () => {
        const result = await search(db, params as SearchParams<typeof db, TypedDocument<typeof db>>)
        const hitIds = result.hits.map((d) => d.id)
        expect(hitIds.includes(id1)).toBe(false)
      })
    }

    it('but keep the others', async () => {
      expect(getByID(db, id2)).toBeTruthy()
      expect(getByID(db, id3)).toBeTruthy()
      expect(getByID(db, id4)).toBeTruthy()

      const result = await search(db, {
        term: ''
      })
      expect(result.count).toBe(3)
    })
  })

  it('remove index also for nested field', async () => {
    const [db, id1, id2] = createSimpleDB()

    const r1_gt = await search(db, {
      where: {
        // @ts-expect-error - err
        'meta.sales': {
          eq: 100
        }
      }
    })

    expect(r1_gt.count).toBe(2)
    expect(r1_gt.hits[0].id).toBe(id1)
    expect(r1_gt.hits[1].id).toBe(id2)

    remove(db, id1)

    const r2_gt = await search(db, {
      where: {
        // @ts-expect-error - err
        'meta.sales': {
          eq: 100
        }
      }
    })

    expect(r2_gt.count).toBe(1)
    expect(r2_gt.hits[0].id).toBe(id2)
  })

  // Tests for https://github.com/oramasearch/orama/issues/52
  it('should correctly remove documents via substring search', async () => {
    const zbsearch = await create({
      schema: {
        word: 'string'
      } as const
    })

    const halo = await insert(zbsearch, { word: 'Halo' })
    await insert(zbsearch, { word: 'Halloween' })
    await insert(zbsearch, { word: 'Hal' })

    await remove(zbsearch, halo)

    // 'Hal' is a fragment of the indexed 'Halloween', so opt into prefix expansion.
    const searchResult = await search(zbsearch, {
      term: 'Hal',
      prefix: true
    })

    expect(searchResult.count).toBe(2)
  })

  describe('should preserve identical docs after deletion', () => {
    it('- delete old document', async () => {
      const [db, id1] = createSimpleDB()
      const doc = getByID(db, id1)!
      const id5 = insert(db, { ...doc, id: undefined })

      remove(db, id1)

      const searchResult1 = await search(db, {
        term: doc.name as string,
        exact: true,
        properties: ['name']
      })
      expect(searchResult1.hits.find((d) => d.id === id5)).toBeTruthy()

      const searchResult2 = await search(db, {
        where: {
          // @ts-expect-error - err
          'meta.sales': { eq: (doc.meta as Record<string, number>).sales }
        }
      })
      expect(searchResult2.hits.find((d) => d.id === id5)).toBeTruthy()
    })

    it('- delete new document', async () => {
      const [db, id1] = createSimpleDB()
      const doc = getByID(db, id1)!
      const id5 = await insert(db, { ...doc, id: undefined })

      remove(db, id5)

      const searchResult1 = await search(db, {
        term: doc.name as string,
        exact: true,
        properties: ['name']
      })
      expect(searchResult1.hits.find((d) => d.id === id1)).toBeTruthy()

      const searchResult2 = await search(db, {
        where: {
          // @ts-expect-error - err
          'meta.sales': { eq: (doc.meta as Record<string, number>).sales }
        }
      })
      expect(searchResult2.hits.find((d) => d.id === id1)).toBeTruthy()
    })
  })

  it('should throw an error on unknown document', () => {
    const [db] = createSimpleDB()
    expect(remove(db, 'unknown index id')).toBe(false)
  })

  it('should remove unindexed-document', async () => {
    const [db] = await createSimpleDB()
    const id5 = await insert(db, {})

    const removed = await remove(db, id5)

    expect(removed).toBeTruthy()
    expect(count(db)).toBe(4)
  })
})

describe('removeMultiple method', () => {
  it('should remove all the given items', async () => {
    const [db, id1, id2, id3, id4] = createSimpleDB()

    removeMultiple(db, [id1, id2])

    expect(getByID(db, id3)).toBeTruthy()
    expect(getByID(db, id4)).toBeTruthy()

    expect(count(db)).toBe(2)
  })

  it('should remove all the given items synchronously even in multiple batches', () => {
    const [db, id1, id2, id3, id4] = createSimpleDB()

    const removed = removeMultiple(db, [id1, id2, id3, id4], 2) as number

    expect(removed).toBe(4)
    expect(count(db)).toBe(0)
  })

  it('should run event loop every batch', async () => {
    const db = create({
      schema: {
        name: 'string'
      } as const,
      plugins: [
        {
          name: 'force-async',
          afterRemoveMultiple: async () => {}
        }
      ]
    })

    const ids = [
      insert(db, { name: 'super coffee maker' }),
      insert(db, { name: 'washing machine' }),
      insert(db, { name: 'coffee maker' }),
      insert(db, { name: 'dish washer' })
    ] as string[]

    let ticks = 0
    const intervalId = setInterval(() => {
      ticks++
    }, 0)

    const removed = await removeMultiple(db, ids, 1)

    clearInterval(intervalId)

    expect(removed).toBe(ids.length)
    expect(count(db)).toBe(0)
    // the event loop turns at least once per batch
    expect(ticks >= ids.length).toBeTruthy()
  })

  it('should throw an error on error', async () => {
    const db = create({
      schema: {
        name: 'string'
      } as const,
      plugins: [
        {
          name: 'throw-error',
          afterRemoveMultiple: () => {
            throw new Error('Kaboom')
          }
        }
      ]
    })
    const id1 = await insert(db, { name: 'coffee' })

    expect(() => removeMultiple(db, [id1])).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('Kaboom')
      })
    )
  })
})

it('should remove a document and update index field length', async () => {
  const [db] = createSimpleDB()

  const fieldLengths = { ...(db.data.index as Index).fieldLengths }
  const avgFieldLength = { ...(db.data.index as Index).avgFieldLength }

  const id4 = insert(db, {
    name: 'other machine',
    rating: 5,
    price: 900,
    meta: {
      sales: 100
    }
  })
  remove(db, id4 as string)

  expect((db.data.index as Index).fieldLengths).toEqual(fieldLengths)
  expect((db.data.index as Index).avgFieldLength).toEqual(avgFieldLength)
})

// Test cases for issue https://github.com/oramasearch/orama/issues/486
it('should correctly remove documents with vector properties', async () => {
  const db = await create({
    schema: {
      name: 'string',
      vector: 'vector[10]'
    } as const
  })

  const id1 = await insert(db, {
    name: 'coffee maker',
    vector: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  })

  const id2 = await insert(db, {
    name: 'better coffee maker',
    vector: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  })

  await remove(db, id1)

  expect(await getByID(db, id1)).toBeFalsy()
  expect(await getByID(db, id2)).toBeTruthy()
})

it('test case for #766: Zero division when computing scores after removing all documents from an index.', async () => {
  const db = create({
    schema: {
      name: 'string'
    } as const
  })

  const id = insert(db, { name: 'test' })

  const success = remove(db, id as string)

  insert(db, { name: 'foo' })
  insert(db, { name: 'bar' })

  expect(success).toBeTruthy()
})

function createSimpleDB() {
  let i = 0
  const db = create({
    schema: {
      name: 'string',
      rating: 'number',
      price: 'number',
      meta: {
        sales: 'number'
      }
    } as const,
    components: {
      getDocumentIndexId(): string {
        return `__${++i}`
      }
    }
  })

  const id1 = insert(db, {
    name: 'super coffee maker',
    rating: 5,
    price: 900,
    meta: {
      sales: 100
    }
  }) as string

  const id2 = insert(db, {
    name: 'washing machine',
    rating: 5,
    price: 900,
    meta: {
      sales: 100
    }
  }) as string

  const id3 = insert(db, {
    name: 'coffee maker',
    rating: 3,
    price: 30,
    meta: {
      sales: 25
    }
  }) as string

  const id4 = insert(db, {
    name: 'coffee maker deluxe',
    rating: 5,
    price: 45,
    meta: {
      sales: 25
    }
  }) as string

  return [db, id1, id2, id3, id4] as const
}
