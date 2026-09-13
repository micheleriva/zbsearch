// Size measurement for the static index format on a synthetic docs corpus.
// Usage: node scripts/measure.mjs [sections]
import { gzipSync } from 'node:zlib'
import { buildStaticIndex } from '../dist/index.js'
import { create, insertMultiple, save } from 'zbsearch'

const SECTIONS = Number(process.argv[2] ?? 10000)

// Deterministic pseudo-random text with a Zipf-ish vocabulary, resembling docs prose.
let seed = 42
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

const VOCAB_SIZE = 30000
const vocab = []
const syllables = ['con', 'fig', 'ser', 'ver', 'in', 'dex', 'que', 'ry', 'sha', 'rd', 'to', 'ken', 'se', 'arch', 'ran', 'king', 'do', 'cu', 'ment', 'la', 'zy', 'fe', 'tch', 'ca', 'che', 'pre', 'fix', 'sta', 'tic', 'bu', 'ild']
for (let i = 0; i < VOCAB_SIZE; i++) {
  let word = ''
  const parts = 2 + Math.floor(rand() * 3)
  for (let p = 0; p < parts; p++) {
    word += syllables[Math.floor(rand() * syllables.length)]
  }
  // Base36 suffix keeps every vocabulary entry distinct, so the dictionary
  // size reflects a realistic unique-term count instead of syllable collisions.
  vocab.push(word + i.toString(36))
}

function zipfWord() {
  // Approximate Zipf: bias toward the head of the vocabulary.
  const r = rand()
  const idx = Math.floor(VOCAB_SIZE * Math.pow(r, 3))
  return vocab[Math.min(idx, VOCAB_SIZE - 1)]
}

function sentence(words) {
  const out = []
  for (let i = 0; i < words; i++) out.push(zipfWord())
  return out.join(' ')
}

const records = []
for (let i = 0; i < SECTIONS; i++) {
  records.push({
    title: sentence(4),
    section: sentence(3),
    content: sentence(80),
    url: `/docs/page-${i}`
  })
}

const schema = { title: 'string', section: 'string', content: 'string' }

console.log(`corpus: ${SECTIONS} sections, ~80 words content each`)

const t0 = performance.now()
const { manifest, files, stats } = await buildStaticIndex({ records, schema })
const t1 = performance.now()

function gz(bytes) {
  return gzipSync(bytes).length
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`

const manifestBytes = files.get('manifest.json')
const dictBytes = files.get('dictionary.json')

let postingsRaw = 0
let postingsGz = 0
for (const shard of manifest.shards) {
  const b = files.get(shard.file)
  postingsRaw += b.length
  postingsGz += gz(b)
}

let fragRaw = 0
let fragGz = 0
for (let g = 0; g < manifest.fragments.count; g++) {
  const b = files.get(`fragments/${g}.json`)
  fragRaw += b.length
  fragGz += gz(b)
}

console.log(`build time: ${(t1 - t0).toFixed(0)} ms`)
console.log(`terms: ${stats.termCount}, shards: ${stats.shardCount}, fragments: ${stats.fragmentCount}`)
console.log('')
console.log(`manifest:   raw ${kb(manifestBytes.length)}  gz ${kb(gz(manifestBytes))}`)
console.log(`dictionary: raw ${kb(dictBytes.length)}  gz ${kb(gz(dictBytes))}   <-- resident budget`)
console.log(`postings:   raw ${kb(postingsRaw)}  gz ${kb(postingsGz)}  avg/shard gz ${kb(postingsGz / Math.max(1, stats.shardCount))}`)
console.log(`fragments:  raw ${kb(fragRaw)}  gz ${kb(fragGz)}`)
console.log(`total:      raw ${kb(stats.totalBytes)}`)

// Monolithic comparison.
const db = create({ schema, language: 'english', inferSchema: false, sort: { enabled: false } })
await insertMultiple(db, records.map((r, i) => ({ id: String(i + 1), ...r })))
const monoJson = Buffer.from(JSON.stringify(save(db)))
console.log('')
console.log(`monolithic index JSON: raw ${kb(monoJson.length)}  gz ${kb(gz(monoJson))}  <-- what ships today`)
console.log(`initial payload (manifest+dict, gz): ${kb(gz(manifestBytes) + gz(dictBytes))}`)
