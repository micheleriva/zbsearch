import { describe, expect, it } from 'vitest'
import { create, freeze, insertMultiple, insertPin, search, type AnyZBSearch } from '../src/index.js'

// A full-text search ranked by score alone only builds the page it returns (the best `offset + limit` results):
// pages, counts and scores must be exactly those of the full ranking.

function rng(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda']

function makeDb(frozen: boolean): AnyZBSearch {
  const random = rng(7)
  const word = () => WORDS[Math.floor(random() * random() * WORDS.length)]
  const db = create({ schema: { title: 'string', body: 'string', n: 'number' } as const }) as AnyZBSearch
  // Enough documents for common terms to match more than the 256 results below which the whole list is sorted
  const docs = Array.from({ length: 1500 }, (_, i) => ({
    id: `${i}`,
    // Every fifth document repeats an earlier one: many tied scores
    title: i % 5 === 0 ? 'alpha beta' : Array.from({ length: 1 + Math.floor(random() * 3) }, word).join(' '),
    body: i % 5 === 0 ? 'gamma' : Array.from({ length: 2 + Math.floor(random() * 8) }, word).join(' '),
    n: i % 10
  }))
  insertMultiple(db, docs as never)
  if (frozen) {
    freeze(db)
  }
  return db
}

// The full ranking, from a search that builds every result (facets need them all) and returns them in one page
function fullRanking(db: AnyZBSearch, params: Record<string, unknown>) {
  const { count } = search(db, { ...params, limit: 0, facets: { n: { ranges: [{ from: 0, to: 10 }] } } } as never) as {
    count: number
  }
  const all = search(db, {
    ...params,
    offset: 0,
    limit: count + 1,
    facets: { n: { ranges: [{ from: 0, to: 10 }] } }
  } as never) as {
    count: number
    hits: { id: string; score: number }[]
  }
  expect(all.hits).toHaveLength(count)
  return all.hits.map(({ id, score }) => ({ id, score }))
}

const TERMS = ['alpha', 'alp', 'beta gamma', 'gamma delta epsilon', 'kapa', 'zzz', '']

describe('top-k full-text search', () => {
  for (const frozen of [false, true]) {
    it(`returns the pages of the full ranking${frozen ? ' (frozen)' : ''}`, () => {
      const db = makeDb(frozen)
      const variants: Record<string, unknown>[] = [
        {},
        { tolerance: 1 },
        { threshold: 0 },
        { properties: ['title'] },
        { boost: { title: 3 } },
        { where: { n: { lt: 4 } } },
        // NaN scores: no consistent order, the page is cut from the fully sorted results
        { relevance: { k: Number.NaN } }
      ]
      for (const term of TERMS) {
        for (const variant of variants) {
          const params = { term, ...variant }
          const all = fullRanking(db, params)
          for (const [offset, limit] of [
            [0, 10],
            [0, 1],
            [3, 7],
            [17, 5],
            [all.length - 2, 10],
            [all.length + 3, 4],
            [0, 0]
          ]) {
            if (offset < 0) continue
            const page = search(db, { ...params, offset, limit } as never) as {
              count: number
              hits: { id: string; score: number }[]
            }
            const label = JSON.stringify({ ...params, offset, limit })
            expect(page.count, label).toBe(all.length)
            expect(
              page.hits.map(({ id, score }) => ({ id, score })),
              label
            ).toStrictEqual(all.slice(offset, offset + limit))
          }
          const preflight = search(db, { ...params, preflight: true } as never) as { count: number; hits: unknown[] }
          expect(preflight.count).toBe(all.length)
          expect(preflight.hits).toStrictEqual([])
        }
      }
    })
  }

  it('still applies pinning rules, which need every result', () => {
    const db = makeDb(true)
    insertPin(db, {
      id: 'pin',
      conditions: [{ anchoring: 'is', pattern: 'gamma' }],
      consequence: { promote: [{ doc_id: '1499', position: 0 }] }
    })
    const page = search(db, { term: 'gamma', limit: 3 }) as { hits: { id: string }[] }
    expect(page.hits[0].id).toBe('1499')
  })
})
