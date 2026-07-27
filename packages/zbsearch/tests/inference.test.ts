import t from 'tap'
import { create, insert, insertMultiple, load, save, search, update, upsert } from '../src/index.js'

t.test('schema inference', async (t) => {
  t.test('infers scalar, array, and nested types from inserted documents', async (t) => {
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

    t.strictSame(db.schema, {
      title: 'string',
      year: 'number',
      active: 'boolean',
      tags: 'string[]',
      ratings: 'number[]',
      meta: { author: 'string' }
    })

    const fulltext = await search(db, { term: 'fox' })
    t.equal(fulltext.count, 1)
    t.equal((fulltext.hits[0].document as any).title, 'The quick brown fox')

    const filtered = await search(db, { term: '', where: { year: { gt: 2021 } } })
    t.equal(filtered.count, 1)

    const boolFiltered = await search(db, { term: '', where: { active: true } })
    t.equal(boolFiltered.count, 1)

    const arrFiltered = await search(db, { term: '', where: { tags: 'fox' } })
    t.equal(arrFiltered.count, 1)

    const nestedFiltered = await search(db, { term: '', where: { 'meta.author': 'john' } })
    t.equal(nestedFiltered.count, 1)
  })

  t.test('supports sortBy, facets, and groupBy on inferred fields', async (t) => {
    const db = create({})

    await insertMultiple(db, [
      { title: 'b doc', year: 2022 },
      { title: 'a doc', year: 2020 },
      { title: 'c doc', year: 2021 }
    ])

    const sorted = await search(db, { term: '', sortBy: { property: 'year', order: 'ASC' } })
    t.strictSame(
      sorted.hits.map((h) => (h.document as any).year),
      [2020, 2021, 2022]
    )

    const sortedStr = await search(db, { term: '', sortBy: { property: 'title', order: 'ASC' } })
    t.strictSame(
      sortedStr.hits.map((h) => (h.document as any).title),
      ['a doc', 'b doc', 'c doc']
    )

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
    t.ok(faceted.facets)
    const bucketCounts = Object.values(faceted.facets!.year.values) as number[]
    t.equal(bucketCounts.length, 2)
    t.equal(
      bucketCounts.reduce((a, b) => a + b, 0),
      3
    )

    const grouped = await search(db, { term: 'doc', groupBy: { properties: ['year'] } })
    t.equal(grouped.groups!.length, 3)
  })

  t.test('defers inference for empty arrays and null/undefined values', async (t) => {
    const db = create({})

    await insert(db, { title: 'first', tags: [], note: null })
    t.strictSame(db.schema, { title: 'string' })

    const before = await search(db, { term: 'first' })
    t.equal(before.count, 1)

    // Filtering on a not-yet-inferred property throws, as with any unknown property
    try {
      await search(db, { term: '', where: { tags: 'x' } })
      t.fail('Should have thrown an error')
    } catch (e) {
      t.equal((e as any).code, 'UNKNOWN_FILTER_PROPERTY')
    }

    await insert(db, { title: 'second', tags: ['x'], note: 'now a string' })
    t.strictSame(db.schema, { title: 'string', tags: 'string[]', note: 'string' })

    const after = await search(db, { term: '', where: { tags: 'x' } })
    t.equal(after.count, 1)
  })

  t.test('infers {lat, lon} objects as geopoints', async (t) => {
    const db = create({})

    await insert(db, { name: 'rome', location: { lat: 41.9028, lon: 12.4964 } })
    await insert(db, { name: 'milan', location: { lat: 45.4642, lon: 9.19 } })
    t.strictSame(db.schema, { name: 'string', location: 'geopoint' })

    const result = await search(db, {
      term: '',
      where: { location: { radius: { coordinates: { lat: 41.9, lon: 12.5 }, value: 50, unit: 'km' } } }
    })
    t.equal(result.count, 1)
    t.equal((result.hits[0].document as any).name, 'rome')
  })

  t.test('locks the type on first sight and rejects conflicting types', async (t) => {
    const db = create({})

    await insert(db, { title: 'first', year: 2023 })

    try {
      await insert(db, { title: 'second', year: 'not a number' })
      t.fail('Should have thrown an error')
    } catch (e) {
      t.equal((e as any).code, 'SCHEMA_VALIDATION_FAILURE')
    }

    // The first document is still searchable, and the type is still number
    const result = await search(db, { term: '', where: { year: { gt: 2000 } } })
    t.equal(result.count, 1)
    t.equal((db.schema as any).year, 'number')
  })

  t.test('infers new fields appearing mid-batch in insertMultiple', async (t) => {
    const db = create({})

    await insertMultiple(db, [{ a: 'first' }, { a: 'second', b: 42 }, { a: 'third', b: 7 }])

    t.strictSame(db.schema, { a: 'string', b: 'number' })

    const result = await search(db, { term: '', where: { b: { gt: 10 } } })
    t.equal(result.count, 1)
    t.equal((result.hits[0].document as any).a, 'second')
  })

  t.test('combines a declared vector field with inferred text fields', async (t) => {
    const db = create({
      schema: { embedding: 'vector[3]' },
      inferSchema: true
    })

    await insert(db, { title: 'vector document', embedding: [1, 0, 0] })
    await insert(db, { title: 'another document', embedding: [0, 1, 0] })

    t.strictSame(db.schema, { embedding: 'vector[3]', title: 'string' })

    const vectorResult = await search(db, {
      mode: 'vector',
      vector: { property: 'embedding', value: [1, 0, 0] }
    })
    // The orthogonal vector is below the default similarity threshold
    t.equal(vectorResult.hits.length, 1)

    const fulltextResult = await search(db, { term: 'vector' })
    t.equal(fulltextResult.count, 1)

    const hybridResult = await search(db, {
      mode: 'hybrid',
      term: 'vector',
      vector: { property: 'embedding', value: [1, 0, 0] }
    })
    t.ok(hybridResult.hits.length >= 1)
  })

  t.test('keeps strict behavior when a schema is provided', async (t) => {
    const db = create({
      schema: { title: 'string' } as const
    })

    await insert(db, { title: 'hello world', extra: 'ignored' })

    t.strictSame(db.schema, { title: 'string' })
    t.notOk((db.data.index as any).indexes.extra)

    const result = await search(db, { term: 'hello' })
    t.equal(result.count, 1)
  })

  t.test('indexes nothing when inference is disabled and no schema is given', async (t) => {
    const db = create({ inferSchema: false })

    await insert(db, { title: 'nothing indexed' })

    t.strictSame(db.schema, {})

    const result = await search(db, { term: 'nothing' })
    t.equal(result.count, 0)
  })

  t.test('preserves inferred fields across save/load and keeps inferring', async (t) => {
    const db = create({})
    await insert(db, { a: 'first', b: 42 })
    await insert(db, { a: 'second', b: 7 })

    const raw = await save(db)

    const restored = create({})
    await load(restored, raw)

    const result = await search(restored, { term: '', where: { b: { gt: 10 } } })
    t.equal(result.count, 1)

    // Inference keeps working on the restored instance
    await insert(restored, { a: 'third', c: true })
    // Known fields are backfilled into the schema lazily, as documents
    // carrying them arrive: "b" is only recorded once a doc contains it.
    t.strictSame(restored.schema, { a: 'string', c: 'boolean' })

    const newField = await search(restored, { term: '', where: { c: true } })
    t.equal(newField.count, 1)

    // Type conflicts are still rejected after a restore
    try {
      await insert(restored, { a: 'fourth', b: 'not a number' })
      t.fail('Should have thrown an error')
    } catch (e) {
      t.equal((e as any).code, 'SCHEMA_VALIDATION_FAILURE')
    }
    t.equal((restored.schema as any).b, 'number')
  })

  t.test('infers new fields through update and upsert', async (t) => {
    const db = create({})

    const id = await insert(db, { title: 'original' })
    await update(db, id, { title: 'updated', views: 10 })

    t.strictSame(db.schema, { title: 'string', views: 'number' })
    const afterUpdate = await search(db, { term: '', where: { views: { gte: 10 } } })
    t.equal(afterUpdate.count, 1)

    await upsert(db, { title: 'upserted', fresh: true })
    t.strictSame(db.schema, { title: 'string', views: 'number', fresh: 'boolean' })

    const afterUpsert = await search(db, { term: '', where: { fresh: true } })
    t.equal(afterUpsert.count, 1)
  })

  t.test('skips the reserved __vector key and the document id', async (t) => {
    const db = create({})

    await insert(db, { id: 'doc-1', __vector: [1, 2, 3], title: 'hello' } as any)

    t.strictSame(db.schema, { title: 'string' })
  })
})
