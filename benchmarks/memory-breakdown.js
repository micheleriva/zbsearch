// Heap breakdown of a full-text index (issue #87): how many bytes each structure of the database holds.
//
// Corpus: the synthetic passages of store-exclude.js (150-250 words from a Zipf-distributed 40k-word vocabulary,
// fields text/section/title/itemKey (string), page/year (number), collection (enum)), text-only, with
// `store: { exclude: ['text'] }`.
//
// The database is built, then its structures are dropped one at a time; the heap freed by each drop (after two full
// GCs) is what that structure held. Every size runs in its own Node process.
//
//   pnpm --filter zbsearch build
//   node benchmarks/memory-breakdown.js [--docs=20000,40000] [--max-old-space-size=8192] [--freeze]
//        [--zbsearch=/path/to/zbsearch/dist/esm/index.js]
//
// --freeze calls `freeze(db)` after inserting (frozen postings, field lengths and term frequencies) before measuring.
// --zbsearch measures another build of zbsearch (for example the previous release) with the same script.
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { BATCH, passages, schema } from './src/passages-corpus.js'

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=')
    return [key, value ?? true]
  })
)

const SIZES = String(args.docs ?? '20000')
  .split(',')
  .map(Number)
const MAX_OLD_SPACE = Number(args['max-old-space-size'] ?? 8192)
const FREEZE = Boolean(args.freeze)
const ZBSEARCH = args.zbsearch
  ? pathToFileURL(resolve(args.zbsearch)).href
  : new URL('../packages/zbsearch/dist/esm/index.js', import.meta.url).href

function heapUsed() {
  globalThis.gc()
  globalThis.gc()
  const { heapUsed, arrayBuffers } = process.memoryUsage()
  return heapUsed + arrayBuffers
}

function clearRadixNodePostings(node) {
  const stack = [node]
  while (stack.length) {
    const n = stack.pop()
    n.d = undefined
    for (const child of n.c.values()) stack.push(child)
  }
}

async function measure(docs) {
  const zb = await import(ZBSEARCH)
  const before = heapUsed()
  const db = zb.create({ schema, store: { exclude: ['text'] } })
  const insertStart = performance.now()
  for (const batch of passages(docs)) zb.insertMultiple(db, batch, BATCH)
  const insertMs = performance.now() - insertStart
  let freezeMs
  if (FREEZE) {
    const start = performance.now()
    zb.freeze(db)
    freezeMs = performance.now() - start
  }
  const total = heapUsed() - before

  const index = db.data.index
  const parts = []
  let last = heapUsed()
  function drop(name, fn) {
    fn()
    const now = heapUsed()
    parts.push([name, last - now])
    last = now
  }

  drop('sorter', () => {
    db.data.sorting = null
  })
  drop('documents store', () => {
    db.data.docs = null
  })
  drop('unstored values/terms (removal data)', () => {
    index.unstoredValues = {}
    index.unstoredTerms = {}
  })
  for (const prop of ['text', 'title', 'section', 'itemKey']) {
    drop(`${prop}: term frequencies`, () => {
      if (index.frequencies) index.frequencies[prop] = {}
    })
    drop(`${prop}: field lengths`, () => {
      if (index.fieldLengths) index.fieldLengths[prop] = {}
    })
    drop(`${prop}: tokenOccurrences`, () => {
      if (index.tokenOccurrences) index.tokenOccurrences[prop] = {}
    })
    drop(`${prop}: frozen segment`, () => {
      if (index.frozen) delete index.frozen[prop]
    })
    drop(`${prop}: postings (doc-id lists)`, () => {
      const tree = index.indexes[prop]
      if (tree?.type === 'Radix') {
        tree.node.postings = new Map()
        clearRadixNodePostings(tree.node)
      }
    })
    drop(`${prop}: radix tree nodes`, () => {
      delete index.indexes[prop]
    })
  }
  drop('number AVL trees (page, year)', () => {
    delete index.indexes.page
    delete index.indexes.year
  })
  drop('enum flat tree (collection)', () => {
    delete index.indexes.collection
  })
  drop('internal id store', () => {
    db.internalDocumentIDStore.idToInternalId = new Map()
    db.internalDocumentIDStore.internalIdToId = []
  })
  drop('rest of the database', () => {
    db.data = null
  })

  return { docs, total, insertMs, freezeMs, parts: parts.filter(([, bytes]) => Math.abs(bytes) > 64 * 1024) }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

if (args.child) {
  process.stdout.write(JSON.stringify(await measure(Number(args.child))))
} else {
  for (const docs of SIZES) {
    const child = spawnSync(
      process.execPath,
      [
        '--expose-gc',
        `--max-old-space-size=${MAX_OLD_SPACE}`,
        fileURLToPath(import.meta.url),
        `--child=${docs}`,
        ...(FREEZE ? ['--freeze'] : []),
        ...(args.zbsearch ? [`--zbsearch=${args.zbsearch}`] : [])
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
    if (child.status !== 0) {
      throw new Error(`${docs} passages failed:\n${child.stderr}`)
    }
    const r = JSON.parse(child.stdout)
    console.log(
      `\n${r.docs.toLocaleString()} passages, text only, store.exclude: ['text']${FREEZE ? ', frozen' : ''}, Node ${process.version}, --max-old-space-size=${MAX_OLD_SPACE}`
    )
    console.log(
      `heap + array buffers: ${mb(r.total)} (${((r.total / r.docs) | 0).toLocaleString()} B/passage), insert ${(r.insertMs / 1000).toFixed(1)} s${r.freezeMs !== undefined ? `, freeze ${(r.freezeMs / 1000).toFixed(2)} s` : ''}\n`
    )
    console.log('| Structure | Bytes | Share |')
    console.log('|---|---|---|')
    for (const [name, bytes] of [...r.parts].sort((a, b) => b[1] - a[1])) {
      console.log(`| ${name} | ${mb(bytes)} | ${((bytes / r.total) * 100).toFixed(1)}% |`)
    }
  }
}
