import { expect, it } from 'vitest'
import { create, insertMultiple, load, remove, save, search } from 'zbsearch'
import { pluginPT15 } from '../src/index.js'
import { get_position } from '../src/algorithm.js'

it('get_position', async () => {
  expect(get_position(0, 1)).toBe(0)
  expect(get_position(1, 1)).toBe(1)

  expect(get_position(0, 50)).toBe(0)
  expect(get_position(1, 50)).toBe(0)
  expect(get_position(2, 50)).toBe(0)
  expect(get_position(3, 50)).toBe(0)

  expect(get_position(4, 50)).toBe(1)
  expect(get_position(5, 50)).toBe(1)
  expect(get_position(6, 50)).toBe(1)

  expect(get_position(7, 50)).toBe(2)
  expect(get_position(8, 50)).toBe(2)
  expect(get_position(9, 50)).toBe(2)

  expect(get_position(10, 50)).toBe(3)
  expect(get_position(11, 50)).toBe(3)
  expect(get_position(12, 50)).toBe(3)
  expect(get_position(13, 50)).toBe(3)

  expect(get_position(14, 50)).toBe(4)

  // skip some...

  expect(get_position(46, 50)).toBe(13)

  expect(get_position(47, 50)).toBe(14)
  expect(get_position(48, 50)).toBe(14)
  expect(get_position(49, 50)).toBe(14)
})

it('plugin-pt15', async () => {
  const db = create({
    schema: {
      name: 'string',
      age: 'number',
      isCool: 'boolean',
      algo: 'string[]',
      preferredNumbers: 'number[]'
    } as const,
    plugins: [pluginPT15()]
  })

  await insertMultiple(db, [
    {
      id: '1',
      name: 'The pen is on the table',
      age: 33,
      isCool: true,
      algo: ['algo1', 'algo2'],
      preferredNumbers: [20]
    },
    { id: '2', name: 'The can is near the table', age: 32, isCool: true, algo: ['algo3'], preferredNumbers: [55] },
    { id: '3', name: 'My table is cool', age: 22, isCool: false, algo: ['algo4'], preferredNumbers: [22] }
  ])

  const result = await search(db, {
    term: 't'
  })

  expect(result.count).toBe(3)

  const dump = await save(db)
  const restored = JSON.parse(JSON.stringify(dump))

  const db2 = create({
    schema: {
      name: 'string',
      age: 'number',
      isCool: 'boolean',
      algo: 'string[]',
      preferredNumbers: 'number[]'
    } as const,
    plugins: [pluginPT15()]
  })
  await load(db2, restored)

  const result2 = await search(db2, {
    term: 't'
  })
  expect(result2.count).toBe(3)

  await remove(db2, '1')

  const result3 = await search(db2, {
    term: 't'
  })
  expect(result3.count).toBe(2)
})

it('where string', async () => {
  const db = create({
    schema: {
      name: 'string',
      age: 'number',
      isCool: 'boolean',
      algo: 'string[]',
      preferredNumbers: 'number[]'
    } as const,
    plugins: [pluginPT15()]
  })

  await insertMultiple(db, [
    {
      id: '1',
      name: 'The pen is on the table',
      age: 33,
      isCool: true,
      algo: ['algo1', 'algo2'],
      preferredNumbers: [20]
    },
    { id: '2', name: 'The can is near the table', age: 32, isCool: true, algo: ['algo3'], preferredNumbers: [55] },
    { id: '3', name: 'My table is cool', age: 22, isCool: false, algo: ['algo4'], preferredNumbers: [22] }
  ])

  expect(
    () =>
      search(db, {
        where: {
          name: 'The pen is on the table'
        }
      }),
    'String filters are not supported'
  ).toThrow()
})

// https://github.com/oramasearch/orama/issues/995
it('matches accented content when the query is typed without accents', async () => {
  const db = create({
    schema: { title: 'string' } as const,
    plugins: [pluginPT15()]
  })

  await insertMultiple(db, [
    { id: '1', title: 'Invitation gâteau au chocolat' },
    { id: '2', title: 'Crème brûlée recipe' }
  ])

  for (const term of ['Gateau', 'Gâteau', 'gateau au chocolat']) {
    const result = search(db, { term })
    expect(result.count, `"${term}" finds the gâteau document`).toBe(1)
    expect(result.hits[0].id).toBe('1')
  }

  for (const term of ['creme brulee', 'Crème brûlée']) {
    const result = search(db, { term })
    expect(result.count, `"${term}" finds the crème brûlée document`).toBe(1)
    expect(result.hits[0].id).toBe('2')
  }
})
