import { createRequire } from 'node:module'
import * as orama from '@orama/orama'
import * as zbsearch from 'zbsearch'
import { createQueryVector, DOCUMENT_COUNT, generateVectorDocuments, VECTOR_DIMENSIONS } from './vector-data.js'

const require = createRequire(import.meta.url)

export const versions = {
  orama: require('@orama/orama/package.json').version,
  zbsearch: require('zbsearch/package.json').version
}

const schema = {
  title: 'string',
  category: 'string',
  rating: 'number',
  embedding: `vector[${VECTOR_DIMENSIONS}]`
}

const documents = generateVectorDocuments()
const queryVector = createQueryVector()

const ratingRanges = {
  ranges: [
    { from: 0, to: 2 },
    { from: 2, to: 4 },
    { from: 4, to: 5 }
  ]
}

function createPopulatedDatabases() {
  const dbOrama = orama.create({ schema })
  const dbZBSearch = zbsearch.create({ schema })

  orama.insertMultiple(dbOrama, documents, 100)
  zbsearch.insertMultiple(dbZBSearch, documents, 100)

  return { dbOrama, dbZBSearch }
}

const { dbOrama, dbZBSearch } = createPopulatedDatabases()

const vectorParams = {
  mode: 'vector',
  vector: {
    value: queryVector,
    property: 'embedding'
  }
}

export const vectorSearch = {
  orama: () => {
    orama.search(dbOrama, {
      ...vectorParams,
      similarity: 0.2
    })
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, {
      ...vectorParams,
      similarity: 0.2
    })
  }
}

export const vectorSearchStrict = {
  orama: () => {
    orama.search(dbOrama, {
      ...vectorParams,
      similarity: 0.8
    })
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, {
      ...vectorParams,
      similarity: 0.8
    })
  }
}

export const vectorSearchWithFilters = {
  orama: () => {
    orama.search(dbOrama, {
      ...vectorParams,
      similarity: 0.2,
      where: {
        rating: { gte: 3 }
      }
    })
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, {
      ...vectorParams,
      similarity: 0.2,
      where: {
        rating: { gte: 3 }
      }
    })
  }
}

export const vectorSearchWithFacets = {
  orama: () => {
    orama.search(dbOrama, {
      ...vectorParams,
      similarity: 0,
      facets: {
        category: {},
        rating: ratingRanges
      }
    })
  },
  zbsearch: () => {
    zbsearch.search(dbZBSearch, {
      ...vectorParams,
      similarity: 0,
      facets: {
        category: {},
        rating: ratingRanges
      }
    })
  }
}

export { DOCUMENT_COUNT, VECTOR_DIMENSIONS }
