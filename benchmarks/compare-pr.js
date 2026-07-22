#!/usr/bin/env node

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPairComparisonSuites } from './src/compare/pair-suites.js'
import {
  loadEngineFromPackageRoot,
  resolveRepoPackage,
  shortSha,
  thisRepoRootFromBenchmarks
} from './src/compare/load-engine.js'
import {
  compareRow,
  toMarkdownTable,
  toAsciiTable,
  summarizeWinners,
  classifyChanges
} from './src/compare/table.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = {
    format: 'markdown',
    json: false,
    quick: false,
    out: null,
    base: null,
    pr: null,
    baseRef: process.env.BENCHMARK_BASE_REF ?? 'base',
    prRef: process.env.BENCHMARK_PR_REF ?? 'pr',
    baseSha: process.env.BENCHMARK_BASE_SHA ?? '',
    prSha: process.env.BENCHMARK_PR_SHA ?? '',
    thresholdPct: Number(process.env.BENCHMARK_REGRESSION_THRESHOLD ?? 5),
    failOnRegression: false
  }

  for (const arg of argv) {
    if (arg === '--json') args.json = true
    else if (arg === '--quick') args.quick = true
    else if (arg === '--fail-on-regression') args.failOnRegression = true
    else if (arg.startsWith('--format=')) args.format = arg.slice('--format='.length)
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length)
    else if (arg.startsWith('--base=')) args.base = arg.slice('--base='.length)
    else if (arg.startsWith('--pr=')) args.pr = arg.slice('--pr='.length)
    else if (arg.startsWith('--base-ref=')) args.baseRef = arg.slice('--base-ref='.length)
    else if (arg.startsWith('--pr-ref=')) args.prRef = arg.slice('--pr-ref='.length)
    else if (arg.startsWith('--base-sha=')) args.baseSha = arg.slice('--base-sha='.length)
    else if (arg.startsWith('--pr-sha=')) args.prSha = arg.slice('--pr-sha='.length)
    else if (arg.startsWith('--threshold=')) {
      args.thresholdPct = Number(arg.slice('--threshold='.length))
    }
  }

  return args
}

const args = parseArgs(process.argv.slice(2))
const repoRoot = thisRepoRootFromBenchmarks()
const baseRoot = args.base ?? process.env.BENCHMARK_BASE_PACKAGE ?? resolveRepoPackage(repoRoot)
const prRoot = args.pr ?? process.env.BENCHMARK_PR_PACKAGE ?? resolveRepoPackage(repoRoot)

if (baseRoot === prRoot) {
  console.error(
    'Error: base and PR package roots are identical. Pass --base= and --pr= (or BENCHMARK_BASE_PACKAGE / BENCHMARK_PR_PACKAGE).'
  )
  process.exit(2)
}

const baseEngine = loadEngineFromPackageRoot(baseRoot)
const prEngine = loadEngineFromPackageRoot(prRoot)

const baseLabel = `base (${args.baseRef}@${shortSha(args.baseSha) || baseEngine.version})`
const prLabel = `PR (${args.prRef}@${shortSha(args.prSha) || prEngine.version})`

console.error('Running base vs PR ZBSearch regression benchmarks...')
console.error(`Base: ${baseLabel}`)
console.error(`      ${baseRoot}`)
console.error(`PR:   ${prLabel}`)
console.error(`      ${prRoot}`)
console.error(`Dataset: games index · Node ${process.version} · ${process.platform}/${process.arch}`)
console.error(`Regression threshold: ${args.thresholdPct}%`)
if (args.quick) {
  console.error('Mode: quick (shorter sampling windows)')
}
console.error('')

const suiteOptions = args.quick
  ? { opsDurationMs: 250, opsWarmupMs: 50, indexIterations: 3 }
  : { opsDurationMs: 900, opsWarmupMs: 200, indexIterations: 10 }

