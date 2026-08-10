import { describe, expect, it } from 'vitest'
import { ZBSearch, create, insert, search } from '../src/index.js'

describe('tokenizeSkipProperties', () => {
  it('skipProperties', async () => {
    const [db, id1] = await createSimpleDB(true)

    const result = await search(db, {
      where: {
        'meta.finish': 'black matte'
      }
    })

    expect(result.elapsed).toBeTruthy()
    expect(result.elapsed.raw).toBeTruthy()
    expect(result.elapsed.formatted).toBeTruthy()
    expect(result.count).toBe(1)
    expect(result.hits[0].id).toBe(id1)
  })

  it('noSkipProperties', async () => {
    const [db, id1, id2, , id4] = await createSimpleDB(false)

    const result = await search(db, {
      where: {
        'meta.finish': 'black matte'
      }
    })

    expect(result.elapsed).toBeTruthy()
    expect(result.elapsed.raw).toBeTruthy()
    expect(result.elapsed.formatted).toBeTruthy()
    expect(result.count).toBe(3)

    for (const id of [id1, id2, id4]) {
      expect(result.hits.find((d) => d.id === id)).toBeTruthy()
    }
  })
})

async function createSimpleDB(skipProperties: boolean) {
  let db: ZBSearch<{
    name: 'string'
    rating: 'number'
    price: 'number'
    meta: {
      sales: 'number'
      finish: 'string'
    }
  }>
  if (skipProperties) {
    db = await create({
      schema: {
        name: 'string',
        rating: 'number',
        price: 'number',
        meta: {
          sales: 'number',
          finish: 'string'
        }
      },
      components: {
        tokenizer: {
          tokenizeSkipProperties: ['meta.finish']
        }
      }
    })
  } else {
    db = await create({
      schema: {
        name: 'string',
        rating: 'number',
        price: 'number',
        meta: {
          sales: 'number',
          finish: 'string'
        }
      }
    })
  }

  const id1 = await insert(db, {
    name: 'super coffee maker',
    rating: 5,
    price: 900,
    meta: {
      sales: 100,
      finish: 'black matte'
    }
  })

  const id2 = await insert(db, {
    name: 'washing machine',
    rating: 5,
    price: 900,
    meta: {
      sales: 100,
      finish: 'gloss black'
    }
  })

  const id3 = await insert(db, {
    name: 'coffee maker',
    rating: 3,
    price: 30,
    meta: {
      sales: 25,
      finish: 'gloss blue'
    }
  })

  const id4 = await insert(db, {
    name: 'coffee maker deluxe',
    rating: 5,
    price: 45,
    meta: {
      sales: 25,
      finish: 'blue matte'
    }
  })

  return [db, id1, id2, id3, id4] as const
}
