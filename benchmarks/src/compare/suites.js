import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync, rmSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { buildSync } from 'esbuild'
import * as orama from '@orama/orama'
import * as zbsearch from 'zbsearch'
import dataset from '../dataset.json' with { type: 'json' }
import {
  SEARCH_LIMIT,
  stopWordTokenizer,
  databaseSortConfig,
  PLAIN_SEARCH_TERM,
  FILTER_SEARCH_TERM,
  COMPLEX_SEARCH_TERM
} from '../benchmark-config.js'
import { withGeoPoints, GEO_SEARCH_CENTER, GEO_RADIUS_KM } from './geo-dataset.js'
import { benchOps, benchTime } from './timer.js'
import { measureEngineMemory } from '../measure-memory.mjs'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

export const versions = {
  orama: require('@orama/orama/package.json').version,
  zbsearch: require('zbsearch/package.json').version
}

const schema = {
  title: 'string',
  description: 'string',
  rating: 'number',
  genres: 'enum[]'
}

const geoSchema = {
  ...schema,
  location: 'geopoint'
}

const geoDataset = withGeoPoints(dataset)

const ratingRanges = {
  ranges: [
    { from: 0, to: 3 },
    { from: 3, to: 4 },
    { from: 4, to: 5 }
  ]
}

function createDb(engine, { geo = false } = {}) {
  const lib = engine === 'orama' ? orama : zbsearch
  const options = {
    schema: geo ? geoSchema : schema,
    components: { tokenizer: stopWordTokenizer }
  }

  // Keep insert benchmarks fair: zbsearch enables sort indexes by default.
  if (engine === 'zbsearch') {
    options.sort = databaseSortConfig
  }

  return lib.create(options)
}

function populate(engine, db, records = dataset) {
  const lib = engine === 'orama' ? orama : zbsearch
  const ids = lib.insertMultiple(db, records, records.length)
  return { db, ids }
}

function createPopulated(engine, options = {}) {
  const records = options.geo ? geoDataset : dataset
  return populate(engine, createDb(engine, options), records)
}

function installPin(engine, db, docId) {
  const lib = engine === 'orama' ? orama : zbsearch
  if (!docId || typeof lib.insertPin !== 'function') {
    return false
  }

  lib.insertPin(db, {
    id: 'bench_pin',
    conditions: [{ anchoring: 'contains', pattern: 'zelda' }],
    consequence: {
      promote: [{ doc_id: docId, position: 0 }]
    }
  })
  return true
}

/**
 * Run all Orama vs ZBSearch suites and return raw numeric results.
 */
