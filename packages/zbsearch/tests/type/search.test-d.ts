/* eslint-disable @typescript-eslint/no-unused-vars */
import { expectAssignable, expectNotAssignable } from 'tsd'
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

  expectAssignable<MovieSearchParamsProperties>('*')
  expectAssignable<MovieSearchParamsProperties>(['title'])
  expectAssignable<MovieSearchParamsProperties>(['meta.foo'])
  expectNotAssignable<MovieSearchParamsProperties>(['meta.unknown'])
  expectNotAssignable<MovieSearchParamsProperties>(['unknown'])

  // Test search properties type with unknown schema
  {
    type MovieSearchParamsProperties = SearchParamsFullText<ZBSearch<any>>['properties']
    expectAssignable<MovieSearchParamsProperties>('*')
    expectAssignable<MovieSearchParamsProperties>(['title'])
  }
}

// Test boost
{
  type MovieSearchParamsBoost = SearchParamsFullText<ZBSearch<typeof movieSchema>>['boost']

  expectAssignable<MovieSearchParamsBoost>(undefined)
  expectAssignable<MovieSearchParamsBoost>({})
  expectAssignable<MovieSearchParamsBoost>({ title: 1 })
  expectAssignable<MovieSearchParamsBoost>({ 'meta.foo': 1 })
  expectNotAssignable<MovieSearchParamsBoost>({ unknown: 1 })
  expectNotAssignable<MovieSearchParamsBoost>({ 'meta.unknown': 1 })

  // Test search boost type with unknown schema
  {
    type MovieSearchParamsBoost = SearchParamsFullText<ZBSearch<any>>['boost']
    expectAssignable<MovieSearchParamsBoost>(undefined)
    expectAssignable<MovieSearchParamsBoost>({})
    expectAssignable<MovieSearchParamsBoost>({ title: 1 })
  }
}
