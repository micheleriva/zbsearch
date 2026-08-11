import * as zbsearch from 'zbsearch'
import dataset from './src/dataset.json' with { type: 'json' }
import { stopWordTokenizer, databaseSortConfig } from './src/benchmark-config.js'

// Deliberately not importing ./src/get-engines.js: it builds populated databases for every engine at import time, which would run before the first measurement and skew it.
const schema = {
  title: 'string',
  description: 'string',
  rating: 'number',
  genres: 'enum[]'
}
const databaseComponents = { tokenizer: stopWordTokenizer }

// Measures main-thread responsiveness during indexing, not throughput.
// 
// `insertMultiple` is synchronous: it holds the thread for its whole duration, so a large build freezes the page.
// `insertMultipleAsync` does the same work in chunks and yields in between.
// The number that matters is therefore not how long the build takes, but the longest uninterrupted stretch during which nothing else can run.
// 
// Usage: node responsiveness.js [documentCount]

const DOC_COUNT = Number(process.argv[2] ?? 30_000)
const PROBE_INTERVAL = 4
const SETTLE = 50

function buildDocuments(target) {
  const docs = []
  let i = 0

  while (docs.length < target) {
    for (const record of dataset) {
      if (docs.length >= target) break
      docs.push({ ...record, id: `doc-${i++}` })
    }
  }

  return docs
}

function startProbe() {
  const gaps = []
  let last = performance.now()

  const timer = setInterval(() => {
    const now = performance.now()
    gaps.push(now - last)
    last = now
  }, PROBE_INTERVAL)

  return function stop() {
    clearInterval(timer)
    gaps.sort((a, b) => a - b)

    return {
      ticks: gaps.length,
      worst: gaps.at(-1) ?? Number.POSITIVE_INFINITY,
      p99: gaps[Math.floor(gaps.length * 0.99)] ?? Number.POSITIVE_INFINITY,
      median: gaps[Math.floor(gaps.length * 0.5)] ?? Number.POSITIVE_INFINITY
    }
  }
}

function MB(bytes) {
  return (bytes / 1024 / 1024).toFixed(0)
}

function formatMs(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}ms` : 'blocked'
}

const rows = []

async function measure(label, run) {
  await new Promise((resolve) => setTimeout(resolve, SETTLE))

  const stop = startProbe()
  const startedAt = performance.now()
  const db = await run()
  const total = performance.now() - startedAt
  const lag = stop()

  if (zbsearch.count(db) !== DOC_COUNT) {
    throw new Error(`${label}: expected ${DOC_COUNT} documents, got ${zbsearch.count(db)}`)
  }

  rows.push({ label, total, ...lag })
}

function printTable(title, entries) {
  console.log(`\n${title}\n`)
  console.log(
    `${'variant'.padEnd(44)}${'total'.padStart(10)}${'worst block'.padStart(16)}${'p99'.padStart(10)}${'median'.padStart(10)}${'yields'.padStart(9)}`
  )

  for (const row of entries) {
    console.log(
      row.label.padEnd(44) +
        `${row.total.toFixed(0)}ms`.padStart(10) +
        formatMs(row.worst).padStart(16) +
        formatMs(row.p99).padStart(10) +
        formatMs(row.median).padStart(10) +
        String(row.ticks).padStart(9)
    )
  }
}

const documents = buildDocuments(DOC_COUNT)
const createDatabase = () => zbsearch.create({ schema, components: databaseComponents, sort: databaseSortConfig })

console.log(`ZBSearch responsiveness - ${DOC_COUNT.toLocaleString()} documents, Node ${process.version}`)

await measure('insertMultiple (sync)', () => {
  const db = createDatabase()
  zbsearch.insertMultiple(db, documents)
  return db
})

for (const batchSize of [1000, 100, 25]) {
  await measure(`insertMultipleAsync (batch ${batchSize})`, async () => {
    const db = createDatabase()
    await zbsearch.insertMultipleAsync(db, documents, { batchSize })
    return db
  })
}

printTable('Indexing', rows.splice(0, rows.length))

const source = createDatabase()
zbsearch.insertMultiple(source, documents)

const monolithicText = JSON.stringify(zbsearch.save(source))

await measure(`load: JSON.parse + load (${MB(monolithicText.length)} MB)`, () => {
  const db = createDatabase()
  zbsearch.load(db, JSON.parse(monolithicText))
  return db
})

for (const chunkSize of [4096, 1024, 512, 128].map((k) => k * 1024)) {
  const text = zbsearch.stringifyChunked(zbsearch.save(source, { format: 'chunked', chunkSize }))

  const label = chunkSize === 512 * 1024 ? ' (default)' : ''
  await measure(`loadAsync: chunked @ ${chunkSize / 1024}KB${label}`, async () => {
    const db = createDatabase()
    await zbsearch.loadAsync(db, zbsearch.parseChunked(text))
    return db
  })
}

printTable('Loading a serialized index', rows)

console.log(
  '\nnote: "worst block" is the longest stretch the event loop could not run, and "blocked" means\n' +
    '      it never ran at all - the thread was held for the whole duration. A 60fps frame budget\n' +
    '      is 16.7ms; Chrome reports anything over 50ms as a long task.\n'
)
