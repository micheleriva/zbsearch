import { expect } from 'vitest'
import { search, suggest, type AnyZBSearch } from '../../src/index.js'

// Parity of two databases that hold the same documents, one of them (partly) frozen: the standard of the sharded
// parity tests, i.e. the same count, scores within 1e-9 at every rank, and the same ids in the same order except
// for swaps inside groups of tied scores.

const tolerance = (score: number) => 1e-9 * Math.max(1, Math.abs(score))

type Hit = { id: string; score: number }

// The ranking of `params` on `db`, page and full list
export function rank(db: AnyZBSearch, params: Record<string, unknown>) {
  const result = search(db, params as never) as unknown as {
    count: number
    hits: Hit[]
    facets?: unknown
    groups?: Array<{ values: unknown[]; result: Hit[] }>
  }
  const full = search(db, { ...params, offset: 0, limit: Math.max(1, result.count) } as never) as unknown as {
    hits: Hit[]
  }
  return { result, all: full.hits.map(({ id, score }) => ({ id, score })) }
}

export function expectSameRanking(actual: Hit[], expected: Hit[], all: Hit[], offset: number, label: string) {
  expect(actual.length, `hits ${label}`).toBe(expected.length)

  // Groups of tied scores in the full ranking
  const group = new Int32Array(all.length)
  const members: Set<string>[] = []
  for (let j = 0; j < all.length; j++) {
    if (j === 0 || Math.abs(all[j].score - all[j - 1].score) > tolerance(all[j - 1].score)) members.push(new Set())
    group[j] = members.length - 1
    members[members.length - 1].add(all[j].id)
  }

  for (let i = 0; i < expected.length; i++) {
    const a = actual[i]
    const e = expected[i]
    expect(Math.abs(a.score - e.score), `score #${i} ${label}: ${a.score} vs ${e.score}`).toBeLessThanOrEqual(
      tolerance(e.score)
    )
    if (a.id !== e.id) {
      const tied = members[group[offset + i]]
      expect(tied?.has(a.id), `ids at #${i} ${label}: ${a.id} vs ${e.id} (not tied)`).toBe(true)
    }
  }
}

export function expectParity(actualDb: AnyZBSearch, referenceDb: AnyZBSearch, params: Record<string, unknown>) {
  const label = JSON.stringify(params)
  const expected = rank(referenceDb, params)
  const actual = rank(actualDb, params)

  expect(actual.result.count, `count ${label}`).toBe(expected.result.count)
  // With sortBy, documents with the same sort value are ranked by score, so ties work the same way
  expectSameRanking(
    actual.result.hits,
    expected.result.hits,
    expected.all,
    (params.offset as number | undefined) ?? 0,
    label
  )
  expectSameRanking(actual.all, expected.all, expected.all, 0, `${label} (all)`)

  if (params.facets) {
    expect(actual.result.facets, `facets ${label}`).toStrictEqual(expected.result.facets)
  }

  if (params.groupBy) {
    const summarize = (groups: Array<{ values: unknown[]; result: Hit[] }> | undefined) =>
      (groups ?? []).map((g) => ({ values: g.values, ids: g.result.map((h) => h.id).sort() }))
    // Groups keep the first documents of each value in ranking order: compare them where scores are not tied
    expect(summarize(actual.result.groups).map((g) => g.values)).toStrictEqual(
      summarize(expected.result.groups).map((g) => g.values)
    )
  }
}

export function expectSuggestParity(actualDb: AnyZBSearch, referenceDb: AnyZBSearch, term: string, tolerance = 0) {
  const expected = suggest(referenceDb, { term, tolerance, limit: 50 })
  const actual = suggest(actualDb, { term, tolerance, limit: 50 })
  expect(actual.count).toBe(expected.count)
  const byTerm = (s: typeof expected) =>
    Object.fromEntries(s.suggestions.map((x) => [x.suggestion, { count: x.count, score: x.score }]))
  const a = byTerm(actual)
  const e = byTerm(expected)
  expect(Object.keys(a).sort()).toStrictEqual(Object.keys(e).sort())
  for (const key of Object.keys(e)) {
    expect(a[key].count, `${term} ~${tolerance} ${key}`).toBe(e[key].count)
    expect(Math.abs(a[key].score - e[key].score)).toBeLessThanOrEqual(1e-9 * Math.max(1, e[key].score))
  }
}
