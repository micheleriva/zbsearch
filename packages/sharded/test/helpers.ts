import { create, insertMultiple, search } from 'zbsearch'
import type { AnyZBSearch } from 'zbsearch'
import { expect } from 'vitest'
import type { ShardedDatabase, ShardedSearchParams } from '../src/index.js'
import { SCHEMA, type Passage } from './corpus.js'

export async function singleInstance(docs: Passage[]): Promise<AnyZBSearch> {
  const db = create({ schema: SCHEMA }) as AnyZBSearch
  // Cloned: core search nulls the vectors of the stored documents it returns.
  await insertMultiple(db, structuredClone(docs) as never)
  return db
}

export interface Ranked {
  count: number
  hits: { id: string; score: number }[]
}

export async function rankSingle(db: AnyZBSearch, params: ShardedSearchParams): Promise<Ranked> {
  const result = await search(db, { ...params } as never)
  return { count: result.count, hits: result.hits.map(({ id, score }) => ({ id, score })) }
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
 * dictionary order, which can move the last bit.
 */
export function expectSameRanking(actual: Ranked, expected: Ranked, label = ''): void {
  expect(actual.count, `count ${label}`).toBe(expected.count)
  expect(actual.hits.length, `hits ${label}`).toBe(expected.hits.length)
  const e = expected.hits
  for (let i = 0; i < e.length; i++) {
    const a = actual.hits[i]
    expect(Math.abs(a.score - e[i].score), `score #${i} ${label}: ${a.score} vs ${e[i].score}`).toBeLessThanOrEqual(
      tolerance(e[i].score)
    )
    if (a.id !== e[i].id) {
      // Allowed only inside a group of tied scores (the group may extend past the page).
      const tied = (j: number) => j >= 0 && j < e.length && Math.abs(e[j].score - e[i].score) <= tolerance(e[i].score)
      const atBoundary = i === e.length - 1
      expect(tied(i - 1) || tied(i + 1) || atBoundary, `ids at #${i} ${label}: ${a.id} vs ${e[i].id}`).toBe(true)
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
