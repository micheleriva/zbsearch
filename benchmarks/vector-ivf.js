import b from 'benny'
import {
  versions,
  vectorSearch,
  vectorSearchStrict,
  vectorSearchWithFilters,
  DOCUMENT_COUNT,
  VECTOR_DIMENSIONS,
  ivfOptions
} from './src/get-vector-ivf-engines.js'

const oramaLabel = `Orama ${versions.orama} (flat)`
const zbsearchFlatLabel = `ZBSearch ${versions.zbsearch} (flat)`
const zbsearchIvfLabel = `ZBSearch ${versions.zbsearch} (IVF nlist=${ivfOptions.nlist}, nprobe=${ivfOptions.nprobe})`
const datasetLabel = `${DOCUMENT_COUNT.toLocaleString()} docs, ${VECTOR_DIMENSIONS}d vectors`

function addComparison(suiteName, cases) {
  return b.suite(
    suiteName,
    b.add(`${cases.name} in ${oramaLabel}`, cases.oramaFlat),
    b.add(`${cases.name} in ${zbsearchFlatLabel}`, cases.zbsearchFlat),
    b.add(`${cases.name} in ${zbsearchIvfLabel}`, cases.zbsearchIvf),
    b.cycle(),
    b.complete(),
    b.save({ file: suiteName, version: '1.0.0' }),
    b.save({ file: suiteName, format: 'chart.html' })
  )
}

await addComparison(`vector search flat vs ivf (${datasetLabel})`, {
  name: 'vector search',
  oramaFlat: vectorSearch.oramaFlat,
  zbsearchFlat: vectorSearch.zbsearchFlat,
  zbsearchIvf: vectorSearch.zbsearchIvf
})

await addComparison(`vector search strict similarity flat vs ivf (${datasetLabel})`, {
  name: 'vector search strict similarity',
  oramaFlat: vectorSearchStrict.oramaFlat,
  zbsearchFlat: vectorSearchStrict.zbsearchFlat,
  zbsearchIvf: vectorSearchStrict.zbsearchIvf
})

await addComparison(`vector search with filters flat vs ivf (${datasetLabel})`, {
  name: 'vector search with filters',
  oramaFlat: vectorSearchWithFilters.oramaFlat,
  zbsearchFlat: vectorSearchWithFilters.zbsearchFlat,
  zbsearchIvf: vectorSearchWithFilters.zbsearchIvf
})
