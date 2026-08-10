import { describe, expect, it } from 'vitest'
import { create, insert, search, remove, insertMultiple, AnyZBSearch } from '../src/index.js'

describe('filters', () => {
  it('should throw on unknown field', async () => {
    const [db] = await createSimpleDB()

    expect(() =>
      search(db, {
        term: 'coffee',
        where: {
          unknownField: '5'
        }
      })
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('Unknown filter property "unknownField"'),
        code: 'UNKNOWN_FILTER_PROPERTY'
      })
    )

    expect(() =>
      search(db, {
        term: 'coffee',
        where: {
          unknownField: { gt: '5' } as unknown as string
        }
      })
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('Unknown filter property "unknownField"'),
        code: 'UNKNOWN_FILTER_PROPERTY'
      })
    )

    expect(() =>
      search(db, {
        term: 'coffee',
        where: {
          unknownField: true as unknown as string
        }
      })
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('Unknown filter property "unknownField"'),
        code: 'UNKNOWN_FILTER_PROPERTY'
      })
    )
  })

  it('greater than', async () => {
    const [db, [id1]] = await createSimpleDB()

    const r1_gt = await search(db, {
      term: 'coffee',
      where: {
        rating: {
          gt: 4
        }
      }
    })

    expect(r1_gt.count).toBe(1)
    expect(r1_gt.hits[0].id).toBe(id1)
  })

  it('greater than or equal to', async () => {
    const [db, [id1, , id3]] = await createSimpleDB()

    const r1_gte = await search(db, {
      term: 'coffee',
      where: {
        rating: {
          gte: 3
        }
      }
    })

    expect(r1_gte.count).toBe(2)
    expect(r1_gte.hits[0].id).toBe(id3)
    expect(r1_gte.hits[1].id).toBe(id1)
  })

  it('less than', async () => {
    const [db, [, , id3]] = await createSimpleDB()

    const r1_lt = await search(db, {
      term: 'coffee',
      where: {
        rating: {
          lt: 5
        }
      }
    })

    expect(r1_lt.count).toBe(1)
    expect(r1_lt.hits[0].id).toBe(id3)
  })

  it('less than or equal to', async () => {
    const [db, [, , id3]] = await createSimpleDB()

    const r1_lte = await search(db, {
      term: 'coffee',
      where: {
        rating: {
          lte: 3
        }
      }
    })

    expect(r1_lte.count).toBe(1)
    expect(r1_lte.hits[0].id).toBe(id3)
  })

  it('equal', async () => {
    const [db, [, , id3]] = await createSimpleDB()

    const r1_lte = await search(db, {
      term: 'coffee',
      where: {
        rating: {
          eq: 3
        }
      }
    })

    expect(r1_lte.count).toBe(1)
    expect(r1_lte.hits[0].id).toBe(id3)
  })

  it('between', async () => {
    const [db, [, , id3]] = await createSimpleDB()

    const r1_lte = await search(db, {
      term: 'coffee',
      where: {
        rating: {
          between: [1, 4]
        }
      }
    })

    expect(r1_lte.count).toBe(1)
    expect(r1_lte.hits[0].id).toBe(id3)
  })

  it('multiple filters', async () => {
    const [db, [, , id3]] = await createSimpleDB()

    const r1_lte = await search(db, {
      term: 'coffee',
      where: {
        rating: {
          between: [1, 4]
        },
        price: {
          lte: 40
        }
      }
    })

    expect(r1_lte.count).toBe(1)
    expect(r1_lte.hits[0].id).toBe(id3)
  })

  it('multiple filters, and operation', async () => {
    const [db, [, , id3]] = await createSimpleDB()

    const r1_lte = await search(db, {
      term: 'coffee',
      where: {
        rating: {
          between: [1, 4]
        },
        price: {
          lte: 40
        },
        'meta.sales': {
          eq: 25
        }
      }
    })

    expect(r1_lte.count).toBe(1)
    expect(r1_lte.hits[0].id).toBe(id3)
  })

  it('explicit and operator', async () => {
    const [db, [, , id3]] = await createSimpleDB()

    const r1_lte = await search(db, {
      term: 'coffee',
      where: {
        and: [{ rating: { between: [1, 4] } }, { price: { lte: 40 } }, { 'meta.sales': { eq: 25 } }]
      }
    })

    expect(r1_lte.count).toBe(1)
    expect(r1_lte.hits[0].id).toBe(id3)
  })

  it('or operator', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [db, [id1, id2, id3]] = await createSimpleDB()

    const r1_or = await search(db, {
      term: 'coffee',
      where: {
        or: [{ rating: { gt: 4 } }, { price: { lt: 30 } }]
      }
    })

    expect(r1_or.count).toBe(1)
    const resultIds = r1_or.hits.map((hit) => hit.id).sort()
    expect(resultIds).toStrictEqual([id1].sort())
  })

  it('not operator', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [db, [id1, id2, id3]] = await createSimpleDB()

    const r1_not = await search(db, {
      term: 'coffee',
      where: {
        not: { rating: { gt: 4 } }
      }
    })

    expect(r1_not.count).toBe(1)
    const resultIds = r1_not.hits.map((hit) => hit.id).sort()
    expect(resultIds).toStrictEqual([id3].sort())
  })

  it('nested logical operators', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [db, [id1, id2, id3]] = await createSimpleDB()

    const r1_nested = await search(db, {
      term: 'coffee',
      where: {
        or: [
          {
            and: [{ rating: { gt: 4 } }, { price: { gt: 50 } }]
          },
          {
            and: [{ not: { rating: { gt: 4 } } }, { price: { lt: 30 } }]
          }
        ]
      }
    })

    expect(r1_nested.count).toBe(1)
    expect(r1_nested.hits[0].id).toBe(id1)
  })

  it('empty and array', async () => {
    const [db] = await createSimpleDB()

    const r1_empty = await search(db, {
      term: 'coffee',
      where: {
        and: []
      }
    })

    expect(r1_empty.count).toBe(0)
  })

  it('empty or array', async () => {
    const [db] = await createSimpleDB()

    const r1_empty = await search(db, {
      term: 'coffee',
      where: {
        or: []
      }
    })

    expect(r1_empty.count).toBe(0)
  })
})

