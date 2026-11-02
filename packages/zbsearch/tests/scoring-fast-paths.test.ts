import { describe, expect, it } from 'vitest'
import { create, insert, insertMultiple, search } from '../src/index.js'
import { calculateResultScores, type Index } from '../src/components/index.js'
import type { RadixTree } from '../src/trees/radix.js'
import type { TokenScore } from '../src/types.js'
import { sortTokenScorePredicate, sortTokenScores } from '../src/utils.js'

const RELEVANCE = { k: 1.2, b: 0.75, d: 0.5 }
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta']

function makeDocs(count: number) {
  const docs: { id: string; title: string; body: string; rank?: number; name?: string }[] = []
  for (let i = 0; i < count; i++) {
    const doc: (typeof docs)[number] = {
      id: `doc-${i}`,
      // Few distinct titles, so many documents tie on their score
      title: `${WORDS[i % 3]} ${WORDS[(i % 5) + 2]}`,
      body: `${WORDS[i % 8]} ${WORDS[(i * 7) % 8]} ${WORDS[(i * 3) % 8]} lorem ipsum`
    }
    if (i % 9 !== 0) {
      doc.rank = (i * 37) % 11
      doc.name = WORDS[(i * 5) % 8]
    }
    docs.push(doc)
  }
  return docs
}

// The scoring and ordering of index.search() spelled out with the public calculateResultScores and a comparator sort
function referenceSearch(
  index: Index,
  tokens: string[],
  properties: string[],
  docsCount: number,
  whereFiltersIDs?: Set<number>
): TokenScore[] {
  const resultsMap = new Map<number, number>()
  for (const prop of properties) {
    const tree = index.indexes[prop].node as RadixTree
    for (const token of tokens) {
      const found = tree.find({ term: token, exact: true, tolerance: 0 })
      for (const word of Object.keys(found)) {
        calculateResultScores(index, prop, word, found[word], docsCount, RELEVANCE, resultsMap, 1, whereFiltersIDs)
      }
    }
  }
  return Array.from(resultsMap.entries()).sort((a, b) => b[1] - a[1])
}

