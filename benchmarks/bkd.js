import b from 'benny'
import {
  versions,
  insert,
  searchByRadiusSmall,
  searchByRadiusLarge,
  searchByRadiusSorted,
  searchByPolygon,
  contains
} from './src/get-bkd-trees.js'
import { POINT_COUNT } from './src/bkd-data.js'

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

await addComparison(`bkd insert (${POINT_COUNT.toLocaleString()} points)`, {
  name: 'insert',
  orama: insert.orama,
  zbsearch: insert.zbsearch
})

await addComparison('bkd search by radius (500m)', {
  name: 'search by radius (500m)',
  orama: searchByRadiusSmall.orama,
  zbsearch: searchByRadiusSmall.zbsearch
})

await addComparison('bkd search by radius (5km)', {
  name: 'search by radius (5km)',
  orama: searchByRadiusLarge.orama,
  zbsearch: searchByRadiusLarge.zbsearch
})

await addComparison('bkd search by radius sorted (5km)', {
  name: 'search by radius sorted (5km)',
  orama: searchByRadiusSorted.orama,
  zbsearch: searchByRadiusSorted.zbsearch
})

await addComparison('bkd search by polygon', {
  name: 'search by polygon',
  orama: searchByPolygon.orama,
  zbsearch: searchByPolygon.zbsearch
})

await addComparison(`bkd contains (${POINT_COUNT.toLocaleString()} lookups)`, {
  name: 'contains',
  orama: contains.orama,
  zbsearch: contains.zbsearch
})
