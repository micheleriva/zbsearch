import { expect, it } from 'vitest'
import { create, insertMultiple, load, remove, save, search } from 'zbsearch'
import { pluginQPS } from '../src/index.js'

it('plugin-qps', async () => {
  const db = create({
    schema: {
      name: 'string',
      age: 'number',
      isCool: 'boolean',
      algo: 'string[]',
      preferredNumbers: 'number[]'
    } as const,
    plugins: [pluginQPS()]
  })

  await insertMultiple(db, [
    { id: '1', name: 'foo foo foo', age: 33, isCool: true, algo: ['algo1', 'algo2'], preferredNumbers: [20] },
    { id: '2', name: 'bar bar bar', age: 32, isCool: true, algo: ['algo3'], preferredNumbers: [55] },
    { id: '3', name: 'baz baz baz', age: 22, isCool: false, algo: ['algo4'], preferredNumbers: [22] }
  ])

  const result = await search(db, {
    term: 'b'
  })

  expect(result.count).toBe(2)

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
    plugins: [pluginQPS()]
  })
  await load(db2, restored)

  const result2 = await search(db, {
    term: 'b'
  })
  expect(result2.count).toBe(2)

  await remove(db2, '2')

  const result3 = await search(db2, {
    term: 'b'
  })

  expect(result3.count).toBe(1)
})

it('filter on string', async () => {
  const db = create({
    schema: {
      name: 'string',
      surname: 'string'
    } as const,
    plugins: [pluginQPS()]
  })

  await insertMultiple(db, [{ id: '1', name: 'Tommaso', surname: 'Allevi' }])

  const result1 = await search(db, {
    term: '',
    where: {
      name: 'Tommaso'
    }
  })

  expect(result1.count).toBe(1)

  const result2 = await search(db, {
    term: '',
    where: {
      name: 'Tommaso',
      surname: 'Allevi'
    }
  })

  expect(result2.count).toBe(1)

  const result3 = await search(db, {
    term: '',
    where: {
      name: 'Tommaso',
      surname: 'unknown'
    }
  })

  expect(result3.count).toBe(0)
})

it('string[] is allowed by this plugin', async () => {
  const db = create({
    schema: {
      title: 'string',
      category: 'string'
    }
    // Without the plugin
    // plugins: [pluginQPS()],
  })

  await insertMultiple(db, [
    {
      title: `Harry Potter and the Philosopher's Stone`,
      category: 'movie'
    },
    {
      title: 'Harry Potter and the Chamber of Secrets',
      category: 'book'
    }
  ])

  const found = await search(db, {
    term: 'Harry',
    where: {
      category: ['movie', 'book']
    }
  })

  const db2 = create({
    schema: {
      title: 'string',
      category: 'string'
    },
    plugins: [pluginQPS()]
  })

  await insertMultiple(db2, [
    {
      title: `Harry Potter and the Philosopher's Stone`,
      category: 'movie'
    },
    {
      title: 'Harry Potter and the Chamber of Secrets',
      category: 'book'
    }
  ])

  const found2 = await search(db2, {
    term: 'Harry',
    where: {
      category: ['movie', 'book']
    }
  })

  expect(found.count).toBe(found2.count)
})

// https://github.com/oramasearch/orama/issues/995
it('matches accented content when the query is typed without accents', async () => {
  const db = create({
    schema: { title: 'string' } as const,
    plugins: [pluginQPS()]
  })

  await insertMultiple(db, [
    { id: '1', title: 'Invitation gâteau au chocolat' },
    { id: '2', title: 'Crème brûlée recipe' }
  ])

  for (const term of ['Gateau', 'Gâteau', 'gateau au chocolat']) {
    const result = await search(db, { term })
    expect(result.count, `"${term}" finds the gâteau document`).toBe(1)
    expect(result.hits[0].id).toBe('1')
  }

  for (const term of ['creme brulee', 'Crème brûlée']) {
    const result = await search(db, { term })
    expect(result.count, `"${term}" finds the crème brûlée document`).toBe(1)
    expect(result.hits[0].id).toBe('2')
  }
})
