import { expectTypeOf } from 'vitest'

/* eslint-disable @typescript-eslint/no-unused-vars */
import { create, insert, search } from '../../src/index.js'
import type { Results, TypedDocument, ZBSearch } from '../../src/types.d.ts'

// Schemaless usage: create() and create({}) are both allowed and return a
// loosely-typed instance.
const schemalessDB = create()
const schemalessDB2 = create({})

// insert accepts any document shape on a schemaless instance
const idP = insert(schemalessDB, { anything: 'goes', nested: { deep: 1 }, list: [1, 2, 3] })
expectTypeOf(idP).toEqualTypeOf<string | Promise<string>>()

// search stays callable with free-form parameters, results keep their shape
const resultP = search(schemalessDB, { term: 'anything' })
expectTypeOf(resultP).toExtend<Results<unknown> | Promise<Results<unknown>>>()
const result = resultP instanceof Promise ? await resultP : resultP
expectTypeOf(result.hits[0].id).toExtend<string | number>()

// Inference can be explicitly disabled
const strictEmptyDB = create({ inferSchema: false })

// Hybrid usage: declared (vector) fields keep their strong typing while
// undeclared document fields are inferred at runtime.
const hybridDB = create({
  schema: { embedding: 'vector[3]' },
  inferSchema: true
})
expectTypeOf(hybridDB).toEqualTypeOf<ZBSearch<{ embedding: 'vector[3]' }>>()

const hybridIdP = insert(hybridDB, { embedding: [1, 0, 0], title: 'inferred at runtime' })
expectTypeOf(hybridIdP).toEqualTypeOf<string | Promise<string>>()

// A full schema without inference keeps the existing strict typing
const movieSchema = { title: 'string', year: 'number' } as const
const movieDB = create({ schema: movieSchema })
expectTypeOf(movieDB).toEqualTypeOf<ZBSearch<typeof movieSchema>>()
const movieResultP = search(movieDB, { term: 'godfather' })
const movieResult = movieResultP instanceof Promise ? await movieResultP : movieResultP
expectTypeOf(movieResult.hits[0].document.title).toEqualTypeOf<string>()
