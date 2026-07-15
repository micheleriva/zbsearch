import b from 'benny'
import {
  versions,
  insert,
  insertMultiple,
  searchPlain,
  searchWithFilters,
  searchWithLongTextAndComplexFilters
} from './src/get-engines.js'

const engines = [
  { key: 'orama', label: `Orama ${versions.orama}` },
  { key: 'zbsearch', label: `ZBSearch ${versions.zbsearch}` },
  { key: 'flexsearch', label: `FlexSearch ${versions.flexsearch}` },
  { key: 'fusejs', label: `Fuse.js ${versions.fusejs}` },
  { key: 'lunr', label: `Lunr ${versions.lunr}` },
  { key: 'minisearch', label: `MiniSearch ${versions.minisearch}` }
]

// FlexSearch is an in-memory text matcher without schema, filters, or persistence.
// It stays in insert benchmarks but is excluded from search workloads where the comparison is not meaningful.
// Lunr is excluded from single-document insert because it has no incremental add API, each update requires a full index rebuild.
const searchableEngines = engines.filter(({ key }) => key !== 'flexsearch')

function runSuite(name, cases, suiteEngines = engines) {
  return b.suite(
    name,
    ...suiteEngines.map(({ key, label }) => b.add(`${name} in ${label}`, cases[key])),
    b.cycle(),
    b.complete(),
    b.save({ file: name, version: '1.0.0' }),
    b.save({ file: name, format: 'chart.html' })
  )
}

await runSuite('insert', insert, engines.filter(({ key }) => key !== 'lunr'))
await runSuite('insert multiple', insertMultiple)
await runSuite('plain search (all terms)', searchPlain, searchableEngines)
await runSuite('search with filters', searchWithFilters, searchableEngines)
await runSuite('search with long text and complex filters', searchWithLongTextAndComplexFilters, searchableEngines)
