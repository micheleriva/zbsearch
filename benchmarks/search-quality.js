// Standardized search-quality benchmark: every engine is run against official
// BEIR test collections (corpus + queries + qrels) and scored with
// trec_eval-compatible metrics.
//
// Datasets (downloaded on first run into .cache/beir/, see src/search-quality/datasets.js):
//   scifact   5,183 docs / 300 test queries / binary qrels
//   nfcorpus  3,633 docs / 323 test queries / graded qrels (1-2)
//   arguana   8,674 docs / 1,406 test queries / binary qrels (1 relevant per query)
//
// Metrics (per query, then averaged): nDCG@10 (BEIR's primary metric), MAP@100,
// Recall@100, P@10, MRR@10. See src/search-quality/metrics.js for exact semantics.
//
// As a sanity guard, ZBSearch (BM25) nDCG@10 is compared against the published
// Lucene BM25 baselines from the BEIR paper (multifield, title + text): landing
// far below them indicates a bug in the harness, not a quality trade-off.
//
// Run with: npm run benchmark:search-quality

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATASETS, loadDataset } from './src/search-quality/datasets.js'
import { engines, FUSE_NOTE } from './src/search-quality/engines.js'
import { evaluateRun } from './src/search-quality/metrics.js'

const RETRIEVAL_LIMIT = 100

// Per-engine time budget for a dataset's query loop. An engine that exceeds it
// is marked as crashed and scores 0: a search engine that cannot answer the
// dataset's queries within the budget has effectively failed the run.
// (Fuse.js completes SciFact/NFCorpus in ~2 min but needs ~45 min on ArguAna.)
const ENGINE_BUDGET_MS = 5 * 60 * 1000

// Published BM25 (Lucene, multifield) nDCG@10 from the BEIR paper / Pyserini 2CR.
const BM25_REFERENCE_NDCG10 = {
  scifact: 0.665,
  nfcorpus: 0.325,
  arguana: 0.414
}
// The tolerance is deliberately wide: tokenizer/analyzer differences (stemming, stopwords, BM25 parameters) legitimately cost several nDCG points vs Lucene.
// This guard only exists to catch catastrophic harness bugs (e.g. broken id mapping or search parameters that silently return nothing).
const SANITY_TOLERANCE = 0.15

const RESULTS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'benchmark', 'results', 'search-quality.json')

function fmt(value) {
  return value.toFixed(3)
}

function printDatasetTable(datasetName, rows) {
  const reference = BM25_REFERENCE_NDCG10[datasetName]
  console.log(`\n### ${datasetName} — nDCG@10 / MAP@100 / R@100 / P@10 / MRR@10 (reference Lucene BM25 nDCG@10: ${reference})\n`)
  console.log('| Engine | nDCG@10 | MAP@100 | R@100 | P@10 | MRR@10 | Build (s) | ms/query |')
  console.log('|---|---|---|---|---|---|---|---|')
  for (const { label, metrics, timing } of rows) {
    const tag = timing.crashed ? ' †' : ''
    const msPerQuery = timing.crashed ? 'crashed' : timing.msPerQuery.toFixed(1)
    console.log(
      `| ${label}${tag} | ${fmt(metrics.ndcg10)} | ${fmt(metrics.map100)} | ${fmt(metrics.recall100)} | ${fmt(metrics.precision10)} | ${fmt(metrics.mrr10)} | ${timing.buildSeconds.toFixed(1)} | ${msPerQuery} |`
    )
  }
  console.log('')
  if (rows.some(({ timing }) => timing.crashed)) {
    console.log(`† crashed = exceeded the ${(ENGINE_BUDGET_MS / 1000).toFixed(0)} s per-engine query budget; scored 0.`)
    console.log('')
  }
  console.log(FUSE_NOTE)
  console.log('')
}

function printMacroTable(perDatasetRows) {
  console.log('\n### Macro average across datasets\n')
  console.log('| Engine | nDCG@10 | MAP@100 | R@100 | P@10 | MRR@10 | ms/query |')
  console.log('|---|---|---|---|---|---|---|')
  for (const { key, label } of engines) {
    const sums = { ndcg10: 0, map100: 0, recall100: 0, precision10: 0, mrr10: 0 }
    let totalQueryMs = 0
    let totalQueries = 0
    for (const rows of Object.values(perDatasetRows)) {
      const row = rows.find((r) => r.key === key)
      for (const metric of Object.keys(sums)) {
        sums[metric] += row.metrics[metric]
      }
      if (row.timing.msPerQuery !== null) {
        totalQueryMs += row.timing.msPerQuery * row.timing.queries
        totalQueries += row.timing.queries
      }
    }
    const n = Object.keys(perDatasetRows).length
    const msPerQuery = totalQueries > 0 ? (totalQueryMs / totalQueries).toFixed(1) : 'crashed'
    console.log(
      `| ${label} | ${fmt(sums.ndcg10 / n)} | ${fmt(sums.map100 / n)} | ${fmt(sums.recall100 / n)} | ${fmt(sums.precision10 / n)} | ${fmt(sums.mrr10 / n)} | ${msPerQuery} |`
    )
  }
  console.log('')
}

