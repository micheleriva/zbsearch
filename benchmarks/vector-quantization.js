/*
 * Vector quantization benchmark (issue #80): recall@10, memory, serialized size and query latency for
 * none / int8 / binary / binary+int8 rescoring / PQ, on flat and IVF indexes.
 *
 * It benchmarks the vector index itself (the object zbsearch keeps per vector property), so the numbers exclude the
 * document store and the full-text index.
 *
 *   pnpm --filter zbsearch build && pnpm --filter @zbsearch/plugin-vector-quantizer build
 *   cd benchmarks
 *   node --expose-gc --max-old-space-size=3072 vector-quantization.js [options]
 *
 * Options:
 *   --dataset=clustered|random|minilm|file   synthetic clustered/anisotropic embeddings (default), random unit
 *                                           vectors (IVF worst case), the 150 real all-MiniLM-L6-v2 vectors shipped
 *                                           with apps/demo-semantic (each document queries the others), or --data.
 *   --data=path.json                        real embeddings: { "corpus": number[][], "queries": number[][] }, both
 *                                           already embedded with the same model (see scripts/embed-beir.mjs).
 *   --docs=20000 --dim=384 --queries=200    size of the synthetic set.
 *   --configs=flat-none,flat-int8,...       subset of configurations (see CONFIGS below).
 *   --memory-only=160000                    only build a quantized index of that many vectors and report its memory
 *   --quantization=int8|binary              (with --memory-only, default int8).
 *   --json=out.json                         also write the results as JSON.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { flat } from 'zbsearch/trees/vector-flat'
import { ivf } from 'zbsearch/trees/vector-ivf'
import { pq } from '@zbsearch/plugin-vector-quantizer'

const here = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=')
    return [key, value ?? 'true']
  })
)

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const random = mulberry32(Number(args.seed ?? 1234))
function gaussian() {
  return Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random())
}

function normalize(vector) {
  let sum = 0
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i]
  const inv = 1 / Math.sqrt(sum)
  for (let i = 0; i < vector.length; i++) vector[i] *= inv
  return vector
}

/**
 * Clustered, anisotropic embeddings with a shared mean direction: the three properties of sentence-embedding models
 * that matter here (topic clusters, a few high-variance directions, and a non-zero mean that makes cosines between
 * unrelated texts positive). Cluster sizes follow a Zipf-like law.
 */
function syntheticGenerator(dim, kind) {
  if (kind === 'random') {
    return () => normalize(Float32Array.from({ length: dim }, gaussian))
  }

  const clusters = Number(args.clusters ?? 400)
  const mean = Array.from({ length: dim }, () => gaussian() * 0.35)
  const scales = Array.from({ length: dim }, (_, d) => 1 / Math.sqrt(1 + d / 12))
  const centers = Array.from({ length: clusters }, () => mean.map((m, d) => m + gaussian() * scales[d]))
  const weights = Array.from({ length: clusters }, (_, i) => 1 / (i + 1) ** 0.6)
  const total = weights.reduce((a, b) => a + b, 0)
  const cumulative = []
  let acc = 0
  for (const weight of weights) cumulative.push((acc += weight / total))
  const spread = Number(args.spread ?? 0.75)

  return () => {
    const r = random()
    let c = cumulative.findIndex((value) => value >= r)
    if (c < 0) c = clusters - 1
    const center = centers[c]
    const vector = new Float32Array(dim)
    for (let d = 0; d < dim; d++) vector[d] = center[d] + gaussian() * spread * scales[d]
    return normalize(vector)
  }
}

function loadDataset() {
  const dataset = args.dataset ?? (args.data ? 'file' : 'clustered')

  if (dataset === 'file') {
    const raw = JSON.parse(readFileSync(args.data, 'utf8'))
    return {
      name: `file:${args.data}`,
      real: true,
      corpus: raw.corpus.map((v) => normalize(Float32Array.from(v))),
      queries: raw.queries.map((v) => normalize(Float32Array.from(v))),
      leaveOneOut: false
    }
  }

  if (dataset === 'minilm') {
    const raw = JSON.parse(readFileSync(join(here, '../apps/demo-semantic/data/embeddings.json'), 'utf8'))
    const bytes = Buffer.from(raw.vectors, 'base64')
    const int8 = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const corpus = []
    for (let i = 0; i < raw.ids.length; i++) {
      corpus.push(normalize(Float32Array.from(int8.subarray(i * raw.dim, (i + 1) * raw.dim), (x) => x / raw.scale)))
    }
    return { name: `minilm-150 (${raw.model})`, real: true, corpus, queries: corpus, leaveOneOut: true }
  }

  const dim = Number(args.dim ?? 384)
  const next = syntheticGenerator(dim, dataset)
  const corpus = Array.from({ length: Number(args.docs ?? 20000) }, next)
  const queries = Array.from({ length: Number(args.queries ?? 200) }, next)
  return { name: `${dataset} synthetic`, real: false, corpus, queries, leaveOneOut: false }
}

function memory() {
  globalThis.gc?.()
  globalThis.gc?.()
  const usage = process.memoryUsage()
  return usage.heapUsed + usage.arrayBuffers
}

// Bounded selection of the k best results (no full sort, so latency reflects the index, not Array#sort).
function topK(results, k, exclude) {
  const best = []
  for (const result of results) {
    if (result[0] === exclude) continue
    if (best.length === k && result[1] <= best[k - 1][1]) continue
    let i = best.length < k ? best.length : k - 1
    best[i] = result
    while (i > 0 && best[i - 1][1] < best[i][1]) {
      ;[best[i - 1], best[i]] = [best[i], best[i - 1]]
      i--
    }
  }
  return best.map(([id]) => id)
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))]
}

