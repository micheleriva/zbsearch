#!/usr/bin/env node

// Head-to-head: ZBSearch's sharded static index vs Pagefind.
//
// Both engines index the identical corpus, serve their bundles from the same
// byte-counting HTTP server, and answer the same query battery in headless
// Chromium. Reported per engine: build time, bundle size, initial transfer,
// per-query transfer and latency, and result quality against known target
// documents (exact terms, one-edit typos, prefixes, two-word queries).
//
// Usage: node pagefind-compare.js [--quick] [--pages=10000] [--skip-scale]

import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { buildBattery, gamesCorpus, syntheticCorpus, tokenize } from './src/pagefind/corpus.js'
import { buildPagefind, buildZb, buildZbClient, writeDrivers } from './src/pagefind/build.js'
import { startServer } from './src/pagefind/server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BENCH_DIR = path.join(__dirname, '.pagefind-bench')

const args = process.argv.slice(2)
const QUICK = args.includes('--quick')
const SKIP_SCALE = args.includes('--skip-scale')
const SCALE_PAGES = Number(args.find((a) => a.startsWith('--pages='))?.slice('--pages='.length) ?? 10000)

const kb = (n) => `${(n / 1024).toFixed(1)} KB`
const ms = (n) => `${n.toFixed(0)} ms`
const pct = (n) => `${(n * 100).toFixed(0)}%`

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
}

function normalizeUrl(url) {
  return String(url).replace(/\/+$/, '')
}

async function runSession(browser, port, driver, queries) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const base = `http://127.0.0.1:${port}`

  const stats = async () => await (await page.request.get(`${base}/__stats`)).json()
  const reset = async () => page.request.get(`${base}/__reset`)

  // Counting starts before navigation, so each engine's own JavaScript (and
  // WASM) is part of its initial transfer, wherever in the flow it loads.
  await reset()
  const initT0 = performance.now()
  await page.goto(`${base}/${driver}`)
  await page.waitForFunction(() => typeof window.bench !== 'undefined')
  await page.evaluate(() => window.bench.init())
  const initMs = performance.now() - initT0
  const init = await stats()

  const perQuery = []
  for (const query of queries) {
    const before = await stats()
    const result = await page.evaluate((term) => window.bench.query(term), query.term)
    const after = await stats()
    perQuery.push({
      ...query,
      ms: result.ms,
      bytes: after.bytes - before.bytes,
      requests: after.requests - before.requests,
      urls: result.urls.map(normalizeUrl)
    })
  }

  const total = await stats()
  await context.close()

  return { initMs, initBytes: init.bytes, initRequests: init.requests, totalBytes: total.bytes, perQuery }
}

async function coldQuery(browser, port, driver, term) {
  const { initBytes, perQuery } = await runSession(browser, port, driver, [{ term }])
  return initBytes + perQuery[0].bytes
}

function scoreQuality(perQuery) {
  const byCategory = new Map()
  for (const q of perQuery) {
    if (!q.category) continue
    const bucket = byCategory.get(q.category) ?? { rr: 0, found: 0, n: 0 }
    const rank = q.urls.indexOf(normalizeUrl(q.target))
    bucket.rr += rank >= 0 ? 1 / (rank + 1) : 0
    bucket.found += rank >= 0 ? 1 : 0
    bucket.n += 1
    byCategory.set(q.category, bucket)
  }
  return byCategory
}

function summarize(session) {
  const times = session.perQuery.map((q) => q.ms)
  const bytes = session.perQuery.map((q) => q.bytes)
  const requests = session.perQuery.map((q) => q.requests)
  return {
    initBytes: session.initBytes,
    initRequests: session.initRequests,
    initMs: session.initMs,
    totalBytes: session.totalBytes,
    meanQueryBytes: bytes.reduce((a, b) => a + b, 0) / Math.max(1, bytes.length),
    meanQueryRequests: requests.reduce((a, b) => a + b, 0) / Math.max(1, requests.length),
    p50Ms: percentile(times, 0.5),
    p95Ms: percentile(times, 0.95)
  }
}

function printTable(title, rows) {
  console.log(`\n### ${title}\n`)
  console.log(`| Metric | ZBSearch static | Pagefind |`)
  console.log(`| --- | ---: | ---: |`)
  for (const [metric, zb, pf] of rows) {
    console.log(`| ${metric} | ${zb} | ${pf} |`)
  }
}

