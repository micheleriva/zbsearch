import { describe, expect, it } from 'vitest'
import { GroupResult, create, insertMultiple, search } from '../src/index.js'

describe('search with groupBy', () => {
  const [db] = createDb()

  describe('should group by a single property', () => {
    it('', async () => {
      const results = await search(db, {
        term: 't-shirt',
        groupBy: {
          properties: ['design']
        },
        sortBy: {
          property: 'id',
          order: 'ASC'
        }
      })

      compareGroupResults(results.groups!, [
        { values: ['A'], result: ['0', '1', '2'] },
        { values: ['B'], result: ['3', '4', '5', '6'] }
      ])
    })

    it('in right order', async () => {
      const results = await search(db, {
        term: 't-shirt',
        groupBy: {
          properties: ['design']
        },
        sortBy: {
          property: 'id',
          order: 'DESC'
        }
      })

      compareGroupResults(results.groups!, [
        { values: ['A'], result: ['2', '1', '0'] },
        { values: ['B'], result: ['6', '5', '4', '3'] }
      ])
    })

    it('with limit', async () => {
      const results = await search(db, {
        term: 't-shirt',
        groupBy: {
          maxResult: 2,
          properties: ['design']
        }
      })

      compareGroupResults(results.groups!, [
        { values: ['A'], result: ['0', '1'] },
        { values: ['B'], result: ['3', '4'] }
      ])
    })

    it('in right order with limit', async () => {
      const results = await search(db, {
        term: 't-shirt',
        groupBy: {
          maxResult: 2,
          properties: ['design']
        },
        sortBy: {
          property: 'id',
          order: 'DESC'
        }
      })

      compareGroupResults(results.groups!, [
        { values: ['A'], result: ['2', '1'] },
        { values: ['B'], result: ['6', '5'] }
      ])
    })
  })

  describe('should group by a 2 properties', () => {
    it('', async () => {
      const results = await search(db, {
        groupBy: {
          properties: ['design', 'rank']
        },
        sortBy: {
          property: 'id',
          order: 'ASC'
        }
      })

      compareGroupResults(results.groups!, [
        { values: ['A', 3], result: ['0', '7'] },
        { values: ['A', 4], result: ['2', '8'] },
        { values: ['A', 5], result: ['1'] },
        // We don't generate empty groups
        // { values: ['B', '3'], result: [] },
        { values: ['B', 4], result: ['3', '4'] },
        { values: ['B', 5], result: ['5', '6'] }
      ])
    })

    it('in the right order', async () => {
      const results = await search(db, {
        groupBy: {
          properties: ['design', 'rank']
        },
        sortBy: {
          property: 'id',
          order: 'DESC'
        }
      })

      compareGroupResults(results.groups!, [
        { values: ['A', 3], result: ['7', '0'] },
        { values: ['A', 4], result: ['8', '2'] },
        { values: ['A', 5], result: ['1'] },
        { values: ['B', 4], result: ['4', '3'] },
        { values: ['B', 5], result: ['6', '5'] }
      ])
    })
  })

  describe('should group by a 3 properties', () => {
    it('', async () => {
      const results = await search(db, {
        groupBy: {
          properties: ['design', 'rank', 'isPromoted']
        },
        sortBy: {
          property: 'id',
          order: 'ASC'
        }
      })

      compareGroupResults(results.groups!, [
        { values: ['A', 3, true], result: ['0', '7'] },
        { values: ['B', 4, true], result: ['4'] },
        { values: ['B', 5, true], result: ['6'] },
        { values: ['A', 4, false], result: ['2', '8'] },
        { values: ['A', 5, false], result: ['1'] },
        { values: ['B', 4, false], result: ['3'] },
        { values: ['B', 5, false], result: ['5'] }
      ])
    })

    it('with custom order', async () => {
      const results = await search(db, {
        groupBy: {
          properties: ['design', 'rank', 'isPromoted']
        },
        sortBy: (a, b) => {
          return -(a[2] as { color: string }).color.localeCompare((b[2] as { color: string }).color)
        }
      })

      compareGroupResults(results.groups!, [
        { values: ['A', 3, true], result: ['7', '0'] },
        { values: ['B', 4, true], result: ['4'] },
        { values: ['B', 5, true], result: ['6'] },
        { values: ['A', 4, false], result: ['2', '8'] },
        { values: ['A', 5, false], result: ['1'] },
        { values: ['B', 4, false], result: ['3'] },
        { values: ['B', 5, false], result: ['5'] }
      ])
    })
  })

  it('with custom aggregator', async () => {
    interface AggregationValue {
      type: string
      design: string
      colors: string[]
      ranks: number[]
      isPromoted: boolean
    }

    const results = await search<typeof db, AggregationValue>(db, {
      groupBy: {
        properties: ['type', 'design'],
        reduce: {
          reducer: (_, acc, item) => {
            const doc = item.document
            acc.type ||= doc.type
            acc.design ||= doc.design
            acc.isPromoted ||= doc.isPromoted
            acc.colors.push(doc.color)
            acc.ranks.push(doc.rank)
            return acc
          },
          getInitialValue: () => ({ type: '', design: '', colors: [], ranks: [], isPromoted: false })
        }
      },
      sortBy: {
        property: 'rank',
        order: 'DESC'
      }
    })

    expect(new Set(results.groups!)).toStrictEqual(
      new Set([
        {
          values: ['t-shirt', 'B'],
          result: {
            type: 't-shirt',
            design: 'B',
            colors: ['gray', 'white', 'green', 'blue'],
            ranks: [5, 5, 4, 4],
            isPromoted: true
          }
        },
        {
          values: ['t-shirt', 'A'],
          result: {
            type: 't-shirt',
            design: 'A',
            colors: ['green', 'red', 'blue'],
            ranks: [5, 4, 3],
            isPromoted: true
          }
        },
        {
          values: ['sweatshirt', 'A'],
          result: { type: 'sweatshirt', design: 'A', colors: ['green', 'yellow'], ranks: [4, 3], isPromoted: true }
        }
      ])
    )
  })

  it('only scalar values are supported', async () => {
    const db = create({
      schema: {
        tags: 'string[]'
      } as const
    })

    expect(() =>
      search(db, {
        groupBy: {
          properties: ['unknown-property']
        }
      })
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('Unknown groupBy property "unknown-property"')
      })
    )

    expect(() =>
      search(db, {
        groupBy: {
          properties: ['tags']
        }
      })
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          'Invalid groupBy property "tags". Allowed types: "string, number, boolean", but given "string[]"'
        )
      })
    )
  })
})

