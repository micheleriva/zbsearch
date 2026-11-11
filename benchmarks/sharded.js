// Memory and cold/warm latency of @zbsearch/sharded on a large passage corpus
// with vectors (issue #82).
//
//   pnpm --filter zbsearch build && pnpm --filter @zbsearch/sharded build
//   cd benchmarks
//   node --expose-gc --max-old-space-size=3072 sharded.js --docs=200000 --dims=384 --budget=300
//
// Options: --docs, --dims, --budget (MB), --shard-docs, --dir (storage
// directory, default under the OS temp dir), --reuse (skip the build when the
// directory already holds a database), --parity (also build a single in-memory
// instance and compare top-10 rankings: only for corpora that fit in memory),
// --json=<file>.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create, insertMultiple, search } from 'zbsearch'
import { openShardedDatabase } from '../packages/sharded/dist/index.js'
import { FileSystemStorage } from '../packages/sharded/dist/node.js'
import { passages, rng, shardedSchema, vocabulary } from './src/sharded-corpus.js'

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=')
    return [key, value ?? 'true']
  })
)

const DOCS = Number(args.docs ?? 200_000)
const DIMS = Number(args.dims ?? 384)
const BUDGET = Number(args.budget ?? 300) * 1024 * 1024
const SHARD_DOCS = Number(args['shard-docs'] ?? 1000)
const DIR = args.dir ?? join(tmpdir(), `zbsearch-sharded-bench-${DOCS}-${DIMS}`)
const SAMPLES = Number(args.samples ?? 8)

if (typeof global.gc !== 'function') {
  console.error('Run with node --expose-gc')
  process.exit(1)
}

const MB = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10

function heapAfterGc() {
  global.gc()
  global.gc()
  return process.memoryUsage().heapUsed
}

let peakHeap = 0
const sampler = setInterval(() => {
  peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed)
}, 20)
sampler.unref()

function dirBytes(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    total += entry.isDirectory() ? dirBytes(full) : statSync(full).size
  }
  return total
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

function summary(values) {
  return {
    median: Math.round(percentile(values, 50) * 10) / 10,
    p95: Math.round(percentile(values, 95) * 10) / 10,
    n: values.length
  }
}

const report = {
  config: { docs: DOCS, dims: DIMS, budgetMB: MB(BUDGET), shardDocs: SHARD_DOCS, node: process.version },
  build: {},
  memory: {},
  latency: {}
}

function options() {
  return {
    schema: shardedSchema(DIMS),
    storage: new FileSystemStorage(DIR),
    partitionBy: 'itemKey',
    packPartitions: true,
    maxDocsPerShard: SHARD_DOCS,
    memoryBudget: BUDGET
  }
}

// ---- Build ----------------------------------------------------------------
let reuse = args.reuse === 'true'
try {
  statSync(join(DIR, 'state.json'))
} catch {
  reuse = false
}

if (!reuse) {
  rmSync(DIR, { recursive: true, force: true })
  mkdirSync(DIR, { recursive: true })
  peakHeap = 0
  const start = performance.now()
  const db = await openShardedDatabase(options())
  let inserted = 0
  let liveHeapBuild = 0
  for (const batch of passages({ count: DOCS, dims: DIMS })) {
    await db.insertMultiple(batch)
    inserted += batch.length
    if (inserted % Math.max(1000, Math.round(DOCS / 10)) === 0) {
      liveHeapBuild = Math.max(liveHeapBuild, heapAfterGc())
      const stats = db.getStats()
      console.error(
        `  inserted ${inserted}/${DOCS} in ${Math.round((performance.now() - start) / 1000)}s, heap ${MB(process.memoryUsage().heapUsed)} MB, resident shards ${stats.residentShards}/${stats.shards}`
      )
    }
  }
  await db.close()
  report.build = {
    seconds: Math.round((performance.now() - start) / 100) / 10,
    docsPerSecond: Math.round(DOCS / ((performance.now() - start) / 1000)),
    peakHeapMB: MB(peakHeap),
    maxLiveHeapAfterGcMB: MB(liveHeapBuild),
    diskMB: MB(dirBytes(DIR))
  }
  console.error('build', report.build)
}

// ---- Open -----------------------------------------------------------------
const baseline = heapAfterGc()
peakHeap = 0
const openStart = performance.now()
const db = await openShardedDatabase(options())
report.memory.openMs = Math.round(performance.now() - openStart)
report.memory.globalLayerHeapMB = MB(heapAfterGc() - baseline)
report.memory.globalLayerEstimateMB = MB(db.getStats().globalBytes)
report.memory.shards = db.getStats().shards
report.memory.dictionaryTerms = db.getStats().terms
report.memory.processBaselineHeapMB = MB(baseline)
report.memory.diskMB = MB(dirBytes(DIR))

// ---- Queries --------------------------------------------------------------
const words = vocabulary(40000)
const random = rng(7)
const items = Math.ceil(DOCS / 80)
const pickItem = () => `ITEM${Math.floor(random() * items)}`
const randomVector = () => {
  const v = Array.from({ length: DIMS }, () => random() * 2 - 1)
  const norm = Math.hypot(...v)
  return v.map((x) => x / norm)
}

