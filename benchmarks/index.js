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
  { key: 'zbsearch', label: `ZBSearch (BM25) ${versions.zbsearch}` },
  { key: 'zbsearch-qps', label: `ZBSearch (QPS) ${versions.qps}` },
  { key: 'zbsearch-pt15', label: `ZBSearch (PT15) ${versions.pt15}` },
  { key: 'flexsearch', label: `FlexSearch ${versions.flexsearch}` },
  { key: 'fusejs', label: `Fuse.js ${versions.fusejs}` },
  { key: 'lunr', label: `Lunr ${versions.lunr}` },
  { key: 'minisearch', label: `MiniSearch ${versions.minisearch}` }
]

// Lunr is excluded from single-document insert because it has no incremental add API;
// each update requires a full index rebuild.
const insertEngines = engines.filter(({ key }) => key !== 'lunr')

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

await runSuite('insert', insert, insertEngines)
await runSuite('insert multiple', insertMultiple)
await runSuite('plain search (all terms)', searchPlain)
await runSuite('search with filters', searchWithFilters)
await runSuite('search with long text and complex filters', searchWithLongTextAndComplexFilters)
