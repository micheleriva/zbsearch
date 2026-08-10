import { describe, expect, it } from 'vitest'
import { boundedLevenshtein, levenshtein, syncBoundedLevenshtein } from '../src/components/levenshtein.js'
import { create } from '../src/methods/create.js'
import { insertMultiple } from '../src/methods/insert.js'
import { search } from '../src/methods/search.js'

it('syncBoundedLevenshtein', async () => {
  // Test exact match
  expect(
    syncBoundedLevenshtein('hello', 'hello', 3),
    'Exact match should return distance 0 and isBounded true'
  ).toEqual({ distance: 0, isBounded: true })

  // Test within tolerance
  expect(
    syncBoundedLevenshtein('hello', 'helo', 2),
    'Strings within tolerance should return correct distance and isBounded true'
  ).toEqual({ distance: 1, isBounded: true })

  // Test at tolerance limit
  expect(
    syncBoundedLevenshtein('hello', 'hllo', 1),
    'Strings at tolerance limit should return correct distance and isBounded true'
  ).toEqual({ distance: 1, isBounded: true })

  // Test beyond tolerance
  expect(
    syncBoundedLevenshtein('hello', 'hi', 1),
    'Strings beyond tolerance should return distance -1 and isBounded false'
  ).toEqual({ distance: -1, isBounded: false })

  // Test empty string
  expect(
    syncBoundedLevenshtein('', 'hello', 5),
    'Empty string should return correct distance and isBounded true if within tolerance'
  ).toEqual({ distance: 5, isBounded: true })

  // Test prefix
  expect(syncBoundedLevenshtein('hel', 'hello', 5), 'Prefix should return distance 0 and isBounded true').toEqual({
    distance: 0,
    isBounded: true
  })

  // Test suffix
  expect(
    syncBoundedLevenshtein('llo', 'hello', 5),
    'Suffix should return correct distance and isBounded true if within tolerance'
  ).toEqual({ distance: 2, isBounded: true })

  // This never happens in the real world: the function accepts tokenized strings
  // so, the stings are always the same case
  // t.same(
  //   syncBoundedLevenshtein('Hello', 'hello', 1),
  //   { distance: 0, isBounded: true },
  //   'Case difference should not be counted in the distance'
  // )

  // Test with tolerance 0
  expect(
    syncBoundedLevenshtein('hello', 'helo', 0),
    'Any difference should return distance -1 and isBounded false when tolerance is 0'
  ).toEqual({ distance: -1, isBounded: false })

  // Test with very large tolerance
  expect(
    syncBoundedLevenshtein('short', 'very long string', 100),
    'Large tolerance should allow for big differences'
  ).toEqual({ distance: 14, isBounded: true })
})

describe('levenshtein', () => {
  it('should be 0 when both inputs are empty', async () => {
    expect(levenshtein('', '')).toBe(0)
  })

  it('should be the max input length when either strings are empty', async () => {
    expect(levenshtein('', 'some')).toBe(4)
    expect(levenshtein('body', '')).toBe(4)
  })

  it('some examples', async () => {
    expect(levenshtein('aa', 'b')).toBe(2)
    expect(levenshtein('b', 'aa')).toBe(2)
    expect(levenshtein('somebody once', 'told me')).toBe(9)
    expect(levenshtein('the world is gonna', 'roll me')).toBe(15)
    expect(levenshtein('kaushuk chadhui', 'caushik chakrabar')).toBe(8)
  })
})

describe('boundedLevenshtein', () => {
  it('should be 0 when both inputs are empty', async () => {
    expect(boundedLevenshtein('', '', 0)).toMatchObject({ distance: 0, isBounded: true })
    expect(boundedLevenshtein('', '', 1)).toMatchObject({ distance: 0, isBounded: true })
  })

  it('should be the max input length when either strings are empty', async () => {
    expect(boundedLevenshtein('', 'some', 0)).toMatchObject({ distance: -1, isBounded: false })

    expect(boundedLevenshtein('', 'some', 4)).toMatchObject({ distance: 4, isBounded: true })
    expect(boundedLevenshtein('body', '', 4)).toMatchObject({ distance: 4, isBounded: true })
  })

  it('should tell whether the Levenshtein distance is upperbounded by a given tolerance', async () => {
    expect(boundedLevenshtein('somebody once', 'told me', 9)).toMatchObject({ isBounded: true })
    expect(boundedLevenshtein('somebody once', 'told me', 8)).toMatchObject({ isBounded: false })
  })
})

