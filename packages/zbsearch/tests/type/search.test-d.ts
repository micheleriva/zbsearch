import { expectTypeOf } from 'vitest'

/* eslint-disable @typescript-eslint/no-unused-vars */
import type { SearchParamsFullText, ZBSearch } from '../../src/types.d.ts'

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

// Test search properties type
{
  type MovieSearchParamsProperties = SearchParamsFullText<ZBSearch<typeof movieSchema>>['properties']

  expectTypeOf('*').toExtend<MovieSearchParamsProperties>()
  expectTypeOf(['title']).toExtend<MovieSearchParamsProperties>()
  expectTypeOf(['meta.foo']).toExtend<MovieSearchParamsProperties>()
  expectTypeOf(['meta.unknown']).not.toExtend<MovieSearchParamsProperties>()
  expectTypeOf(['unknown']).not.toExtend<MovieSearchParamsProperties>()

  // Test search properties type with unknown schema
  {
    type MovieSearchParamsProperties = SearchParamsFullText<ZBSearch<any>>['properties']
    expectTypeOf('*').toExtend<MovieSearchParamsProperties>()
    expectTypeOf(['title']).toExtend<MovieSearchParamsProperties>()
  }
}

// Test boost
{
  type MovieSearchParamsBoost = SearchParamsFullText<ZBSearch<typeof movieSchema>>['boost']

  expectTypeOf(undefined).toExtend<MovieSearchParamsBoost>()
  expectTypeOf({}).toExtend<MovieSearchParamsBoost>()
  expectTypeOf({ title: 1 }).toExtend<MovieSearchParamsBoost>()
  expectTypeOf({ 'meta.foo': 1 }).toExtend<MovieSearchParamsBoost>()
  expectTypeOf({ unknown: 1 }).not.toExtend<MovieSearchParamsBoost>()
  expectTypeOf({ 'meta.unknown': 1 }).not.toExtend<MovieSearchParamsBoost>()

  // Test search boost type with unknown schema
  {
    type MovieSearchParamsBoost = SearchParamsFullText<ZBSearch<any>>['boost']
    expectTypeOf(undefined).toExtend<MovieSearchParamsBoost>()
    expectTypeOf({}).toExtend<MovieSearchParamsBoost>()
    expectTypeOf({ title: 1 }).toExtend<MovieSearchParamsBoost>()
  }
}
