import { describe, expect, it } from 'vitest'
import { create, insert, insertMultiple, load, remove, save, search, update } from '../src/index.js'

describe('search with sortBy', () => {
  describe('on number', async () => {
    const db = await create({
      schema: {
        number: 'number'
      } as const
    })
    const [id1, id2, id3, id4, id5, id6] = await insertMultiple(db, [
      { number: 5 },
      { number: 2 },
      { number: 7 },
      { number: 10 },
      { number: -3 },
      {}
    ])

    it('should sort correctly - asc', async () => {
      const result = await search(db, {
        sortBy: {
          property: 'number'
        }
      })

      expect(result.hits.map((d) => d.id)).toStrictEqual([id5, id2, id1, id3, id4, id6])

      const result2 = await search(db, {
        sortBy: {
          property: 'number',
          order: 'ASC'
        }
      })

      expect(result2.hits.map((d) => d.id)).toStrictEqual([id5, id2, id1, id3, id4, id6])
    })

    it('should sort correctly - desc', async () => {
      const result = await search(db, {
        sortBy: {
          property: 'number',
          order: 'DESC'
        }
      })

      expect(result.hits.map((d) => d.id)).toStrictEqual([id4, id3, id1, id2, id5, id6])
    })

    it('should work correctly also after removal', async () => {
      const db = await create({
        schema: { number: 'number' } as const
      })
      const [id1, id2, id3, id4, id5, id6] = await insertMultiple(db, [
        { number: 5 },
        { number: 2 },
        { number: 7 },
        { number: 10 },
        { number: -3 },
        {}
      ])
      let ascExpected = [id5, id2, id1, id3, id4, id6]
      let descExpected = [id4, id3, id1, id2, id5, id6]

      let resultAsc = await search(db, { sortBy: { property: 'number' } })
      expect(resultAsc.hits.map((d) => d.id)).toStrictEqual(ascExpected)
      let resultDesc = await search(db, {
        sortBy: { property: 'number', order: 'DESC' }
      })
      expect(resultDesc.hits.map((d) => d.id)).toStrictEqual(descExpected)

      const elementToRemove = [id2, id1, id4, id3, id5, id6]
      for (const idToRemove of elementToRemove) {
        await remove(db, idToRemove)
        descExpected = descExpected.filter((id) => id !== idToRemove)
        ascExpected = ascExpected.filter((id) => id !== idToRemove)

        resultAsc = await search(db, { sortBy: { property: 'number' } })
        expect(resultAsc.hits.map((d) => d.id)).toStrictEqual(ascExpected)
        resultDesc = await search(db, {
          sortBy: { property: 'number', order: 'DESC' }
        })
        expect(resultDesc.hits.map((d) => d.id)).toStrictEqual(descExpected)
      }
    })
  })

  describe('on string', async () => {
    const db = await create({
      schema: {
        string: 'string'
      } as const
    })
    const [id1, id2, id3, id4, id5, id6] = await insertMultiple(db, [
      { string: 'a' },
      { string: 'e' },
      { string: 'z' },
      { string: 'd' },
      { string: 'f' },
      {}
    ])

    it('should sort correctly - asc', async () => {
      const result = await search(db, {
        sortBy: {
          property: 'string'
        }
      })
      expect(result.hits.map((d) => d.id)).toStrictEqual([id1, id4, id2, id5, id3, id6])
    })

    it('should sort correctly - desc', async () => {
      const result = await search(db, {
        sortBy: {
          property: 'string',
          order: 'DESC'
        }
      })
      expect(result.hits.map((d) => d.id)).toStrictEqual([id3, id5, id2, id4, id1, id6])
    })

    it('should work correctly also after removal', async () => {
      const db = await create({
        schema: {
          string: 'string'
        } as const
      })
      const [id1, id2, id3, id4, id5, id6] = await insertMultiple(db, [
        { string: 'a' },
        { string: 'e' },
        { string: 'z' },
        { string: 'd' },
        { string: 'f' },
        {}
      ])
      let ascExpected = [id1, id4, id2, id5, id3, id6]
      let descExpected = [id3, id5, id2, id4, id1, id6]

      let resultAsc = await search(db, { sortBy: { property: 'string' } })
      expect(resultAsc.hits.map((d) => d.id)).toStrictEqual(ascExpected)
      let resultDesc = await search(db, {
        sortBy: { property: 'string', order: 'DESC' }
      })
      expect(resultDesc.hits.map((d) => d.id)).toStrictEqual(descExpected)

      const elementToRemove = [id2, id1, id4, id3, id5, id6]
      for (const idToRemove of elementToRemove) {
        await remove(db, idToRemove)
        descExpected = descExpected.filter((id) => id !== idToRemove)
        ascExpected = ascExpected.filter((id) => id !== idToRemove)

        resultAsc = await search(db, { sortBy: { property: 'string' } })
        expect(resultAsc.hits.map((d) => d.id)).toStrictEqual(ascExpected)
        resultDesc = await search(db, {
          sortBy: { property: 'string', order: 'DESC' }
        })
        expect(resultDesc.hits.map((d) => d.id)).toStrictEqual(descExpected)
      }
    })
  })

  describe('on intl language', async () => {
    const db = await create({
      schema: {
        string: 'string'
      } as const,
      language: 'norwegian'
    })
    const [id1, id2, id3, id4, id5, id6] = await insertMultiple(db, [
      { string: 'å' },
      { string: 'a' },
      { string: 'ø' },
      { string: 'o' },
      { string: 'æ' },
      {}
    ])

    it('should short using locale - asc', async () => {
      const result = await search(db, {
        sortBy: {
          property: 'string'
        }
      })
      expect(result.hits.map((d) => d.id)).toStrictEqual([id2, id4, id5, id3, id1, id6])
    })
  })

  describe('on boolean', async () => {
    const db = await create({
      schema: {
        boolean: 'boolean'
      } as const
    })
    const [id1, id2, id3, id4, id5, id6] = await insertMultiple(db, [
      { boolean: true },
      { boolean: false },
      { boolean: false },
      { boolean: true },
      { boolean: true },
      {}
    ])

    it('should sort correctly - asc', async () => {
      const result = await search(db, {
        sortBy: {
          property: 'boolean'
        }
      })
      expect(result.hits.map((d) => d.id)).toStrictEqual([id2, id3, id5, id4, id1, id6])
    })

    it('should sort correctly - desc', async () => {
      const result = await search(db, {
        sortBy: {
          property: 'boolean',
          order: 'DESC'
        }
      })
      expect(result.hits.map((d) => d.id)).toStrictEqual([id1, id4, id5, id3, id2, id6])
    })

    it('should work correctly also after removal', async () => {
      const db = await create({
        schema: {
          boolean: 'boolean'
        } as const
      })
      const [id1, id2, id3, id4, id5, id6] = await insertMultiple(db, [
        { boolean: true },
        { boolean: false },
        { boolean: false },
        { boolean: true },
        { boolean: true },
        {}
      ])
      let ascExpected = [id2, id3, id5, id4, id1, id6]
      let descExpected = [id1, id4, id5, id3, id2, id6]

      let resultAsc = await search(db, { sortBy: { property: 'boolean' } })
      expect(resultAsc.hits.map((d) => d.id)).toStrictEqual(ascExpected)
      let resultDesc = await search(db, {
        sortBy: { property: 'boolean', order: 'DESC' }
      })
      expect(resultDesc.hits.map((d) => d.id)).toStrictEqual(descExpected)

      const elementToRemove = [id2, id1, id4, id3, id5, id6]
      for (const idToRemove of elementToRemove) {
        await remove(db, idToRemove)
        descExpected = descExpected.filter((id) => id !== idToRemove)
        ascExpected = ascExpected.filter((id) => id !== idToRemove)

        resultAsc = await search(db, { sortBy: { property: 'boolean' } })
        expect(resultAsc.hits.map((d) => d.id)).toStrictEqual(ascExpected)
        resultDesc = await search(db, {
          sortBy: { property: 'boolean', order: 'DESC' }
        })
        expect(resultDesc.hits.map((d) => d.id)).toStrictEqual(descExpected)
      }
    })
  })

  describe('on nested property', async () => {
    const db = await create({
      schema: {
        obj: {
          number: 'number'
        }
      } as const
    })
    const [id1, id2, id3, id4, id5, id6, id7] = await insertMultiple(db, [
      { obj: { number: 5 } },
      { obj: { number: 2 } },
      { obj: { number: 7 } },
      { obj: { number: 10 } },
      { obj: { number: -3 } },
      { obj: {} },
      {}
    ])

    it('should sort correctly - asc', async () => {
      const result = await search(db, {
        sortBy: {
          property: 'obj.number'
        }
      })

      expect(result.hits.map((d) => d.id)).toStrictEqual([id5, id2, id1, id3, id4, id6, id7])

      const result2 = await search(db, {
        sortBy: {
          property: 'obj.number',
          order: 'ASC'
        }
      })

      expect(result2.hits.map((d) => d.id)).toStrictEqual([id5, id2, id1, id3, id4, id6, id7])
    })

    it('should sort correctly - desc', async () => {
      const result = await search(db, {
        sortBy: {
          property: 'obj.number',
          order: 'DESC'
        }
      })

      expect(result.hits.map((d) => d.id)).toStrictEqual([id4, id3, id1, id2, id5, id6, id7])
    })
  })

  it('should throw if `sortBy` is unknown', async () => {
    const db = await create({
      schema: {
        number: 'number'
      } as const
    })
    expect(() => search(db, { sortBy: { property: 'foobar' } as any })).toThrow()
  })

  it('should throw if `sortBy` is ignored', async () => {
    const db = await create({
      schema: {
        number: 'number'
      } as const,
      sort: {
        unsortableProperties: ['number']
      }
    })
    expect(() => search(db, { sortBy: { property: 'number' } })).toThrow()
  })

  it('should allow custom function', async () => {
    const db = create({
      schema: {
        string: 'string'
      } as const
    })
    const [id1, id2, id3, id4, id5, id6] = await insertMultiple(db, [
      { string: 'a' },
      { string: 'e' },
      { string: 'z' },
      { string: 'd' },
      { string: 'f' },
      {}
    ])

    const result = await search(db, {
      sortBy: (a, b) => {
        return (a[2].string || '').localeCompare(b[2].string || '')
      }
    })

    expect(result.hits.map((d) => d.id)).toStrictEqual([id6, id1, id4, id2, id5, id3])
  })
})