it('syncBoundedLevenshtein substrings are ok even if with tolerance pppppp', async () => {
  expect(boundedLevenshtein('Dhris', 'Chris', 0)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Dhris', 'Chris', 1)).toMatchObject({ isBounded: true, distance: 1 })
  expect(boundedLevenshtein('Dhris', 'Cgris', 1)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Dhris', 'Cgris', 2)).toMatchObject({ isBounded: true, distance: 2 })
  expect(boundedLevenshtein('Dhris', 'Cgris', 3)).toMatchObject({ isBounded: true, distance: 2 })

  expect(boundedLevenshtein('Dhris', 'Cris', 0)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Dhris', 'Cris', 1)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Dhris', 'Cris', 2)).toMatchObject({ isBounded: true, distance: 2 })

  expect(boundedLevenshtein('Dhris', 'Caig', 0)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Dhris', 'Caig', 1)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Dhris', 'Caig', 2)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Dhris', 'Caig', 3)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Dhris', 'Caig', 4)).toMatchObject({ isBounded: true, distance: 4 })

  expect(boundedLevenshtein('Chris', 'Chris', 0)).toMatchObject({ isBounded: true, distance: 0 })
  expect(boundedLevenshtein('Chris', 'Chris', 1)).toMatchObject({ isBounded: true, distance: 0 })
  expect(boundedLevenshtein('Chris', 'Chris', 2)).toMatchObject({ isBounded: true, distance: 0 })

  expect(boundedLevenshtein('Chris', 'Cris', 0)).toMatchObject({ isBounded: false, distance: -1 })

  expect(boundedLevenshtein('Chris', 'Cris', 1)).toMatchObject({ isBounded: true, distance: 1 })
  expect(boundedLevenshtein('Chris', 'Cris', 2)).toMatchObject({ isBounded: true, distance: 1 })

  expect(boundedLevenshtein('Chris', 'Caig', 0)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Chris', 'Caig', 1)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Chris', 'Caig', 2)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Chris', 'Caig', 3)).toMatchObject({ isBounded: true, distance: 3 })

  expect(boundedLevenshtein('Craig', 'Caig', 0)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Craig', 'Caig', 1)).toMatchObject({ isBounded: true, distance: 1 })
  expect(boundedLevenshtein('Craig', 'Caig', 2)).toMatchObject({ isBounded: true, distance: 1 })

  expect(boundedLevenshtein('Chxy', 'Cris', 0)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Chxy', 'Cris', 1)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Chxy', 'Cris', 2)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Chxy', 'Cris', 3)).toMatchObject({ isBounded: true, distance: 3 })

  expect(boundedLevenshtein('Chxy', 'Caig', 0)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Chxy', 'Caig', 1)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Chxy', 'Caig', 2)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Chxy', 'Caig', 3)).toMatchObject({ isBounded: true, distance: 3 })

  expect(boundedLevenshtein('Crxy', 'Cris', 0)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Crxy', 'Cris', 1)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Crxy', 'Cris', 2)).toMatchObject({ isBounded: true, distance: 2 })

  expect(boundedLevenshtein('Crxy', 'Caig', 0)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Crxy', 'Caig', 1)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Crxy', 'Caig', 2)).toMatchObject({ isBounded: false, distance: -1 })
  expect(boundedLevenshtein('Crxy', 'Caig', 3)).toMatchObject({ isBounded: true, distance: 3 })

  expect(boundedLevenshtein('Crxy', 'Caig', 3)).toMatchObject({ isBounded: true, distance: 3 })

  expect(boundedLevenshtein('Christopher', 'Chris', 0)).toMatchObject({ isBounded: false, distance: -1 })

  expect(boundedLevenshtein('Christopher', 'Chris', 1)).toMatchObject({ isBounded: false, distance: -1 })
  // To return true, the prefix must be within tolerance
  expect(boundedLevenshtein('Christopher', 'Chris', 'Christopher'.length - 'Chris'.length)).toMatchObject({
    isBounded: true,
    distance: 6
  })
})

