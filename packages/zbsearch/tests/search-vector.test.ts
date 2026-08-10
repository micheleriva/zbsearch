import { describe, expect, it } from 'vitest'
import { create, insertMultiple, search } from '../src/index.js'

describe('create', () => {
  it('should create a vector instance', async () => {
    const db = await create({
      schema: {
        title: 'string',
        description: 'string',
        embedding: 'vector[1536]'
      } as const
    })

    expect(db, 'db instance created').toBeTruthy()
  })

  it('should throw an error if no vector size is provided', async () => {
    try {
      await create({
        schema: {
          title: 'string',
          description: 'string',
          embedding: 'vector[]'
        } as const
      })
    } catch (err) {
      expect(err, 'error thrown').toBeTruthy()
    }
  })

  it('should throw an error if vector size is not a number', async () => {
    try {
      await create({
        schema: {
          title: 'string',
          description: 'string',
          embedding: 'vector[foo]'
        } as const
      })
    } catch (err) {
      expect(err, 'error thrown').toBeTruthy()
    }
  })
})

describe('search', () => {
  it('should return the most similar vectors', async () => {
    const db = await create({
      schema: {
        vector: 'vector[5]'
      } as const
    })

    await insertMultiple(db, [{ vector: [1, 1, 1, 1, 1] }, { vector: [0, 1, 1, 1, 1] }, { vector: [0, 0, 1, 1, 1] }])

    const results = await search(db, {
      mode: 'vector',
      vector: {
        value: [1, 1, 1, 1, 1],
        property: 'vector'
      },
      includeVectors: true
    })

    expect(results.count).toEqual(2)
    expect(results.hits[0].document.vector).toEqual([1, 1, 1, 1, 1])
    expect(results.hits[1].document.vector).toEqual([0, 1, 1, 1, 1])
  })

  it('should search through nested properties', async () => {
    const db = await create({
      schema: {
        title: 'string',
        vectors: {
          embedding: 'vector[5]'
        }
      } as const
    })

    await insertMultiple(db, [
      { title: 'foo', vectors: { embedding: [1, 1, 1, 1, 1] } },
      { title: 'bar', vectors: { embedding: [0, 1, 1, 1, 1] } },
      { title: 'baz', vectors: { embedding: [0, 0, 1, 1, 1] } }
    ])

    const results = await search(db, {
      mode: 'vector',
      vector: {
        value: [1, 1, 1, 1, 1],
        property: 'vectors.embedding'
      },
      includeVectors: true
    })

    expect(results.count).toEqual(2)
    expect((results.hits[0].document as any).vectors.embedding).toEqual([1, 1, 1, 1, 1])
    expect((results.hits[1].document as any).vectors.embedding).toEqual([0, 1, 1, 1, 1])
  })

  it('should search through deeply nested properties', async () => {
    const db = await create({
      schema: {
        title: 'string',
        deeply: {
          nested: {
            vectors: 'vector[5]'
          }
        }
      } as const
    })

    await insertMultiple(db, [
      { title: 'foo', deeply: { nested: { vectors: [1, 1, 1, 1, 1] } } },
      { title: 'bar', deeply: { nested: { vectors: [0, 1, 1, 1, 1] } } },
      { title: 'baz', deeply: { nested: { vectors: [0, 0, 1, 1, 1] } } }
    ])

    const results = await search(db, {
      mode: 'vector',
      vector: {
        value: [1, 1, 1, 1, 1],
        property: 'deeply.nested.vectors'
      },
      includeVectors: true
    })

    expect(results.count).toEqual(2)
    expect((results.hits[0].document as any).deeply.nested.vectors).toEqual([1, 1, 1, 1, 1])
    expect((results.hits[1].document as any).deeply.nested.vectors).toEqual([0, 1, 1, 1, 1])
  })

  it('should be able to work on multiple vector properties at creation time', async () => {
    const db = await create({
      schema: {
        title: 'string',
        vectors: {
          embedding: 'vector[5]',
          embedding_2: 'vector[6]'
        }
      } as const
    })

    await insertMultiple(db, [
      { title: 'foo', vectors: { embedding: [1, 1, 1, 1, 1], embedding_2: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2] } },
      { title: 'bar', vectors: { embedding: [0, 1, 1, 1, 1], embedding_2: [0.2, 0.02, 0.1, 0.1, 0.1, 0.1] } },
      { title: 'baz', vectors: { embedding: [0, 0, 1, 1, 1], embedding_2: [0.2, 0.2, 0.21, 0.21, 0.21, 0.21] } }
    ])

    const results1 = await search(db, {
      mode: 'vector',
      vector: {
        value: [1, 1, 1, 1, 1],
        property: 'vectors.embedding'
      },
      includeVectors: true
    })

    const results2 = await search(db, {
      mode: 'vector',
      vector: {
        value: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2],
        property: 'vectors.embedding_2'
      },
      includeVectors: true
    })

    expect(results1.count).toEqual(2)
    expect((results1.hits[0].document as any).vectors.embedding).toEqual([1, 1, 1, 1, 1])
    expect((results1.hits[1].document as any).vectors.embedding).toEqual([0, 1, 1, 1, 1])

    expect(results2.count).toEqual(3)
    expect((results2.hits[0].document as any).vectors.embedding_2).toEqual([0.2, 0.2, 0.2, 0.2, 0.2, 0.2])
    expect((results2.hits[1].document as any).vectors.embedding_2).toEqual([0.2, 0.2, 0.21, 0.21, 0.21, 0.21])
    expect((results2.hits[2].document as any).vectors.embedding_2).toEqual([0.2, 0.02, 0.1, 0.1, 0.1, 0.1])
  })

  it('should throw an error when using unknown vector property', async () => {
    const db = await create({
      schema: {
        title: 'string',
        embedding: 'vector[5]'
      } as const
    })

    await insertMultiple(db, [{ title: 'foo', embedding: [1, 1, 1, 1, 1] }])

    try {
      await search(db, {
        mode: 'vector',
        vector: {
          value: [1, 1, 1, 1, 1],
          property: 'nonexistent_vector'
        }
      })
      expect.fail('Should have thrown an error')
    } catch (err: any) {
      expect(
        err.message.includes('Unknown vector property "nonexistent_vector"'),
        'error message contains property name'
      ).toBeTruthy()
      expect(err.code, 'correct error code').toEqual('UNKNOWN_VECTOR_PROPERTY')
    }
  })
})

