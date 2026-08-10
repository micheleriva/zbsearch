import { describe, expect, it } from 'vitest'
import { create, insert, search } from '../../src/index.js'
// 👆 This test assumes the module has been built

describe('zbsearch', () => {
  it('should correctly search for data', async () => {
    const db = await create({
      schema: {
        quote: 'string',
        author: 'string'
      } as const
    })

    await insert(db, { quote: 'the quick, brown fox jumps over the lazy dog. What a fox!', author: 'John Doe' })
    await insert(db, { quote: 'Foxes are nice animals. But I prefer having a dog.', author: 'John Doe' })
    await insert(db, { quote: 'I like dogs. They are the best.', author: 'Jane Doe' })
    await insert(db, { quote: 'I like cats. They are the best.', author: 'Jane Doe' })

    // Exact search
    const result1 = await search(db, { term: 'fox', exact: true })
    const result2 = await search(db, { term: 'dog', exact: true })

    expect(result1.count).toBe(2)
    expect(result2.count).toBe(3)

    // Prefix search
    const result3 = await search(db, { term: 'fox', exact: false })
    const result4 = await search(db, { term: 'dog', exact: false })

    expect(result3.count).toBe(2)
    expect(result4.count).toBe(3)

    // Typo-tolerant search
    const result5 = await search(db, { term: 'fx', tolerance: 1 })
    const result6 = await search(db, { term: 'dg', tolerance: 2 })

    expect(result5.count).toBe(2)
    expect(result6.count).toBe(4)
  })
})
