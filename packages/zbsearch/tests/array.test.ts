import { expect, it } from 'vitest'
import { create, getByID, insert, insertMultiple, load, remove, save, search, update } from '../src/index.js'

it('create should support array of string', async () => {
  const db = create({
    schema: {
      id: 'string',
      name: 'string[]'
    } as const
  })

  const albusId = await insert(db, {
    name: ['Albus', 'Percival', 'Wulfric', 'Brian']
  })

  const [harryId, jamesId, lilyId] = await insertMultiple(db, [
    { id: '1', name: ['Harry', 'James', 'Potter'] },
    { id: '2', name: ['James', 'Potter'] },
    { id: '3', name: ['Lily', 'Lily', 'Lily', 'Lily', 'Evans', 'Potter'] }
  ])

  await checkSearchTerm(db, 'Albus', [albusId])
  await checkSearchTerm(db, 'Harry', [harryId])
  await checkSearchTerm(db, 'James', [harryId, jamesId])
  await checkSearchTerm(db, 'Potter', [harryId, jamesId, lilyId])
  // 'P' is a fragment of indexed words ('Percival', 'Potter'), so opt into prefix expansion.
  await checkSearchTerm(db, 'P', [albusId, harryId, jamesId, lilyId], { prefix: true })
  await checkSearchTerm(db, 'foo', [])

  await checkSearchWhere(db, 'name', 'Albus', [albusId])

  await checkSearchWhere(db, 'name', 'Harry', [harryId])
  await checkSearchWhere(db, 'name', 'James', [harryId, jamesId])
  await checkSearchWhere(db, 'name', 'Potter', [harryId, jamesId, lilyId])
  await checkSearchWhere(db, 'name', 'P', [])
  await checkSearchWhere(db, 'name', 'foo', [])

  await checkSearchWhere(db, 'name', ['Albus'], [albusId])
  await checkSearchWhere(db, 'name', ['Harry'], [harryId])
  await checkSearchWhere(db, 'name', ['James'], [harryId, jamesId])
  await checkSearchWhere(db, 'name', ['Percival', 'Evans'], [albusId, lilyId])
  await checkSearchWhere(db, 'name', ['P'], [])
  await checkSearchWhere(db, 'name', ['foo'], [])

  await checkSearchFacets(
    db,
    'name',
    {},
    {
      count: 9,
      values: {
        James: 2,
        Potter: 3,
        Lily: 1,
        Evans: 1,
        Albus: 1,
        Percival: 1,
        Wulfric: 1,
        Brian: 1,
        Harry: 1
      }
    }
  )
})

it('create should support array of number', async () => {
  const db = create({
    schema: {
      num: 'number[]'
    } as const
  })

  const first = await insert(db, {
    num: [5]
  })

  const [second, third, fourth] = await insertMultiple(db, [
    { num: [2, 7] },
    { num: [3, 5, 7, 35] },
    { num: [3, 2, 5] }
  ])

  await checkSearchWhere(db, 'num', { eq: 5 }, [first, third, fourth])

  await checkSearchWhere(db, 'num', { eq: 35 }, [third])
  await checkSearchWhere(db, 'num', { gt: 6 }, [second, third])
  await checkSearchWhere(db, 'num', { gte: 7 }, [second, third])
  await checkSearchWhere(db, 'num', { between: [6, 10] }, [second, third])
  await checkSearchWhere(db, 'num', { eq: 42 }, [])

  await checkSearchFacets(
    db,
    'num',
    {
      ranges: [
        { from: 0, to: 3 },
        { from: 3, to: 7 },
        { from: 7, to: 10 }
      ]
    },
    {
      count: 3,
      values: {
        '0-3': 3,
        '3-7': 4,
        '7-10': 2
      }
    }
  )
})

it('create should support array of boolean', async () => {
  const db = create({
    schema: {
      b: 'boolean[]'
    } as const
  })

  const first = await insert(db, {
    b: [true]
  })

  const [second, third, fourth] = await insertMultiple(db, [
    { b: [false] },
    { b: [true, false] },
    { b: [true, true, true] }
  ])

  await checkSearchWhere(db, 'b', true, [first, third, fourth])
  await checkSearchWhere(db, 'b', false, [second, third])

  await checkSearchFacets(
    db,
    'b',
    {
      true: true,
      false: true
    },
    {
      count: 2,
      values: {
        true: 3,
        false: 2
      }
    }
  )
})

it('remove should support array as well', async () => {
  const db = create({
    schema: {
      strings: 'string[]',
      num: 'number[]',
      b: 'boolean[]'
    } as const
  })

  const docId = await insert(db, {
    strings: ['Albus', 'Percival', 'Wulfric', 'Brian'],
    num: [3, 5, 7, 35],
    b: [true, true, true]
  })
  expect(docId).toBeTruthy()

  const removed = await remove(db, docId)
  expect(removed).toBeTruthy()
})

it('serialization should support array as well', async () => {
  const db = create({
    schema: {
      strings: 'string[]',
      num: 'number[]',
      b: 'boolean[]'
    } as const
  })
  const docId = await insert(db, {
    strings: ['Albus', 'Percival', 'Wulfric', 'Brian'],
    num: [3, 5, 7, 35],
    b: [true, true, true]
  })
  expect(docId).toBeTruthy()

  const raw = save(db)
  const db2 = create({
    schema: {
      strings: 'string[]',
      num: 'number[]',
      b: 'boolean[]'
    }
  })
  load(db2, raw)

  const doc = getByID(db, docId)
  expect(doc).toStrictEqual({
    strings: ['Albus', 'Percival', 'Wulfric', 'Brian'],
    num: [3, 5, 7, 35],
    b: [true, true, true]
  })
})

it('update supports array as well', async () => {
  const db = create({
    schema: {
      strings: 'string[]',
      num: 'number[]',
      b: 'boolean[]'
    } as const
  })
  const docId = await insert(db, {
    strings: ['Albus', 'Percival', 'Wulfric', 'Brian'],
    num: [3, 5, 7, 35],
    b: [true, true, true]
  })
  expect(docId).toBeTruthy()

  const newDocId = await update(db, docId, {
    strings: ['Harry', 'James', 'Potter'],
    num: [2, 3],
    b: [false, true]
  })
  expect(newDocId).toBeTruthy()
})

async function checkSearchTerm(db, term, expectedIds, extraParams = {}) {
  const result = await search(db, {
    term,
    ...extraParams
  })
  expect(result.hits.length).toBe(expectedIds.length)
  expect(result.count).toBe(expectedIds.length)
  expect(new Set(result.hits.map((h) => h.id))).toStrictEqual(new Set(expectedIds))
}

async function checkSearchWhere(db, key, where, expectedIds) {
  const result = await search(db, {
    where: {
      [key]: where
    }
  })
  expect(result.hits.length).toBe(expectedIds.length)
  expect(result.count).toBe(expectedIds.length)
  expect(new Set(result.hits.map((h) => h.id).sort())).toStrictEqual(new Set(expectedIds))
}

async function checkSearchFacets(db, key, facet, expectedFacet) {
  const result = await search(db, {
    facets: {
      [key]: facet
    }
  })
  expect(result.facets![key]).toStrictEqual(expectedFacet)
}
