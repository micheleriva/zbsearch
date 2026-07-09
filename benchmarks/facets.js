import b from 'benny'
import {
  versions,
  searchWithFacets,
  searchWithFacetsBroad,
  searchWithFacetsFiltered,
  searchWithFacetsLongText
} from './src/get-facets-engines.js'

const oramaLabel = `Orama ${versions.orama}`
const zbsearchLabel = `ZBSearch ${versions.zbsearch}`

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

await addComparison('search with facets', {
  name: 'search with facets',
  orama: searchWithFacets.orama,
  zbsearch: searchWithFacets.zbsearch
})

await addComparison('search with facets (all documents)', {
  name: 'search with facets (all documents)',
  orama: searchWithFacetsBroad.orama,
  zbsearch: searchWithFacetsBroad.zbsearch
})

await addComparison('search with facets and filters', {
  name: 'search with facets and filters',
  orama: searchWithFacetsFiltered.orama,
  zbsearch: searchWithFacetsFiltered.zbsearch
})

await addComparison('search with facets, long text and complex filters', {
  name: 'search with facets, long text and complex filters',
  orama: searchWithFacetsLongText.orama,
  zbsearch: searchWithFacetsLongText.zbsearch
})
