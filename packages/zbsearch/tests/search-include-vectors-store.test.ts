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

describe('search hits keep the shape of stored documents', () => {
  class Doc {
    constructor(
      public id: string,
      private _title: string,
      public v?: number[]
    ) {}

    get title() {
      return this._title
    }
  }

  it('returns the stored document untouched when the schema has no vectors', async () => {
    const db = create({ schema: { title: 'string' } as const })
    const doc = new Doc('a', 'hello')
    await insert(db, doc as any)

    const results = await search(db, { term: 'hello' })
    expect(results.hits.length).toBe(1)
    expect(results.hits[0].document).toBe(doc)
    expect(results.hits[0].document.title).toBe('hello')
  })

  it('keeps inherited fields readable when nulling vectors', async () => {
    const db = create({ schema: { title: 'string', v: 'vector[2]' } as const })
    const doc = new Doc('a', 'hello', [1, 0])
    await insert(db, doc as any)

    const results = await search(db, { term: 'hello' })
    expect(results.hits.length).toBe(1)
    const hit = results.hits[0].document as any
    expect(hit).not.toBe(doc)
    expect(hit).toBeInstanceOf(Doc)
    expect(hit.title).toBe('hello')
    expect(hit.v).toBeNull()
    expect(doc.v).toEqual([1, 0])
  })
})

describe('stripping vectors from documents with accessors or write restrictions', () => {
  it('strips a getter-only vector without throwing', async () => {
    const db = create({ schema: { t: 'string', v: 'vector[2]' } as const })
    const doc = { id: 'a', t: 'x' }
    Object.defineProperty(doc, 'v', { get: () => [1, 0], enumerable: true })
    await insert(db, doc as any)

    const results = await search(db, { term: 'x' })
    expect(results.hits.length).toBe(1)
    expect(results.hits[0].document.v).toBeNull()
    expect((doc as any).v).toEqual([1, 0])
  })

  it('does not call a setter that shares state with the stored document', async () => {
    const db = create({ schema: { t: 'string', v: 'vector[2]' } as const })
    const backing = { v: [1, 0] as number[] | null }
    const doc = { id: 'a', t: 'x' }
    Object.defineProperty(doc, 'v', {
      get: () => backing.v,
      set: (value) => {
        backing.v = value
      },
      enumerable: true
    })
    await insert(db, doc as any)

    const results = await search(db, { term: 'x' })
    expect(results.hits[0].document.v).toBeNull()
    expect(backing.v).toEqual([1, 0])
    expect(getByID(db, 'a')!.v).toEqual([1, 0])
  })

  it('strips vectors from frozen documents, including nested ones', async () => {
    const db = create({ schema: { t: 'string', v: 'vector[2]', nested: { w: 'vector[2]' } } as const })
    const doc = Object.freeze({ id: 'a', t: 'x', v: [1, 0], nested: Object.freeze({ w: [0, 1] }) })
    await insert(db, doc as any)

    const results = await search(db, { term: 'x' })
    expect(results.hits[0].document).toEqual({ id: 'a', t: 'x', v: null, nested: { w: null } })
    expect(getByID(db, 'a')).toEqual({ id: 'a', t: 'x', v: [1, 0], nested: { w: [0, 1] } })
  })
})
