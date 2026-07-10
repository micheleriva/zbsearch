import { createRequire } from 'node:module'
import { formatBytes, formatDelta, measureEngineMemory } from './src/measure-memory.mjs'

const require = createRequire(import.meta.url)

const versions = {
  orama: require('@orama/orama/package.json').version,
  zbsearch: require('zbsearch/package.json').version
}

const SEARCH_WARMUP = 100

function printEngineReport(label, data) {
  console.log(`${label}`)
  console.log(`  Indexed heap delta: ${formatBytes(data.indexedDelta.heapUsed)}`)
  console.log(`  Indexed RSS delta:  ${formatBytes(data.indexedDelta.rss)}`)
  console.log(`  Indexed external: ${formatBytes(data.indexedDelta.external)}`)
  console.log(`  Heap after index: ${formatBytes(data.indexed.heapUsed)}`)
  console.log(`  RSS after index:  ${formatBytes(data.indexed.rss)}`)
  if (data.searchDelta) {
    console.log(`  Search heap delta (${data.searchIterations} queries): ${formatBytes(data.searchDelta.heapUsed)}`)
  }
  console.log(`  Serialized JSON:    ${formatBytes(data.serializedBytes)}`)
}

const orama = measureEngineMemory('orama', { searches: SEARCH_WARMUP })
const zbsearch = measureEngineMemory('zbsearch', { searches: SEARCH_WARMUP })

console.log(`Memory footprint benchmark (${orama.records} records, ${SEARCH_WARMUP} search warmup)`)
console.log('')

printEngineReport(`Orama ${versions.orama}`, orama)
console.log('')
printEngineReport(`ZBSearch ${versions.zbsearch}`, zbsearch)
console.log('')
console.log('Comparison (indexed heap delta)')
console.log(`  ${formatDelta('ZBSearch', zbsearch.indexedDelta.heapUsed, orama.indexedDelta.heapUsed)}`)
console.log('Comparison (indexed RSS delta)')
console.log(`  ${formatDelta('ZBSearch', zbsearch.indexedDelta.rss, orama.indexedDelta.rss)}`)
console.log('Comparison (serialized JSON)')
console.log(`  ${formatDelta('ZBSearch', zbsearch.serializedBytes, orama.serializedBytes)}`)