async function comparisonRun({ name, records, battery, browser }) {
  const wwwDir = path.join(BENCH_DIR, name, 'www')
  await rm(path.join(BENCH_DIR, name), { recursive: true, force: true })
  await mkdir(wwwDir, { recursive: true })

  console.log(`\n## ${name}: ${records.length} documents, ${battery.length} queries`)

  const zbBuild = await buildZb(records, wwwDir)
  const pfBuild = await buildPagefind(records, wwwDir)
  const { clientBytes } = await buildZbClient(wwwDir)
  await writeDrivers(wwwDir)

  const server = await startServer(wwwDir)

  const zb = await runSession(browser, server.port, 'zbsearch.html', battery)
  const pf = await runSession(browser, server.port, 'pagefind.html', battery)

  // Cold sessions: a fresh page answering a single query.
  const coldTerms = battery.filter((q) => !q.category || q.category === 'exact').slice(0, 3)
  let zbCold = 0
  let pfCold = 0
  for (const q of coldTerms) {
    zbCold += await coldQuery(browser, server.port, 'zbsearch.html', q.term)
    pfCold += await coldQuery(browser, server.port, 'pagefind.html', q.term)
  }
  zbCold /= coldTerms.length
  pfCold /= coldTerms.length

  await server.close()

  const zbSummary = summarize(zb)
  const pfSummary = summarize(pf)

  printTable(`${name} — delivery`, [
    ['Build time', ms(zbBuild.buildMs), ms(pfBuild.buildMs)],
    ['Bundle on disk', kb(zbBuild.bundleBytes + clientBytes), kb(pfBuild.bundleBytes)],
    ['JS runtime (client code)', kb(clientBytes), '~30 KB js + ~75 KB wasm'],
    ['Initial transfer (page + engine + boot)', kb(zbSummary.initBytes), kb(pfSummary.initBytes)],
    ['Cold single query, total transfer', kb(zbCold), kb(pfCold)],
    ['Mean marginal transfer per query', kb(zbSummary.meanQueryBytes), kb(pfSummary.meanQueryBytes)],
    ['Mean requests per query', zbSummary.meanQueryRequests.toFixed(1), pfSummary.meanQueryRequests.toFixed(1)],
    [`Whole session (${battery.length} queries)`, kb(zbSummary.totalBytes), kb(pfSummary.totalBytes)],
    ['Query latency p50', ms(zbSummary.p50Ms), ms(pfSummary.p50Ms)],
    ['Query latency p95', ms(zbSummary.p95Ms), ms(pfSummary.p95Ms)]
  ])

  const zbQuality = scoreQuality(zb.perQuery)
  const pfQuality = scoreQuality(pf.perQuery)

  if (zbQuality.size > 0) {
    console.log(`\n### ${name} — quality (target document, top-5)\n`)
    console.log(`| Category | ZBSearch MRR | ZBSearch found | Pagefind MRR | Pagefind found |`)
    console.log(`| --- | ---: | ---: | ---: | ---: |`)
    for (const category of ['exact', 'typo', 'prefix', 'two words']) {
      const z = zbQuality.get(category)
      const p = pfQuality.get(category)
      if (!z || !p) continue
      console.log(
        `| ${category} (n=${z.n}) | ${(z.rr / z.n).toFixed(2)} | ${pct(z.found / z.n)} | ${(p.rr / p.n).toFixed(2)} | ${pct(p.found / p.n)} |`
      )
    }
  }

  return { name, records: records.length, zbBuild, pfBuild, clientBytes, zbSummary, pfSummary, zbCold, pfCold, zbQuality: [...zbQuality], pfQuality: [...pfQuality] }
}

const browser = await chromium.launch()
const report = { date: new Date().toISOString(), quick: QUICK, runs: [] }

// Part A: real English corpus, with quality scoring.
{
  const records = gamesCorpus()
  const battery = buildBattery(records, QUICK ? 15 : 60)
  report.runs.push(await comparisonRun({ name: 'games-1512', records, battery, browser }))
}

// Part B: scale — transfer and latency at docs-site page counts.
if (!SKIP_SCALE) {
  const records = syntheticCorpus(QUICK ? 2000 : SCALE_PAGES)

  const df = new Map()
  for (const record of records) {
    for (const token of new Set(tokenize(`${record.title} ${record.content}`))) {
      df.set(token, (df.get(token) ?? 0) + 1)
    }
  }
  const terms = [...df.entries()]
  const pick = (filter, n) => terms.filter(([, d]) => filter(d)).slice(0, n).map(([t]) => ({ term: t }))
  const battery = [...pick((d) => d >= 10 && d <= 100, 15), ...pick((d) => d <= 5, 15)]

  report.runs.push(await comparisonRun({ name: `synthetic-${records.length}`, records, battery, browser }))
}

await browser.close()

await mkdir(path.join(BENCH_DIR, 'out'), { recursive: true })
const outFile = path.join(BENCH_DIR, 'out', 'pagefind-compare.json')
await writeFile(outFile, JSON.stringify(report, null, 2))
console.log(`\nJSON report: ${outFile}`)