it('serialize work fine', async () => {
  const db = create({
    schema: {
      title: 'string',
      year: 'number',
      isTop: 'boolean',
      meta: {
        tag: 'string',
        rating: 'number',
        favorite: 'boolean'
      }
    } as const
  })
  const id = await insert(db, {
    title: 'The title',
    year: 2000,
    isTop: true,
    meta: {
      tag: 'tag',
      rating: 5,
      favorite: true
    }
  })
  const raw = save(db)

  const db2 = create({
    schema: {
      title: 'string',
      year: 'number',
      isTop: 'boolean',
      meta: {
        tag: 'string',
        rating: 'number',
        favorite: 'boolean'
      }
    }
  })

  load(db2, raw)

  const r = await search(db2, { sortBy: { property: 'title' } })

  expect(r.hits.map((d) => d.id)).toStrictEqual([id])
})

it('disabled', async () => {
  const db = await create({
    schema: {
      number: 'number'
    } as const,
    sort: {
      enabled: false
    }
  })
  const id = await insert(db, { number: 1 })
  await expect(() => search(db, { sortBy: { property: 'number' } })).toThrow(
    expect.objectContaining({
      code: 'SORT_DISABLED'
    })
  )
  await remove(db, id)
  const raw = await save(db)

  expect(raw.sorting as { enabled: boolean }).toStrictEqual({ enabled: false })

  const db2 = await create({
    schema: {
      number: 'number'
    } as const,
    sort: {
      enabled: false
    }
  })

  load(db2, raw)

  const id2 = await insert(db2, { number: 1 })
  expect(() => search(db2, { sortBy: { property: 'number' } })).toThrow(
    expect.objectContaining({
      code: 'SORT_DISABLED'
    })
  )
  await remove(db2, id2)
  const raw2 = save(db2)

  expect((raw2.sorting as { enabled: boolean }).enabled).toBe(false)
})

