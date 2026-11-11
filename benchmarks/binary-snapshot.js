// Binary snapshot vs chunked JSON benchmark (issue #79).
//
// Builds a synthetic passage corpus (150-250 words per passage drawn from a Zipf-distributed 40k-word vocabulary,
// fields text/section/title/itemKey/page/year/collection plus a 384-dimension unit vector) and measures, for each
// size: snapshot size, save and load times, the largest segment and the extra memory held during save.
//
// Usage (build zbsearch first: pnpm --filter zbsearch build):
//   node --expose-gc --max-old-space-size=3072 benchmarks/binary-snapshot.js [docs...] [--dims=384] [--no-json]
//        [--out=/path/to/dir] [--segment=1048576]
//
// --no-json skips the chunked JSON baseline (which needs the whole JSON in memory) for the largest sizes.

import { createReadStream, createWriteStream, mkdirSync, rmSync, statSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  create,
  insertMultiple,
  save,
  loadAsync,
  saveBinary,
  loadBinary,
  search,
  searchVector,
  count
} from '../packages/zbsearch/dist/esm/index.js'

const args = process.argv.slice(2)
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')).map(([k, v]) => [k, v ?? true])
)
const sizes = args.filter((a) => !a.startsWith('--')).map(Number)
if (sizes.length === 0) sizes.push(10_000)
const DIMS = Number(flags.dims ?? 384)
const SEGMENT = Number(flags.segment ?? 1024 * 1024)
const OUT = flags.out ?? join(tmpdir(), 'zbsearch-binary-snapshot-bench')
const RUN_JSON = !flags['no-json']
const gc = globalThis.gc ?? (() => {})

mkdirSync(OUT, { recursive: true })

// Deterministic PRNG (mulberry32)
function rng(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const random = rng(79)
const SYLLABLES = 'ba be bi bo bu ca ce ci co cu da de di do du fa fe fi fo fu ga ge gi go gu la le li lo lu ma me mi mo mu na ne ni no nu pa pe pi po pu ra re ri ro ru sa se si so su ta te ti to tu va ve vi vo vu za ze zi zo zu'.split(
  ' '
)

const vocabulary = []
const seen = new Set()
while (vocabulary.length < 40_000) {
  const syllables = 1 + Math.floor(random() * 4)
  let word = ''
  for (let i = 0; i < syllables; i++) word += SYLLABLES[Math.floor(random() * SYLLABLES.length)]
  if (random() < 0.3) word += 'n'
  if (!seen.has(word)) {
    seen.add(word)
    vocabulary.push(word)
  }
}

const cumulative = new Float64Array(vocabulary.length)
let total = 0
for (let i = 0; i < vocabulary.length; i++) {
  total += 1 / (i + 1)
  cumulative[i] = total
}

function zipfWord() {
  const target = random() * total
  let lo = 0
  let hi = cumulative.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (cumulative[mid] < target) lo = mid + 1
    else hi = mid
  }
  return vocabulary[lo]
}

function sentence(words) {
  const out = new Array(words)
  for (let i = 0; i < words; i++) out[i] = zipfWord()
  return out.join(' ')
}

const COLLECTIONS = ['articles', 'books', 'theses', 'reports', 'preprints', 'notes']
const SECTIONS = ['Abstract', 'Introduction', 'Background', 'Methods', 'Results', 'Discussion', 'Conclusion']

function makeDoc(i) {
  const paper = Math.floor(i / 80)
  const embedding = new Array(DIMS)
  let norm = 0
  for (let d = 0; d < DIMS; d++) {
    // Box-Muller gaussian, normalized below: a random unit vector
    const g = Math.sqrt(-2 * Math.log(random() || 1e-12)) * Math.cos(2 * Math.PI * random())
    embedding[d] = g
    norm += g * g
  }
  norm = Math.sqrt(norm)
  for (let d = 0; d < DIMS; d++) embedding[d] /= norm

  return {
    id: `p${i}`,
    text: sentence(150 + Math.floor(random() * 101)),
    section: SECTIONS[i % SECTIONS.length],
    title: `Paper ${paper}: ${sentence(6)}`,
    itemKey: `K${paper.toString(36).toUpperCase().padStart(7, '0')}`,
    page: 1 + (i % 80),
    year: 1990 + (paper % 35),
    collection: COLLECTIONS[paper % COLLECTIONS.length],
    embedding
  }
}

const schema = {
  text: 'string',
  section: 'string',
  title: 'string',
  itemKey: 'string',
  page: 'number',
  year: 'number',
  collection: 'enum',
  embedding: `vector[${DIMS}]`
}

function memory() {
  const m = process.memoryUsage()
  return m.heapUsed + m.arrayBuffers
}

const MB = 1024 * 1024
const fmt = (bytes) => `${(bytes / MB).toFixed(1)} MB`
const secs = (ms) => `${(ms / 1000).toFixed(2)} s`