const report = {
  description: 'Search quality on BEIR test collections (scifact, nfcorpus, arguana) with trec_eval-compatible metrics',
  metrics: {
    ndcg10: 'trec_eval ndcg_cut.10: linear gain, DCG = sum(rel_i / log2(i + 1)) / IDCG',
    map100: 'trec_eval map_cut.100: AP@100 averaged, denominator = all relevant docs in qrels',
    recall100: 'trec_eval recall.100',
    precision10: 'trec_eval P.10',
    mrr10: 'BEIR custom MRR@10: 1/rank of first relevant hit within top 10'
  },
  retrievalLimit: RETRIEVAL_LIMIT,
  notes: [FUSE_NOTE],
  datasets: {}
}

const perDatasetRows = {}
const warnings = []

// Write the report after every dataset so a crash or timeout never loses
// completed work (Fuse.js makes full runs long).
async function writeReport() {
  report.warnings = warnings
  await mkdir(path.dirname(RESULTS_FILE), { recursive: true })
  await writeFile(RESULTS_FILE, JSON.stringify(report, null, 2))
}

for (const datasetName of Object.keys(DATASETS)) {
  const { documents, queries, qrels } = await loadDataset(datasetName)
  console.log(`\n${datasetName}: ${documents.length} documents, ${queries.length} judged queries`)

  const rows = []
  for (const { key, label, build, search } of engines) {
    const buildStart = performance.now()
    const engine = await build(documents)
    const buildSeconds = (performance.now() - buildStart) / 1000

    const queryStart = performance.now()
    const runs = new Map()
    const details = []
    let crashed = false

    for (const { id, text } of queries) {
      if (performance.now() - queryStart > ENGINE_BUDGET_MS) {
        crashed = true
        break
      }
      const hits = await search(engine, text, RETRIEVAL_LIMIT)
      runs.set(id, hits)
      details.push({ queryId: id, term: text, hits: hits.slice(0, 10) })
    }
    const queryMs = performance.now() - queryStart

    const metrics = crashed ? { ndcg10: 0, map100: 0, recall100: 0, precision10: 0, mrr10: 0 } : evaluateRun(runs, qrels)
    const timing = { buildSeconds, msPerQuery: crashed ? null : queryMs / queries.length, queries: queries.length, crashed }
    rows.push({ key, label, metrics, timing, queries: details })
    console.log(
      crashed
        ? `  ${label}: CRASHED (exceeded ${(ENGINE_BUDGET_MS / 1000).toFixed(0)}s query budget) — scored 0`
        : `  ${label}: nDCG@10 ${fmt(metrics.ndcg10)}  MAP@100 ${fmt(metrics.map100)}  R@100 ${fmt(metrics.recall100)}  (build ${buildSeconds.toFixed(1)}s, ${timing.msPerQuery.toFixed(1)} ms/query)`
    )
  }

  perDatasetRows[datasetName] = rows
  printDatasetTable(datasetName, rows)

  const zbsearchBm25 = rows.find((row) => row.key === 'zbsearch-bm25').metrics
  const reference = BM25_REFERENCE_NDCG10[datasetName]
  if (zbsearchBm25.ndcg10 < reference - SANITY_TOLERANCE) {
    warnings.push(
      `*** WARNING: ZBSearch (BM25) nDCG@10 on ${datasetName} (${fmt(zbsearchBm25.ndcg10)}) is more than ${SANITY_TOLERANCE} below the published Lucene BM25 baseline (${reference}). This suggests a harness bug, not a quality trade-off. ***`
    )
  }

  report.datasets[datasetName] = {
    documents: documents.length,
    queries: queries.length,
    referenceBm25Ndcg10: reference,
    engines: Object.fromEntries(
      rows.map(({ key, label, metrics, timing, queries: details }) => [key, { label, ...metrics, timing, queries: details }])
    )
  }

  await writeReport()
  console.log(`  (partial results written to ${path.relative(process.cwd(), RESULTS_FILE)})`)
}

printMacroTable(perDatasetRows)

for (const warning of warnings) {
  console.log(warning)
}
if (warnings.length > 0) {
  console.log('')
}

await writeReport()
console.log(`Full results written to ${path.relative(process.cwd(), RESULTS_FILE)}`)
