import b from 'benny'
import { insert, insertMultiple, searchPlain, searchWithFilters, searchWithLongTextAndComplexFilters } from './src/get-zbsearch.js'

function benchmarkInsert() {
  return b.suite('insert',
    b.add('insert in ZBSearch 2.1.1', async () => {
      await insert.zbsearch211()
    }),
    b.add('insert in ZBSearch 3.0.0-rc-2', () => {
      insert.zbsearch300rc2()
    }),
    b.add('insert in ZBSearch latest', () => {
      insert.zbsearchLatest()
    }),
    b.add('insert in ZBSearch latest with PT15', () => {
      insert.zbsearchLatestPT15()
    }),
    b.add('insert in ZBSearch latest with QPS', () => {
      insert.zbsearchLatestQPS()
    }),
    b.cycle(),
    b.complete(),
    b.save({ file: 'insert', version: '1.0.0' }),
    b.save({ file: 'insert', format: 'chart.html' }),
  )
}

function benchmarkInsertMultiple() {
  return b.suite('insert multiple',
    b.add('insert multiple in ZBSearch 2.1.1', async () => {
      await insertMultiple.zbsearch211()
    }),
    b.add('insert multiple in ZBSearch 3.0.0-rc-2', () => {
      insertMultiple.zbsearch300rc2()
    }),
    b.add('insert multiple in ZBSearch latest', () => {
      insertMultiple.zbsearchLatest()
    }),
    b.add('insert multiple in ZBSearch latest with PT15', () => {
      insertMultiple.zbsearchLatestPT15()
    }),
    b.add('insert multiple in ZBSearch latest with QPS', () => {
      insertMultiple.zbsearchLatestQPS()
    }),
    b.cycle(),
    b.complete(),
    b.save({ file: 'insert multiple', version: '1.0.0' }),
    b.save({ file: 'insert multiple', format: 'chart.html' }),
  )
}

function benchmarkSearch() {
  return b.suite('plain search',
    b.add('plain search in ZBSearch 2.1.1', async () => {
      await searchPlain.zbsearch211()
    }),
    b.add('plain search in ZBSearch 3.0.0-rc-2', () => {
      searchPlain.zbsearch300rc2()
    }),
    b.add('plain search in ZBSearch latest', () => {
      searchPlain.zbsearchLatest()
    }),
    b.add('plain search in ZBSearch latest with PT15', () => {
      searchPlain.zbsearchLatestPT15()
    }),
    b.add('plain search in ZBSearch latest with QPS', () => {
      searchPlain.zbsearchLatestQPS()
    }),
    b.cycle(),
    b.complete(),
    b.save({ file: 'plain search', version: '1.0.0' }),
    b.save({ file: 'plain search', format: 'chart.html' }),
  )  
}

function benchmarkSearchWithFilters() {
  return b.suite('search with filters',
    b.add('search with filters in ZBSearch 2.1.1', async () => {
      await searchWithFilters.zbsearch211()
    }),
    b.add('search with filters in ZBSearch 3.0.0-rc-2', () => {
      searchWithFilters.zbsearch300rc2()
    }),
    b.add('search with filters in ZBSearch latest', () => {
      searchWithFilters.zbsearchLatest()
    }),
    b.add('search with filters in ZBSearch latest with PT15', () => {
      searchWithFilters.zbsearchLatestPT15()
    }),
    b.add('search with filters in ZBSearch latest with QPS', () => {
      searchWithFilters.zbsearchLatestQPS()
    }),
    b.cycle(),
    b.complete(),
    b.save({ file: 'search with filters', version: '1.0.0' }),
    b.save({ file: 'search with filters', format: 'chart.html' }),
  )  
}

function benchmarkSearchWithLongTextAndComplexFilters() {
  return b.suite('search with long text and complex filters',
    b.add('search with long text and complex filters in ZBSearch 2.1.1', async () => {
      await searchWithLongTextAndComplexFilters.zbsearch211()
    }),
    b.add('search with long text and complex filters in ZBSearch 3.0.0-rc-2', () => {
      searchWithLongTextAndComplexFilters.zbsearch300rc2()
    }),
    b.add('search with long text and complex filters in ZBSearch latest', () => {
      searchWithLongTextAndComplexFilters.zbsearchLatest()
    }),
    b.add('search with long text and complex filters in ZBSearch latest with PT15', () => {
      searchWithLongTextAndComplexFilters.zbsearchLatestPT15()
    }),
    b.add('search with long text and complex filters in ZBSearch latest with QPS', () => {
      searchWithLongTextAndComplexFilters.zbsearchLatestQPS()
    }),
    b.cycle(),
    b.complete(),
    b.save({ file: 'search with long text and complex filters', version: '1.0.0' }),
    b.save({ file: 'ssearch with long text and complex filters', format: 'chart.html' }),
  )  
}

await benchmarkInsert()
await benchmarkInsertMultiple()
await benchmarkSearch()
await benchmarkSearchWithFilters()
await benchmarkSearchWithLongTextAndComplexFilters()