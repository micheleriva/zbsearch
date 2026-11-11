// Resident memory and latency of a large passage index (issue #87).
//
// Corpus: src/passages-corpus.js (150-250 word passages from a Zipf-distributed 40k-word vocabulary, string fields
// text/section/title/itemKey, numbers page/year, enum collection), text-only unless --dims is given, with
// `store: { exclude: ['text'] }`. Measures, in one process:
//
// - insertMultipleAsync({ batchSize: 50 }) throughput and the longest event-loop block while it runs;
// - the heap the database holds (heapUsed + arrayBuffers after two full GCs);
// - with --freeze, the time `freeze(db)` takes and the heap afterwards;
// - search latency (p50 / p95 / max) for a fixed Zipf query mix: plain, `tolerance: 1`, `where`, facets, `sortBy`,
//   and hybrid when --dims is given;
// - update and remove latency;
// - saveBinary size and time, loadBinary time, the heap of the loaded database and whether it returns the same
//   results.
//
//   pnpm --filter zbsearch build
//   node --expose-gc --max-old-space-size=8192 benchmarks/large-index.js [--docs=160000] [--freeze]
//        [--queries=200] [--dims=384] [--zbsearch=/path/to/zbsearch/dist/esm/index.js] [--json]
import { createReadStream, createWriteStream, mkdirSync, rmSync, statSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { passages, prng, schema as baseSchema, zipfSampler } from './src/passages-corpus.js'

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=')
    return [key, value ?? true]
  })
)

const DOCS = Number(args.docs ?? 20_000)
const QUERIES = Number(args.queries ?? 200)
const DIMS = Number(args.dims ?? 0)
const FREEZE = Boolean(args.freeze)
const ZBSEARCH = args.zbsearch
  ? pathToFileURL(resolve(args.zbsearch)).href
  : new URL('../packages/zbsearch/dist/esm/index.js', import.meta.url).href
const zb = await import(ZBSEARCH)

if (!globalThis.gc) {
  throw new Error('Run with node --expose-gc')
}

function memory() {
  globalThis.gc()
  globalThis.gc()
  const { heapUsed, arrayBuffers } = process.memoryUsage()
  return heapUsed + arrayBuffers
}

const MB = 1024 * 1024
const fmt = (bytes) => `${(bytes / MB).toFixed(1)} MB`

function percentiles(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] }
}

// Measures the longest gap between 1 ms timer ticks while `fn` runs
async function withEventLoopMonitor(fn) {
  let longest = 0
  let last = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    longest = Math.max(longest, now - last)
    last = now
  }, 1)
  try {
    await fn()
  } finally {
    clearInterval(timer)
  }
  return longest
}

const schema = DIMS ? { ...baseSchema, embedding: `vector[${DIMS}]` } : baseSchema
const result = { docs: DOCS, dims: DIMS, freeze: FREEZE, node: process.version }

// Build
const baseline = memory()
const db = zb.create({ schema, store: { exclude: ['text'] } })
let inserted = 0
let insertMs = 0
result.insertLongestBlockMs = await withEventLoopMonitor(async () => {
  for (const batch of passages(DOCS, { dimensions: DIMS })) {
    const start = performance.now()
    await zb.insertMultipleAsync(db, batch, { batchSize: 50 })
    insertMs += performance.now() - start
    inserted += batch.length
  }
})
result.insertDocsPerSecond = Math.round(inserted / (insertMs / 1000))
result.heapAfterInsert = memory() - baseline
console.log(
  `${DOCS.toLocaleString()} passages${DIMS ? `, vector[${DIMS}]` : ', text only'}, store.exclude: ['text'], Node ${process.version}`
)
console.log(
  `insertMultipleAsync(batchSize 50): ${result.insertDocsPerSecond.toLocaleString()} docs/s, longest event-loop block ${result.insertLongestBlockMs.toFixed(0)} ms`
)
console.log(`heap after insert: ${fmt(result.heapAfterInsert)}`)

if (FREEZE) {
  const start = performance.now()
  zb.freeze(db)
  result.freezeMs = performance.now() - start
  result.heapAfterFreeze = memory() - baseline
  console.log(`freeze: ${(result.freezeMs / 1000).toFixed(2)} s, heap after freeze: ${fmt(result.heapAfterFreeze)}`)
}

// Queries: 1-3 Zipf-sampled words
const random = prng(87)
const sampleWord = zipfSampler(random)
const terms = Array.from({ length: QUERIES }, () => {
  const n = 1 + Math.floor(random() * 3)
  return Array.from({ length: n }, sampleWord).join(' ')
})
const vectors = DIMS
  ? Array.from({ length: QUERIES }, () => {
      const v = Array.from({ length: DIMS }, () => random() * 2 - 1)
      const norm = Math.hypot(...v)
      return v.map((x) => x / norm)
    })
  : []

