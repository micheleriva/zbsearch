import * as orama from '@orama/orama'
import * as zbsearch from 'zbsearch'
import dataset from './dataset.json' with { type: 'json' }

const engine = process.argv[2]
const searchIterations = Number(process.argv[3] ?? 0)

const schema = {
  title: 'string',
  description: 'string',
  rating: 'number',
  genres: 'enum[]'
}

function gc() {
  if (global.gc) {
    global.gc()
    global.gc()
  }
}

function snapshot() {
  const usage = process.memoryUsage()
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    rss: usage.rss,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers
  }
}

function buildDatabase() {
  if (engine === 'orama') {
    const db = orama.create({ schema })
    orama.insertMultiple(db, dataset, 50)
    return db
  }

  if (engine === 'zbsearch') {
    const db = zbsearch.create({ schema })
    zbsearch.insertMultiple(db, dataset, 50)
    return db
  }

  throw new Error(`Unknown engine: ${engine}`)
}

function runSearch(db) {
  if (engine === 'orama') {
    orama.search(db, { term: 'Legend of Zelda' })
    return
  }

  zbsearch.search(db, { term: 'Legend of Zelda' })
}

gc()
const baseline = snapshot()
const db = buildDatabase()

gc()
const indexed = snapshot()

for (let i = 0; i < searchIterations; i++) {
  runSearch(db)
}

if (searchIterations > 0) {
  gc()
}

const afterSearch = searchIterations > 0 ? snapshot() : indexed

let serializedBytes = 0
if (engine === 'orama') {
  serializedBytes = Buffer.byteLength(JSON.stringify(orama.save(db)))
} else {
  serializedBytes = Buffer.byteLength(JSON.stringify(zbsearch.save(db)))
}

const output = {
  engine,
  records: dataset.length,
  searchIterations,
  baseline,
  indexed,
  afterSearch,
  indexedDelta: {
    heapUsed: indexed.heapUsed - baseline.heapUsed,
    rss: indexed.rss - baseline.rss,
    external: indexed.external - baseline.external
  },
  searchDelta:
    searchIterations > 0
      ? {
          heapUsed: afterSearch.heapUsed - indexed.heapUsed,
          rss: afterSearch.rss - indexed.rss,
          external: afterSearch.external - indexed.external
        }
      : null,
  serializedBytes
}

process.stdout.write(`${JSON.stringify(output)}\n`)
