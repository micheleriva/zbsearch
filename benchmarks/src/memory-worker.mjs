import * as orama from '@orama/orama'
import * as zbsearch from 'zbsearch'
import dataset from './dataset.json' with { type: 'json' }
import { stopWordTokenizer, searchParams, databaseSortConfig } from './benchmark-config.js'
import {
  buildFlexSearchIndex,
  buildFuseIndex,
  buildLunrIndex,
  buildMiniSearchIndex,
  runFlexSearchPlain,
  runFusePlain,
  runLunrPlain,
  runMiniSearchPlain,
  serializeFlexSearchIndex,
  serializeFuseIndex,
  serializeLunrIndex,
  serializeMiniSearchIndex
} from './alternate-engines.js'

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
    const db = orama.create({ schema, components: { tokenizer: stopWordTokenizer } })
    orama.insertMultiple(db, dataset, dataset.length)
    return db
  }

  if (engine === 'zbsearch') {
    const db = zbsearch.create({
      schema,
      components: { tokenizer: stopWordTokenizer },
      sort: databaseSortConfig
    })
    zbsearch.insertMultiple(db, dataset, dataset.length)
    return db
  }

  if (engine === 'flexsearch') {
    return buildFlexSearchIndex()
  }

  if (engine === 'minisearch') {
    return buildMiniSearchIndex()
  }

  if (engine === 'fusejs') {
    return buildFuseIndex()
  }

  if (engine === 'lunr') {
    return buildLunrIndex()
  }

  throw new Error(`Unknown engine: ${engine}`)
}

function runSearch(db) {
  if (engine === 'orama') {
    orama.search(db, searchParams.plain)
    return
  }

  if (engine === 'zbsearch') {
    zbsearch.search(db, searchParams.plain)
    return
  }

  if (engine === 'flexsearch') {
    runFlexSearchPlain(db)
    return
  }

  if (engine === 'fusejs') {
    runFusePlain(db)
    return
  }

  if (engine === 'lunr') {
    runLunrPlain(db)
    return
  }

  runMiniSearchPlain(db)
}

function getSerializedBytes(db) {
  if (engine === 'orama') {
    return Buffer.byteLength(JSON.stringify(orama.save(db)))
  }

  if (engine === 'zbsearch') {
    return Buffer.byteLength(JSON.stringify(zbsearch.save(db)))
  }

  if (engine === 'flexsearch') {
    return serializeFlexSearchIndex(db)
  }

  if (engine === 'fusejs') {
    return serializeFuseIndex(db)
  }

  if (engine === 'lunr') {
    return serializeLunrIndex(db.index)
  }

  return serializeMiniSearchIndex(db)
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
const serializedBytes = getSerializedBytes(db)

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