// includeVectors: true everywhere, because searches without it currently overwrite the vectors of the stored
// documents they return with null.
function probe(db) {
  const query = Array.from(db.data.docs.docs[1].embedding)
  return {
    count: count(db),
    text: search(db, { term: `${vocabulary[3]} ${vocabulary[50]}`, limit: 5, includeVectors: true }).hits.map(
      (h) => h.id
    ),
    filtered: search(db, {
      term: vocabulary[10],
      where: { year: { gt: 2000 }, collection: { eq: 'books' } },
      limit: 5,
      includeVectors: true
    }).hits.map((h) => h.id),
    vector: searchVector(db, {
      vector: { value: query, property: 'embedding' },
      limit: 3,
      includeVectors: true
    }).hits.map((h) => h.id)
  }
}

async function run(n) {
  console.log(`\n=== ${n.toLocaleString()} passages, ${DIMS}-dim vectors ===`)
  let t = performance.now()
  const db = create({ schema })
  const BATCH = 1000
  for (let i = 0; i < n; i += BATCH) {
    const docs = []
    for (let j = i; j < Math.min(n, i + BATCH); j++) docs.push(makeDoc(j))
    insertMultiple(db, docs, BATCH)
  }
  console.log(`build: ${secs(performance.now() - t)}`)
  const expected = probe(db)
  const result = { docs: n, dims: DIMS, segmentSize: SEGMENT }

  if (RUN_JSON) {
    gc()
    const before = memory()
    t = performance.now()
    try {
      const chunked = save(db, { format: 'chunked' })
      result.chunkedSaveMs = performance.now() - t
      let chars = 0
      for (const chunk of chunked.chunks) chars += chunk.length
      result.chunkedBytes = chars + chunked.chunks.length - 1 // stringifyChunked joins with "\n" (ASCII corpus)
      result.chunkedExtraMemory = memory() - before
      console.log(
        `chunked JSON: ${fmt(result.chunkedBytes)}, save ${secs(result.chunkedSaveMs)}, held ${fmt(result.chunkedExtraMemory)}`
      )
      const db2 = create({ schema })
      t = performance.now()
      await loadAsync(db2, chunked)
      result.chunkedLoadMs = performance.now() - t
      console.log(`chunked JSON loadAsync: ${secs(result.chunkedLoadMs)}`)
    } catch (error) {
      result.chunkedError = String(error)
      console.log(`chunked JSON failed: ${error}`)
    }
    gc()
  }

  // Binary: stream to a file
  const file = join(OUT, `snapshot-${n}.zbsb`)
  gc()
  const baseline = memory()
  let peak = 0
  let livePeak = 0
  let largestSegment = 0
  let segments = 0
  t = performance.now()
  const out = createWriteStream(file)
  for await (const segment of saveBinary(db, { segmentSize: SEGMENT })) {
    segments++
    largestSegment = Math.max(largestSegment, segment.length)
    if (!out.write(segment)) await once(out, 'drain')
    peak = Math.max(peak, memory() - baseline)
    if (segments % 64 === 0) {
      gc()
      livePeak = Math.max(livePeak, memory() - baseline)
    }
  }
  out.end()
  await once(out, 'finish')
  result.binarySaveMs = performance.now() - t
  result.binaryBytes = statSync(file).size
  result.binarySegments = segments
  result.largestSegment = largestSegment
  result.saveExtraMemoryPeak = peak
  result.saveExtraMemoryLive = livePeak
  console.log(
    `binary: ${fmt(result.binaryBytes)} in ${segments} segments (largest ${fmt(largestSegment)}), save ${secs(result.binarySaveMs)}`
  )
  console.log(`binary save extra memory: peak ${fmt(peak)} (incl. garbage), live after GC ${fmt(livePeak)}`)
  if (result.chunkedBytes) {
    result.ratio = result.chunkedBytes / result.binaryBytes
    console.log(`size ratio chunked/binary: ${result.ratio.toFixed(2)}x`)
  }

  // Load from a file stream into a fresh database
  const docsBefore = { ...expected }
  db.data = null // drop the source index
  gc()
  const loadBaseline = memory()
  const db3 = create({ schema: { __placeholder: 'string' } })
  t = performance.now()
  let longestBlock = 0
  let last = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    longestBlock = Math.max(longestBlock, now - last)
    last = now
  }, 1)
  await loadBinary(db3, createReadStream(file, { highWaterMark: 1024 * 1024 }))
  clearInterval(timer)
  result.binaryLoadMs = performance.now() - t
  result.loadLongestBlockMs = longestBlock
  gc()
  result.loadedHeap = memory() - loadBaseline
  console.log(
    `binary loadBinary (file stream): ${secs(result.binaryLoadMs)}, longest event-loop block ~${longestBlock.toFixed(0)} ms`
  )
  const actual = probe(db3)
  result.identicalResults = JSON.stringify(actual) === JSON.stringify(docsBefore)
  console.log(`same search results after reload: ${result.identicalResults}`)
  rmSync(file)
  return result
}

const results = []
for (const n of sizes) {
  results.push(await run(n))
  gc()
}
console.log('\nJSON:', JSON.stringify(results, null, 2))
