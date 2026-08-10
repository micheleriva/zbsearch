import { describe, expect, it } from 'vitest'
import { create, insert, search } from '../src/index.js'

describe('boosting', () => {
  it('field boosting', async () => {
    const db = await create({
      schema: {
        id: 'string',
        title: 'string',
        description: 'string'
      } as const
    })

    await insert(db, {
      id: '1',
      title: 'Powerful computer with 16GB RAM',
      description: 'A powerful computer with 16GB RAM and a 1TB SSD, perfect for gaming and video editing.'
    })

    await insert(db, {
      id: '2',
      title: 'PC with 8GB RAM. Good for gaming and browsing the web.',
      description:
        'A personal computer with 8GB RAM and a 500GB SSD, perfect for browsing the web and watching movies. This computer is also great for kids.'
    })

    const { hits: hits1 } = await search(db, {
      term: 'computer for browsing and movies'
    })

    const { hits: hits2 } = await search(db, {
      term: 'computer for browsing and movies',
      boost: {
        title: 2.5
      }
    })

    try {
      await search(db, {
        term: 'computer for browsing and movies',
        boost: {
          title: 0
        }
      })
    } catch (err) {
      expect(err.message).toEqual(`Boost value must be a number greater than, or less than 0.`)
    }

    expect(hits1[0].score < hits2[0].score).toBe(true)
  })
})
