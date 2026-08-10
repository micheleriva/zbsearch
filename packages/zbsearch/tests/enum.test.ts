import { describe, expect, it } from 'vitest'
import {
  EnumArrComparisonOperator,
  ScalarSearchableValue,
  count,
  create,
  insert,
  insertMultiple,
  load,
  remove,
  save,
  search
} from '../src/index.js'

describe('enum', () => {
  describe('filter', async () => {
    const db = create({
      schema: {
        categoryId: 'enum'
      } as const
    })

    const c1 = await insert(db, {
      categoryId: 1
    })
    const [c11, c2, c3, c5] = await insertMultiple(db, [
      { categoryId: 1 },
      { categoryId: 2 },
      { categoryId: 3 },
      { categoryId: '5' }
    ])
    const documentCount = count(db)
    const allIds = [c1, c11, c2, c3, c5]

    const tests: { value: ScalarSearchableValue; expected: string[] }[] = [
      { value: 1, expected: [c1, c11] },
      { value: 2, expected: [c2] },
      { value: 3, expected: [c3] },
      { value: '5', expected: [c5] },
      { value: 'unknown', expected: [] }
    ]

    describe('eq operator', () => {
      for (const { value, expected } of tests) {
        it(`eq: ${value}`, async () => {
          const result = await search(db, {
            term: '',
            where: {
              categoryId: { eq: value }
            }
          })
          expect(result.hits.length).toBe(expected.length)
          expect(result.hits.map((h) => h.id)).toStrictEqual(expected)
        })
      }
    })

    describe('in operator', () => {
      for (const { value, expected } of tests) {
        it(`in: [${value}]`, async () => {
          const result = await search(db, {
            term: '',
            where: {
              categoryId: { in: [value] }
            }
          })
          expect(result.hits.length).toBe(expected.length)
          expect(result.hits.map((h) => h.id)).toStrictEqual(expected)
        })
      }

      it(`in: [1, 3, "5", 'unknown']`, async () => {
        const result = await search(db, {
          term: '',
          where: {
            categoryId: { in: [1, 3, '5', 'unknown'] }
          }
        })
        expect(result.hits.length).toBe(4)
        expect(result.hits.map((h) => h.id)).toStrictEqual([c1, c11, c3, c5])
      })
    })

    describe('nin operator', () => {
      for (const { value, expected } of tests) {
        it(`nin: [${value}]`, async () => {
          const result = await search(db, {
            term: '',
            where: {
              categoryId: { nin: [value] }
            }
          })
          expect(result.hits.length).toBe(documentCount - expected.length)
          expect(result.hits.map((h) => h.id)).toStrictEqual(allIds.filter((id) => expected.includes(id) === false))
        })
      }

      it(`nin: [1, 3, "5", 'unknown']`, async () => {
        const result = await search(db, {
          term: '',
          where: {
            categoryId: { nin: [1, 3, '5', 'unknown'] }
          }
        })
        expect(result.hits.length).toBe(1)
        expect(result.hits.map((h) => h.id)).toStrictEqual([c2])
      })

      it(`nin: [1, 2, 3, "5", 'unknown']`, async () => {
        const result = await search(db, {
          term: '',
          where: {
            categoryId: { nin: [1, 2, 3, '5', 'unknown'] }
          }
        })
        expect(result.hits.length).toBe(0)
        expect(result.hits.map((h) => h.id)).toStrictEqual([])
      })
    })
  })

  it(`remove document works fine`, async () => {
    const db = await create({
      schema: {
        categoryId: 'enum'
      } as const
    })
    const c1 = await insert(db, { categoryId: 1 })
    const c11 = await insert(db, { categoryId: 1 })

    const result1 = await search(db, {
      term: '',
      where: { categoryId: { eq: 1 } }
    })
    expect(result1.hits.length).toBe(2)
    expect(result1.hits.map((h) => h.id)).toStrictEqual([c1, c11])

    await remove(db, c1)

    const result2 = await search(db, {
      term: '',
      where: { categoryId: { eq: 1 } }
    })
    expect(result2.hits.length).toBe(1)
    expect(result2.hits.map((h) => h.id)).toStrictEqual([c11])
  })

  it(`still serializable`, async () => {
    const db1 = create({
      schema: {
        categoryId: 'enum'
      } as const
    })
    const [c1, c11, c2, c3, c5] = await insertMultiple(db1, [
      { categoryId: 1 },
      { categoryId: 1 },
      { categoryId: 2 },
      { categoryId: 3 },
      { categoryId: '5' }
    ])

    const dump = save(db1)

    const db2 = create({
      schema: {
        categoryId: 'enum'
      } as const
    })
    load(db2, dump)

    const result1 = await search(db2, {
      term: '',
      where: {
        categoryId: { eq: 1 }
      }
    })
    expect(result1.hits.length).toBe(2)
    expect(result1.hits.map((h) => h.id)).toStrictEqual([c1, c11])

    const result2 = await search(db2, {
      term: '',
      where: {
        categoryId: { in: [1, 2, 3, '5', 'unknown'] }
      }
    })
    expect(result2.hits.length).toBe(5)
    expect(result2.hits.map((h) => h.id)).toStrictEqual([c1, c11, c2, c3, c5])
  })

  it(`complex example`, async () => {
    const filmDb = await create({
      schema: {
        title: 'string',
        year: 'number',
        categoryId: 'enum'
      } as const
    })
    const [c1] = await insertMultiple(filmDb, [
      { title: 'The Shawshank Redemption', year: 1994, categoryId: 1 },
      { title: 'The Godfather', year: 1972, categoryId: 1 },
      { title: 'The Dark Knight', year: 2008, categoryId: 2 },
      { title: "Schindler's List", year: 1993, categoryId: 3 },
      { title: 'The Lord of the Rings: The Return of the King', year: 2003, categoryId: 4 }
    ])

    // 'r' is a fragment of indexed words, so opt into prefix expansion.
    const result1 = await search(filmDb, {
      term: 'r',
      prefix: true
    })
    expect(result1.hits.length).toBe(2)

    const result2 = await search(filmDb, {
      term: 'r',
      prefix: true,
      where: {
        categoryId: { eq: 1 }
      }
    })
    expect(result2.hits.length).toBe(1)
    expect(result2.hits.map((h) => h.id)).toStrictEqual([c1])

    const result3 = await search(filmDb, {
      term: 'r',
      prefix: true,
      where: {
        year: { gt: 2000 },
        categoryId: { eq: 1 }
      }
    })
    expect(result3.hits.length).toBe(0)
    expect(result3.hits.map((h) => h.id)).toStrictEqual([])

    const result4 = await search(filmDb, {
      term: 'r',
      prefix: true,
      where: {
        year: { lte: 2000 },
        categoryId: { eq: 1 }
      }
    })
    expect(result4.hits.length).toBe(1)
    expect(result4.hits.map((h) => h.id)).toStrictEqual([c1])
  })
})

