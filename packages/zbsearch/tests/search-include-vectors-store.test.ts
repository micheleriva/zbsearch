import { describe, expect, it } from 'vitest'
import { create, getByID, insert, search } from '../src/index.js'

describe('search with includeVectors: false', () => {
  async function setup() {
    const db = create({
      schema: {
        t: 'string',
        v: 'vector[2]',
        nested: { w: 'vector[2]' }
      } as const
    })
    await insert(db, { id: 'a', t: 'x', v: [1, 0], nested: { w: [0, 1] } })
    return db
  }

  function storedDocs(db: Awaited<ReturnType<typeof setup>>) {
    return Object.values(db.data.docs.docs as Record<string, any>)
  }

  // Full-text and hybrid searches strip every vector property; vector search strips only the searched one.
  it.each([
    ['fulltext', { term: 'x' }, { v: null, nested: { w: null } }],
    [
      'vector',
      { mode: 'vector', vector: { value: [1, 0], property: 'v' }, similarity: 0.1 },
      { v: null, nested: { w: [0, 1] } }
    ],
    [
      'vector (nested property)',
      { mode: 'vector', vector: { value: [0, 1], property: 'nested.w' }, similarity: 0.1 },
      { v: [1, 0], nested: { w: null } }
    ],
    [
      'hybrid',
      { mode: 'hybrid', term: 'x', vector: { value: [1, 0], property: 'v' }, similarity: 0.1 },
      { v: null, nested: { w: null } }
    ]
  ])('does not mutate the stored document on %s search', async (_, params, expectedVectors) => {
    const db = await setup()

    const results = await search(db, params as any)
    expect(results.hits.length).toBe(1)
    expect(results.hits[0].document).toEqual({ id: 'a', t: 'x', ...expectedVectors })

    expect(storedDocs(db)).toEqual([{ id: 'a', t: 'x', v: [1, 0], nested: { w: [0, 1] } }])
    expect(getByID(db, 'a')).toEqual({ id: 'a', t: 'x', v: [1, 0], nested: { w: [0, 1] } })

    const withVectors = await search(db, { ...(params as any), includeVectors: true })
    expect(withVectors.hits[0].document.v).toEqual([1, 0])
    expect(withVectors.hits[0].document.nested.w).toEqual([0, 1])
  })
})
