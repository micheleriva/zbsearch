import { expect, it } from 'vitest'
import { count, getByID, create, insert } from '../src/index.js'

it('count', async () => {
  const db = await create({
    schema: {
      id: 'string',
      title: 'string'
    } as const
  })

  await insert(db, { id: 'doc1', title: 'Hello World 1' })
  await insert(db, { id: 'doc2', title: 'Hello World 2' })
  await insert(db, { id: 'doc3', title: 'Hello World 3' })

  expect(await count(db), 'count').toBe(3)
  expect((await getByID(db, 'doc1'))?.title, 'getByID').toBe('Hello World 1')
})