export function runComparisonSuites(options = {}) {
  const opsDurationMs = options.opsDurationMs ?? 800
  const opsWarmupMs = options.opsWarmupMs ?? 150
  const indexIterations = options.indexIterations ?? 8

  const results = []

  // --- Indexing ---
  const indexInsert = {
    orama: benchTime(
      () => {
        const db = createDb('orama')
        for (const record of dataset) {
          orama.insert(db, record)
        }
      },
      { iterations: indexIterations }
    ),
    zbsearch: benchTime(
      () => {
        const db = createDb('zbsearch')
        for (const record of dataset) {
          zbsearch.insert(db, record)
        }
      },
      { iterations: indexIterations }
    )
  }

  results.push({
    category: 'Indexing',
    name: 'Indexing (insert one-by-one)',
    unit: 'ms',
    higherIsBetter: false,
    orama: indexInsert.orama.medianMs,
    zbsearch: indexInsert.zbsearch.medianMs
  })

  const indexMultiple = {
    orama: benchTime(
      () => {
        const db = createDb('orama')
        orama.insertMultiple(db, dataset, dataset.length)
      },
      { iterations: indexIterations }
    ),
    zbsearch: benchTime(
      () => {
        const db = createDb('zbsearch')
        zbsearch.insertMultiple(db, dataset, dataset.length)
      },
      { iterations: indexIterations }
    )
  }

  results.push({
    category: 'Indexing',
    name: 'Indexing (insertMultiple)',
    unit: 'ms',
    higherIsBetter: false,
    orama: indexMultiple.orama.medianMs,
    zbsearch: indexMultiple.zbsearch.medianMs
  })

  // --- Search (shared populated DBs) ---
  const { db: dbOrama } = createPopulated('orama')
  const { db: dbZB } = createPopulated('zbsearch')

  const searchCases = [
    {
      name: 'Prefix search (simple)',
      params: { term: 'Zel', limit: SEARCH_LIMIT, threshold: 0 }
    },
    {
      name: 'Exact match search',
      params: { term: 'Elden', exact: true, limit: SEARCH_LIMIT }
    },
    {
      name: 'Plain full-text search',
      params: { term: PLAIN_SEARCH_TERM, limit: SEARCH_LIMIT, threshold: 0 }
    },
    {
      name: 'Typo-tolerant search',
      params: { term: 'Eldan Ring', tolerance: 1, limit: SEARCH_LIMIT }
    },
    {
      name: 'Search with filters',
      params: {
        term: FILTER_SEARCH_TERM,
        where: { rating: { gte: 4 } },
        limit: SEARCH_LIMIT
      }
    },
    {
      name: 'Complex query + filters',
      params: {
        term: COMPLEX_SEARCH_TERM,
        where: { rating: { gte: 4 }, genres: { containsAll: ['Shooter'] } },
        limit: SEARCH_LIMIT
      }
    },
    {
      name: 'Search with facets',
      params: {
        term: 'adventure',
        facets: { genres: {}, rating: ratingRanges },
        limit: SEARCH_LIMIT
      }
    },
    {
      name: 'Facets + filters',
      params: {
        term: 'game',
        where: { rating: { gte: 4 } },
        facets: { genres: {}, rating: ratingRanges },
        limit: SEARCH_LIMIT
      }
    },
    {
      name: 'Field boosting',
      params: {
        term: PLAIN_SEARCH_TERM,
        boost: { title: 2, description: 0.5 },
        limit: SEARCH_LIMIT
      }
    }
  ]

  for (const { name, params } of searchCases) {
    const oramaResult = benchOps(() => orama.search(dbOrama, params), {
      durationMs: opsDurationMs,
      warmupMs: opsWarmupMs
    })
    const zbResult = benchOps(() => zbsearch.search(dbZB, params), {
      durationMs: opsDurationMs,
      warmupMs: opsWarmupMs
    })

    results.push({
      category: 'Search',
      name,
      unit: 'ops',
      higherIsBetter: true,
      orama: oramaResult.opsPerSec,
      zbsearch: zbResult.opsPerSec
    })
  }

  // --- Pinning ---
  const { db: dbOramaPin, ids: oramaPinIds } = createPopulated('orama')
  const { db: dbZBPin, ids: zbPinIds } = createPopulated('zbsearch')
  const oramaHasPin = installPin('orama', dbOramaPin, oramaPinIds[0])
  const zbHasPin = installPin('zbsearch', dbZBPin, zbPinIds[0])

  if (oramaHasPin && zbHasPin) {
    const pinParams = { term: PLAIN_SEARCH_TERM, limit: SEARCH_LIMIT }
    const oramaPin = benchOps(() => orama.search(dbOramaPin, pinParams), {
      durationMs: opsDurationMs,
      warmupMs: opsWarmupMs
    })
    const zbPin = benchOps(() => zbsearch.search(dbZBPin, pinParams), {
      durationMs: opsDurationMs,
      warmupMs: opsWarmupMs
    })

    results.push({
      category: 'Search',
      name: 'Search with results pinning',
      unit: 'ops',
      higherIsBetter: true,
      orama: oramaPin.opsPerSec,
      zbsearch: zbPin.opsPerSec
    })
  }

  // --- Geosearch ---
  const { db: dbOramaGeo } = createPopulated('orama', { geo: true })
  const { db: dbZBGeo } = createPopulated('zbsearch', { geo: true })

  const geoParams = {
    term: '',
    where: {
      location: {
        radius: {
          coordinates: GEO_SEARCH_CENTER,
          unit: 'km',
          value: GEO_RADIUS_KM,
          inside: true
        }
      }
    },
    limit: SEARCH_LIMIT
  }

  const geoFilteredParams = {
    term: 'game',
    where: {
      rating: { gte: 4 },
      location: {
        radius: {
          coordinates: GEO_SEARCH_CENTER,
          unit: 'km',
          value: GEO_RADIUS_KM,
          inside: true
        }
      }
    },
    limit: SEARCH_LIMIT
  }

  for (const [name, params] of [
    ['Geosearch (radius)', geoParams],
    ['Geosearch + text + filters', geoFilteredParams]
  ]) {
    const oramaGeo = benchOps(() => orama.search(dbOramaGeo, params), {
      durationMs: opsDurationMs,
      warmupMs: opsWarmupMs
    })
    const zbGeo = benchOps(() => zbsearch.search(dbZBGeo, params), {
      durationMs: opsDurationMs,
      warmupMs: opsWarmupMs
    })

    results.push({
      category: 'Geosearch',
      name,
      unit: 'ops',
      higherIsBetter: true,
      orama: oramaGeo.opsPerSec,
      zbsearch: zbGeo.opsPerSec
    })
  }

  // --- Remove throughput ---
  const removeResult = {
    orama: benchTime(
      () => {
        const { db, ids } = createPopulated('orama')
        for (let i = 0; i < 100; i++) {
          orama.remove(db, ids[i])
        }
      },
      { iterations: 6 }
    ),
    zbsearch: benchTime(
      () => {
        const { db, ids } = createPopulated('zbsearch')
        for (let i = 0; i < 100; i++) {
          zbsearch.remove(db, ids[i])
        }
      },
      { iterations: 6 }
    )
  }

  results.push({
    category: 'Mutations',
    name: 'Remove 100 documents',
    unit: 'ms',
    higherIsBetter: false,
    orama: removeResult.orama.medianMs,
    zbsearch: removeResult.zbsearch.medianMs
  })

  // --- Memory ---
  const memOrama = measureEngineMemory('orama', { searches: 50 })
  const memZB = measureEngineMemory('zbsearch', { searches: 50 })

  results.push({
    category: 'Memory',
    name: 'Memory footprint (heap delta)',
    unit: 'bytes',
    higherIsBetter: false,
    orama: memOrama.indexedDelta.heapUsed,
    zbsearch: memZB.indexedDelta.heapUsed
  })

  results.push({
    category: 'Memory',
    name: 'Memory footprint (RSS delta)',
    unit: 'bytes',
    higherIsBetter: false,
    orama: memOrama.indexedDelta.rss,
    zbsearch: memZB.indexedDelta.rss
  })

  results.push({
    category: 'Memory',
    name: 'Serialized index size (JSON)',
    unit: 'bytes',
    higherIsBetter: false,
    orama: memOrama.serializedBytes,
    zbsearch: memZB.serializedBytes
  })

  // --- Bundle / package size ---
  const bundles = measurePackageBundles()
  results.push({
    category: 'Bundle',
    name: 'JS bundle size (minified)',
    unit: 'bytes',
    higherIsBetter: false,
    orama: bundles.orama.minified,
    zbsearch: bundles.zbsearch.minified
  })
  results.push({
    category: 'Bundle',
    name: 'JS bundle size (min+gzip)',
    unit: 'bytes',
    higherIsBetter: false,
    orama: bundles.orama.gzip,
    zbsearch: bundles.zbsearch.gzip
  })

  return {
    versions,
    records: dataset.length,
    results,
    meta: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      date: new Date().toISOString()
    }
  }
}

function measurePackageBundles() {
  const outDir = join(__dirname, '../../.compare-bundle')
  mkdirSync(outDir, { recursive: true })

  const packages = [
    { key: 'orama', entry: '@orama/orama' },
    { key: 'zbsearch', entry: 'zbsearch' }
  ]

  const sizes = {}

  for (const { key, entry } of packages) {
    const outfile = join(outDir, `${key}.mjs`)
    const source = `
      import { create, insert, insertMultiple, search, remove, save, load } from '${entry}'
      export { create, insert, insertMultiple, search, remove, save, load }
    `
    const entryFile = join(outDir, `${key}-entry.mjs`)
    writeFileSync(entryFile, source)

    buildSync({
      entryPoints: [entryFile],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      minify: true,
      treeShaking: true,
      logLevel: 'silent'
    })

    const minified = statSync(outfile).size
    const gzip = gzipSync(readFileSync(outfile)).length
    sizes[key] = { minified, gzip }
  }

  rmSync(outDir, { recursive: true, force: true })
  return sizes
}
