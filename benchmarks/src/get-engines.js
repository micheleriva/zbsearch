import { createRequire } from 'node:module'
import * as orama from '@orama/orama'
import * as zbsearch from 'zbsearch'
import dataset from './dataset.json' with { type: 'json' }

const require = createRequire(import.meta.url)

export const versions = {
  orama: require('@orama/orama/package.json').version,
  zbsearch: require('zbsearch/package.json').version
}

export const schema = {
  title: 'string',
  description: 'string',
  rating: 'number',
  genres: 'enum[]'
}

const create = {
  orama: () => orama.create({ schema }),
  zbsearch: () => zbsearch.create({ schema })
}

function createPopulatedDatabases() {
  const dbOrama = create.orama()
  const dbZBSearch = create.zbsearch()

  orama.insertMultiple(dbOrama, dataset, 50)
  zbsearch.insertMultiple(dbZBSearch, dataset, 50)

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
  }
}

export const insertMultiple = {
  orama: () => {
    const db = create.orama()
    orama.insertMultiple(db, dataset, 50)
  },
  zbsearch: () => {
    const db = create.zbsearch()
    zbsearch.insertMultiple(db, dataset, 50)
  }
}

export const searchPlain = {
  orama: () => {
    orama.search(dbOrama, { term: 'Legend of Zelda' })
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, { term: 'Legend of Zelda' })
  }
}

export const searchWithFilters = {
  orama: () => {
    orama.search(dbOrama, { term: 'Super Hero', where: { rating: { gte: 4 } } })
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, { term: 'Super Hero', where: { rating: { gte: 4 } } })
  }
}

export const searchWithLongTextAndComplexFilters = {
  orama: () => {
    orama.search(dbOrama, {
      term: 'classic run gun, action game focused on boss battles',
      where: { rating: { gte: 4 }, genres: { containsAll: ['Shooter'] } }
    })
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, {
      term: 'classic run gun, action game focused on boss battles',
      where: { rating: { gte: 4 }, genres: { containsAll: ['Shooter'] } }
    })
  }
}
