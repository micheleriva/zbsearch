import { expectTypeOf } from 'vitest'

/* eslint-disable @typescript-eslint/no-unused-vars */
// https://github.com/oramasearch/orama/issues/538
import { create, search } from '../../src/index.js'

const movieSchema = {
  title: 'string'
} as const
const db = await create({ schema: movieSchema })

interface Movie {
  title: string
  year: number
}

const r = await search<typeof db, Movie>(db, { term: '' })
expectTypeOf(r.hits[0].document.title).toExtend<string>()
expectTypeOf(r.hits[0].document.year).toExtend<number>()
