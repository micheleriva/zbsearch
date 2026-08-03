import t from 'tap'
import { create, insertMultiple, search, save, load, remove, update } from '../src/index.js'
import { RESERVED_VECTOR_INDEX_KEY } from '../src/constants.js'
import { ivf } from '../src/trees/vector-ivf.js'

t.test('IVF vector index', async (t) => {
  t.test('should return similar vectors using IVF', async (t) => {
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

    t.same(results.count, 2)
  })

  t.test('should support update and remove with IVF', async (t) => {
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
    t.same(afterRemove.count, 1)
    t.same(afterRemove.hits[0].id, id2)

    const newId = await update(db, id2, { embedding: [1, 0, 0, 0, 0] })
    const afterUpdate = await search(db, {
      mode: 'vector',
      vector: { value: [1, 0, 0, 0, 0], property: 'embedding' },
      similarity: 0.99
    })
    t.same(afterUpdate.count, 1)
    t.same(afterUpdate.hits[0].id, newId)
  })

  t.test('should serialize and restore IVF indexes', async (t) => {
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
    t.same(serialized.index.vectorIndexes.embedding.kind, 'ivf')

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

    t.same(results.count, 2)
  })

  t.test('should fail to load IVF data without indexes config', async (t) => {
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
      t.fail('should throw when IVF snapshot is loaded without indexes config')
    } catch (err: any) {
      t.ok(err.code === 'IVF_INDEX_REQUIRES_FACTORY')
    }
  })

  t.test('should reject reserved schema property names', async (t) => {
    try {
      create({
        schema: {
          [RESERVED_VECTOR_INDEX_KEY]: 'vector[5]'
        } as const
      })
      t.fail('should throw for reserved schema property')
    } catch (err: any) {
      t.ok(err.code === 'RESERVED_SCHEMA_PROPERTY')
    }

    try {
      create({
        schema: {
          vectors: {
            [RESERVED_VECTOR_INDEX_KEY]: 'vector[5]'
          }
        } as const
      })
      t.fail('should throw for nested reserved schema property')
    } catch (err: any) {
      t.ok(err.code === 'RESERVED_SCHEMA_PROPERTY')
    }
  })
})
