import { expect, it } from 'vitest'
import { create } from '../src/methods/create.js'
import { insert } from '../src/methods/insert.js'
import { search } from '../src/methods/search.js'

it('preflight request', async () => {
  const db = await create({
    schema: {
      title: 'string'
    } as const
  })

  await insert(db, { title: 'Red headphones' })
  await insert(db, { title: 'Blue headphones' })
  await insert(db, { title: 'Yellow headphones' })
  await insert(db, { title: 'Magenta headphones' })
  await insert(db, { title: 'Green headphones' })

  const results = await search(db, {
    term: 'headphones',
    preflight: true
  })

  const fullResults = await search(db, {
    term: 'headphones'
  })

  expect(results.count).toEqual(5)
  expect(results.hits).toEqual([])
  expect(fullResults.count).toEqual(5)
  expect(fullResults.hits.length).toEqual(5)
})
