import b from 'benny'
import {
  versions,
  insert,
  insertBatched,
  find,
  contains,
  rangeSearchNarrow,
  rangeSearchWide,
  greaterThan,
  lessThan,
  remove
} from './src/get-avl-trees.js'
import { KEY_COUNT, BATCH_REBALANCE_THRESHOLD } from './src/avl-data.js'

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

await addComparison(`avl insert (${KEY_COUNT.toLocaleString()} keys)`, {
  name: 'insert',
  orama: insert.orama,
  zbsearch: insert.zbsearch
})

await addComparison(`avl insert batched (${BATCH_REBALANCE_THRESHOLD} threshold)`, {
  name: 'insert batched',
  orama: insertBatched.orama,
  zbsearch: insertBatched.zbsearch
})

await addComparison(`avl find (${KEY_COUNT.toLocaleString()} lookups)`, {
  name: 'find',
  orama: find.orama,
  zbsearch: find.zbsearch
})

await addComparison(`avl contains (${KEY_COUNT.toLocaleString()} lookups)`, {
  name: 'contains',
  orama: contains.orama,
  zbsearch: contains.zbsearch
})

await addComparison('avl range search (narrow)', {
  name: 'range search (narrow)',
  orama: rangeSearchNarrow.orama,
  zbsearch: rangeSearchNarrow.zbsearch
})

await addComparison('avl range search (wide)', {
  name: 'range search (wide)',
  orama: rangeSearchWide.orama,
  zbsearch: rangeSearchWide.zbsearch
})

await addComparison('avl greater than', {
  name: 'greater than',
  orama: greaterThan.orama,
  zbsearch: greaterThan.zbsearch
})

await addComparison('avl less than', {
  name: 'less than',
  orama: lessThan.orama,
  zbsearch: lessThan.zbsearch
})

await addComparison(`avl remove (${(KEY_COUNT / 2).toLocaleString()} keys)`, {
  name: 'remove',
  orama: remove.orama,
  zbsearch: remove.zbsearch
})
