/*
 * Scores the curated queries in data/queries.json against all three search modes and
 * prints where each one puts the first relevant article.
 *
 * This is what the claims in the README are measured with. It builds the index from the
 * same schema and defaults the browser uses, so the numbers describe the demo rather than
 * a convenient variant of it.
 *
 *   pnpm --filter @zbsearch/demo-semantic evaluate
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pipeline } from '@huggingface/transformers'
import { create, insertMultiple, search } from 'zbsearch'
import {
  DEFAULT_BOOST,
  DEFAULT_HYBRID_WEIGHTS,
  DEFAULT_SIMILARITY,
  DEFAULT_TOLERANCE,
  SCHEMA,
  TOKENIZER,
  dequantise,
  toDocument,
} from '../lib/schema.mjs'
import { hashCorpus } from '../lib/embedding-text.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const read = async name => JSON.parse(await readFile(join(here, '..', 'data', name), 'utf8'))

const [articles, embeddings, queries] = await Promise.all([
  read('articles.json'),
  read('embeddings.json'),
  read('queries.json'),
])

if (hashCorpus(articles) !== embeddings.sourceHash) {
  console.error('articles.json has changed since embeddings.json was built — run `pnpm corpus` first')
  process.exit(1)
}

const vectors = dequantise(embeddings, base64 => Buffer.from(base64, 'base64'))
const db = create({ schema: SCHEMA, components: { tokenizer: TOKENIZER } })
await insertMultiple(db, articles.map((article, i) => toDocument(article, vectors[i])))

const extract = await pipeline('feature-extraction', embeddings.model, { dtype: 'q8' })
const encode = async term => (await extract([term], { pooling: 'mean', normalize: true })).tolist()[0]

const MODES = ['fulltext', 'vector', 'hybrid']

/** Where the first expected article lands, or null if it is outside the top 10. */
function rankOf(results, expect) {
  const at = results.hits.findIndex(hit => expect.includes(String(hit.id)))
  return at === -1 ? null : at + 1
}

const ranks = { fulltext: [], vector: [], hybrid: [] }
const rows = []

for (const query of queries) {
  const vector = { property: 'embedding', value: await encode(query.term) }
  const row = { term: query.term }

  for (const mode of MODES) {
    const results = await search(db, {
      mode,
      term: query.term,
      limit: 10,
      boost: DEFAULT_BOOST,
      ...(DEFAULT_TOLERANCE > 0 && mode !== 'vector' ? { tolerance: DEFAULT_TOLERANCE } : {}),
      ...(mode === 'fulltext' ? {} : { vector, similarity: DEFAULT_SIMILARITY }),
      ...(mode === 'hybrid' ? { hybridWeights: DEFAULT_HYBRID_WEIGHTS } : {}),
    })

    const rank = rankOf(results, query.expect)
    ranks[mode].push(rank)
    row[mode] = { rank, count: results.count, top: results.hits[0]?.document?.title ?? '—' }
  }

  rows.push(row)
}

const cell = ({ rank, count }) => (rank === null ? (count === 0 ? '   —' : ' >10') : `${String(rank).padStart(4)}`)

console.log('\nRank of the first relevant article (— = no hits at all, >10 = missed the top ten)\n')
console.log(`${'query'.padEnd(46)} full  vec  hyb   winner`)
console.log('-'.repeat(78))

for (const row of rows) {
  const best = MODES.reduce((a, b) => ((row[b].rank ?? 99) < (row[a].rank ?? 99) ? b : a))
  const tied = MODES.filter(m => (row[m].rank ?? 99) === (row[best].rank ?? 99))
  console.log(
    `${row.term.slice(0, 45).padEnd(46)}${cell(row.fulltext)} ${cell(row.vector)} ${cell(row.hybrid)}` +
      `   ${tied.length === MODES.length ? 'all' : tied.join('+')}`
  )
}

console.log('-'.repeat(78))

const summarise = mode => {
  const values = ranks[mode]
  const found = values.filter(rank => rank !== null)
  const mrr = values.reduce((sum, rank) => sum + (rank ? 1 / rank : 0), 0) / values.length
  const top1 = values.filter(rank => rank === 1).length
  return `${mode.padEnd(9)} top-1 ${String(top1).padStart(2)}/${values.length}   in top-10 ${String(found.length).padStart(2)}/${values.length}   MRR ${mrr.toFixed(3)}`
}

for (const mode of MODES) {
  console.log(summarise(mode))
}

console.log()