describe('enum[]', () => {
  describe('filter', async () => {
    const db = await create({
      schema: {
        tags: 'enum[]'
      } as const
    })

    const cGreenBlue = await insert(db, {
      tags: ['green', 'blue']
    })
    const [cGreen, cBlue, cWhite] = await insertMultiple(db, [
      { tags: ['green'] },
      { tags: ['blue'] },
      { tags: ['white'] }
    ])

    const testsContainsAll = [
      { values: ['green'], expected: [cGreenBlue, cGreen] },
      { values: ['blue'], expected: [cGreenBlue, cBlue] },
      { values: ['white'], expected: [cWhite] },
      { values: ['unknown'], expected: [] },
      { values: ['green', 'blue'], expected: [cGreenBlue] },
      { values: ['blue', 'green'], expected: [cGreenBlue] },
      { values: ['green', 'blue', 'white'], expected: [] },
      { values: ['white', 'unknown'], expected: [] },
      { values: [], expected: [] }
    ]
    describe('containsAll', () => {
      for (const { values, expected } of testsContainsAll) {
        it(`"${values}"`, async () => {
          const result = await search(db, {
            term: '',
            where: {
              tags: { containsAll: values }
            }
          })
          expect(result.hits.length).toBe(expected.length)
          expect(result.hits.map((h) => h.id)).toStrictEqual(expected)
        })
      }
    })

    const testsContainsAny = [
      { values: ['green'], expected: [cGreenBlue, cGreen] },
      { values: ['blue'], expected: [cGreenBlue, cBlue] },
      { values: ['white'], expected: [cWhite] },
      { values: ['unknown'], expected: [] },
      { values: ['green', 'blue'], expected: [cGreenBlue, cGreen, cBlue] },
      { values: ['blue', 'green'], expected: [cGreenBlue, cGreen, cBlue] },
      { values: ['green', 'blue', 'white'], expected: [cGreenBlue, cGreen, cBlue, cWhite] },
      { values: ['white', 'unknown'], expected: [cWhite] },
      { values: [], expected: [] }
    ]
    describe('containsAny', () => {
      for (const { values, expected } of testsContainsAny) {
        it(`"${values}"`, async () => {
          const result = await search(db, {
            term: '',
            where: {
              tags: { containsAny: values }
            }
          })
          expect(result.hits.length).toBe(expected.length)
          expect(result.hits.map((h) => h.id)).toStrictEqual(expected)
        })
      }
    })

    it("eq operator shouldn't allowed", async () => {
      expect(
        () =>
          search(db, {
            term: '',
            where: {
              tags: { eq: 'green' } as EnumArrComparisonOperator
            }
          }),
        'aa'
      ).toThrow()
    })

    it("in operator shouldn't allowed", async () => {
      expect(
        () =>
          search(db, {
            term: '',
            where: {
              tags: { in: ['green'] } as EnumArrComparisonOperator
            }
          }),
        'aa'
      ).toThrow()
    })

    it("in operator shouldn't allowed", async () => {
      expect(
        () =>
          search(db, {
            term: '',
            where: {
              tags: { nin: ['green'] } as EnumArrComparisonOperator
            }
          }),
        'aa'
      ).toThrow()
    })
  })

  it(`remove document works fine`, async () => {
    const db = create({
      schema: {
        tags: 'enum[]'
      } as const
    })
    const c1 = await insert(db, { tags: ['green', 'blue'] })
    const c11 = await insert(db, { tags: ['blue', 'green'] })

    const result1 = await search(db, {
      term: '',
      where: { tags: { containsAll: ['green', 'blue'] } }
    })
    expect(result1.hits.length).toBe(2)
    expect(result1.hits.map((h) => h.id)).toStrictEqual([c1, c11])

    await remove(db, c1)

    const result2 = await search(db, {
      term: '',
      where: { tags: { containsAll: ['green', 'blue'] } }
    })
    expect(result2.hits.length).toBe(1)
    expect(result2.hits.map((h) => h.id)).toStrictEqual([c11])
  })

  it(`still serializable`, async () => {
    const db1 = await create({
      schema: {
        tags: 'enum[]'
      } as const
    })
    const [c1, c11] = await insertMultiple(db1, [
      { tags: ['green'] },
      { tags: ['green', 'blue'] },
      { tags: ['orange'] },
      { tags: ['purple'] },
      { tags: ['black'] }
    ])

    const dump = save(db1)

    const db2 = create({
      schema: {
        tags: 'enum[]'
      }
    })
    load(db2, dump)

    const result1 = await search(db2, {
      term: '',
      where: {
        tags: { containsAll: ['green'] }
      }
    })
    expect(result1.hits.length).toBe(2)
    expect(result1.hits.map((h) => h.id)).toStrictEqual([c1, c11])

    const result2 = await search(db2, {
      term: '',
      where: {
        tags: { containsAll: [] }
      } as const
    })
    expect(result2.hits.length).toBe(0)
    expect(result2.hits.map((h) => h.id)).toStrictEqual([])
  })

  it(`complex example`, async () => {
    const filmDb = create({
      schema: {
        title: 'string',
        year: 'number',
        tags: 'enum[]'
      } as const
    })
    const [, , , c4] = await insertMultiple(filmDb, [
      { title: 'The Shawshank Redemption', year: 1994, tags: ['drama', 'crime'] },
      { title: 'The Godfather', year: 1972, tags: ['drama', 'crime'] },
      { title: 'The Dark Knight', year: 2008, tags: ['action', 'adventure'] },
      { title: "Schindler's List", year: 1993, tags: ['war', 'drama '] },
      { title: 'The Lord of the Rings: The Return of the King', year: 2003, tags: ['fantasy', 'adventure'] }
    ])

    // 'l' is a fragment of indexed words, so opt into prefix expansion.
    const result1 = await search(filmDb, {
      term: 'l',
      prefix: true
    })
    expect(result1.hits.length).toBe(2)

    const result2 = await search(filmDb, {
      term: 'l',
      prefix: true,
      where: {
        tags: { containsAll: ['war'] }
      }
    })
    expect(result2.hits.length).toBe(1)
    expect(result2.hits.map((h) => h.id)).toStrictEqual([c4])

    const result3 = await search(filmDb, {
      term: 'l',
      prefix: true,
      where: {
        year: { gt: 2000 },
        tags: { containsAll: ['war'] }
      }
    })
    expect(result3.hits.length).toBe(0)
    expect(result3.hits.map((h) => h.id)).toStrictEqual([])

    const result4 = await search(filmDb, {
      term: 'l',
      prefix: true,
      where: {
        year: { lte: 2000 },
        tags: { containsAll: ['war'] }
      }
    })
    expect(result4.hits.length).toBe(1)
    expect(result4.hits.map((h) => h.id)).toStrictEqual([c4])
  })
})
