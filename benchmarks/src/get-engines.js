import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as orama from '@orama/orama'
import * as zbsearch from 'zbsearch'
import { pluginPT15 } from '@zbsearch/plugin-pt15'
import { pluginQPS } from '@zbsearch/plugin-qps'
import dataset from './dataset.json' with { type: 'json' }
import { searchParams, stopWordTokenizer, databaseSortConfig } from './benchmark-config.js'
import {
  alternateVersions,
  insert as alternateInsert,
  insertMultiple as alternateInsertMultiple,
  searchPlain as alternateSearchPlain,
  searchWithFilters as alternateSearchWithFilters,
  searchWithLongTextAndComplexFilters as alternateSearchWithLongTextAndComplexFilters
} from './alternate-engines.js'

const require = createRequire(import.meta.url)
const benchmarksRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function pkgVersion(name) {
  return JSON.parse(readFileSync(join(benchmarksRoot, 'node_modules', name, 'package.json'), 'utf8')).version
}

export const versions = {
  orama: require('@orama/orama/package.json').version,
  zbsearch: require('zbsearch/package.json').version,
  qps: pkgVersion('@zbsearch/plugin-qps'),
  pt15: pkgVersion('@zbsearch/plugin-pt15'),
  ...alternateVersions
}

export const schema = {
  title: 'string',
  description: 'string',
  rating: 'number',
  genres: 'enum[]'
}

const databaseComponents = {
  tokenizer: stopWordTokenizer
}

const create = {
  orama: () => orama.create({ schema, components: databaseComponents }),
  zbsearch: () =>
    zbsearch.create({
      schema,
      components: databaseComponents,
      sort: databaseSortConfig
    }),
  'zbsearch-qps': () =>
    zbsearch.create({
      schema,
      plugins: [pluginQPS()],
      components: databaseComponents,
      sort: databaseSortConfig
    }),
  'zbsearch-pt15': () =>
    zbsearch.create({
      schema,
      plugins: [pluginPT15()],
      components: databaseComponents,
      sort: databaseSortConfig
    })
}

function createPopulatedDatabases() {
  const dbOrama = create.orama()
  const dbZBSearch = create.zbsearch()
  const dbZBSearchQps = create['zbsearch-qps']()
  const dbZBSearchPt15 = create['zbsearch-pt15']()

  orama.insertMultiple(dbOrama, dataset, dataset.length)
  zbsearch.insertMultiple(dbZBSearch, dataset, dataset.length)
  zbsearch.insertMultiple(dbZBSearchQps, dataset, dataset.length)
  zbsearch.insertMultiple(dbZBSearchPt15, dataset, dataset.length)

  return { dbOrama, dbZBSearch, dbZBSearchQps, dbZBSearchPt15 }
}

const { dbOrama, dbZBSearch, dbZBSearchQps, dbZBSearchPt15 } = createPopulatedDatabases()

export const insert = {
  orama: () => {
    const db = create.orama()
    for (const record of dataset) {
      orama.insert(db, record)
    }
  },
  zbsearch: () => {
    const db = create.zbsearch()
    for (const record of dataset) {
      zbsearch.insert(db, record)
    }
  },
  'zbsearch-qps': () => {
    const db = create['zbsearch-qps']()
    for (const record of dataset) {
      zbsearch.insert(db, record)
    }
  },
  'zbsearch-pt15': () => {
    const db = create['zbsearch-pt15']()
    for (const record of dataset) {
      zbsearch.insert(db, record)
    }
  },
  ...alternateInsert
}

export const insertMultiple = {
  orama: () => {
    const db = create.orama()
    orama.insertMultiple(db, dataset, dataset.length)
  },
  zbsearch: () => {
    const db = create.zbsearch()
    zbsearch.insertMultiple(db, dataset, dataset.length)
  },
  'zbsearch-qps': () => {
    const db = create['zbsearch-qps']()
    zbsearch.insertMultiple(db, dataset, dataset.length)
  },
  'zbsearch-pt15': () => {
    const db = create['zbsearch-pt15']()
    zbsearch.insertMultiple(db, dataset, dataset.length)
  },
  ...alternateInsertMultiple
}

export const searchPlain = {
  orama: () => {
    orama.search(dbOrama, searchParams.plain)
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, searchParams.plain)
  },
  'zbsearch-qps': () => {
    zbsearch.search(dbZBSearchQps, searchParams.plain)
  },
  'zbsearch-pt15': () => {
    zbsearch.search(dbZBSearchPt15, searchParams.plain)
  },
  ...alternateSearchPlain
}

export const searchWithFilters = {
  orama: () => {
    orama.search(dbOrama, searchParams.filters)
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, searchParams.filters)
  },
  'zbsearch-qps': () => {
    zbsearch.search(dbZBSearchQps, searchParams.filters)
  },
  'zbsearch-pt15': () => {
    zbsearch.search(dbZBSearchPt15, searchParams.filters)
  },
  ...alternateSearchWithFilters
}

export const searchWithLongTextAndComplexFilters = {
  orama: () => {
    orama.search(dbOrama, searchParams.complex)
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, searchParams.complex)
  },
  'zbsearch-qps': () => {
    zbsearch.search(dbZBSearchQps, searchParams.complex)
  },
  'zbsearch-pt15': () => {
    zbsearch.search(dbZBSearchPt15, searchParams.complex)
  },
  ...alternateSearchWithLongTextAndComplexFilters
}