it('real test', async () => {
  const [db] = createDb()
  const results = await search(db, {
    term: 't-shirt',
    groupBy: {
      properties: ['design'],
      maxResult: 1
    },
    sortBy: {
      property: 'rank',
      order: 'DESC'
    }
  })

  compareGroupResults(results.groups!, [
    { values: ['A'], result: ['1'] },
    { values: ['B'], result: ['6'] }
  ])
})

function compareGroupResults(groups: GroupResult<any>, expected) {
  // We don't care about the order of the groups
  expect(
    new Set(
      groups.map((g) => ({
        values: g.values,
        result: g.result.map((d) => d.id)
      }))
    )
  ).toStrictEqual(new Set(expected))
}

function createDb() {
  const db = create({
    schema: {
      id: 'string',
      type: 'string',
      design: 'string',
      color: 'string',
      rank: 'number',
      isPromoted: 'boolean'
    } as const
  })

  const ids = insertMultiple(db, [
    { id: '0', type: 't-shirt', design: 'A', color: 'blue', rank: 3, isPromoted: true },
    { id: '1', type: 't-shirt', design: 'A', color: 'green', rank: 5, isPromoted: false },
    { id: '2', type: 't-shirt', design: 'A', color: 'red', rank: 4, isPromoted: false },
    { id: '3', type: 't-shirt', design: 'B', color: 'blue', rank: 4, isPromoted: false },
    { id: '4', type: 't-shirt', design: 'B', color: 'green', rank: 4, isPromoted: true },
    { id: '5', type: 't-shirt', design: 'B', color: 'white', rank: 5, isPromoted: false },
    { id: '6', type: 't-shirt', design: 'B', color: 'gray', rank: 5, isPromoted: true },
    { id: '7', type: 'sweatshirt', design: 'A', color: 'yellow', rank: 3, isPromoted: true },
    { id: '8', type: 'sweatshirt', design: 'A', color: 'green', rank: 4, isPromoted: false }
  ])

  return [db, ids] as const
}
