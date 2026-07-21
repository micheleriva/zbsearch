#!/usr/bin/env node
/**
 * Orama vs ZBSearch head-to-head comparison.
 *
 * Usage:
 *   node compare.js
 *   node compare.js --format=markdown
 *   node compare.js --format=ascii
 *   node compare.js --format=both
 *   node compare.js --json
 *   node compare.js --quick   # shorter sampling windows for local smoke runs
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runComparisonSuites } from './src/compare/suites.js'
import {
  compareRow,
  toMarkdownTable,
  toAsciiTable,
  summarizeWinners
} from './src/compare/table.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = {
    format: 'both',
    json: false,
    quick: false,
    out: null
  }

  for (const arg of argv) {
    if (arg === '--json') args.json = true
    else if (arg === '--quick') args.quick = true
    else if (arg.startsWith('--format=')) args.format = arg.slice('--format='.length)
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length)
  }

  return args
}

const args = parseArgs(process.argv.slice(2))

console.error('Running Orama vs ZBSearch comparison benchmarks...')
console.error(`Dataset: games index · Node ${process.version} · ${process.platform}/${process.arch}`)
if (args.quick) {
  console.error('Mode: quick (shorter sampling windows)')
}
console.error('')

const suiteOptions = args.quick
  ? { opsDurationMs: 250, opsWarmupMs: 50, indexIterations: 3 }
  : { opsDurationMs: 900, opsWarmupMs: 200, indexIterations: 10 }

const started = performance.now()
const report = runComparisonSuites(suiteOptions)
const elapsedSec = ((performance.now() - started) / 1000).toFixed(1)

const rows = report.results.map((result) =>
  compareRow({
    name: result.name,
    unit: result.unit,
    orama: result.orama,
    zbsearch: result.zbsearch,
    higherIsBetter: result.higherIsBetter
  })
)

const meta = {
  title: 'Orama vs ZBSearch Benchmarks',
  oramaVersion: report.versions.orama,
  zbsearchVersion: report.versions.zbsearch
}

const winners = summarizeWinners(rows)
const markdown = [
  toMarkdownTable(rows, meta),
  '',
  '> Speed metrics are ops/sec (higher is better). Indexing/remove are median latency (lower is better). Memory and bundle sizes are bytes (lower is better).',
  '',
  `**Records:** ${report.records.toLocaleString()} · **Node:** ${report.meta.node} · **Platform:** ${report.meta.platform}`,
  '',
  `**Wins:** ZBSearch ${winners.ZBSearch} · Orama ${winners.Orama} · Ties ${winners.tie}`,
  '',
  `_Completed in ${elapsedSec}s on ${report.meta.date}_`
].join('\n')

const ascii = [
  toAsciiTable(rows, meta),
  '',
  'Speed = ops/sec (higher better) | Indexing/remove = latency (lower better) | Memory/bundle = bytes (lower better)',
  `Records: ${report.records.toLocaleString()}  Node: ${report.meta.node}  Platform: ${report.meta.platform}`,
  `Wins: ZBSearch ${winners.ZBSearch}  Orama ${winners.Orama}  Ties ${winners.tie}`,
  `Completed in ${elapsedSec}s`
].join('\n')

if (args.format === 'markdown' || args.format === 'both') {
  console.log(markdown)
  if (args.format === 'both') console.log('')
}

if (args.format === 'ascii' || args.format === 'both') {
  console.log(ascii)
}

if (args.json || args.out) {
  const payload = {
    ...report,
    table: rows,
    winners,
    elapsedSec: Number(elapsedSec)
  }

  const outPath =
    args.out ??
    join(__dirname, 'benchmark', 'orama-vs-zbsearch.json')

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.error(`\nWrote JSON report to ${outPath}`)
}

// Expose markdown for GitHub Actions step summaries via stdout marker
if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, { flag: 'a' })
}