// MiB
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1)

async function configs(count) {
  const nlist = Math.max(4, Math.round(Math.sqrt(count)))
  const nprobe = Math.min(nlist, 16)
  const pqFactory = await pq({ m: 48, ks: 256, iterations: 12, trainingSize: Math.min(count, 4096) })
  const ivfBase = { nlist, nprobe }
  const trained = { ...ivfBase, trainMin: Math.min(count, Math.max(nlist * 20, 1024)) }

  return {
    'flat-none': () => flat(),
    'flat-int8': () => flat({ quantization: 'int8' }),
    'flat-binary': () => flat({ quantization: 'binary' }),
    'flat-binary+int8': () => flat({ quantization: 'binary', rescore: 'int8' }),
    'flat-pq': () => flat({ quantization: pqFactory }),
    'flat-pq+int8': () => flat({ quantization: pqFactory, rescore: 'int8' }),
    // The configuration from the issue: IVF with the default trainMin (min(nlist, 32) vectors train the centroids).
    'ivf-none-default': () => ivf(ivfBase),
    'ivf-none': () => ivf(trained),
    'ivf-int8': () => ivf({ ...trained, quantization: 'int8' }),
    'ivf-binary+int8': () => ivf({ ...trained, quantization: 'binary', rescore: 'int8' }),
    'ivf-pq': () => ivf({ ...trained, quantization: pqFactory })
  }
}

async function memoryOnly(count) {
  const dim = Number(args.dim ?? 384)
  const next = syntheticGenerator(dim, args.dataset ?? 'clustered')
  for (const name of [args.quantization ?? 'int8']) {
    const before = memory()
    const index = flat({ quantization: name })({ dim, property: 'embedding' })
    for (let i = 0; i < count; i++) index.add(i + 1, next())
    const grown = index.byteLength
    index.shrinkToFit()
    const after = memory()
    console.log(
      `${count} x ${dim} ${name}: codes + ids ${mb(index.byteLength)} MiB after shrinkToFit (${mb(grown)} MiB ` +
        `with growth slack), heap+arrayBuffers delta incl. id map ${mb(after - before)} MiB, ` +
        `float32 would be ${mb(count * dim * 4)} MiB`
    )
  }
}

async function main() {
  if (args['memory-only']) {
    await memoryOnly(Number(args['memory-only']))
    return
  }

  const data = loadDataset()
  const dim = data.corpus[0].length
  const all = await configs(data.corpus.length)
  const selected = args.configs ? args.configs.split(',') : Object.keys(all)
  const k = 10

  console.log(
    `dataset: ${data.name}${data.real ? '' : ' (SYNTHETIC)'}, ${data.corpus.length} vectors x ${dim} dims, ` +
      `${data.queries.length} queries, recall@${k} against exact float32 search`
  )

  // Exact ground truth.
  const exactIndex = flat()({ dim, property: 'embedding' })
  data.corpus.forEach((vector, i) => exactIndex.add(i + 1, vector))
  const truth = data.queries.map((query, q) =>
    topK(exactIndex.find(query, -1, undefined), k, data.leaveOneOut ? q + 1 : undefined)
  )

  const rows = []
  for (const name of selected) {
    const factory = all[name]
    if (!factory) throw new Error(`Unknown config ${name}`)

    const before = memory()
    const started = performance.now()
    const index = factory()({ dim, property: 'embedding' })
    data.corpus.forEach((vector, i) => index.add(i + 1, vector))
    const buildMs = performance.now() - started
    const heap = memory() - before

    let hits = 0
    const latencies = []
    for (let q = 0; q < data.queries.length; q++) {
      const exclude = data.leaveOneOut ? q + 1 : undefined
      const t = performance.now()
      const results = index.find(data.queries[q], -1, undefined, { limit: k + (exclude ? 1 : 0) })
      const ids = topK(results, k, exclude)
      latencies.push(performance.now() - t)
      const expected = new Set(truth[q])
      for (const id of ids) if (expected.has(id)) hits++
    }

    const snapshot = index.toBinarySnapshot?.()
    const snapshotBytes = snapshot ? Object.values(snapshot.arrays).reduce((sum, a) => sum + a.byteLength, 0) : NaN
    const jsonBytes = JSON.stringify(index.toJSON()).length

    const row = {
      config: name,
      recall: hits / (data.queries.length * k),
      heapMB: Number(mb(heap)),
      codesMB: index.byteLength !== undefined ? Number(mb(index.byteLength)) : null,
      snapshotMB: Number(mb(snapshotBytes)),
      jsonMB: Number(mb(jsonBytes)),
      buildMs: Math.round(buildMs),
      p50ms: Number(percentile(latencies, 50).toFixed(2)),
      p95ms: Number(percentile(latencies, 95).toFixed(2))
    }
    rows.push(row)
    console.log(
      `${name.padEnd(18)} recall@10 ${row.recall.toFixed(3)}  heap ${String(row.heapMB).padStart(7)} MB  ` +
        `snapshot ${String(row.snapshotMB).padStart(7)} MB  json ${String(row.jsonMB).padStart(7)} MB  ` +
        `build ${String(row.buildMs).padStart(6)} ms  p50 ${row.p50ms} ms  p95 ${row.p95ms} ms`
    )
  }

  if (args.json) {
    writeFileSync(
      args.json,
      JSON.stringify({ dataset: data.name, synthetic: !data.real, count: data.corpus.length, dim, rows }, null, 2)
    )
  }
}

await main()
