/* eslint-disable @typescript-eslint/no-unused-vars */
import { expectType } from 'tsd'
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
expectType<ZBSearch<typeof movieSchema>>(movieDBP)
const movieDB = movieDBP

const idP = insert(movieDB, {
  title: 'The Godfather',
  year: 1972,
  actors: ['Marlon Brando', 'Al Pacino'],
  isFavorite: true
})
expectType<string | Promise<string>>(idP)

const searchParams: SearchParams<ZBSearch<typeof movieSchema>> = {
  term: 'godfather'
}

const resultP = search(movieDB, searchParams)
expectType<Results<MovieDocument> | Promise<Results<MovieDocument>>>(resultP)
const result = resultP instanceof Promise ? await resultP : resultP
expectType<string>(result.hits[0].document.title)
