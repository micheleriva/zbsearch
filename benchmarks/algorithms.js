import b from 'benny'
import {
  versions,
  insertCases,
  insertMultipleCases,
  searchPlain,
  searchWithFilters,
  searchWithLongTextAndComplexFilters,
  searchPrefix,
  searchEntireWords
} from './src/get-algorithms-engines.js'

const algorithms = [
  { key: 'bm25', label: `ZBSearch BM25 ${versions.zbsearch}` },
  { key: 'qps', label: `ZBSearch QPS ${versions.qps}` },
  { key: 'pt15', label: `ZBSearch PT15 ${versions.pt15}` }
]

function runSuite(name, cases) {
  return b.suite(
    name,
    ...algorithms.map(({ key, label }) => b.add(`${name} in ${label}`, cases[key])),
    b.cycle(),
    b.complete(),
    b.save({ file: name, version: '1.0.0' }),
    b.save({ file: name, format: 'chart.html' })
  )
}

await runSuite('algorithms insert', insertCases)
await runSuite('algorithms insert multiple', insertMultipleCases)
await runSuite('algorithms plain search', searchPlain)
await runSuite('algorithms search with filters', searchWithFilters)
await runSuite('algorithms search with long text and complex filters', searchWithLongTextAndComplexFilters)
await runSuite('algorithms single-term prefix', searchPrefix)
await runSuite('algorithms entire words', searchEntireWords)