it('should throw when using multiple operators', async () => {
  const [db] = await createSimpleDB()

  expect(() =>
    search(db, {
      term: 'coffee',
      where: {
        rating: {
          gt: 4,
          lte: 10
        }
      }
    })
  ).toThrow(expect.objectContaining({ code: 'INVALID_FILTER_OPERATION' }))
})

it('boolean filters', async () => {
  const db = create({
    schema: {
      id: 'string',
      isAvailable: 'boolean',
      name: 'string'
    } as const
  })

  await insert(db, {
    id: '1',
    isAvailable: true,
    name: 'coffee'
  })

  await insert(db, {
    id: '2',
    isAvailable: true,
    name: 'coffee machine'
  })

  await insert(db, {
    id: '3',
    isAvailable: false,
    name: 'coffee maker'
  })

  const r1 = await search(db, {
    term: 'coffee',
    where: {
      isAvailable: true
    }
  })

  expect(r1.count).toBe(2)
  expect(r1.hits[0].id).toBe('1')
  expect(r1.hits[1].id).toBe('2')

  const r2 = await search(db, {
    term: 'coffee',
    where: {
      isAvailable: false
    }
  })

  expect(r2.count).toBe(1)
  expect(r2.hits[0].id).toBe('3')

  await remove(db, '2')

  const r3 = await search(db, {
    term: 'coffee',
    where: {
      isAvailable: true
    }
  })

  expect(r3.count).toBe(1)
  expect(r3.hits[0].id).toBe('1')
})

it('string filters', async () => {
  const db = await create({
    schema: {
      id: 'string',
      name: 'string',
      tags: 'string'
    } as const
  })

  await insert(db, {
    id: '1',
    name: 'coffee type',
    tags: 'coffee type'
  })

  await insert(db, {
    id: '2',
    name: 'coffee machine',
    tags: 'coffee machine'
  })

  await insert(db, {
    id: '3',
    name: 'coffee maker',
    tags: 'coffee maker'
  })

  await insert(db, {
    id: '4',
    name: 'coffee drinker',
    tags: 'coffee drinker'
  })

  await insert(db, {
    id: '5',
    name: 'another',
    tags: 'coffee drinker'
  })

  const r1 = await search(db, {
    term: 'coffee',
    properties: ['name'],
    where: {
      tags: 'coffee'
    }
  })

  expect(r1.count).toBe(4)
  expect(r1.hits[0].id).toBe('1')
  expect(r1.hits[1].id).toBe('2')
  expect(r1.hits[2].id).toBe('3')
  expect(r1.hits[3].id).toBe('4')

  const r2 = await search(db, {
    term: 'coffee',
    properties: ['name'],
    where: {
      name: ['machine', 'maker']
    }
  })

  expect(r2.count).toBe(2)
  expect(r2.hits[0].id).toBe('2')
  expect(r2.hits[1].id).toBe('3')

  const r3 = await search(db, {
    term: 'another',
    properties: ['name'],
    where: {
      name: ['coffee']
    }
  })

  expect(r3.count).toBe(0)

  const r4 = await search(db, {
    term: '',
    where: {
      name: []
    }
  })

  expect(r4.count).toBe(0)
})

it('string filters with stemming', async () => {
  const db = await create({
    schema: {
      id: 'string',
      name: 'string',
      tags: 'string'
    } as const,
    components: {
      tokenizer: {
        stemming: true
      }
    }
  })

  await insert(db, {
    id: '1',
    name: 'coffee',
    tags: 'machine'
  })

  await insert(db, {
    id: '2',
    name: 'coffee',
    tags: 'machines'
  })

  const r1 = await search(db, {
    term: 'coffee',
    properties: ['name'],
    where: {
      tags: 'machine'
    }
  })

  expect(r1.count).toBe(2)
  expect(r1.hits[0].id).toBe('1')
  expect(r1.hits[1].id).toBe('2')

  const r2 = await search(db, {
    term: 'coffee',
    properties: ['name'],
    where: {
      tags: 'machines'
    }
  })

  expect(r2.count).toBe(2)
  expect(r2.hits[0].id).toBe('1')
  expect(r2.hits[1].id).toBe('2')
})

async function createSimpleDB(): Promise<[AnyZBSearch, string[]]> {
  let i = 0
  const db = await create({
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

  const ids = await insertMultiple(db, [
    {
      name: 'super coffee maker',
      rating: 5,
      price: 900,
      meta: {
        sales: 100
      }
    },
    {
      name: 'washing machine',
      rating: 5,
      price: 900,
      meta: {
        sales: 100
      }
    },
    {
      name: 'coffee maker',
      rating: 3,
      price: 30,
      meta: {
        sales: 25
      }
    }
  ])

  return [db, ids]
}
