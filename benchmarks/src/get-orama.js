import * as zbsearch211 from 'zbsearch_211'
import * as zbsearch300rc2 from 'zbsearch_300_rc_2'
import * as zbsearchLatest from 'zbsearch_latest'
import { pluginPT15 } from '@zbsearch/plugin-pt15'
import { pluginQPS } from '@zbsearch/plugin-qps'
import dataset from './dataset.json' assert { type: 'json' }

export const schema = {
  title: 'string',
  description: 'string',
  rating: 'number',
  genres: 'enum[]'
}

const create = {
  zbsearch211: () => zbsearch211.create({ schema }),
  zbsearch300rc2: () => zbsearch300rc2.create({ schema }),
  zbsearchLatest: () => zbsearchLatest.create({ schema }),
  zbsearchLatestPT15: () => zbsearchLatest.create({ schema, plugins: [pluginPT15()] }),
  zbsearchLatestQPS: () => zbsearchLatest.create({ schema, plugins: [pluginQPS()] })
}

export const db211 = await create.zbsearch211()
export const db300rc2 = create.zbsearch300rc2()
export const dbLatest = create.zbsearchLatest()
export const dbLatestPT15 = create.zbsearchLatestPT15()
export const dbLatestQPS = create.zbsearchLatestQPS()

export const insert = {
  zbsearch211: async () => {
    const db = await create.zbsearch211()
    for (const record of dataset) {
      await zbsearch211.insert(db, record)
    }
  },
  zbsearch300rc2: () => {
    const db = create.zbsearch300rc2()
    for (const record of dataset) {
      zbsearch300rc2.insert(db, record)
    }
  },
  zbsearchLatest: () => {
    const db = create.zbsearchLatest()
    for (const record of dataset) {
      zbsearchLatest.insert(db, record)
    }
  },
  zbsearchLatestPT15: () => {
    const db = create.zbsearchLatestPT15()
    for (const record of dataset) {
      zbsearchLatest.insert(db, record)
    }
  },
  zbsearchLatestQPS: () => {
    const db = create.zbsearchLatestQPS()
    for (const record of dataset) {
      zbsearchLatest.insert(db, record)
    }
  },
}

export const insertMultiple = {
  zbsearch211: async () => {
    await zbsearch211.insertMultiple(db211, dataset, 50)
  },
  zbsearch300rc2: () => {
    zbsearch300rc2.insertMultiple(db300rc2, dataset, 50)
  },
  zbsearchLatest: () => {
    zbsearchLatest.insertMultiple(dbLatest, dataset, 50)
  },
  zbsearchLatestPT15: () => {
    zbsearchLatest.insertMultiple(dbLatestPT15, dataset, 50)
  },
  zbsearchLatestQPS: () => {
    zbsearchLatest.insertMultiple(dbLatestQPS, dataset, 50)
  },
}

export const searchPlain = {
  zbsearch211: async () => {
    await zbsearch211.search(db211, { term: 'Legend of Zelda' })
  },
  zbsearch300rc2: () => {
    zbsearch300rc2.search(db300rc2, { term: 'Legend of Zelda' })
  },
  zbsearchLatest: () => {
    zbsearchLatest.search(dbLatest, { term: 'Legend of Zelda' })
  },
  zbsearchLatestPT15: () => {
    zbsearchLatest.search(dbLatestPT15, { term: 'Legend of Zelda' })
  },
  zbsearchLatestQPS: () => {
    zbsearchLatest.search(dbLatestQPS, { term: 'Legend of Zelda' })
  },
}

export const searchWithFilters = {
  zbsearch211: async () => {
    await zbsearch211.search(db211, { term: 'Super Hero', where: { rating: { gte: 4 } } })
  },
  zbsearch300rc2: () => {
    zbsearch300rc2.search(db300rc2, { term: 'Super Hero', where: { rating: { gte: 4 } } })
  },
  zbsearchLatest: () => {
    zbsearchLatest.search(dbLatest, { term: 'Super Hero', where: { rating: { gte: 4 } } })
  },
  zbsearchLatestPT15: () => {
    zbsearchLatest.search(dbLatestPT15, { term: 'Super Hero', where: { rating: { gte: 4 } } })
  },
  zbsearchLatestQPS: () => {
    zbsearchLatest.search(dbLatestQPS, { term: 'Super Hero', where: { rating: { gte: 4 } } })
  },
}

export const searchWithLongTextAndComplexFilters = {
  zbsearch211: async () => {
    await zbsearch211.search(db211, { term: 'classic run gun, action game focused on boss battles', where: { rating: { gte: 4 }, genres: { containsAll: ['Shooter'] } } })
  },
  zbsearch300rc2: () => {
    zbsearch300rc2.search(db300rc2, { term: 'classic run gun, action game focused on boss battles', where: { rating: { gte: 4 }, genres: { containsAll: ['Shooter'] } } })
  },
  zbsearchLatest: () => {
    zbsearchLatest.search(dbLatest, { term: 'classic run gun, action game focused on boss battles', where: { rating: { gte: 4 }, genres: { containsAll: ['Shooter'] } } })
  },
  zbsearchLatestPT15: () => {
    zbsearchLatest.search(dbLatestPT15, { term: 'classic run gun, action game focused on boss battles', where: { rating: { gte: 4 }, genres: { containsAll: ['Shooter'] } } })
  },
  zbsearchLatestQPS: () => {
    zbsearchLatest.search(dbLatestQPS, { term: 'classic run gun, action game focused on boss battles', where: { rating: { gte: 4 }, genres: { containsAll: ['Shooter'] } } })
  },
}