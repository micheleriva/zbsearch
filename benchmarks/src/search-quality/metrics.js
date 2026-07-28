// trec_eval-compatible retrieval metrics, as used by BEIR (via pytrec_eval).
//
// Semantics follow the official trec_eval C source:
//   - nDCG@k:   linear gain, DCG = Σ rel_i / log2(i + 1) over 1-based ranks i ≤ k
//               (NOT the 2^rel - 1 variant). IDCG is the same sum over the ideal
//               ordering of all judged docs, truncated at k. Queries with IDCG = 0
//               are dropped from the average.
//   - MAP@k:    map_cut semantics — AP@k = Σ P@r over ranks r ≤ k where rel_r > 0,
//               divided by the TOTAL number of relevant docs in the qrels
//               (not capped at k).
//   - Recall@k: |top-k ∩ relevant| / |relevant|
//   - P@k:      |top-k ∩ relevant| / k   (denominator is k even for shorter runs)
//   - MRR@k:    BEIR's custom metric — 1/rank of the first hit with rel ≥ 1 within
//               the top k, else 0.
//
// `run` is a ranked array of corpus doc ids (best first); `queryQrels` is a
// Map<docId, score>. Unjudged docs count as score 0.

export function ndcgAtK(run, queryQrels, k) {
  let dcg = 0
  const top = run.slice(0, k)
  for (let i = 0; i < top.length; i++) {
    const rel = queryQrels.get(top[i]) ?? 0
    dcg += rel / Math.log2(i + 2)
  }

  const ideal = [...queryQrels.values()].sort((a, b) => b - a).slice(0, k)
  let idcg = 0
  for (let i = 0; i < ideal.length; i++) {
    idcg += ideal[i] / Math.log2(i + 2)
  }

  return idcg === 0 ? null : dcg / idcg
}

export function averagePrecisionAtK(run, queryQrels, k) {
  const relevant = [...queryQrels.values()].filter((score) => score > 0).length
  if (relevant === 0) {
    return null
  }

  let hits = 0
  let precisionSum = 0
  const top = run.slice(0, k)
  for (let i = 0; i < top.length; i++) {
    if ((queryQrels.get(top[i]) ?? 0) > 0) {
      hits++
      precisionSum += hits / (i + 1)
    }
  }

  return precisionSum / relevant
}

export function recallAtK(run, queryQrels, k) {
  const relevant = [...queryQrels.values()].filter((score) => score > 0).length
  if (relevant === 0) {
    return null
  }

  let hits = 0
  for (const docId of run.slice(0, k)) {
    if ((queryQrels.get(docId) ?? 0) > 0) {
      hits++
    }
  }

  return hits / relevant
}

export function precisionAtK(run, queryQrels, k) {
  let hits = 0
  for (const docId of run.slice(0, k)) {
    if ((queryQrels.get(docId) ?? 0) > 0) {
      hits++
    }
  }

  return hits / k
}

export function reciprocalRankAtK(run, queryQrels, k) {
  const top = run.slice(0, k)
  for (let i = 0; i < top.length; i++) {
    if ((queryQrels.get(top[i]) ?? 0) > 0) {
      return 1 / (i + 1)
    }
  }

  return 0
}

function mean(values) {
  const present = values.filter((value) => value !== null)
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) / present.length : 0
}

// perQueryRuns: Map<queryId, string[]>; qrels: Map<queryId, Map<docId, score>>.
// Queries in qrels but missing from the run score 0 (empty ranking).
export function evaluateRun(perQueryRuns, qrels) {
  const ndcg = []
  const map = []
  const recall = []
  const precision = []
  const mrr = []

  for (const [queryId, queryQrels] of qrels) {
    const run = perQueryRuns.get(queryId) ?? []
    ndcg.push(ndcgAtK(run, queryQrels, 10))
    map.push(averagePrecisionAtK(run, queryQrels, 100))
    recall.push(recallAtK(run, queryQrels, 100))
    precision.push(precisionAtK(run, queryQrels, 10))
    mrr.push(reciprocalRankAtK(run, queryQrels, 10))
  }

  return {
    ndcg10: mean(ndcg),
    map100: mean(map),
    recall100: mean(recall),
    precision10: mean(precision),
    mrr10: mean(mrr)
  }
}
