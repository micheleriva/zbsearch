import b from 'benny'
import {
  versions,
  insert,
  insertMultiple,
  searchPlain,
  searchWithFilters,
  searchWithLongTextAndComplexFilters
} from './src/get-engines.js'

const oramaLabel = `Orama ${versions.orama}`
const zbsearchLabel = `ZBSearch ${versions.zbsearch}`

function benchmarkInsert() {
  return b.suite(
    'insert',
    b.add(`insert in ${oramaLabel}`, () => {
      insert.orama()
    }),
    b.add(`insert in ${zbsearchLabel}`, () => {
      insert.zbsearch()
    }),
    b.cycle(),
    b.complete(),
    b.save({ file: 'insert', version: '1.0.0' }),
    b.save({ file: 'insert', format: 'chart.html' })
  )
}

function benchmarkInsertMultiple() {
  return b.suite(
    'insert multiple',
    b.add(`insert multiple in ${oramaLabel}`, () => {
      insertMultiple.orama()
    }),
    b.add(`insert multiple in ${zbsearchLabel}`, () => {
      insertMultiple.zbsearch()
    }),
    b.cycle(),
    b.complete(),
    b.save({ file: 'insert multiple', version: '1.0.0' }),
    b.save({ file: 'insert multiple', format: 'chart.html' })
  )
}

function benchmarkSearch() {
  return b.suite(
    'plain search',
    b.add(`plain search in ${oramaLabel}`, () => {
      searchPlain.orama()
    }),
    b.add(`plain search in ${zbsearchLabel}`, () => {
      searchPlain.zbsearch()
    }),
    b.cycle(),
    b.complete(),
    b.save({ file: 'plain search', version: '1.0.0' }),
    b.save({ file: 'plain search', format: 'chart.html' })
  )
}

function benchmarkSearchWithFilters() {
  return b.suite(
    'search with filters',
    b.add(`search with filters in ${oramaLabel}`, () => {
      searchWithFilters.orama()
    }),
    b.add(`search with filters in ${zbsearchLabel}`, () => {
      searchWithFilters.zbsearch()
    }),
    b.cycle(),
    b.complete(),
    b.save({ file: 'search with filters', version: '1.0.0' }),
    b.save({ file: 'search with filters', format: 'chart.html' })
  )
}

function benchmarkSearchWithLongTextAndComplexFilters() {
  return b.suite(
    'search with long text and complex filters',
    b.add(`search with long text and complex filters in ${oramaLabel}`, () => {
      searchWithLongTextAndComplexFilters.orama()
    }),
    b.add(`search with long text and complex filters in ${zbsearchLabel}`, () => {
      searchWithLongTextAndComplexFilters.zbsearch()
    }),
    b.cycle(),
    b.complete(),
    b.save({ file: 'search with long text and complex filters', version: '1.0.0' }),
    b.save({ file: 'search with long text and complex filters', format: 'chart.html' })
  )
}

await benchmarkInsert()
await benchmarkInsertMultiple()
await benchmarkSearch()
await benchmarkSearchWithFilters()
await benchmarkSearchWithLongTextAndComplexFilters()
