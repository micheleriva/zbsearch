import { describe, expect, it } from 'vitest'
import { create, insertMultiple, search, save, load, remove, update } from '../src/index.js'
import { RESERVED_VECTOR_INDEX_KEY } from '../src/constants.js'
import { ivf } from '../src/trees/vector-ivf.js'

describe('IVF vector index', () => {
  it('should return similar vectors using IVF', async () => {
    const db = create({
      schema: {
        embedding: 'vector[5]'
      } as const,
      indexes: {
        embedding: ivf({ nlist: 2, nprobe: 2, trainMin: 2 })
      }
    })

    await insertMultiple(db, [
      { embedding: [1, 1, 1, 1, 1] },
      { embedding: [0, 1, 1, 1, 1] },
      { embedding: [0, 0, 1, 1, 1] }
    ])

    const results = await search(db, {
      mode: 'vector',
      vector: {
        value: [1, 1, 1, 1, 1],
        property: 'embedding'
      },
      similarity: 0.8
    })

    expect(results.count).toEqual(2)
  })

  it('should support update and remove with IVF', async () => {
    const db = create({
      schema: {
        embedding: 'vector[5]'
      } as const,
      indexes: {
        [RESERVED_VECTOR_INDEX_KEY]: ivf({ nlist: 2, nprobe: 2, trainMin: 2 })
      }
    })

    const [id1, id2] = await insertMultiple(db, [{ embedding: [1, 0, 0, 0, 0] }, { embedding: [0, 1, 0, 0, 0] }])

    await search(db, {
      mode: 'vector',
      vector: { value: [1, 0, 0, 0, 0], property: 'embedding' },
      similarity: 0
    })
    await remove(db, id1)

    const afterRemove = await search(db, {
      mode: 'vector',
      vector: { value: [1, 0, 0, 0, 0], property: 'embedding' },
      similarity: 0
    })
    expect(afterRemove.count).toEqual(1)
    expect(afterRemove.hits[0].id).toEqual(id2)

    const newId = await update(db, id2, { embedding: [1, 0, 0, 0, 0] })
    const afterUpdate = await search(db, {
      mode: 'vector',
      vector: { value: [1, 0, 0, 0, 0], property: 'embedding' },
      similarity: 0.99
    })
    expect(afterUpdate.count).toEqual(1)
    expect(afterUpdate.hits[0].id).toEqual(newId)
  })

  it('should serialize and restore IVF indexes', async () => {
    const db = create({
      schema: {
        embedding: 'vector[5]'
      } as const,
      indexes: {
        embedding: ivf({ nlist: 2, nprobe: 2, trainMin: 2 })
      }
    })

    await insertMultiple(db, [
      { embedding: [1, 1, 1, 1, 1] },
      { embedding: [0, 1, 1, 1, 1] },
      { embedding: [0, 0, 1, 1, 1] }
    ])

    await search(db, {
      mode: 'vector',
      vector: { value: [1, 1, 1, 1, 1], property: 'embedding' },
      similarity: 0
    })

    const serialized = save(db)
    expect(serialized.index.vectorIndexes.embedding.kind).toEqual('ivf')

    const restored = create({
      schema: {
        embedding: 'vector[5]'
      } as const,
      indexes: {
        embedding: ivf({ nlist: 2, nprobe: 2, trainMin: 2 })
      }
    })

    load(restored, serialized)

    const results = await search(restored, {
      mode: 'vector',
      vector: { value: [1, 1, 1, 1, 1], property: 'embedding' },
      similarity: 0.8
    })

    expect(results.count).toEqual(2)
  })

  it('should fail to load IVF data without indexes config', async () => {
    const db = create({
      schema: {
        embedding: 'vector[5]'
      } as const,
      indexes: {
        embedding: ivf({ nlist: 2, nprobe: 2, trainMin: 2 })
      }
    })

    await insertMultiple(db, [{ embedding: [1, 1, 1, 1, 1] }, { embedding: [0, 1, 1, 1, 1] }])
    const serialized = save(db)

    const restored = create({
      schema: {
        embedding: 'vector[5]'
      } as const
    })

    try {
      load(restored, serialized)
      expect.fail('should throw when IVF snapshot is loaded without indexes config')
    } catch (err: any) {
      expect(err.code === 'IVF_INDEX_REQUIRES_FACTORY').toBeTruthy()
    }
  })

  it('should reject reserved schema property names', async () => {
    try {
      create({
        schema: {
          [RESERVED_VECTOR_INDEX_KEY]: 'vector[5]'
        } as const
      })
      expect.fail('should throw for reserved schema property')
    } catch (err: any) {
      expect(err.code === 'RESERVED_SCHEMA_PROPERTY').toBeTruthy()
    }

    try {
      create({
        schema: {
          vectors: {
            [RESERVED_VECTOR_INDEX_KEY]: 'vector[5]'
          }
        } as const
      })
      expect.fail('should throw for nested reserved schema property')
    } catch (err: any) {
      expect(err.code === 'RESERVED_SCHEMA_PROPERTY').toBeTruthy()
    }
  })
})