it('vector search with where clause', async () => {
  const db = await create({
    schema: {
      embedding: 'vector[5]',
      rating: 'number'
    } as const
  })

  const [, id2] = await insertMultiple(db, [
    { embedding: [1, 1, 1, 1, 1], rating: 4.5 },
    { embedding: [0, 1, 1, 1, 1], rating: 4.3 },
    { embedding: [0, 0, 1, 1, 1], rating: 4.1 }
  ])

  const results = await search(db, {
    mode: 'vector',
    vector: {
      value: [1, 1, 1, 1, 1],
      property: 'embedding'
    },
    where: {
      rating: {
        eq: 4.3
      }
    }
  })

  expect(results.count).toEqual(1)
  expect(results.hits[0].id).toEqual(id2)
})

it('vector search with facets', async () => {
  const db = await create({
    schema: {
      embedding: 'vector[5]',
      rating: 'number'
    } as const
  })

  await insertMultiple(db, [
    { embedding: [1, 1, 1, 1, 1], rating: 1 },
    { embedding: [0, 1, 1, 1, 1], rating: 2 },
    { embedding: [0, 0, 1, 1, 1], rating: 4 }
  ])

  const results = await search(db, {
    mode: 'vector',
    vector: {
      value: [1, 1, 1, 1, 1],
      property: 'embedding'
    },
    similarity: 0,
    facets: {
      rating: {
        ranges: [
          { from: 0, to: 1 },
          { from: 1, to: 3 },
          { from: 3, to: 5 }
        ]
      }
    }
  })

  expect(results.count).toEqual(3)
  expect(results.facets?.rating.values['0-1']).toEqual(1)
  expect(results.facets?.rating.values['1-3']).toEqual(2)
  expect(results.facets?.rating.values['3-5']).toEqual(1)
})
