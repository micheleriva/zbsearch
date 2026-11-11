// Memory and snapshot size of indexed-but-not-stored fields (`store` option of `create`).
//
// Corpus: synthetic passages of 150-250 words drawn from a Zipf-distributed 40k-word vocabulary, with `text`,
// `section`, `title`, `itemKey` (string), `page`, `year` (number), `collection` (enum) and, unless --no-vectors,
// `embedding: 'vector[384]'` holding random unit vectors.
//
// Every variant runs in its own Node process, so that heap measurements do not interfere:
//
//   pnpm --filter zbsearch build
//   node benchmarks/store-exclude.js [--docs=10000] [--no-vectors] [--max-old-space-size=3072]
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { create, insertMultiple, remove, save, search } from 'zbsearch'

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=')
    return [key, value ?? true]
  })
)

const DOCS = Number(args.docs ?? 10_000)
const WITH_VECTORS = !args['no-vectors']
const MAX_OLD_SPACE = Number(args['max-old-space-size'] ?? 3072)
const VOCABULARY = 40_000
const DIMENSIONS = 384
const BATCH = 500

const VARIANTS = {
  'store everything (4.0.x)': { vectors: true },
  'default (vectors not stored)': undefined,
  'exclude text': { exclude: ['text'] },
  'exclude text, section, page, year, collection': { exclude: ['text', 'section', 'page', 'year', 'collection'] }
}

// Deterministic PRNG (mulberry32)
function prng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SYLLABLES = ['ka', 'lo', 'mi', 'ne', 'ru', 'sa', 'ti', 'vo', 'ze', 'pa', 'do', 'fi', 'gu', 'he', 'ja', 'be']

function makeWord(i) {
  let word = ''
  let n = i + 16
  while (n > 0) {
    word += SYLLABLES[n % 16]
    n = Math.floor(n / 16)
  }
  return word
}

function makeCorpus() {
  const random = prng(81)
  const words = Array.from({ length: VOCABULARY }, (_, i) => makeWord(i))
  // Zipf (s = 1) cumulative distribution
  const cdf = new Float64Array(VOCABULARY)
  let total = 0
  for (let i = 0; i < VOCABULARY; i++) {
    total += 1 / (i + 1)
    cdf[i] = total
  }

  function sampleWord() {
    const target = random() * total
    let lo = 0
    let hi = VOCABULARY - 1
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (cdf[mid] < target) lo = mid + 1
      else hi = mid
    }
    return words[lo]
  }

  function sentence(length) {
    const parts = new Array(length)
    for (let i = 0; i < length; i++) parts[i] = sampleWord()
    return parts.join(' ')
  }

  function vector() {
    const v = new Array(DIMENSIONS)
    let norm = 0
    for (let i = 0; i < DIMENSIONS; i++) {
      v[i] = random() * 2 - 1
      norm += v[i] * v[i]
    }
    norm = Math.sqrt(norm)
    for (let i = 0; i < DIMENSIONS; i++) v[i] /= norm
    return v
  }

  return function* batches() {
    for (let start = 0; start < DOCS; start += BATCH) {
      const batch = []
      for (let i = start; i < Math.min(start + BATCH, DOCS); i++) {
        const doc = {
          id: `p${i}`,
          text: sentence(150 + Math.floor(random() * 101)),
          section: sentence(3),
          title: sentence(6),
          itemKey: `ITEM${Math.floor(i / 80)}`,
          page: 1 + (i % 80),
          year: 1990 + Math.floor(random() * 35),
          collection: `col${Math.floor(random() * 12)}`
        }
        if (WITH_VECTORS) doc.embedding = vector()
        batch.push(doc)
      }
      yield batch
    }
  }
}

function heapUsed() {
  globalThis.gc()
  globalThis.gc()
  return process.memoryUsage().heapUsed
}

function runVariant(name) {
  const store = VARIANTS[name]
  const schema = {
    text: 'string',
    section: 'string',
    title: 'string',
    itemKey: 'string',
    page: 'number',
    year: 'number',
    collection: 'enum'
  }
  if (WITH_VECTORS) schema.embedding = `vector[${DIMENSIONS}]`

  const batches = makeCorpus()
  const before = heapUsed()
  const db = create({ schema, store })

  const insertStart = process.hrtime.bigint()
  // Batches are generated and dropped one at a time, so the heap only holds what the database keeps
  for (const batch of batches()) {
    insertMultiple(db, batch, BATCH)
  }
  const insertMs = Number(process.hrtime.bigint() - insertStart) / 1e6
  const heap = heapUsed() - before

  const raw = save(db)
  const snapshotBytes = Buffer.byteLength(JSON.stringify(raw))
  const docsBytes = Buffer.byteLength(JSON.stringify(raw.docs))
  const removalBytes =
    Buffer.byteLength(JSON.stringify(raw.index.unstoredValues ?? {})) +
    Buffer.byteLength(JSON.stringify(raw.index.unstoredTerms ?? {}))

  const queries = ['kalo', 'mika sa', 'neru']
  const searchStart = process.hrtime.bigint()
  let hits = 0
  for (let i = 0; i < 30; i++) hits += search(db, { term: queries[i % queries.length] }).count
  const searchMs = Number(process.hrtime.bigint() - searchStart) / 1e6 / 30

  const removeStart = process.hrtime.bigint()
  for (let i = 0; i < 1000; i++) remove(db, `p${i * 7}`)
  const removeMs = Number(process.hrtime.bigint() - removeStart) / 1e6 / 1000

  return { name, heap, snapshotBytes, docsBytes, removalBytes, insertMs, searchMs, removeMs, hits }
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function pct(value, base) {
  const delta = ((value - base) / base) * 100
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`
}

if (args.variant) {
  process.stdout.write(JSON.stringify(runVariant(args.variant)))
} else {
  const results = []
  for (const name of Object.keys(VARIANTS)) {
    const child = spawnSync(
      process.execPath,
      [
        '--expose-gc',
        `--max-old-space-size=${MAX_OLD_SPACE}`,
        fileURLToPath(import.meta.url),
        `--variant=${name}`,
        `--docs=${DOCS}`,
        ...(WITH_VECTORS ? [] : ['--no-vectors'])
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
    if (child.status !== 0) {
      throw new Error(`Variant "${name}" failed:\n${child.stderr}`)
    }
    results.push(JSON.parse(child.stdout))
  }

  const base = results[0]
  console.log(
    `${DOCS} passages, ${WITH_VECTORS ? `with vector[${DIMENSIONS}]` : 'text only'}, Node ${process.version}\n`
  )
  console.log(
    '| Variant | Heap | Snapshot (JSON) | of which docs | Removal data | Insert | Search (avg) | Remove (avg) |'
  )
  console.log('|---|---|---|---|---|---|---|---|')
  for (const r of results) {
    console.log(
      `| ${r.name} | ${mb(r.heap)} (${pct(r.heap, base.heap)}) | ${mb(r.snapshotBytes)} (${pct(
        r.snapshotBytes,
        base.snapshotBytes
      )}) | ${mb(r.docsBytes)} | ${mb(r.removalBytes)} | ${(r.insertMs / 1000).toFixed(1)} s | ${r.searchMs.toFixed(
        1
      )} ms | ${(r.removeMs * 1000).toFixed(0)} µs |`
    )
  }
}