// Test cases for https://github.com/oramasearch/orama/issues/744
it('Issue #744', async () => {
  const index = await create({
    schema: {
      libelle: 'string'
    } as const
  })

  const docs = [
    { id: '1', libelle: 'abricot moelleux' },
    { id: '2', libelle: 'moelleux choc bio' },
    { id: '3', libelle: 'crepe moelleuse' },
    { id: '4', libelle: 'os moelle' }
  ]
  await insertMultiple(index, docs)

  const searchTerm = 'moelleux'

  // doc1 and doc2 match searchTerm exactly
  expect(syncBoundedLevenshtein(searchTerm, searchTerm, 0).isBounded).toBe(true)
  // doc3 don't match searchTerm with tolerance 1
  expect(syncBoundedLevenshtein(searchTerm, 'moelleuse', 1).isBounded).toBe(false)
  // but doc3 match searchTerm with tolerance 2 ("x" => "se" are 2 operations)
  expect(syncBoundedLevenshtein(searchTerm, 'moelleuse', 2).isBounded).toBe(true)
  // doc4 don't match searchTerm with tolerance 1
  expect(syncBoundedLevenshtein(searchTerm, 'moelle', 1).isBounded).toBe(false)
  // but doc4 match searchTerm with tolerance 2 ("ux" => "" are 2 operation)
  expect(syncBoundedLevenshtein('moelle', searchTerm, 2).isBounded).toBe(true)

  const s1 = await search(index, {
    term: searchTerm
  })
  expect(s1.count).toBe(2)
  expect(s1.hits.map((h) => h.id)).toStrictEqual(['1', '2'])

  const s2 = await search(index, {
    term: searchTerm,
    tolerance: 0
  })
  expect(s2.count).toBe(2)
  expect(s2.hits.map((h) => h.id)).toStrictEqual(['1', '2'])

  const s3 = await search(index, {
    term: searchTerm,
    tolerance: 1
  })
  expect(s3.count).toBe(2)
  expect(s3.hits.map((h) => h.id)).toStrictEqual(['1', '2'])

  const s4 = await search(index, {
    term: searchTerm,
    tolerance: 2
  })
  expect(s4.count).toBe(4)
  // Exact matches (docs 1-2 contain 'moelleux') outrank fuzzy tolerance-2 matches (docs 3-4): full-token matches always score above expansions.
  expect(s4.hits.map((h) => h.id)).toStrictEqual(['1', '2', '3', '4'])
})

// https://github.com/oramasearch/orama/issues/797
it('Issue #797', async () => {
  const db = await create({
    schema: {
      name: 'string'
    } as const
  })
  await insertMultiple(db, [
    { id: '1', name: 'S' },
    { id: '2', name: 'Scroll' }
  ])

  const res = await search(db, {
    term: 'scrol',
    tolerance: 1
  })

  expect(res.count).toBe(1)
  expect(res.hits[0].id).toBe('2')
})

it('typo tolerance finds matches hidden behind compressed radix edges', async () => {
  const db = await create({
    schema: {
      name: 'string'
    } as const
  })
  await insertMultiple(db, [
    { id: '1', name: 'boosting' },
    { id: '2', name: 'boasting' },
    { id: '3', name: 'boats' }
  ])

  const res = await search(db, {
    term: 'boosting',
    tolerance: 1
  })

  expect(res.count).toBe(2)
  expect(res.hits.map((h) => h.id).sort()).toStrictEqual(['1', '2'])
})