let maxLiveHeap = 0
async function timed(params) {
  const t = performance.now()
  const result = await db.search(params)
  const ms = performance.now() - t
  // Live memory after the query, outside the timing.
  maxLiveHeap = Math.max(maxLiveHeap, heapAfterGc())
  return { ms, result }
}

/** Runs `make(i)` cold (shards not loaded) and then again warm, SAMPLES times. */
async function coldWarm(name, make, samples = SAMPLES) {
  const cold = []
  const warm = []
  const loaded = []
  for (let i = 0; i < samples; i++) {
    const params = make(i)
    const first = await timed(params)
    cold.push(first.ms)
    loaded.push(first.result.shards.loaded)
    warm.push((await timed(params)).ms)
  }
  report.latency[name] = { coldMs: summary(cold), warmMs: summary(warm), shardsLoadedCold: summary(loaded) }
  console.error(name, JSON.stringify(report.latency[name]))
}

async function once(name, params, runs = 2) {
  const out = []
  for (let i = 0; i < runs; i++) {
    const { ms, result } = await timed(params)
    out.push({
      ms: Math.round(ms),
      count: result.count,
      candidates: result.shards.candidates,
      loaded: result.shards.loaded
    })
  }
  report.latency[name] = out
  console.error(name, JSON.stringify(out))
}

const midWord = (i) => words[200 + i * 37]
const rareWord = (i) => words[39000 + i * 101]

await coldWarm('bm25 · one item (where itemKey)', (i) => ({ term: midWord(i), where: { itemKey: pickItem() } }))
await coldWarm('bm25 · two terms, one item', (i) => ({
  term: `${midWord(i)} ${words[3 + i]}`,
  where: { itemKey: pickItem() }
}))
await coldWarm('vector · one item', () => ({
  mode: 'vector',
  vector: { value: randomVector(), property: 'embedding' },
  similarity: 0,
  where: { itemKey: pickItem() }
}))
await coldWarm('hybrid · one item', (i) => ({
  mode: 'hybrid',
  term: midWord(i),
  vector: { value: randomVector(), property: 'embedding' },
  similarity: 0,
  where: { itemKey: pickItem() }
}))
await coldWarm('bm25 · rare term, whole corpus', (i) => ({ term: rareWord(i), prefix: false }), Math.min(SAMPLES, 3))
await once('bm25 · common term, whole corpus', { term: words[5] })
await once('bm25 · two terms, whole corpus', { term: `${words[50]} ${words[400]}` })
await once('vector · whole corpus', {
  mode: 'vector',
  vector: { value: randomVector(), property: 'embedding' },
  similarity: 0.15
})

const stats = db.getStats()
report.memory.peakHeapDuringQueriesMB = MB(peakHeap)
report.memory.maxLiveHeapAfterQueryMB = MB(maxLiveHeap)
report.memory.maxLiveHeapAboveBaselineMB = MB(maxLiveHeap - baseline)
report.memory.heapAfterQueriesMB = MB(heapAfterGc())
report.memory.maxRssMB = MB(process.resourceUsage().maxRSS * 1024)
report.memory.residentShardsEnd = stats.residentShards
report.memory.estimatedResidentMB = MB(stats.residentBytes + stats.globalBytes)
report.memory.loads = stats.loads
report.memory.evictions = stats.evictions

// ---- Optional parity check against a single instance ------------------------
if (args.parity === 'true') {
  const single = create({ schema: shardedSchema(DIMS) })
  for (const batch of passages({ count: DOCS, dims: DIMS })) await insertMultiple(single, batch)
  const parity = []
  for (const params of [
    { term: words[5] },
    { term: `${words[50]} ${words[400]}` },
    { term: rareWord(1), prefix: false },
    { term: midWord(2), where: { itemKey: 'ITEM3' } },
    { term: words[9], where: { year: { between: [1990, 2000] } }, limit: 10 },
    { mode: 'vector', vector: { value: randomVector(), property: 'embedding' }, similarity: 0.1 },
    { mode: 'hybrid', term: words[12], vector: { value: randomVector(), property: 'embedding' }, similarity: 0.1 }
  ]) {
    const a = await db.search(params)
    const b = await search(single, params)
    const same =
      a.count === b.count &&
      a.hits.length === b.hits.length &&
      a.hits.every(
        (hit, i) =>
          hit.id === b.hits[i].id && Math.abs(hit.score - b.hits[i].score) <= 1e-9 * Math.max(1, b.hits[i].score)
      )
    parity.push({ query: params.term ?? params.mode, mode: params.mode ?? 'fulltext', count: a.count, sameTop10: same })
  }
  report.parity = parity
  console.error('parity', JSON.stringify(parity))
}

// ---- Writes ---------------------------------------------------------------
{
  const extra = []
  for (const batch of passages({ count: 100, dims: DIMS, seed: 9 })) extra.push(...batch)
  const t = performance.now()
  for (const doc of extra) {
    await db.upsert({ ...doc, id: `new-${doc.id}`, itemKey: pickItem() })
  }
  report.latency['upsert · one document, random item (WAL + shard)'] = {
    meanMs: Math.round(((performance.now() - t) / extra.length) * 10) / 10
  }
  const c = performance.now()
  await db.compact()
  report.latency['compact after 100 upserts'] = { ms: Math.round(performance.now() - c) }
}

clearInterval(sampler)
console.log(JSON.stringify(report, null, 2))
if (args.json) writeFileSync(args.json, JSON.stringify(report, null, 2))
