import { create, insertMultiple, search } from 'zbsearch'
import type { AnyZBSearch } from 'zbsearch'
import { expect } from 'vitest'
import type { ShardedDatabase, ShardedSearchParams } from '../src/index.js'
import { SCHEMA, type Passage } from './corpus.js'

export async function singleInstance(docs: Passage[], options: Record<string, unknown> = {}): Promise<AnyZBSearch> {
  const db = create({ schema: SCHEMA, ...options } as never) as AnyZBSearch
  // Cloned: the single instance and the sharded database must not share document objects.
  await insertMultiple(db, structuredClone(docs) as never)
  return db
}

export interface Ranked {
  count: number
  hits: { id: string; score: number }[]
}

export interface ExpectedRanking extends Ranked {
  /** Position of the page's first hit in the full ranking. */
  offset: number
  /** The full ranking (offset 0, every match): tied groups may extend past the page on either side. */
  all: { id: string; score: number }[]
}

export async function rankSingle(db: AnyZBSearch, params: ShardedSearchParams): Promise<ExpectedRanking> {
  const result = await search(db, { ...params } as never)
  const full = await search(db, { ...params, offset: 0, limit: Math.max(1, result.count) } as never)
  return {
    count: result.count,
    hits: result.hits.map(({ id, score }) => ({ id, score })),
    offset: params.offset ?? 0,
    all: full.hits.map(({ id, score }) => ({ id, score }))
  }
}

export async function rankSharded(db: ShardedDatabase, params: ShardedSearchParams): Promise<Ranked> {
  const result = await db.search({ ...params })
  return { count: result.count, hits: result.hits.map(({ id, score }) => ({ id, score })) }
}

const tolerance = (score: number) => 1e-9 * Math.max(1, Math.abs(score))

/**
 * Same count, scores equal within float tolerance at every rank, and the same
 * IDs in the same order, except that documents whose scores tie within that
 * tolerance may swap places: shards sum a document's term scores in their own
 * dictionary order, which can move the last bit. A swap must stay inside its
 * tied group of the full ranking; where the group is cut by the page boundary,
 * the page must hold a subset of the group's IDs.
 */
export function expectSameRanking(actual: Ranked, expected: ExpectedRanking, label = ''): void {
  expect(actual.count, `count ${label}`).toBe(expected.count)
  expect(actual.hits.length, `hits ${label}`).toBe(expected.hits.length)

  // Tied groups of the full ranking: neighbours whose scores are equal within tolerance.
  const all = expected.all
  const group = new Int32Array(all.length)
  const members: Set<string>[] = []
  for (let j = 0; j < all.length; j++) {
    if (j === 0 || Math.abs(all[j].score - all[j - 1].score) > tolerance(all[j - 1].score)) members.push(new Set())
    group[j] = members.length - 1
    members[members.length - 1].add(all[j].id)
  }

  const e = expected.hits
  const seen = new Set<string>()
  for (let i = 0; i < e.length; i++) {
    const a = actual.hits[i]
    expect(Math.abs(a.score - e[i].score), `score #${i} ${label}: ${a.score} vs ${e[i].score}`).toBeLessThanOrEqual(
      tolerance(e[i].score)
    )
    expect(seen.has(a.id), `duplicate id ${a.id} at #${i} ${label}`).toBe(false)
    seen.add(a.id)
    if (a.id !== e[i].id) {
      const position = expected.offset + i
      expect(
        Math.abs((all[position]?.score ?? NaN) - e[i].score),
        `full ranking at #${position} ${label}`
      ).toBeLessThanOrEqual(tolerance(e[i].score))
      const tiedIds = members[group[position]]
      expect(tiedIds.has(a.id), `ids at #${i} ${label}: ${a.id} vs ${e[i].id} (not in its tied group)`).toBe(true)
    }
  }
}

export async function expectParity(
  sharded: ShardedDatabase,
  single: AnyZBSearch,
  queries: ShardedSearchParams[]
): Promise<void> {
  for (const params of queries) {
    const label = JSON.stringify(params, (key, value) => (key === 'value' ? '[vector]' : value))
    expectSameRanking(await rankSharded(sharded, params), await rankSingle(single, params), label)
  }
}