const modes = {
  plain: (term) => ({ term }),
  'tolerance: 1': (term) => ({ term, tolerance: 1 }),
  where: (term) => ({ term, where: { year: { gte: 2005 }, collection: { in: ['col1', 'col2', 'col3'] } } }),
  facets: (term) => ({
    term,
    facets: {
      collection: {},
      year: {
        ranges: [
          { from: 1990, to: 2005 },
          { from: 2005, to: 2030 }
        ]
      }
    }
  }),
  sortBy: (term) => ({ term, sortBy: { property: 'year', order: 'DESC' } })
}
if (DIMS) {
  modes.hybrid = (term, i) => ({
    mode: 'hybrid',
    term,
    vector: { value: vectors[i], property: 'embedding' },
    similarity: 0.1
  })
}

function runQueries(target) {
  const latency = {}
  const signature = []
  for (const [mode, params] of Object.entries(modes)) {
    // Warm-up
    for (let i = 0; i < Math.min(20, QUERIES); i++) zb.search(target, params(terms[i], i))
    const samples = []
    for (let i = 0; i < QUERIES; i++) {
      const start = performance.now()
      const r = zb.search(target, params(terms[i], i))
      samples.push(performance.now() - start)
      if (i < 20) signature.push(r.count, ...r.hits.map((h) => `${h.id}:${h.score.toFixed(9)}`))
    }
    latency[mode] = percentiles(samples)
  }
  return { latency, signature: signature.join(',') }
}

const searched = runQueries(db)
result.search = searched.latency
console.log(`\n| Search (${QUERIES} queries) | p50 | p95 | max |\n|---|---|---|---|`)
for (const [mode, { p50, p95, max }] of Object.entries(searched.latency)) {
  console.log(`| ${mode} | ${p50.toFixed(1)} ms | ${p95.toFixed(1)} ms | ${max.toFixed(1)} ms |`)
}

// Save and load
const dir = join(tmpdir(), 'zbsearch-large-index-bench')
mkdirSync(dir, { recursive: true })
const file = join(dir, `snapshot-${process.pid}.zbsb`)
let start = performance.now()
const out = createWriteStream(file)
for await (const segment of zb.saveBinary(db)) {
  if (!out.write(segment)) await once(out, 'drain')
}
out.end()
await once(out, 'finish')
result.saveBinaryMs = performance.now() - start
result.binaryBytes = statSync(file).size
console.log(`\nsaveBinary: ${fmt(result.binaryBytes)} in ${(result.saveBinaryMs / 1000).toFixed(2)} s`)

// Updates and removals (on the original database, after saving it)
const updateRandom = prng(5)
const updateSample = zipfSampler(updateRandom)
const updateSamples = []
const removeSamples = []
for (let i = 0; i < 500; i++) {
  const n = Math.floor(updateRandom() * DOCS)
  const doc = {
    id: `p${n}`,
    text: Array.from({ length: 180 }, updateSample).join(' '),
    section: 'updated section',
    title: 'updated title',
    itemKey: `ITEM${Math.floor(n / 80)}`,
    page: 1,
    year: 2000,
    collection: 'col1'
  }
  if (DIMS) doc.embedding = vectors[i % vectors.length]
  start = performance.now()
  zb.update(db, `p${n}`, doc)
  updateSamples.push(performance.now() - start)
}
for (let i = 0; i < 500; i++) {
  start = performance.now()
  zb.remove(db, `p${(i * 7919) % DOCS}`)
  removeSamples.push(performance.now() - start)
}
result.update = percentiles(updateSamples)
result.remove = percentiles(removeSamples)
console.log(
  `update: p50 ${result.update.p50.toFixed(2)} ms, p95 ${result.update.p95.toFixed(2)} ms; remove: p50 ${result.remove.p50.toFixed(2)} ms, p95 ${result.remove.p95.toFixed(2)} ms`
)

const loadBaseline = memory()
const loaded = zb.create({ schema })
start = performance.now()
result.loadLongestBlockMs = await withEventLoopMonitor(() =>
  zb.loadBinary(loaded, createReadStream(file, { highWaterMark: MB }))
)
result.loadBinaryMs = performance.now() - start
rmSync(file)
result.loadedHeap = memory() - loadBaseline
console.log(
  `loadBinary: ${(result.loadBinaryMs / 1000).toFixed(2)} s (longest event-loop block ${result.loadLongestBlockMs.toFixed(0)} ms), loaded database heap ${fmt(result.loadedHeap)}`
)

// The loaded database must return what the original returned before it was saved
result.loadedSameResults = runQueries(loaded).signature === searched.signature
console.log(`loaded database returns the same results: ${result.loadedSameResults}`)
console.log(`max RSS: ${fmt(process.resourceUsage().maxRSS * 1024)}`)

if (args.json) {
  console.log(JSON.stringify(result))
}
