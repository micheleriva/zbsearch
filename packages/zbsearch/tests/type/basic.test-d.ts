import { expectTypeOf } from 'vitest'

/* eslint-disable @typescript-eslint/no-unused-vars */
import type { ZBSearch, Results, SearchParams, TypedDocument } from '../../src/types.d.ts'
import { create, insert, search } from '../../src/index.js'

const movieSchema = {
  title: 'string',
  year: 'number',
  actors: 'string[]',
  isFavorite: 'boolean',
  stars: 'enum'
} as const
type MovieDocument = TypedDocument<ZBSearch<typeof movieSchema>>

const movieDBP = create({
  schema: movieSchema
})
expectTypeOf(movieDBP).toEqualTypeOf<ZBSearch<typeof movieSchema>>()
const movieDB = movieDBP

// The store option does not change the database type
const unstoredMovieDB = create({ schema: movieSchema, store: { exclude: ['actors'], vectors: false } })
expectTypeOf(unstoredMovieDB).toEqualTypeOf<ZBSearch<typeof movieSchema>>()
expectTypeOf(unstoredMovieDB.store).toEqualTypeOf<{ exclude: string[]; vectors: boolean } | undefined>()

const idP = insert(movieDB, {
  title: 'The Godfather',
  year: 1972,
  actors: ['Marlon Brando', 'Al Pacino'],
  isFavorite: true
})
expectTypeOf(idP).toEqualTypeOf<string | Promise<string>>()

const searchParams: SearchParams<ZBSearch<typeof movieSchema>> = {
  term: 'godfather'
}

const resultP = search(movieDB, searchParams)
expectTypeOf(resultP).toEqualTypeOf<Results<MovieDocument> | Promise<Results<MovieDocument>>>()
const result = resultP instanceof Promise ? await resultP : resultP
expectTypeOf(result.hits[0].document.title).toEqualTypeOf<string>()
