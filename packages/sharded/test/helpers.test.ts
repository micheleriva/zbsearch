import { describe, expect, it } from 'vitest'
import { expectSameRanking, type ExpectedRanking, type Ranked } from './helpers.js'

const hit = (id: string, score: number) => ({ id, score })

// Full ranking: a, then b/c/d tied, then e.
const ALL = [hit('a', 3), hit('b', 2), hit('c', 2), hit('d', 2), hit('e', 1)]

function expected(offset: number, limit: number): ExpectedRanking {
  return { count: ALL.length, hits: ALL.slice(offset, offset + limit), offset, all: ALL }
}

const page = (...hits: { id: string; score: number }[]): Ranked => ({ count: ALL.length, hits })

describe('expectSameRanking', () => {
  it('accepts swaps inside a tied group, also where the page cuts the group', () => {
    expectSameRanking(page(hit('a', 3), hit('c', 2), hit('b', 2), hit('d', 2)), expected(0, 4))
    expectSameRanking(page(hit('a', 3), hit('d', 2)), expected(0, 2))
    expectSameRanking(page(hit('c', 2), hit('e', 1)), expected(3, 2))
  })

  it('rejects an id outside the tied group at the page boundary', () => {
    expect(() => expectSameRanking(page(hit('a', 3), hit('e', 2)), expected(0, 2))).toThrow()
    expect(() => expectSameRanking(page(hit('a', 3), hit('b', 2), hit('x', 2)), expected(0, 3))).toThrow()
  })

  it('rejects an id from a different group beside tied scores', () => {
    expect(() => expectSameRanking(page(hit('a', 3), hit('b', 2), hit('e', 2), hit('d', 2)), expected(0, 4))).toThrow()
  })

  it('rejects duplicates', () => {
    expect(() => expectSameRanking(page(hit('a', 3), hit('b', 2), hit('b', 2)), expected(0, 3))).toThrow()
  })
})
