import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { create, insert, insertMultiple, search } from 'zbsearch'
import { pluginPT15 } from '@zbsearch/plugin-pt15'
import { pluginQPS } from '@zbsearch/plugin-qps'
import dataset from './dataset.json' with { type: 'json' }
import {
  searchParams,
  stopWordTokenizer,
  databaseSortConfig,
  SEARCH_LIMIT
} from './benchmark-config.js'

const benchmarksRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function pkgVersion(name) {
  return JSON.parse(readFileSync(join(benchmarksRoot, 'node_modules', name, 'package.json'), 'utf8')).version
}

export const versions = {
  zbsearch: pkgVersion('zbsearch'),
  qps: pkgVersion('@zbsearch/plugin-qps'),
  pt15: pkgVersion('@zbsearch/plugin-pt15')
}

export const schema = {
  title: 'string',
  description: 'string',
  rating: 'number',
  genres: 'enum[]'
}

const algorithmSearchParams = {
  ...searchParams,
  prefix: { term: 'L', limit: SEARCH_LIMIT, threshold: 0 },
  entireWords: { term: 'Legend of Zelda', limit: SEARCH_LIMIT, threshold: 0 }
}

function createDatabase(plugins = []) {
  return create({
    schema,
    plugins,
    components: {
      tokenizer: stopWordTokenizer
    },
    sort: databaseSortConfig
  })
}

const createFns = {
  bm25: () => createDatabase(),
  qps: () => createDatabase([pluginQPS()]),
  pt15: () => createDatabase([pluginPT15()])
}

function createPopulatedDatabases() {
  const dbBM25 = createFns.bm25()
  const dbQPS = createFns.qps()
  const dbPT15 = createFns.pt15()

  insertMultiple(dbBM25, dataset, dataset.length)
  insertMultiple(dbQPS, dataset, dataset.length)
  insertMultiple(dbPT15, dataset, dataset.length)

  return { dbBM25, dbQPS, dbPT15 }
}

const { dbBM25, dbQPS, dbPT15 } = createPopulatedDatabases()

export const insertCases = {
  bm25: () => {
    const db = createFns.bm25()
    for (const record of dataset) {
      insert(db, record)
    }
  },
  qps: () => {
    const db = createFns.qps()
    for (const record of dataset) {
      insert(db, record)
    }
  },
  pt15: () => {
    const db = createFns.pt15()
    for (const record of dataset) {
      insert(db, record)
    }
  }
}

export const insertMultipleCases = {
  bm25: () => {
    const db = createFns.bm25()
    insertMultiple(db, dataset, dataset.length)
  },
  qps: () => {
    const db = createFns.qps()
    insertMultiple(db, dataset, dataset.length)
  },
  pt15: () => {
    const db = createFns.pt15()
    insertMultiple(db, dataset, dataset.length)
  }
}

function searchCases(params) {
  return {
    bm25: () => {
      search(dbBM25, params)
    },
    qps: () => {
      search(dbQPS, params)
    },
    pt15: () => {
      search(dbPT15, params)
    }
  }
}

export const searchPlain = searchCases(algorithmSearchParams.plain)
export const searchWithFilters = searchCases(algorithmSearchParams.filters)
export const searchWithLongTextAndComplexFilters = searchCases(algorithmSearchParams.complex)
export const searchPrefix = searchCases(algorithmSearchParams.prefix)
export const searchEntireWords = searchCases(algorithmSearchParams.entireWords)
