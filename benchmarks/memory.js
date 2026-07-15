import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { formatBytes, formatDelta, measureEngineMemory } from './src/measure-memory.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

function pkgVersion(name) {
  return JSON.parse(readFileSync(join(__dirname, 'node_modules', name, 'package.json'), 'utf8')).version
}

const versions = {
  orama: pkgVersion('@orama/orama'),
  zbsearch: pkgVersion('zbsearch'),
  flexsearch: pkgVersion('flexsearch'),
  fusejs: pkgVersion('fuse.js'),
  lunr: pkgVersion('lunr'),
  minisearch: pkgVersion('minisearch')
}

const SEARCH_WARMUP = 100

const engines = [
  { key: 'orama', label: `Orama ${versions.orama}` },
  { key: 'zbsearch', label: `ZBSearch ${versions.zbsearch}` },
  { key: 'flexsearch', label: `FlexSearch ${versions.flexsearch}` },
  { key: 'fusejs', label: `Fuse.js ${versions.fusejs}` },
  { key: 'lunr', label: `Lunr ${versions.lunr}` },
  { key: 'minisearch', label: `MiniSearch ${versions.minisearch}` }
]

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

const results = Object.fromEntries(
  engines.map(({ key }) => [key, measureEngineMemory(key, { searches: SEARCH_WARMUP })])
)

console.log(`Memory footprint benchmark (${results.orama.records} records, ${SEARCH_WARMUP} search warmup)`)
console.log('')

for (const { key, label } of engines) {
  printEngineReport(label, results[key])
  console.log('')
}

console.log('Comparison (indexed heap delta)')
for (const { key, label } of engines.slice(1)) {
  console.log(`  ${formatDelta(label, results[key].indexedDelta.heapUsed, results.orama.indexedDelta.heapUsed)}`)
}

console.log('Comparison (indexed RSS delta)')
for (const { key, label } of engines.slice(1)) {
  console.log(`  ${formatDelta(label, results[key].indexedDelta.rss, results.orama.indexedDelta.rss)}`)
}

console.log('Comparison (serialized JSON)')
for (const { key, label } of engines.slice(1)) {
  console.log(`  ${formatDelta(label, results[key].serializedBytes, results.orama.serializedBytes)}`)
}
