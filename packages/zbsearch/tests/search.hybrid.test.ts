import { describe, expect, it } from 'vitest'
import { search, insertMultiple, create } from '../src/index.js'

describe('hybrid search', () => {
  it('should return results', async () => {
    const db = await create({
      schema: {
        text: 'string',
        embedding: 'vector[5]',
        number: 'number'
      } as const
    })

    await insertMultiple(db, [
      { text: 'hello world', embedding: [1, 2, 3, 4, 5], number: 1 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 2 }
    ])

    const results = await search(db, {
      mode: 'hybrid',
      term: 'hello',
      vector: {
        value: [1, 2, 3, 4, 5],
        property: 'embedding'
      },
      similarity: 1
    })

    expect(results.count).toBe(2)
  })

  it('should return results with filters', async () => {
    const db = await create({
      schema: {
        text: 'string',
        embedding: 'vector[5]',
        number: 'number'
      } as const
    })

    await insertMultiple(db, [
      { text: 'hello world', embedding: [1, 2, 3, 4, 5], number: 1 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 2 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 3 }
    ])

    const results1 = await search(db, {
      mode: 'hybrid',
      term: 'hello',
      vector: {
        property: 'embedding',
        value: [1, 2, 3, 4, 4]
      },
      similarity: 1,
      where: {
        number: {
          eq: 3
        }
      }
    })

    const results2 = await search(db, {
      mode: 'hybrid',
      term: 'hello',
      vector: {
        property: 'embedding',
        value: [1, 2, 3, 4, 4]
      },
      similarity: 0.99,
      where: {
        number: {
          eq: 0
        }
      }
    })

    expect(results1.count).toBe(1)
    expect(results2.count).toBe(0)
  })

  it('should correctly paginate the results', async () => {
    const db = await create({
      schema: {
        text: 'string',
        embedding: 'vector[5]',
        number: 'number'
      } as const
    })

    await insertMultiple(db, [
      { text: 'hello world', embedding: [1, 2, 3, 4, 5], number: 1 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 2 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 3 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 4 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 5 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 6 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 7 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 8 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 9 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 10 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 11 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 12 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 13 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 14 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 15 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 16 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 17 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 18 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 19 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 20 }
    ])

    const page1 = await search(db, {
      term: 'hello there',
      mode: 'hybrid',
      vector: {
        property: 'embedding',
        value: [1, 2, 3, 4, 4]
      },
      similarity: 0.5,
      limit: 2,
      offset: 0
    })

    const page2 = await search(db, {
      term: 'hello there',
      mode: 'hybrid',
      vector: {
        property: 'embedding',
        value: [1, 2, 3, 4, 4]
      },
      similarity: 0.5,
      limit: 2,
      offset: 1
    })

    const page3 = await search(db, {
      term: 'hello there',
      mode: 'hybrid',
      vector: {
        property: 'embedding',
        value: [1, 2, 3, 4, 4]
      },
      similarity: 0.5,
      limit: 2,
      offset: 2
    })

    expect(page1.count).toBe(20)
    expect(page2.count).toBe(20)
    expect(page3.count).toBe(20)
    expect(page1.hits.length).toBe(2)
    expect(page2.hits.length).toBe(2)
    expect(page3.hits.length).toBe(2)

    // Result with number 1 is skipped since it's not similar enough
    expect(page1.hits[0].document.number).toBe(2)
    expect(page1.hits[1].document.number).toBe(3)

    expect(page2.hits[0].document.number).toBe(3)
    expect(page2.hits[1].document.number).toBe(4)

    expect(page3.hits[0].document.number).toBe(4)
    expect(page3.hits[1].document.number).toBe(5)
  })

  it('should use custom weights correctly', async () => {
    const db = await create({
      schema: {
        text: 'string',
        embedding: 'vector[5]',
        number: 'number'
      } as const
    })

    await insertMultiple(db, [
      { text: 'hello world', embedding: [0, 41, 10, 39, 12], number: 1 },
      { text: 'hello world', embedding: [1, 2, 3, 4, 4], number: 2 }
    ])

    const results = await search(db, {
      mode: 'hybrid',
      term: 'hello world',
      vector: {
        value: [1, 2, 3, 4, 5],
        property: 'embedding'
      },
      similarity: 1,
      hybridWeights: {
        text: 1, // only consider text, which is identical for both documents
        vector: 0
      }
    })

    expect(results.count).toBe(2)
    expect(results.hits[0].score).toBe(1)
    expect(results.hits[1].score).toBe(1)
  })

  it('should work without a term (vector-only input)', async () => {
    const db = await create({
      schema: {
        text: 'string',
        embedding: 'vector[5]',
        number: 'number'
      } as const
    })

    await insertMultiple(db, [
      { text: 'hello world', embedding: [1, 2, 3, 4, 5], number: 1 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 2 },
      { text: 'foo bar', embedding: [9, 9, 9, 9, 9], number: 3 }
    ])

    const results = await search(db, {
      mode: 'hybrid',
      vector: {
        value: [1, 2, 3, 4, 5],
        property: 'embedding'
      },
      similarity: 0.95
    })

    expect(results.count).toBe(2)
    for (const hit of results.hits) {
      expect(Number.isFinite(hit.score), 'score should never be NaN').toBeTruthy()
    }
    // Pure vector contribution: 0.5 * normalized similarity
    expect(results.hits[0].score).toBe(0.5)
    expect(results.hits[0].document.number).toBe(1)
  })

  it('should honor a zero weight in hybridWeights', async () => {
    const db = await create({
      schema: {
        text: 'string',
        embedding: 'vector[5]',
        number: 'number'
      } as const
    })

    await insertMultiple(db, [
      { text: 'hello world', embedding: [1, 2, 3, 4, 5], number: 1 },
      { text: 'hello there', embedding: [1, 2, 3, 4, 4], number: 2 },
      { text: 'foo bar', embedding: [9, 9, 9, 9, 9], number: 3 }
    ])

    const results = await search(db, {
      mode: 'hybrid',
      term: 'hello',
      vector: {
        value: [1, 2, 3, 4, 5],
        property: 'embedding'
      },
      similarity: 0.9,
      hybridWeights: {
        text: 0, // ignore full-text scores entirely
        vector: 1
      }
    })

    // The best vector match ranks first with its normalized similarity as the score
    expect(results.hits[0].document.number).toBe(1)
    expect(results.hits[0].score).toBe(1)
    for (const hit of results.hits) {
      expect(Number.isFinite(hit.score), 'score should never be NaN').toBeTruthy()
    }
  })
})

