// Large-index comparison: ZBSearch against the other engines of the benchmark suite on the synthetic passage corpus of
// issue #87 (src/passages-corpus.js: 150-250 word passages from a Zipf-distributed 40k-word vocabulary), with a
// timeout on indexing and on search.
//
// Every engine × size runs in its own child process (`node --expose-gc --max-old-space-size=<n>`), so memory is
// isolated and the parent can enforce the timeouts by killing the child:
//
// - indexing (including `freeze(db)` for ZBSearch frozen) must finish within --index-timeout, or the child is killed
//   and the run is recorded as `index-timeout`;
// - the search phase (warm-up + measured queries) must finish within --search-timeout, and no single query may take
//   longer than --query-timeout, or the child is killed and the run is recorded as `search-timeout`. The child streams
//   each query's latency to the parent over IPC, so the queries completed before the timeout are kept;
// - a child that exits on its own before finishing (an exception, out of memory) is recorded as `crashed`.
//
// The engines are configured as in src/get-engines.js and src/alternate-engines.js (stop-word tokenizer, sort indexes
// off, all-terms "plain search" with a limit of 10), and index `text`, `section` and `title` as full text. Queries are
// 1-3 Zipf-sampled words, generated with the same seed as large-index.js.
//
//   npx turbo build --filter=zbsearch --filter=@zbsearch/plugin-qps --filter=@zbsearch/plugin-pt15
//   node benchmarks/large-index-engines.js [--docs=20000,80000,160000] [--engines=zbsearch-bm25,minisearch]
//        [--index-timeout=10m] [--search-timeout=5m] [--query-timeout=60s] [--queries=200] [--warmup=10]
//        [--max-old-space-size=8192] [--out=benchmark/results/large-index-engines.json]
//
// Durations accept a unit (ms, s, m, h) and default to seconds.
import { fork } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, totalmem, platform, arch, release } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const MB = 1024 * 1024

const FIELDS = ['text', 'section', 'title']
const SEARCH_LIMIT = 10
const CORPUS_BATCH = 500

const ENGINES = [
  { key: 'orama', label: 'Orama', pkg: '@orama/orama' },
  { key: 'zbsearch-bm25', label: 'ZBSearch (BM25)', pkg: 'zbsearch' },
  { key: 'zbsearch-bm25-frozen', label: 'ZBSearch (BM25, frozen)', pkg: 'zbsearch' },
  { key: 'zbsearch-qps', label: 'ZBSearch (QPS)', pkg: '@zbsearch/plugin-qps' },
  { key: 'zbsearch-pt15', label: 'ZBSearch (PT15)', pkg: '@zbsearch/plugin-pt15' },
  { key: 'flexsearch', label: 'FlexSearch', pkg: 'flexsearch' },
  { key: 'fusejs', label: 'Fuse.js', pkg: 'fuse.js' },
  { key: 'lunr', label: 'Lunr', pkg: 'lunr' },
  { key: 'minisearch', label: 'MiniSearch', pkg: 'minisearch' }
]

// What each engine keeps besides its index (reported in the JSON and on the docs page)
const STORES = {
  orama: 'full documents (default document store)',
  'zbsearch-bm25': "documents without `text` (`store: { exclude: ['text'] }`)",
  'zbsearch-bm25-frozen': "documents without `text` (`store: { exclude: ['text'] }`)",
  'zbsearch-qps': 'full documents (the QPS index does not support `store.exclude`)',
  'zbsearch-pt15': 'full documents (the PT15 index does not support `store.exclude`)',
  flexsearch: 'ids only (no document store)',
  fusejs: 'full documents (Fuse searches its own document list)',
  lunr: 'refs only',
  minisearch: 'ids only (no `storeFields`)'
}

function parseArgs(argv) {
  return Object.fromEntries(
    argv.map((arg) => {
      const [key, ...value] = arg.replace(/^--/, '').split('=')
      return [key, value.length ? value.join('=') : true]
    })
  )
}

