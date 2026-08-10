import { expectTypeOf } from 'vitest'

/* eslint-disable @typescript-eslint/no-unused-vars */
import { suggest } from '../../src/index.js'
import type { SuggestParams, SuggestResults, ZBSearch } from '../../src/types.d.ts'

const movieSchema = {
  title: 'string',
  year: 'number',
  actors: 'string[]',
  isFavorite: 'boolean',
  stars: 'enum',
  meta: {
    foo: 'string'
  }
} as const

type MovieDB = ZBSearch<typeof movieSchema>

// Test suggest properties type
{
  type MovieSuggestParamsProperties = SuggestParams<MovieDB>['properties']

  expectTypeOf('*').toExtend<MovieSuggestParamsProperties>()
  expectTypeOf(['title']).toExtend<MovieSuggestParamsProperties>()
  expectTypeOf(['meta.foo']).toExtend<MovieSuggestParamsProperties>()
  expectTypeOf(['meta.unknown']).not.toExtend<MovieSuggestParamsProperties>()
  expectTypeOf(['unknown']).not.toExtend<MovieSuggestParamsProperties>()
}

// Test suggest boost type
{
  type MovieSuggestParamsBoost = SuggestParams<MovieDB>['boost']

  expectTypeOf(undefined).toExtend<MovieSuggestParamsBoost>()
  expectTypeOf({ title: 1 }).toExtend<MovieSuggestParamsBoost>()
  expectTypeOf({ 'meta.foo': 1 }).toExtend<MovieSuggestParamsBoost>()
  expectTypeOf({ unknown: 1 }).not.toExtend<MovieSuggestParamsBoost>()
}

// Test suggest prefix type
{
  type MovieSuggestParamsPrefix = SuggestParams<MovieDB>['prefix']

  expectTypeOf(true).toExtend<MovieSuggestParamsPrefix>()
  expectTypeOf(false).toExtend<MovieSuggestParamsPrefix>()
  expectTypeOf('last').toExtend<MovieSuggestParamsPrefix>()
  expectTypeOf('first').not.toExtend<MovieSuggestParamsPrefix>()
}

// Test suggest where type
{
  type MovieSuggestParamsWhere = SuggestParams<MovieDB>['where']

  expectTypeOf({ year: { gt: 2000 } }).toExtend<MovieSuggestParamsWhere>()
  expectTypeOf({ isFavorite: true }).toExtend<MovieSuggestParamsWhere>()
  expectTypeOf({ unknown: true }).not.toExtend<MovieSuggestParamsWhere>()
}

// Test suggest results
{
  const db = null as unknown as MovieDB
  const results = suggest(db, { term: 'the god' })

  expectTypeOf(results).toEqualTypeOf<SuggestResults>()
  expectTypeOf(results.count).toEqualTypeOf<number>()
  expectTypeOf(results.suggestions[0].suggestion).toEqualTypeOf<string>()
  expectTypeOf(results.suggestions[0].terms).toEqualTypeOf<string[]>()
  expectTypeOf(results.suggestions[0].score).toEqualTypeOf<number>()
  expectTypeOf(results.suggestions[0].count).toEqualTypeOf<number>()
}
