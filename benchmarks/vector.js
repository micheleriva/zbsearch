import b from 'benny'
import {
  versions,
  vectorSearch,
  vectorSearchStrict,
  vectorSearchWithFilters,
  vectorSearchWithFacets,
  DOCUMENT_COUNT,
  VECTOR_DIMENSIONS
} from './src/get-vector-engines.js'

const oramaLabel = `Orama ${versions.orama}`
const zbsearchLabel = `ZBSearch ${versions.zbsearch}`
const datasetLabel = `${DOCUMENT_COUNT.toLocaleString()} docs, ${VECTOR_DIMENSIONS}d vectors`

function addComparison(suiteName, cases) {
  return b.suite(
    suiteName,
    b.add(`${cases.name} in ${oramaLabel}`, cases.orama),
    b.add(`${cases.name} in ${zbsearchLabel}`, cases.zbsearch),
    b.cycle(),
    b.complete(),
    b.save({ file: suiteName, version: '1.0.0' }),
    b.save({ file: suiteName, format: 'chart.html' })
  )
}

await addComparison(`vector search (${datasetLabel})`, {
  name: 'vector search',
  orama: vectorSearch.orama,
  zbsearch: vectorSearch.zbsearch
})

await addComparison(`vector search strict similarity (${datasetLabel})`, {
  name: 'vector search strict similarity',
  orama: vectorSearchStrict.orama,
  zbsearch: vectorSearchStrict.zbsearch
})

await addComparison(`vector search with filters (${datasetLabel})`, {
  name: 'vector search with filters',
  orama: vectorSearchWithFilters.orama,
  zbsearch: vectorSearchWithFilters.zbsearch
})

await addComparison(`vector search with facets (${datasetLabel})`, {
  name: 'vector search with facets',
  orama: vectorSearchWithFacets.orama,
  zbsearch: vectorSearchWithFacets.zbsearch
})
