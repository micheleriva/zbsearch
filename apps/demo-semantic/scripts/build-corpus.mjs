/*
 * Embeds every article in data/articles.json and writes data/embeddings.json.
 *
 * The demo ships the vectors rather than computing them in the browser: 150 documents
 * would take the better part of a minute to encode on a phone, and the point of the page
 * is the search, not the wait. Only the query is encoded at runtime.
 *
 *   pnpm --filter @zbsearch/demo-semantic corpus
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pipeline } from '@huggingface/transformers'
import { embeddingTextFor, hashCorpus } from '../lib/embedding-text.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const ARTICLES = join(here, '..', 'data', 'articles.json')
const EMBEDDINGS = join(here, '..', 'data', 'embeddings.json')

export const MODEL = 'Xenova/all-MiniLM-L6-v2'
const BATCH = 16

const articles = JSON.parse(await readFile(ARTICLES, 'utf8'))
console.log(`encoding ${articles.length} articles with ${MODEL}`)

const started = Date.now()
const extract = await pipeline('feature-extraction', MODEL, { dtype: 'q8' })
console.log(`  model ready in ${Date.now() - started}ms`)

/** @type {number[][]} */
const vectors = []
const encodeStarted = Date.now()

for (let offset = 0; offset < articles.length; offset += BATCH) {
  const batch = articles.slice(offset, offset + BATCH)
  const output = await extract(batch.map(embeddingTextFor), { pooling: 'mean', normalize: true })

  vectors.push(...output.tolist())
  process.stdout.write(`\r  encoded ${vectors.length}/${articles.length}`)
}

const dim = vectors[0].length
console.log(`\n  ${vectors.length} vectors of ${dim} dimensions in ${Date.now() - encodeStarted}ms`)

/*
 * Quantise to int8. The vectors are unit length, so no component ever reaches 1 and a
 * fixed scale of 127 would waste most of the range — the largest component here is around
 * 0.22. Scaling by the observed maximum instead uses the full range and keeps the cosine
 * between a vector and its round trip above 0.999, which does not move any ranking.
 */
let peak = 0
for (const vector of vectors) {
  for (const component of vector) {
    peak = Math.max(peak, Math.abs(component))
  }
}

const scale = 127 / peak
const quantised = new Int8Array(vectors.length * dim)
let worst = 1

for (let i = 0; i < vectors.length; i++) {
  let dot = 0
  let magnitude = 0

  for (let d = 0; d < dim; d++) {
    const rounded = Math.round(vectors[i][d] * scale)
    quantised[i * dim + d] = rounded
    dot += vectors[i][d] * rounded
    magnitude += rounded * rounded
  }

  // cos(original, dequantised) — the dequantise step is a division by `scale`, which
  // cancels out of a cosine, so the rounded values can be compared directly.
  worst = Math.min(worst, dot / Math.sqrt(magnitude))
}

console.log(`  quantised to int8 (peak ${peak.toFixed(4)}, worst round-trip cosine ${worst.toFixed(6)})`)

const payload = {
  model: MODEL,
  dim,
  /** Divide a stored int8 component by this to recover the float. */
  scale,
  /** Guards against `articles.json` being edited without re-running this script. */
  sourceHash: hashCorpus(articles),
  ids: articles.map(article => article.id),
  vectors: Buffer.from(quantised.buffer).toString('base64'),
}

await writeFile(EMBEDDINGS, `${JSON.stringify(payload)}\n`)

const bytes = Buffer.byteLength(JSON.stringify(payload))
console.log(`wrote data/embeddings.json — ${(bytes / 1024).toFixed(0)} KB`)