it('should correctly paginate the results with a where clause', async () => {
  const db = await create({
    schema: {
      text: 'string',
      embedding: 'vector[5]',
      number: 'number',
      itemId: 'string'
    } as const
  })

  await insertMultiple(db, [
    { text: 'hello world', itemId: '1', embedding: [1, 2, 3, 4, 5], number: 1 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 2 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 3 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 4 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 5 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 6 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 7 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 8 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 9 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 10 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 11 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 12 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 13 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 14 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 15 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 16 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 17 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 18 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 19 },
    { text: 'hello there', itemId: '1', embedding: [1, 2, 3, 4, 4], number: 20 }
  ])

  const page1 = await search(db, {
    term: 'hello there',
    mode: 'hybrid',
    where: {
      itemId: '1'
    },
    vector: {
      property: 'embedding',
      value: [1, 2, 3, 4, 4]
    },
    similarity: 0.5,
    limit: 2,
    offset: 0
  })

  const page2 = await search(db, {
    term: 'hello there',
    mode: 'hybrid',
    where: {
      itemId: '1'
    },
    vector: {
      property: 'embedding',
      value: [1, 2, 3, 4, 4]
    },
    similarity: 0.5,
    limit: 2,
    offset: 1
  })

  const page3 = await search(db, {
    term: 'hello there',
    mode: 'hybrid',
    where: {
      itemId: '1'
    },
    vector: {
      property: 'embedding',
      value: [1, 2, 3, 4, 4]
    },
    similarity: 0.5,
    limit: 2,
    offset: 2
  })
  const page4 = await search(db, {
    term: 'hello there',
    mode: 'hybrid',
    where: {
      itemId: '1'
    },
    vector: {
      property: 'embedding',
      value: [1, 2, 3, 4, 4]
    },
    similarity: 0.5,
    limit: 10,
    offset: 5
  })
  expect(page1.hits.length).toBe(2)
  expect(page2.hits.length).toBe(2)
  expect(page3.hits.length).toBe(2)
  expect(page4.hits.length).toBe(10)

  expect(page1.hits[0].document.number).toBe(2)
  expect(page1.hits[1].document.number).toBe(3)

  expect(page2.hits[0].document.number).toBe(3)
  expect(page2.hits[1].document.number).toBe(4)

  expect(page3.hits[0].document.number).toBe(4)
  expect(page3.hits[1].document.number).toBe(5)

  expect(page1.count).toBe(20)
  expect(page2.count).toBe(20)
  expect(page3.count).toBe(20)
  expect(page4.count).toBe(20)
})
