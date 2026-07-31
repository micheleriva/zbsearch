/* eslint-disable @typescript-eslint/no-unused-vars */
import { expectAssignable, expectNotAssignable, expectType } from 'tsd'
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

  expectAssignable<MovieSuggestParamsProperties>('*')
  expectAssignable<MovieSuggestParamsProperties>(['title'])
  expectAssignable<MovieSuggestParamsProperties>(['meta.foo'])
  expectNotAssignable<MovieSuggestParamsProperties>(['meta.unknown'])
  expectNotAssignable<MovieSuggestParamsProperties>(['unknown'])
}

// Test suggest boost type
{
  type MovieSuggestParamsBoost = SuggestParams<MovieDB>['boost']

  expectAssignable<MovieSuggestParamsBoost>(undefined)
  expectAssignable<MovieSuggestParamsBoost>({ title: 1 })
  expectAssignable<MovieSuggestParamsBoost>({ 'meta.foo': 1 })
  expectNotAssignable<MovieSuggestParamsBoost>({ unknown: 1 })
}

// Test suggest prefix type
{
  type MovieSuggestParamsPrefix = SuggestParams<MovieDB>['prefix']

  expectAssignable<MovieSuggestParamsPrefix>(true)
  expectAssignable<MovieSuggestParamsPrefix>(false)
  expectAssignable<MovieSuggestParamsPrefix>('last')
  expectNotAssignable<MovieSuggestParamsPrefix>('first')
}

// Test suggest where type
{
  type MovieSuggestParamsWhere = SuggestParams<MovieDB>['where']

  expectAssignable<MovieSuggestParamsWhere>({ year: { gt: 2000 } })
  expectAssignable<MovieSuggestParamsWhere>({ isFavorite: true })
  expectNotAssignable<MovieSuggestParamsWhere>({ unknown: true })
}

// Test suggest results
{
  const db = null as unknown as MovieDB
  const results = suggest(db, { term: 'the god' })

  expectType<SuggestResults>(results)
  expectType<number>(results.count)
  expectType<string>(results.suggestions[0].suggestion)
  expectType<string[]>(results.suggestions[0].terms)
  expectType<number>(results.suggestions[0].score)
  expectType<number>(results.suggestions[0].count)
}
