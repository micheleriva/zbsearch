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

const ratingRanges = {
  ranges: [
    { from: 0, to: 3 },
    { from: 3, to: 4 },
    { from: 4, to: 5 }
  ]
}

function createPopulatedDatabases() {
  const dbOrama = orama.create({ schema })
  const dbZBSearch = zbsearch.create({ schema })

  orama.insertMultiple(dbOrama, dataset, 50)
  zbsearch.insertMultiple(dbZBSearch, dataset, 50)

  return { dbOrama, dbZBSearch }
}

const { dbOrama, dbZBSearch } = createPopulatedDatabases()

export const searchWithFacets = {
  orama: () => {
    orama.search(dbOrama, {
      term: 'adventure',
      facets: {
        genres: {},
        rating: ratingRanges
      }
    })
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, {
      term: 'adventure',
      facets: {
        genres: {},
        rating: ratingRanges
      }
    })
  }
}

export const searchWithFacetsBroad = {
  orama: () => {
    orama.search(dbOrama, {
      term: '',
      facets: {
        genres: {},
        rating: ratingRanges
      }
    })
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, {
      term: '',
      facets: {
        genres: {},
        rating: ratingRanges
      }
    })
  }
}

export const searchWithFacetsFiltered = {
  orama: () => {
    orama.search(dbOrama, {
      term: 'game',
      where: { rating: { gte: 4 } },
      facets: {
        genres: {},
        rating: ratingRanges
      }
    })
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, {
      term: 'game',
      where: { rating: { gte: 4 } },
      facets: {
        genres: {},
        rating: ratingRanges
      }
    })
  }
}

export const searchWithFacetsLongText = {
  orama: () => {
    orama.search(dbOrama, {
      term: 'classic run gun, action game focused on boss battles',
      where: { rating: { gte: 4 }, genres: { containsAll: ['Shooter'] } },
      facets: {
        genres: {},
        rating: ratingRanges
      }
    })
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, {
      term: 'classic run gun, action game focused on boss battles',
      where: { rating: { gte: 4 }, genres: { containsAll: ['Shooter'] } },
      facets: {
        genres: {},
        rating: ratingRanges
      }
    })
  }
}