function parseDuration(value, fallbackMs) {
  if (value === undefined || value === true) return fallbackMs
  const match = String(value).match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/)
  if (!match) throw new Error(`Invalid duration: ${value}`)
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2] ?? 's']
  return Number(match[1]) * unit
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

/** Latency statistics of the measured queries (works on a partial run too). */
export function latencyStats(samples) {
  if (samples.length === 0) {
    return { queries: 0, meanMs: null, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null, qps: null }
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const total = samples.reduce((sum, ms) => sum + ms, 0)
  return {
    queries: samples.length,
    meanMs: total / samples.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maxMs: sorted[sorted.length - 1],
    qps: total > 0 ? samples.length / (total / 1000) : null
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Child: builds one engine at one size and runs the query set, reporting every step to the parent over IPC
// ---------------------------------------------------------------------------------------------------------------------

async function loadEngine(key) {
  const { stopWordTokenizer, stopWordSet, tokenizeSearchTerm } = await import('./src/benchmark-config.js')

  const sort = { unsortableProperties: FIELDS }
  const schema = { text: 'string', section: 'string', title: 'string' }

  // The QPS and PT15 index components cannot remove unstored documents, so they keep the default store
  async function zbsearchEngine(pluginFactory) {
    const zb = await import('zbsearch')
    const plugins = pluginFactory ? [await pluginFactory()] : []
    const store = pluginFactory ? undefined : { exclude: ['text'] }
    return {
      zb,
      create: () => zb.create({ schema, plugins, components: { tokenizer: stopWordTokenizer }, sort, store }),
      add: (db, batch) => zb.insertMultiple(db, batch, batch.length),
      search: (db, term) => {
        const result = zb.search(db, { term, limit: SEARCH_LIMIT, threshold: 0 })
        return { hits: result.hits.length, total: result.count }
      }
    }
  }

  switch (key) {
    case 'zbsearch-bm25':
    case 'zbsearch-bm25-frozen': {
      const engine = await zbsearchEngine()
      if (key === 'zbsearch-bm25-frozen') engine.freeze = (db) => engine.zb.freeze(db)
      return engine
    }
    case 'zbsearch-qps':
      return zbsearchEngine(async () => (await import('@zbsearch/plugin-qps')).pluginQPS())
    case 'zbsearch-pt15':
      return zbsearchEngine(async () => (await import('@zbsearch/plugin-pt15')).pluginPT15())
    case 'orama': {
      const orama = await import('@orama/orama')
      return {
        create: () => orama.create({ schema, components: { tokenizer: stopWordTokenizer } }),
        add: (db, batch) => orama.insertMultiple(db, batch, batch.length),
        search: (db, term) => {
          const result = orama.search(db, { term, limit: SEARCH_LIMIT, threshold: 0 })
          return { hits: result.hits.length, total: result.count }
        }
      }
    }
    case 'minisearch': {
      const { default: MiniSearch } = await import('minisearch')
      return {
        create: () =>
          new MiniSearch({
            fields: FIELDS,
            processTerm: (term) => (stopWordSet.has(term) ? null : term.toLowerCase())
          }),
        add: (index, batch) => index.addAll(batch),
        search: (index, term) => {
          const result = index.search(term, { combineWith: 'AND' })
          return { hits: Math.min(result.length, SEARCH_LIMIT), total: result.length }
        }
      }
    }
    case 'flexsearch': {
      const { default: FlexSearch } = await import('flexsearch')
      return {
        create: () => new FlexSearch.Document({ preset: 'score', document: { id: 'id', index: FIELDS } }),
        add: (index, batch) => {
          for (const doc of batch) index.add(doc)
        },
        // As in alternate-engines.js: each token is searched separately (top 1,000 per field) and the matches are
        // intersected, so every hit contains all the query terms
        search: (index, term) => {
          let candidates = null
          for (const token of tokenizeSearchTerm(term)) {
            const ids = new Set()
            for (const { result } of index.search(token, { limit: 1000 })) {
              for (const id of result) ids.add(id)
            }
            candidates = candidates ? new Set([...candidates].filter((id) => ids.has(id))) : ids
            if (candidates.size === 0) break
          }
          return { hits: Math.min(candidates?.size ?? 0, SEARCH_LIMIT), total: null }
        }
      }
    }
    case 'fusejs': {
      const { default: Fuse } = await import('fuse.js')
      const options = {
        keys: FIELDS,
        useTokenSearch: true,
        tokenMatch: 'all',
        threshold: 0,
        ignoreLocation: true,
        includeScore: false
      }
      // Fuse builds its index from the whole document list at construction, as in alternate-engines.js
      return {
        create: () => ({ docs: [], fuse: null }),
        add: (state, batch) => {
          for (const doc of batch) state.docs.push(doc)
        },
        finish: (state) => {
          state.fuse = new Fuse(state.docs, options)
        },
        search: (state, term) => {
          const result = state.fuse.search(term, { limit: SEARCH_LIMIT })
          return { hits: result.length, total: null }
        }
      }
    }
    case 'lunr': {
      const { default: lunr } = await import('lunr')
      const stopWordFilter = lunr.generateStopWordFilter([...stopWordSet])
      lunr.Pipeline.registerFunction(stopWordFilter, 'benchmarkStopWordFilter')
      // lunr(fn) with the pipeline of alternate-engines.js, built incrementally so batches can be added
      return {
        create: () => {
          const builder = new lunr.Builder()
          builder.pipeline.add(lunr.trimmer, stopWordFilter)
          builder.searchPipeline.add(stopWordFilter)
          builder.ref('id')
          for (const field of FIELDS) builder.field(field)
          return { builder, index: null }
        },
        add: (state, batch) => {
          for (const doc of batch) state.builder.add(doc)
        },
        finish: (state) => {
          state.index = state.builder.build()
          state.builder = null
        },
        search: (state, term) => {
          const tokens = tokenizeSearchTerm(term)
          if (tokens.length === 0) return { hits: 0, total: 0 }
          const result = state.index.search(tokens.map((token) => `+${token}`).join(' '))
          return { hits: Math.min(result.length, SEARCH_LIMIT), total: result.length }
        }
      }
    }
    default:
      throw new Error(`Unknown engine: ${key}`)
  }
}

function heapBytes() {
  globalThis.gc()
  globalThis.gc()
  const { heapUsed, arrayBuffers } = process.memoryUsage()
  return heapUsed + arrayBuffers
}

const send = (message) => process.send(message)
const tick = () => new Promise((resolve) => setImmediate(resolve))

async function child() {
  const {
    engine: key,
    docs: DOCS,
    queries: QUERIES,
    warmup: WARMUP
  } = JSON.parse(process.env.LARGE_INDEX_ENGINES_CHILD)
  if (!globalThis.gc) throw new Error('The child must run with --expose-gc')

  const { passages, prng, zipfSampler } = await import('./src/passages-corpus.js')
  const engine = await loadEngine(key)

  // Queries: 1-3 Zipf-sampled words, as in large-index.js
  const random = prng(87)
  const sampleWord = zipfSampler(random)
  const terms = Array.from({ length: QUERIES }, () => {
    const n = 1 + Math.floor(random() * 3)
    return Array.from({ length: n }, sampleWord).join(' ')
  })

  const baseline = heapBytes()

  // The corpus is generated before indexing starts, so neither the timings nor the timeout include it
  let start = performance.now()
  let batches = []
  for (const batch of passages(DOCS, { batch: CORPUS_BATCH })) {
    batches.push(batch.map(({ id, text, section, title }) => ({ id, text, section, title })))
  }
  send({ type: 'ready', corpusMs: performance.now() - start })

  // Indexing (the timeout is enforced by the parent from the `ready` message)
  let indexMs = 0
  let indexed = 0
  const db = engine.create()
  for (const batch of batches) {
    start = performance.now()
    await engine.add(db, batch)
    indexMs += performance.now() - start
    indexed += batch.length
    send({ type: 'index-progress', docs: indexed, indexMs })
    await tick()
  }
  if (engine.finish) {
    start = performance.now()
    engine.finish(db)
    const finishMs = performance.now() - start
    indexMs += finishMs
  }
  let freezeMs = null
  if (engine.freeze) {
    start = performance.now()
    engine.freeze(db)
    freezeMs = performance.now() - start
    indexMs += freezeMs
  }
  send({ type: 'indexed', indexMs, freezeMs })

  batches = null
  const heap = heapBytes() - baseline
  const { rss } = process.memoryUsage()
  send({ type: 'memory', heapBytes: heap, rssBytes: rss, maxRssBytes: process.resourceUsage().maxRSS * 1024 })

  // Search: warm-up, then the measured queries, one IPC message per query
  send({ type: 'search-start' })
  for (let i = 0; i < Math.min(WARMUP, QUERIES); i++) {
    start = performance.now()
    engine.search(db, terms[i])
    send({ type: 'warmup', i, ms: performance.now() - start })
    await tick()
  }
  for (let i = 0; i < QUERIES; i++) {
    start = performance.now()
    const { hits, total } = engine.search(db, terms[i])
    const ms = performance.now() - start
    send({ type: 'query', i, ms, term: i < 5 ? terms[i] : undefined, hits, total })
    await tick()
  }
  send({ type: 'done', maxRssBytes: process.resourceUsage().maxRSS * 1024 })
  process.disconnect()
}

// ---------------------------------------------------------------------------------------------------------------------
// Parent: runs every engine × size in a child process and enforces the timeouts
// ---------------------------------------------------------------------------------------------------------------------

function packageVersion(name) {
  return JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version
}

function runOne({ engine, docs, options }) {
  return new Promise((resolvePromise) => {
    const record = {
      engine: engine.key,
      label: engine.label,
      docs,
      status: 'running',
      error: null,
      store: STORES[engine.key],
      corpusMs: null,
      indexMs: null,
      docsPerSecond: null,
      freezeMs: null,
      docsIndexed: 0,
      heapMB: null,
      rssMB: null,
      maxRssMB: null,
      warmupQueries: 0,
      search: null,
      sample: []
    }
    const samples = []
    let phase = 'starting'
    let stderr = ''
    let indexTimer = null
    let searchTimer = null
    let queryTimer = null
    let killedFor = null
    let finished = false

    const child = fork(fileURLToPath(import.meta.url), ['--child'], {
      execArgv: ['--expose-gc', `--max-old-space-size=${options.maxOldSpaceSize}`],
      env: {
        ...process.env,
        LARGE_INDEX_ENGINES_CHILD: JSON.stringify({
          engine: engine.key,
          docs,
          queries: options.queries,
          warmup: options.warmup
        })
      },
      stdio: ['ignore', 'inherit', 'pipe', 'ipc']
    })
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-8000)
    })

    const clearTimers = () => {
      clearTimeout(indexTimer)
      clearTimeout(searchTimer)
      clearTimeout(queryTimer)
    }
    const kill = (reason) => {
      if (killedFor || finished) return
      killedFor = reason
      clearTimers()
      child.kill('SIGKILL')
    }
    const armQueryTimer = () => {
      clearTimeout(queryTimer)
      queryTimer = setTimeout(() => kill('query'), options.queryTimeoutMs)
    }

    child.on('message', (message) => {
      switch (message.type) {
        case 'ready':
          phase = 'indexing'
          record.corpusMs = message.corpusMs
          indexTimer = setTimeout(() => kill('index'), options.indexTimeoutMs)
          break
        case 'index-progress':
          record.docsIndexed = message.docs
          break
        case 'indexed':
          clearTimeout(indexTimer)
          phase = 'measuring memory'
          record.docsIndexed = docs
          record.indexMs = message.indexMs
          record.freezeMs = message.freezeMs
          record.docsPerSecond = Math.round(docs / (message.indexMs / 1000))
          break
        case 'memory':
          record.heapMB = message.heapBytes / MB
          record.rssMB = message.rssBytes / MB
          record.maxRssMB = message.maxRssBytes / MB
          break
        case 'search-start':
          phase = 'searching'
          searchTimer = setTimeout(() => kill('search'), options.searchTimeoutMs)
          armQueryTimer()
          break
        case 'warmup':
          record.warmupQueries = message.i + 1
          armQueryTimer()
          break
        case 'query':
          samples.push(message.ms)
          if (record.sample.length < 5) {
            record.sample.push({ term: message.term, hits: message.hits, total: message.total })
          }
          armQueryTimer()
          break
        case 'done':
          finished = true
          clearTimers()
          record.status = 'ok'
          record.maxRssMB = message.maxRssBytes / MB
          break
      }
    })

    child.on('exit', (code, signal) => {
      clearTimers()
      record.search = phase === 'searching' || finished ? latencyStats(samples) : null
      if (finished) {
        // already `ok`
      } else if (killedFor === 'index') {
        record.status = 'index-timeout'
        record.error = `indexing did not finish within ${formatDuration(options.indexTimeoutMs)} (${record.docsIndexed.toLocaleString('en-US')} of ${docs.toLocaleString('en-US')} documents added)`
      } else if (killedFor === 'search' || killedFor === 'query') {
        record.status = 'search-timeout'
        record.error =
          killedFor === 'search'
            ? `search did not finish within ${formatDuration(options.searchTimeoutMs)} (${samples.length} of ${options.queries} queries completed)`
            : `a single query took longer than ${formatDuration(options.queryTimeoutMs)} (${samples.length} of ${options.queries} queries completed)`
      } else {
        record.status = 'crashed'
        const oom = /heap out of memory|Allocation failed|out of memory/i.test(stderr)
        record.error = oom
          ? `out of memory (--max-old-space-size=${options.maxOldSpaceSize}) while ${phase}`
          : `exited with ${signal ?? `code ${code}`} while ${phase}: ${(stderr.split('\n').find((line) => /Error/.test(line)) ?? stderr.trim().split('\n').at(-1) ?? '').trim().slice(0, 500)}`
        if (stderr && !oom) process.stderr.write(stderr)
      }
      resolvePromise(record)
    })
  })
}

