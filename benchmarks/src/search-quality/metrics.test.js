import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  averagePrecisionAtK,
  evaluateRun,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRankAtK
} from './metrics.js'

const TOLERANCE = 1e-9

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < TOLERANCE, `expected ${actual} ≈ ${expected}`)
}

describe('ndcgAtK (trec_eval linear gain)', () => {
  it('uses linear gain and log2(i + 1) discount', () => {
    const qrels = new Map([['a', 2], ['b', 1], ['c', 3]])
    const run = ['c', 'x', 'a']
    // DCG  = 3/log2(2) + 0/log2(3) + 2/log2(4) = 3 + 0 + 1 = 4
    // IDCG = 3/log2(2) + 2/log2(3) + 1/log2(4) = 3 + 1.2618595 + 0.5
    closeTo(ndcgAtK(run, qrels, 10), 4 / (3 + 2 / Math.log2(3) + 0.5))
  })

  it('truncates both DCG and IDCG at k', () => {
    const qrels = new Map([['a', 2], ['b', 1], ['c', 3]])
    // k=1: DCG = rel(c)/log2(2) = 3, IDCG = 3 -> 1.0
    closeTo(ndcgAtK(['c'], qrels, 1), 1)
    closeTo(ndcgAtK(['a'], qrels, 1), 2 / 3)
  })

  it('returns null when IDCG is 0 (no judged relevant docs)', () => {
    assert.equal(ndcgAtK(['a'], new Map([['a', 0]]), 10), null)
  })

  it('treats unjudged docs as 0', () => {
    closeTo(ndcgAtK(['x', 'a'], new Map([['a', 1]]), 10), 1 / Math.log2(3))
  })
})

describe('averagePrecisionAtK (trec_eval map_cut)', () => {
  it('divides by total relevant docs, not by those retrieved within k', () => {
    const qrels = new Map([['a', 1], ['b', 1], ['c', 1], ['d', 1]])
    // run@2 = [a, x]: only P@1 = 1 counts -> AP = 1/4
    closeTo(averagePrecisionAtK(['a', 'x'], qrels, 2), 0.25)
  })

  it('accumulates precision at every relevant rank', () => {
    const qrels = new Map([['a', 1], ['b', 1]])
    // run = [a, x, b]: P@1 = 1, P@3 = 2/3 -> AP = (1 + 2/3) / 2 = 5/6
    closeTo(averagePrecisionAtK(['a', 'x', 'b'], qrels, 10), 5 / 6)
  })

  it('returns null when the query has no relevant docs', () => {
    assert.equal(averagePrecisionAtK(['a'], new Map([['a', 0]]), 10), null)
  })
})

describe('recallAtK / precisionAtK', () => {
  const qrels = new Map([['a', 1], ['b', 2]])

  it('computes recall over all relevant docs', () => {
    closeTo(recallAtK(['a', 'x'], qrels, 2), 0.5)
    closeTo(recallAtK(['a', 'x', 'b'], qrels, 3), 1)
  })

  it('uses k as the precision denominator even for short runs', () => {
    closeTo(precisionAtK(['a'], qrels, 10), 0.1)
  })

  it('counts any positive score as relevant', () => {
    closeTo(precisionAtK(['b'], qrels, 10), 0.1)
  })
})

describe('reciprocalRankAtK (BEIR MRR)', () => {
  it('is 1/rank of the first relevant hit', () => {
    const qrels = new Map([['a', 1]])
    closeTo(reciprocalRankAtK(['x', 'x', 'a'], qrels, 10), 1 / 3)
  })

  it('is 0 on a miss within k', () => {
    const qrels = new Map([['a', 1]])
    assert.equal(reciprocalRankAtK(['x', 'x'], qrels, 2), 0)
    assert.equal(reciprocalRankAtK(['x', 'x', 'a'], qrels, 2), 0)
  })
})

describe('evaluateRun', () => {
  it('averages over judged queries and drops null-metric queries', () => {
    const qrels = new Map([
      ['q1', new Map([['a', 1]])],
      ['q2', new Map([['b', 0]])] // no relevant docs -> dropped from ndcg/map/recall
    ])
    const runs = new Map([
      ['q1', ['a']],
      ['q2', ['a']]
    ])
    const metrics = evaluateRun(runs, qrels)
    closeTo(metrics.ndcg10, 1)
    closeTo(metrics.map100, 1)
    closeTo(metrics.recall100, 1)
    // precision/mrr have no null case: q2's hit 'a' is unjudged -> contributes 0
    closeTo(metrics.precision10, 0.05)
    closeTo(metrics.mrr10, 0.5)
  })

  it('scores queries missing from the run as 0', () => {
    const qrels = new Map([
      ['q1', new Map([['a', 1]])],
      ['q2', new Map([['b', 1]])]
    ])
    const metrics = evaluateRun(new Map([['q1', ['a']]]), qrels)
    closeTo(metrics.ndcg10, 0.5)
    closeTo(metrics.recall100, 0.5)
    closeTo(metrics.mrr10, 0.5)
  })
})
