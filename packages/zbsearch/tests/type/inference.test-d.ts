/* eslint-disable @typescript-eslint/no-unused-vars */
import { expectAssignable, expectType } from 'tsd'
import { create, insert, search } from '../../src/index.js'
import type { Results, TypedDocument, ZBSearch } from '../../src/types.d.ts'

// Schemaless usage: create() and create({}) are both allowed and return a
// loosely-typed instance.
const schemalessDB = create()
const schemalessDB2 = create({})

// insert accepts any document shape on a schemaless instance
const idP = insert(schemalessDB, { anything: 'goes', nested: { deep: 1 }, list: [1, 2, 3] })
expectType<string | Promise<string>>(idP)

// search stays callable with free-form parameters, results keep their shape
const resultP = search(schemalessDB, { term: 'anything' })
expectAssignable<Results<unknown> | Promise<Results<unknown>>>(resultP)
const result = resultP instanceof Promise ? await resultP : resultP
expectAssignable<string | number>(result.hits[0].id)

// Inference can be explicitly disabled
const strictEmptyDB = create({ inferSchema: false })

// Hybrid usage: declared (vector) fields keep their strong typing while
// undeclared document fields are inferred at runtime.
const hybridDB = create({
  schema: { embedding: 'vector[3]' },
  inferSchema: true
})
expectType<ZBSearch<{ embedding: 'vector[3]' }>>(hybridDB)

const hybridIdP = insert(hybridDB, { embedding: [1, 0, 0], title: 'inferred at runtime' })
expectType<string | Promise<string>>(hybridIdP)

// A full schema without inference keeps the existing strict typing
const movieSchema = { title: 'string', year: 'number' } as const
const movieDB = create({ schema: movieSchema })
expectType<ZBSearch<typeof movieSchema>>(movieDB)
const movieResultP = search(movieDB, { term: 'godfather' })
const movieResult = movieResultP instanceof Promise ? await movieResultP : movieResultP
expectType<string>(movieResult.hits[0].document.title)
