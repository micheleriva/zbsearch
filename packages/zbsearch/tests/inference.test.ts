import { describe, expect, it } from 'vitest'
import { create, insert, insertMultiple, load, save, search, update, upsert } from '../src/index.js'

describe('schema inference', () => {
  it('infers scalar, array, and nested types from inserted documents', async () => {
    const db = create({})

    await insert(db, {
      title: 'The quick brown fox',
      year: 2023,
      active: true,
      tags: ['fox', 'animal'],
      ratings: [4, 5],
      meta: { author: 'john' }
    })
    await insert(db, {
      title: 'The lazy dog',
      year: 2020,
      active: false,
      tags: ['dog'],
      ratings: [3],
      meta: { author: 'jane' }
    })

    expect(db.schema).toStrictEqual({
      title: 'string',
      year: 'number',
      active: 'boolean',
      tags: 'string[]',
      ratings: 'number[]',
      meta: { author: 'string' }
    })

    const fulltext = await search(db, { term: 'fox' })
    expect(fulltext.count).toBe(1)
    expect((fulltext.hits[0].document as any).title).toBe('The quick brown fox')

    const filtered = await search(db, { term: '', where: { year: { gt: 2021 } } })
    expect(filtered.count).toBe(1)

    const boolFiltered = await search(db, { term: '', where: { active: true } })
    expect(boolFiltered.count).toBe(1)

    const arrFiltered = await search(db, { term: '', where: { tags: 'fox' } })
    expect(arrFiltered.count).toBe(1)

    const nestedFiltered = await search(db, { term: '', where: { 'meta.author': 'john' } })
    expect(nestedFiltered.count).toBe(1)
  })

  it('supports sortBy, facets, and groupBy on inferred fields', async () => {
    const db = create({})

    await insertMultiple(db, [
      { title: 'b doc', year: 2022 },
      { title: 'a doc', year: 2020 },
      { title: 'c doc', year: 2021 }
    ])

    const sorted = await search(db, { term: '', sortBy: { property: 'year', order: 'ASC' } })
    expect(sorted.hits.map((h) => (h.document as any).year)).toStrictEqual([2020, 2021, 2022])

    const sortedStr = await search(db, { term: '', sortBy: { property: 'title', order: 'ASC' } })
    expect(sortedStr.hits.map((h) => (h.document as any).title)).toStrictEqual(['a doc', 'b doc', 'c doc'])

    const faceted = await search(db, {
      term: 'doc',
      facets: {
        year: {
          ranges: [
            { from: 2019, to: 2020.5 },
            { from: 2020.5, to: 2022.5 }
          ]
        }
      }
    })
    expect(faceted.facets).toBeTruthy()
    const bucketCounts = Object.values(faceted.facets!.year.values) as number[]
    expect(bucketCounts.length).toBe(2)
    expect(bucketCounts.reduce((a, b) => a + b, 0)).toBe(3)

    const grouped = await search(db, { term: 'doc', groupBy: { properties: ['year'] } })
    expect(grouped.groups!.length).toBe(3)
  })

  it('defers inference for empty arrays and null/undefined values', async () => {
    const db = create({})

    await insert(db, { title: 'first', tags: [], note: null })
    expect(db.schema).toStrictEqual({ title: 'string' })

    const before = await search(db, { term: 'first' })
    expect(before.count).toBe(1)

    // Filtering on a not-yet-inferred property throws, as with any unknown property
    try {
      await search(db, { term: '', where: { tags: 'x' } })
      expect.fail('Should have thrown an error')
    } catch (e) {
      expect((e as any).code).toBe('UNKNOWN_FILTER_PROPERTY')
    }

    await insert(db, { title: 'second', tags: ['x'], note: 'now a string' })
    expect(db.schema).toStrictEqual({ title: 'string', tags: 'string[]', note: 'string' })

    const after = await search(db, { term: '', where: { tags: 'x' } })
    expect(after.count).toBe(1)
  })

  it('infers {lat, lon} objects as geopoints', async () => {
    const db = create({})

    await insert(db, { name: 'rome', location: { lat: 41.9028, lon: 12.4964 } })
    await insert(db, { name: 'milan', location: { lat: 45.4642, lon: 9.19 } })
    expect(db.schema).toStrictEqual({ name: 'string', location: 'geopoint' })

    const result = await search(db, {
      term: '',
      where: { location: { radius: { coordinates: { lat: 41.9, lon: 12.5 }, value: 50, unit: 'km' } } }
    })
    expect(result.count).toBe(1)
    expect((result.hits[0].document as any).name).toBe('rome')
  })

  it('locks the type on first sight and rejects conflicting types', async () => {
    const db = create({})

    await insert(db, { title: 'first', year: 2023 })

    try {
      await insert(db, { title: 'second', year: 'not a number' })
      expect.fail('Should have thrown an error')
    } catch (e) {
      expect((e as any).code).toBe('SCHEMA_VALIDATION_FAILURE')
    }

    // The first document is still searchable, and the type is still number
    const result = await search(db, { term: '', where: { year: { gt: 2000 } } })
    expect(result.count).toBe(1)
    expect((db.schema as any).year).toBe('number')
  })

  it('infers new fields appearing mid-batch in insertMultiple', async () => {
    const db = create({})

    await insertMultiple(db, [{ a: 'first' }, { a: 'second', b: 42 }, { a: 'third', b: 7 }])

    expect(db.schema).toStrictEqual({ a: 'string', b: 'number' })

    const result = await search(db, { term: '', where: { b: { gt: 10 } } })
    expect(result.count).toBe(1)
    expect((result.hits[0].document as any).a).toBe('second')
  })

  it('combines a declared vector field with inferred text fields', async () => {
    const db = create({
      schema: { embedding: 'vector[3]' },
      inferSchema: true
    })

    await insert(db, { title: 'vector document', embedding: [1, 0, 0] })
    await insert(db, { title: 'another document', embedding: [0, 1, 0] })

    expect(db.schema).toStrictEqual({ embedding: 'vector[3]', title: 'string' })

    const vectorResult = await search(db, {
      mode: 'vector',
      vector: { property: 'embedding', value: [1, 0, 0] }
    })
    // The orthogonal vector is below the default similarity threshold
    expect(vectorResult.hits.length).toBe(1)

    const fulltextResult = await search(db, { term: 'vector' })
    expect(fulltextResult.count).toBe(1)

    const hybridResult = await search(db, {
      mode: 'hybrid',
      term: 'vector',
      vector: { property: 'embedding', value: [1, 0, 0] }
    })
    expect(hybridResult.hits.length >= 1).toBeTruthy()
  })

  it('keeps strict behavior when a schema is provided', async () => {
    const db = create({
      schema: { title: 'string' } as const
    })

    await insert(db, { title: 'hello world', extra: 'ignored' })

    expect(db.schema).toStrictEqual({ title: 'string' })
    expect((db.data.index as any).indexes.extra).toBeFalsy()

    const result = await search(db, { term: 'hello' })
    expect(result.count).toBe(1)
  })

  it('indexes nothing when inference is disabled and no schema is given', async () => {
    const db = create({ inferSchema: false })

    await insert(db, { title: 'nothing indexed' })

    expect(db.schema).toStrictEqual({})

    const result = await search(db, { term: 'nothing' })
    expect(result.count).toBe(0)
  })

  it('preserves inferred fields across save/load and keeps inferring', async () => {
    const db = create({})
    await insert(db, { a: 'first', b: 42 })
    await insert(db, { a: 'second', b: 7 })

    const raw = await save(db)

    const restored = create({})
    await load(restored, raw)

    const result = await search(restored, { term: '', where: { b: { gt: 10 } } })
    expect(result.count).toBe(1)

    // Inference keeps working on the restored instance
    await insert(restored, { a: 'third', c: true })
    // Known fields are backfilled into the schema lazily, as documents
    // carrying them arrive: "b" is only recorded once a doc contains it.
    expect(restored.schema).toStrictEqual({ a: 'string', c: 'boolean' })

    const newField = await search(restored, { term: '', where: { c: true } })
    expect(newField.count).toBe(1)

    // Type conflicts are still rejected after a restore
    try {
      await insert(restored, { a: 'fourth', b: 'not a number' })
      expect.fail('Should have thrown an error')
    } catch (e) {
      expect((e as any).code).toBe('SCHEMA_VALIDATION_FAILURE')
    }
    expect((restored.schema as any).b).toBe('number')
  })

  it('infers new fields through update and upsert', async () => {
    const db = create({})

    const id = await insert(db, { title: 'original' })
    await update(db, id, { title: 'updated', views: 10 })

    expect(db.schema).toStrictEqual({ title: 'string', views: 'number' })
    const afterUpdate = await search(db, { term: '', where: { views: { gte: 10 } } })
    expect(afterUpdate.count).toBe(1)

    await upsert(db, { title: 'upserted', fresh: true })
    expect(db.schema).toStrictEqual({ title: 'string', views: 'number', fresh: 'boolean' })

    const afterUpsert = await search(db, { term: '', where: { fresh: true } })
    expect(afterUpsert.count).toBe(1)
  })

  it('skips the reserved __vector key and the document id', async () => {
    const db = create({})

    await insert(db, { id: 'doc-1', __vector: [1, 2, 3], title: 'hello' } as any)

    expect(db.schema).toStrictEqual({ title: 'string' })
  })

  describe('rejects documents whose shape conflicts with a locked property path', () => {
    it('scalar first, then nested object at the same path', async () => {
      const db = create({})

      await insert(db, { a: 'scalar', keep: true })

      try {
        await insert(db, { a: { b: 1 } })
        expect.fail('Should have thrown an error')
      } catch (e) {
        expect((e as any).code).toBe('SCHEMA_VALIDATION_FAILURE')
      }

      // The schema is not corrupted by the rejected document
      expect(db.schema).toStrictEqual({ a: 'string', keep: 'boolean' })
      expect((db.data.index as any).indexes['a.b']).toBeFalsy()

      const result = await search(db, { term: 'scalar' })
      expect(result.count).toBe(1)
    })

    it('nested object first, then scalar at the parent path', async () => {
      const db = create({})

      await insert(db, { a: { b: 1 } })

      try {
        await insert(db, { a: 'scalar' })
        expect.fail('Should have thrown an error')
      } catch (e) {
        expect((e as any).code).toBe('SCHEMA_VALIDATION_FAILURE')
      }

      expect(db.schema).toStrictEqual({ a: { b: 'number' } })

      const result = await search(db, { term: '', where: { 'a.b': { eq: 1 } } })
      expect(result.count).toBe(1)
    })
  })

  it('respects unsortableProperties for inferred fields, across save/load', async () => {
    const db = create({
      sort: { unsortableProperties: ['b'] }
    })

    await insert(db, { a: 'first', b: 42 })

    // "b" was inferred and indexed, but not made sortable
    expect((db.data.index as any).indexes.b).toBeTruthy()
    expect((db.data.sorting as any).sorts.b).toBeFalsy()

    const raw = await save(db)
    const restored = create({})
    await load(restored, raw)

    // The deny list survives the round trip: new docs still can't sort by "b"
    await insert(restored, { a: 'second', b: 7 })
    expect((restored.data.sorting as any).sorts.b).toBeFalsy()

    try {
      await search(restored, { term: '', sortBy: { property: 'b', order: 'ASC' } })
      expect.fail('Should have thrown an error')
    } catch (e) {
      expect((e as any).code).toBe('UNABLE_TO_SORT_ON_UNKNOWN_FIELD')
    }

    const result = await search(restored, { term: '', sortBy: { property: 'a', order: 'DESC' } })
    expect(result.hits.map((h) => (h.document as any).a)).toStrictEqual(['second', 'first'])
  })
})
