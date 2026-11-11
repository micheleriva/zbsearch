import { describe, expect, it } from 'vitest'
import { create, insertMultiple, remove, save, load, search, update, type AnyZBSearch } from '../src/index.js'

// sortBy after any sequence of inserts, updates and removals (interleaved with sorts on other properties, saves and
// loads) ranks by the current values of the documents.

function rng(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

describe('sortBy after updates and removals', () => {
  it('ranks by the current values', () => {
    const random = rng(3)
    let next = 0
    // Distinct values, so that the expected order is fully determined
    const value = () => Math.floor(random() * 1e6) * 1000 + next++
    const db = create({ schema: { title: 'string', rank: 'number', label: 'string' } as const }) as AnyZBSearch
    const live = new Map<string, { rank: number; label: string }>()
    const doc = (id: string) => {
      const v = { rank: value(), label: `l${value().toString(36)}` }
      live.set(id, v)
      return { id, title: 'item', ...v }
    }

    insertMultiple(
      db,
      Array.from({ length: 60 }, (_, i) => doc(`d${i}`))
    )
    let db2: AnyZBSearch = db

    const check = () => {
      for (const [property, key] of [
        ['rank', 'rank'],
        ['label', 'label']
      ] as const) {
        for (const order of ['ASC', 'DESC'] as const) {
          const hits = search(db2, { term: 'item', limit: 1000, sortBy: { property, order } }).hits.map((h) => h.id)
          const expected = [...live.entries()]
            .sort(([, a], [, b]) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0))
            .map(([id]) => id)
          if (order === 'DESC') expected.reverse()
          expect(hits, `${property} ${order}`).toStrictEqual(expected)
        }
      }
    }

    for (let round = 0; round < 40; round++) {
      const ids = [...live.keys()]
      const pick = () => ids[Math.floor(random() * ids.length)]
      const action = random()
      if (action < 0.4) {
        const id = pick()
        update(db2, id, doc(id))
      } else if (action < 0.6) {
        const id = pick()
        remove(db2, id)
        live.delete(id)
      } else if (action < 0.8) {
        insertMultiple(db2, [doc(`n${round}`)])
      } else if (action < 0.9) {
        // Sorting one property must not leave stale entries in another
        search(db2, { term: 'item', sortBy: { property: random() < 0.5 ? 'rank' : 'label' } })
      } else {
        const restored = create({ schema: { title: 'string', rank: 'number', label: 'string' } as const })
        load(restored, JSON.parse(JSON.stringify(save(db2))))
        db2 = restored as AnyZBSearch
      }
      // Give the document sorted first an even smaller value
      if (round % 7 === 0) {
        const first = search(db2, { term: 'item', limit: 1, sortBy: { property: 'rank' } }).hits[0].id
        const replacement = doc(first)
        replacement.rank = -next++
        live.get(first)!.rank = replacement.rank
        update(db2, first, replacement)
      }
      check()
    }
  })

  it('does not keep the entries of past values when no sortBy query runs', () => {
    const db = create({ schema: { title: 'string', rank: 'number' } as const }) as AnyZBSearch
    insertMultiple(
      db,
      Array.from({ length: 50 }, (_, i) => ({ id: `d${i}`, title: 'item', rank: i }))
    )
    const orderedDocs = () => (db.data.sorting as any).sorts.rank.orderedDocs.length as number

    // Updates and removals made without a sortBy query or a save in between
    for (let i = 0; i < 20_000; i++) {
      update(db, `d${i % 50}`, { id: `d${i % 50}`, title: 'item', rank: 1_000_000 - i })
      expect(orderedDocs()).toBeLessThanOrEqual(2 * 50 + 1025)
    }
    for (let i = 0; i < 25; i++) remove(db, `d${i}`)

    const expected = Array.from({ length: 25 }, (_, i) => `d${25 + i}`).sort(
      (a, b) => Number(b.slice(1)) - Number(a.slice(1))
    )
    // The last update of d(25 + k) set its rank to 1_000_000 - (19_950 + 25 + k): the larger k, the smaller the rank
    const hits = search(db, { term: 'item', limit: 100, sortBy: { property: 'rank', order: 'ASC' } }).hits.map(
      (h) => h.id
    )
    expect(hits).toStrictEqual(expected)
    expect(orderedDocs()).toBe(25)
  })
})