const started = performance.now()
const report = runPairComparisonSuites(
  {
    key: 'base',
    label: 'base',
    version: baseEngine.version,
    lib: baseEngine.lib,
    entry: baseEngine.entry,
    modulePath: baseEngine.root,
    useSort: true
  },
  {
    key: 'pr',
    label: 'PR',
    version: prEngine.version,
    lib: prEngine.lib,
    entry: prEngine.entry,
    modulePath: prEngine.root,
    useSort: true
  },
  suiteOptions
)
const elapsedSec = ((performance.now() - started) / 1000).toFixed(1)

const rows = report.results.map((result) =>
  compareRow({
    name: result.name,
    unit: result.unit,
    higherIsBetter: result.higherIsBetter,
    leftKey: 'base',
    rightKey: 'pr',
    leftLabel: 'base',
    rightLabel: 'PR',
    base: result.base,
    pr: result.pr
  })
)

const winners = summarizeWinners(rows, { left: 'base', right: 'PR' })
const changes = classifyChanges(rows, {
  thresholdPct: args.thresholdPct,
  rightLabel: 'PR'
})

const meta = {
  title: 'PR vs base ZBSearch benchmarks',
  subtitle: `${baseLabel} vs ${prLabel}`,
  leftLabel: baseLabel,
  rightLabel: prLabel,
  leftShort: 'base',
  rightShort: 'PR',
  deltaHeader: 'Δ (PR / base)'
}

const regressionLines =
  changes.regressions.length === 0
    ? ['No regressions beyond the threshold.']
    : changes.regressions.map((r) => `- ❌ **${r.metric}**: ${r.delta} (worse on PR)`)

const improvementLines =
  changes.improvements.length === 0
    ? ['No improvements beyond the threshold.']
    : changes.improvements.map((r) => `- ✅ **${r.metric}**: ${r.delta} (better on PR)`)

const markdown = [
  '<!-- zbsearch-pr-benchmarks -->',
  toMarkdownTable(rows, meta),
  '',
  `> Comparing ZBSearch on this PR against the PR base branch. Threshold for flagged changes: **${args.thresholdPct}%**. Speed = ops/sec (higher better). Indexing/remove = latency (lower better). Memory/bundle = bytes (lower better).`,
  '',
  `**Records:** ${report.records.toLocaleString()} · **Node:** ${report.meta.node} · **Platform:** ${report.meta.platform}`,
  '',
  `**Wins:** PR ${winners.PR ?? 0} · base ${winners.base ?? 0} · Ties ${winners.tie ?? 0}`,
  '',
  `### Regressions (≥ ${args.thresholdPct}% worse)`,
  ...regressionLines,
  '',
  `### Improvements (≥ ${args.thresholdPct}% better)`,
  ...improvementLines,
  '',
  `_Completed in ${elapsedSec}s on ${report.meta.date}_`
].join('\n')

const ascii = [
  toAsciiTable(rows, meta),
  '',
  `Wins: PR ${winners.PR ?? 0}  base ${winners.base ?? 0}  Ties ${winners.tie ?? 0}`,
  `Regressions: ${changes.regressions.length}  Improvements: ${changes.improvements.length}  Threshold: ${args.thresholdPct}%`,
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
    changes,
    refs: {
      base: { ref: args.baseRef, sha: args.baseSha, path: baseRoot, version: baseEngine.version },
      pr: { ref: args.prRef, sha: args.prSha, path: prRoot, version: prEngine.version }
    },
    thresholdPct: args.thresholdPct,
    elapsedSec: Number(elapsedSec)
  }

  const outPath = args.out ?? join(__dirname, 'benchmark', 'pr-vs-base.json')
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.error(`\nWrote JSON report to ${outPath}`)
}

if (process.env.GITHUB_STEP_SUMMARY) {
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, { flag: 'a' })
}

if (args.failOnRegression && changes.regressions.length > 0) {
  console.error(
    `\nFailing: ${changes.regressions.length} regression(s) beyond ${args.thresholdPct}% threshold.`
  )
  process.exit(1)
}