function formatDuration(ms) {
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} min`
  if (ms >= 1000) return `${ms / 1000} s`
  return `${ms} ms`
}

const fmt = (value, digits = 1) => (value == null ? '-' : value.toFixed(digits))

function printTable(runs) {
  console.log(
    '\n| Docs | Engine | Status | Index (s) | Docs/s | Freeze (s) | Heap (MB) | RSS (MB) | Queries | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | QPS |'
  )
  console.log('|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const run of runs) {
    const s = run.search ?? {}
    console.log(
      `| ${run.docs.toLocaleString('en-US')} | ${run.label} | ${run.status} | ${fmt(run.indexMs == null ? null : run.indexMs / 1000, 2)} | ${run.docsPerSecond?.toLocaleString('en-US') ?? '-'} | ${fmt(run.freezeMs == null ? null : run.freezeMs / 1000, 2)} | ${fmt(run.heapMB)} | ${fmt(run.rssMB)} | ${s.queries ?? '-'} | ${fmt(s.meanMs, 2)} | ${fmt(s.p50Ms, 2)} | ${fmt(s.p95Ms, 2)} | ${fmt(s.p99Ms, 2)} | ${s.qps == null ? '-' : s.qps < 10 ? s.qps.toFixed(1) : Math.round(s.qps).toLocaleString('en-US')} |`
    )
  }
  const failed = runs.filter((run) => run.error)
  if (failed.length) {
    console.log('')
    for (const run of failed) console.log(`- ${run.label}, ${run.docs.toLocaleString('en-US')} docs: ${run.error}`)
  }
}

async function parent() {
  const args = parseArgs(process.argv.slice(2))
  const sizes = String(args.docs ?? '20000,80000,160000')
    .split(',')
    .map((n) => Number(n.replace(/_/g, '')))
  const selected = args.engines ? String(args.engines).split(',') : ENGINES.map((engine) => engine.key)
  const unknown = selected.filter((key) => !ENGINES.some((engine) => engine.key === key))
  if (unknown.length) throw new Error(`Unknown engines: ${unknown.join(', ')}`)
  const engines = ENGINES.filter((engine) => selected.includes(engine.key))

  const options = {
    indexTimeoutMs: parseDuration(args['index-timeout'], 10 * 60_000),
    searchTimeoutMs: parseDuration(args['search-timeout'], 5 * 60_000),
    queryTimeoutMs: parseDuration(args['query-timeout'], 60_000),
    queries: Number(args.queries ?? 200),
    warmup: Number(args.warmup ?? 10),
    maxOldSpaceSize: Number(args['max-old-space-size'] ?? 8192)
  }
  const out = resolve(ROOT, String(args.out ?? 'benchmark/results/large-index-engines.json'))

  const cpuList = cpus()
  const result = {
    name: 'large-index-engines',
    date: new Date().toISOString(),
    machine: {
      node: process.version,
      platform: `${platform()} ${release()} (${arch()})`,
      cpu: cpuList[0]?.model.trim() ?? 'unknown',
      cpus: cpuList.length,
      totalMemoryGB: Math.round((totalmem() / 1024 ** 3) * 10) / 10
    },
    config: {
      sizes,
      indexTimeoutMs: options.indexTimeoutMs,
      searchTimeoutMs: options.searchTimeoutMs,
      queryTimeoutMs: options.queryTimeoutMs,
      queries: options.queries,
      warmupQueries: options.warmup,
      maxOldSpaceSizeMB: options.maxOldSpaceSize,
      searchLimit: SEARCH_LIMIT,
      fields: FIELDS,
      corpus:
        'src/passages-corpus.js: synthetic passages of 150-250 words from a Zipf-distributed 40,000-word vocabulary (seed 81); text, section (3 words) and title (6 words) indexed as full text',
      queryMix: '1-3 Zipf-sampled words per query (seed 87, as in large-index.js), all terms required, top 10 results'
    },
    versions: Object.fromEntries(engines.map((engine) => [engine.key, packageVersion(engine.pkg)])),
    stores: Object.fromEntries(engines.map((engine) => [engine.key, STORES[engine.key]])),
    runs: []
  }

  console.log(
    `Large-index engines: ${sizes.map((n) => n.toLocaleString('en-US')).join(', ')} docs; index timeout ${formatDuration(options.indexTimeoutMs)}, search budget ${formatDuration(options.searchTimeoutMs)}, per-query cap ${formatDuration(options.queryTimeoutMs)}; ${result.machine.cpu} × ${result.machine.cpus}, ${result.machine.totalMemoryGB} GB, Node ${process.version}`
  )

  mkdirSync(dirname(out), { recursive: true })
  for (const docs of sizes) {
    for (const engine of engines) {
      const startedAt = performance.now()
      process.stdout.write(`${engine.label}, ${docs.toLocaleString('en-US')} docs... `)
      const run = await runOne({ engine, docs, options })
      result.runs.push(run)
      console.log(
        `${run.status} in ${((performance.now() - startedAt) / 1000).toFixed(0)} s` +
          (run.indexMs == null ? '' : `; index ${(run.indexMs / 1000).toFixed(2)} s`) +
          (run.heapMB == null ? '' : `, heap ${run.heapMB.toFixed(0)} MB`) +
          (run.search?.p50Ms == null ? '' : `, p50 ${run.search.p50Ms.toFixed(2)} ms (${run.search.queries} queries)`)
      )
      // Written after every run so an interrupted benchmark keeps what it measured
      writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`)
    }
  }

  printTable(result.runs)
  console.log(`\nResults written to ${out}`)
}

if (process.argv.includes('--child')) {
  await child()
} else {
  await parent()
}
