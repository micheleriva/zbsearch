import { writeFileSync, mkdirSync, rmSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { buildSync } from 'esbuild'
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

const __dirname = dirname(fileURLToPath(import.meta.url))

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

/**
 * @typedef {object} EngineSide
 * @property {string} key - Result object key (e.g. "orama", "base", "pr")
 * @property {string} label - Human label for tables
 * @property {string} version
 * @property {object} lib - Module namespace with create/insert/search/...
 * @property {string} entry - Import path / file URL for bundle size measurement
 * @property {boolean} [useSort=true] - Pass databaseSortConfig on create
 * @property {string} [modulePath] - Absolute package root for isolated memory worker
 */

function createDb(side, { geo = false } = {}) {
  const options = {
    schema: geo ? geoSchema : schema,
    components: { tokenizer: stopWordTokenizer }
  }

  if (side.useSort !== false) {
    options.sort = databaseSortConfig
  }

  return side.lib.create(options)
}

function populate(side, db, records = dataset) {
  const ids = side.lib.insertMultiple(db, records, records.length)
  return { db, ids }
}

function createPopulated(side, options = {}) {
  const records = options.geo ? geoDataset : dataset
  return populate(side, createDb(side, options), records)
}

function installPin(side, db, docId) {
  if (!docId || typeof side.lib.insertPin !== 'function') {
    return false
  }

  side.lib.insertPin(db, {
    id: 'bench_pin',
    conditions: [{ anchoring: 'contains', pattern: 'zelda' }],
    consequence: {
      promote: [{ doc_id: docId, position: 0 }]
    }
  })
  return true
}

function memorySpec(side) {
  if (side.modulePath) {
    return { modulePath: side.modulePath }
  }
  return side.key
}

export function runPairComparisonSuites(left, right, options = {}) {
  const opsDurationMs = options.opsDurationMs ?? 800
  const opsWarmupMs = options.opsWarmupMs ?? 150
  const indexIterations = options.indexIterations ?? 8
  const skipBundle = options.skipBundle === true
  const skipMemory = options.skipMemory === true

  const results = []
  const sides = [left, right]

  const indexInsert = Object.fromEntries(
    sides.map((side) => [
      side.key,
      benchTime(
        () => {
          const db = createDb(side)
          for (const record of dataset) {
            side.lib.insert(db, record)
          }
        },
        { iterations: indexIterations }
      )
    ])
  )

  results.push({
    category: 'Indexing',
    name: 'Indexing (insert one-by-one)',
    unit: 'ms',
    higherIsBetter: false,
    [left.key]: indexInsert[left.key].medianMs,
    [right.key]: indexInsert[right.key].medianMs
  })

  const indexMultiple = Object.fromEntries(
    sides.map((side) => [
      side.key,
      benchTime(
        () => {
          const db = createDb(side)
          side.lib.insertMultiple(db, dataset, dataset.length)
        },
        { iterations: indexIterations }
      )
    ])
  )

  results.push({
    category: 'Indexing',
    name: 'Indexing (insertMultiple)',
    unit: 'ms',
    higherIsBetter: false,
    [left.key]: indexMultiple[left.key].medianMs,
    [right.key]: indexMultiple[right.key].medianMs
  })

  const dbs = Object.fromEntries(sides.map((side) => [side.key, createPopulated(side)]))

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
    const row = {
      category: 'Search',
      name,
      unit: 'ops',
      higherIsBetter: true
    }

    for (const side of sides) {
      const result = benchOps(() => side.lib.search(dbs[side.key].db, params), {
        durationMs: opsDurationMs,
        warmupMs: opsWarmupMs
      })
      row[side.key] = result.opsPerSec
    }

    results.push(row)
  }

  const pinDbs = Object.fromEntries(
    sides.map((side) => {
      const populated = createPopulated(side)
      return [side.key, { ...populated, hasPin: installPin(side, populated.db, populated.ids[0]) }]
    })
  )

  if (sides.every((side) => pinDbs[side.key].hasPin)) {
    const pinParams = { term: PLAIN_SEARCH_TERM, limit: SEARCH_LIMIT }
    const row = {
      category: 'Search',
      name: 'Search with results pinning',
      unit: 'ops',
      higherIsBetter: true
    }

    for (const side of sides) {
      const result = benchOps(() => side.lib.search(pinDbs[side.key].db, pinParams), {
        durationMs: opsDurationMs,
        warmupMs: opsWarmupMs
      })
      row[side.key] = result.opsPerSec
    }

    results.push(row)
  }

  const geoDbs = Object.fromEntries(
    sides.map((side) => [side.key, createPopulated(side, { geo: true })])
  )

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
    const row = {
      category: 'Geosearch',
      name,
      unit: 'ops',
      higherIsBetter: true
    }

    for (const side of sides) {
      const result = benchOps(() => side.lib.search(geoDbs[side.key].db, params), {
        durationMs: opsDurationMs,
        warmupMs: opsWarmupMs
      })
      row[side.key] = result.opsPerSec
    }

    results.push(row)
  }

  const removeResult = Object.fromEntries(
    sides.map((side) => [
      side.key,
      benchTime(
        () => {
          const { db, ids } = createPopulated(side)
          for (let i = 0; i < 100; i++) {
            side.lib.remove(db, ids[i])
          }
        },
        { iterations: 6 }
      )
    ])
  )

  results.push({
    category: 'Mutations',
    name: 'Remove 100 documents',
    unit: 'ms',
    higherIsBetter: false,
    [left.key]: removeResult[left.key].medianMs,
    [right.key]: removeResult[right.key].medianMs
  })

  if (!skipMemory) {
    const mem = Object.fromEntries(
      sides.map((side) => [side.key, measureEngineMemory(memorySpec(side), { searches: 50 })])
    )

    results.push({
      category: 'Memory',
      name: 'Memory footprint (heap delta)',
      unit: 'bytes',
      higherIsBetter: false,
      [left.key]: mem[left.key].indexedDelta.heapUsed,
      [right.key]: mem[right.key].indexedDelta.heapUsed
    })

    results.push({
      category: 'Memory',
      name: 'Memory footprint (RSS delta)',
      unit: 'bytes',
      higherIsBetter: false,
      [left.key]: mem[left.key].indexedDelta.rss,
      [right.key]: mem[right.key].indexedDelta.rss
    })

    results.push({
      category: 'Memory',
      name: 'Serialized index size (JSON)',
      unit: 'bytes',
      higherIsBetter: false,
      [left.key]: mem[left.key].serializedBytes,
      [right.key]: mem[right.key].serializedBytes
    })
  }

  if (!skipBundle) {
    const bundles = measurePackageBundles(sides)
    results.push({
      category: 'Bundle',
      name: 'JS bundle size (minified)',
      unit: 'bytes',
      higherIsBetter: false,
      [left.key]: bundles[left.key].minified,
      [right.key]: bundles[right.key].minified
    })
    results.push({
      category: 'Bundle',
      name: 'JS bundle size (min+gzip)',
      unit: 'bytes',
      higherIsBetter: false,
      [left.key]: bundles[left.key].gzip,
      [right.key]: bundles[right.key].gzip
    })
  }

  return {
    versions: {
      [left.key]: left.version,
      [right.key]: right.version
    },
    labels: {
      [left.key]: left.label,
      [right.key]: right.label
    },
    keys: { left: left.key, right: right.key },
    records: dataset.length,
    results,
    meta: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      date: new Date().toISOString()
    }
  }
}

function measurePackageBundles(sides) {
  const outDir = join(__dirname, '../../.compare-bundle')
  mkdirSync(outDir, { recursive: true })

  const sizes = {}

  for (const side of sides) {
    const outfile = join(outDir, `${side.key}.mjs`)
    const source = `
      import { create, insert, insertMultiple, search, remove, save, load } from ${JSON.stringify(side.entry)}
      export { create, insert, insertMultiple, search, remove, save, load }
    `
    const entryFile = join(outDir, `${side.key}-entry.mjs`)
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
    sizes[side.key] = { minified, gzip }
  }

  rmSync(outDir, { recursive: true, force: true })
  return sizes
}
