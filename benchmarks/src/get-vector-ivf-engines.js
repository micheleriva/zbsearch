import { createRequire } from 'node:module'
import * as orama from '@orama/orama'
import * as zbsearch from 'zbsearch'
import { RESERVED_VECTOR_INDEX_KEY } from 'zbsearch'
import { ivf } from 'zbsearch/trees/vector-ivf'
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

const ivfOptions = {
  nlist: Math.min(256, Math.max(16, Math.round(4 * Math.sqrt(DOCUMENT_COUNT)))),
  nprobe: 16,
  trainMin: 32
}

function createPopulatedDatabases() {
  const dbOramaFlat = orama.create({ schema })
  const dbZBSearchFlat = zbsearch.create({ schema })
  const dbZBSearchIvf = zbsearch.create({
    schema,
    indexes: {
      [RESERVED_VECTOR_INDEX_KEY]: ivf(ivfOptions)
    }
  })

  orama.insertMultiple(dbOramaFlat, documents, 100)
  zbsearch.insertMultiple(dbZBSearchFlat, documents, 100)
  zbsearch.insertMultiple(dbZBSearchIvf, documents, 100)

  // Ensure IVF is trained before benchmarking
  zbsearch.search(dbZBSearchIvf, {
    mode: 'vector',
    vector: { value: queryVector, property: 'embedding' },
    similarity: 0.2
  })

  return { dbOramaFlat, dbZBSearchFlat, dbZBSearchIvf }
}

const { dbOramaFlat, dbZBSearchFlat, dbZBSearchIvf } = createPopulatedDatabases()

const vectorParams = {
  mode: 'vector',
  vector: {
    value: queryVector,
    property: 'embedding'
  }
}

export const vectorSearch = {
  oramaFlat: () => {
    orama.search(dbOramaFlat, { ...vectorParams, similarity: 0.2 })
  },
  zbsearchFlat: () => {
    zbsearch.search(dbZBSearchFlat, { ...vectorParams, similarity: 0.2 })
  },
  zbsearchIvf: () => {
    zbsearch.search(dbZBSearchIvf, { ...vectorParams, similarity: 0.2 })
  }
}

export const vectorSearchStrict = {
  oramaFlat: () => {
    orama.search(dbOramaFlat, { ...vectorParams, similarity: 0.8 })
  },
  zbsearchFlat: () => {
    zbsearch.search(dbZBSearchFlat, { ...vectorParams, similarity: 0.8 })
  },
  zbsearchIvf: () => {
    zbsearch.search(dbZBSearchIvf, { ...vectorParams, similarity: 0.8 })
  }
}

export const vectorSearchWithFilters = {
  oramaFlat: () => {
    orama.search(dbOramaFlat, {
      ...vectorParams,
      similarity: 0.2,
      where: { rating: { gte: 3 } }
    })
  },
  zbsearchFlat: () => {
    zbsearch.search(dbZBSearchFlat, {
      ...vectorParams,
      similarity: 0.2,
      where: { rating: { gte: 3 } }
    })
  },
  zbsearchIvf: () => {
    zbsearch.search(dbZBSearchIvf, {
      ...vectorParams,
      similarity: 0.2,
      where: { rating: { gte: 3 } }
    })
  }
}

export { DOCUMENT_COUNT, VECTOR_DIMENSIONS, ivfOptions }
