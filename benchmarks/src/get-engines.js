import { createRequire } from 'node:module'
import * as orama from '@orama/orama'
import * as zbsearch from 'zbsearch'
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

export const versions = {
  orama: require('@orama/orama/package.json').version,
  zbsearch: require('zbsearch/package.json').version,
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
    })
}

function createPopulatedDatabases() {
  const dbOrama = create.orama()
  const dbZBSearch = create.zbsearch()

  orama.insertMultiple(dbOrama, dataset, dataset.length)
  zbsearch.insertMultiple(dbZBSearch, dataset, dataset.length)

  return { dbOrama, dbZBSearch }
}

const { dbOrama, dbZBSearch } = createPopulatedDatabases()

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
  ...alternateInsertMultiple
}

export const searchPlain = {
  orama: () => {
    orama.search(dbOrama, searchParams.plain)
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, searchParams.plain)
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
  ...alternateSearchWithFilters
}

export const searchWithLongTextAndComplexFilters = {
  orama: () => {
    orama.search(dbOrama, searchParams.complex)
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, searchParams.complex)
  },
  ...alternateSearchWithLongTextAndComplexFilters
}