it('search with sortBy should be consistent ignoring the insert order', async () => {
  const docs = [
    { id: '5' },
    { id: '2', number: 5 },
    { id: '4', number: 10 },
    { id: '0', number: -3 },
    { id: '1', number: 2 },
    { id: '3', number: 7 }
  ]

  let iters = 10
  while (iters--) {
    const db = await create({
      schema: {
        id: 'string',
        number: 'number'
      } as const
    })

    const d = shuffle([...docs])

    await insertMultiple(db, d)
    const result = await search(db, {
      sortBy: {
        property: 'number'
      }
    })

    expect(result.hits.map((d) => d.id)).toStrictEqual(['0', '1', '2', '3', '4', '5'])
  }

  iters = 10
  while (iters--) {
    const db = await create({
      schema: {
        id: 'string',
        number: 'number'
      } as const
    })

    const d = shuffle([...docs])

    await insertMultiple(db, d)
    const result = await search(db, {
      sortBy: {
        property: 'number',
        order: 'DESC'
      }
    })

    expect(result.hits.map((d) => d.id)).toStrictEqual(['4', '3', '2', '1', '0', '5'])
  }
})

// https://github.com/oramasearch/orama/issues/629
it('sort should be consistent after update', async () => {
  const db = await create({
    schema: {
      id: 'string',
      name: 'string',
      createdAt: 'number'
    } as const
  })
  await insertMultiple(db, [
    { id: '1', name: 'a', createdAt: 1 },
    { id: '2', name: 'b', createdAt: 2 },
    { id: '3', name: 'c', createdAt: 3 }
  ])

  const resultBefore = await search(db, {
    sortBy: {
      property: 'createdAt'
    }
  })

  expect(resultBefore.hits.map((d) => d.document.name)).toStrictEqual(['a', 'b', 'c'])
  expect(resultBefore.hits.map((d) => d.id)).toStrictEqual(['1', '2', '3'])
  expect(resultBefore.hits.map((d) => d.document.id)).toStrictEqual(['1', '2', '3'])

  // Just update keeping the same document
  await update(db, '2', resultBefore.hits.find((d) => d.id === '2')!.document)

  const resultAfter = await search(db, {
    sortBy: {
      property: 'createdAt'
    }
  })

  // The order should be the same
  expect(resultAfter.hits.map((d) => d.document.name)).toStrictEqual(['a', 'b', 'c'])
  expect(resultAfter.hits.map((d) => d.id)).toStrictEqual(['1', '2', '3'])
  expect(resultAfter.hits.map((d) => d.document.id)).toStrictEqual(['1', '2', '3'])
})

function shuffle(array) {
  let currentIndex = array.length,
    randomIndex

  // While there remain elements to shuffle.
  while (currentIndex != 0) {
    // Pick a remaining element.
    randomIndex = Math.floor(Math.random() * currentIndex)
    currentIndex-- // And swap it with the current element.
    ;[array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]]
  }

  return array
}