describe('scoring fast paths', () => {
  it('index.search scores and orders like calculateResultScores plus a stable sort, ties included', async () => {
    const db = create({ schema: { title: 'string', body: 'string', rank: 'number', name: 'string' } as const })
    await insertMultiple(db, makeDocs(300))

    const index = db.data.index as Index
    const docsCount = db.data.docs.count

    for (const term of ['alpha', 'gamma', 'alpha beta', 'theta lorem', 'zeta eta gamma']) {
      const tokens = Array.from(new Set(db.tokenizer.tokenize(term)))

      for (const whereFiltersIDs of [undefined, new Set(Array.from({ length: 250 }, (_, i) => 300 - i))]) {
        const actual = db.index.search(
          index,
          term,
          db.tokenizer,
          undefined,
          ['title', 'body'],
          true,
          0,
          {},
          RELEVANCE,
          docsCount,
          whereFiltersIDs,
          1
        )

        expect(actual.length).toBeGreaterThan(64)
        expect(actual).toStrictEqual(referenceSearch(index, tokens, ['title', 'body'], docsCount, whereFiltersIDs))
      }
    }
  })

  it('scores documents inserted after a previous search', async () => {
    const db = create({ schema: { title: 'string', body: 'string' } as const })
    await insertMultiple(db, makeDocs(10))
    expect(search(db, { term: 'alpha' }).count).toBeGreaterThan(0)

    await insertMultiple(
      db,
      makeDocs(500)
        .slice(10)
        .map(({ id, title, body }) => ({ id, title, body }))
    )

    const fresh = create({ schema: { title: 'string', body: 'string' } as const })
    await insertMultiple(
      fresh,
      makeDocs(500).map(({ id, title, body }) => ({ id, title, body }))
    )

    for (const params of [
      { term: 'alpha', limit: 1000 },
      { term: 'alpha beta', threshold: 0.5, limit: 1000 },
      { term: 'theta lorem', threshold: 0, limit: 1000 }
    ]) {
      const expected = search(fresh, params)
      const actual = search(db, params)
      expect(actual.count).toBe(expected.count)
      expect(actual.hits.map((hit) => [hit.id, hit.score])).toStrictEqual(
        expected.hits.map((hit) => [hit.id, hit.score])
      )
    }
  })

  it('keeps the where filter applied once its IDs are marked', async () => {
    const db = create({ schema: { title: 'string', body: 'string', rank: 'number' } as const })
    await insertMultiple(db, makeDocs(400))

    // "lorem" is in every body: far more lookups than filtered documents, so the filter gets marked
    const { hits, count } = search(db, { term: 'lorem ipsum alpha', where: { rank: { eq: 3 } }, limit: 1000 })
    const expectedIds = makeDocs(400)
      .filter((doc) => doc.rank === 3)
      .map((doc) => doc.id)

    expect(count).toBe(expectedIds.length)
    expect(hits.map((hit) => hit.id).sort()).toStrictEqual(expectedIds.sort())
    expect(hits.map((hit) => hit.document.rank)).toStrictEqual(hits.map(() => 3))
  })

  it('sortBy orders by the sorted property, with documents missing it last in score order', async () => {
    const db = create({ schema: { title: 'string', body: 'string', rank: 'number', name: 'string' } as const })
    const docs = makeDocs(200)
    await insertMultiple(db, docs)
    const byId = new Map(docs.map((doc) => [doc.id, doc]))

    for (const order of ['ASC', 'DESC'] as const) {
      for (const property of ['rank', 'name'] as const) {
        const scored = search(db, { term: 'alpha gamma', limit: 1000 })
        const sorted = search(db, { term: 'alpha gamma', limit: 1000, sortBy: { property, order } })

        expect(sorted.count).toBe(scored.count)

        const values = sorted.hits.map((hit) => byId.get(hit.id)![property])
        const firstMissing = values.indexOf(undefined)
        const present = values.slice(0, firstMissing === -1 ? values.length : firstMissing)

        // Every document with the property comes before every document without it
        expect(values.slice(present.length).every((value) => value === undefined)).toBe(true)

        // ...ordered by the property
        for (let i = 1; i < present.length; i++) {
          const compared =
            property === 'rank'
              ? (present[i - 1] as number) - (present[i] as number)
              : (present[i - 1] as string).localeCompare(present[i] as string)
          expect(order === 'ASC' ? compared <= 0 : compared >= 0).toBe(true)
        }

        // ...and documents without it keep their relevance order
        const missingIds = sorted.hits.slice(present.length).map((hit) => hit.id)
        const missingInScoreOrder = scored.hits
          .map((hit) => hit.id)
          .filter((id) => byId.get(id)![property] === undefined)
        expect(missingIds).toStrictEqual(missingInScoreOrder)
      }
    }
  })

  it('sortBy keeps equal string values in insertion order', async () => {
    const db = create({ schema: { name: 'string' } as const })
    await insert(db, { id: 'b2', name: 'b' })
    await insert(db, { id: 'a1', name: 'a' })
    await insert(db, { id: 'b1', name: 'b' })
    await insert(db, { id: 'c', name: 'C' })

    expect(search(db, { sortBy: { property: 'name' } }).hits.map((hit) => hit.id)).toStrictEqual([
      'a1',
      'b2',
      'b1',
      'c'
    ])
    expect(search(db, { sortBy: { property: 'name', order: 'DESC' } }).hits.map((hit) => hit.id)).toStrictEqual([
      'c',
      'b1',
      'b2',
      'a1'
    ])
  })
})

describe('sortTokenScores', () => {
  it('matches sorting with sortTokenScorePredicate on sorted, nearly sorted and shuffled input', () => {
    let seed = 42
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

    for (const length of [0, 1, 2, 5, 31, 32, 33, 64, 200, 1000]) {
      const shuffled: TokenScore[] = Array.from({ length }, () => [
        Math.floor(random() * 10_000),
        Math.floor(random() * 20) / 4
      ])
      // Score order with ties in input order: what index.search() returns
      const byScore = shuffled.slice().sort((a, b) => b[1] - a[1])
      const nearlySorted = byScore.slice()
      for (let i = 0; i + 1 < length; i += 7) {
        ;[nearlySorted[i], nearlySorted[i + 1]] = [nearlySorted[i + 1], nearlySorted[i]]
      }

      const withNaN = byScore.map(([id, score], i): TokenScore => [id, i % 5 === 2 ? NaN : score])

      for (const input of [shuffled, byScore, nearlySorted, byScore.slice().reverse(), withNaN]) {
        expect(sortTokenScores(input.slice())).toStrictEqual(input.slice().sort(sortTokenScorePredicate))
      }
    }
  })
})
