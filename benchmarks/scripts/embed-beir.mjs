/*
 * Embeds a BEIR dataset (default: SciFact) for vector-quantization.js --data=...
 *
 *   pnpm install                      # @huggingface/transformers comes from apps/demo-semantic
 *   pnpm --filter zbsearch build && pnpm --filter @zbsearch/plugin-vector-quantizer build
 *   cd benchmarks
 *   node scripts/embed-beir.mjs --dataset=scifact --model=bge-small        # writes benchmark/scifact-bge-small.json
 *   node --expose-gc --max-old-space-size=3072 vector-quantization.js --data=benchmark/scifact-bge-small.json
 *
 * Needs network access to huggingface.co (dataset files and model weights). Models:
 *   bge-small  Xenova/bge-small-en-v1.5           CLS pooling, query instruction prefix
 *   e5-small   Xenova/multilingual-e5-small       mean pooling, "query: " / "passage: " prefixes
 *   minilm     Xenova/all-MiniLM-L6-v2            mean pooling
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=')
    return [key, value ?? 'true']
  })
)

const MODELS = {
  'bge-small': {
    id: 'Xenova/bge-small-en-v1.5',
    pooling: 'cls',
    query: 'Represent this sentence for searching relevant passages: ',
    passage: ''
  },
  'e5-small': { id: 'Xenova/multilingual-e5-small', pooling: 'mean', query: 'query: ', passage: 'passage: ' },
  minilm: { id: 'Xenova/all-MiniLM-L6-v2', pooling: 'mean', query: '', passage: '' }
}

const dataset = args.dataset ?? 'scifact'
const model = MODELS[args.model ?? 'bge-small']
if (!model) throw new Error(`Unknown model ${args.model}. Use one of ${Object.keys(MODELS).join(', ')}`)
// benchmarks/benchmark/ is git-ignored.
const out = args.out ?? join(here, '..', 'benchmark', `${dataset}-${args.model ?? 'bge-small'}.json`)
mkdirSync(dirname(out), { recursive: true })
const limitQueries = Number(args.queries ?? Infinity)
const batch = Number(args.batch ?? 32)

async function jsonl(file) {
  const url = `https://huggingface.co/datasets/BeIR/${dataset}/resolve/main/${file}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  const text = gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

// Reuse the transformers.js install of the semantic demo instead of adding it to the benchmarks.
const require = createRequire(join(here, '../../apps/demo-semantic/package.json'))
const { pipeline } = await import(require.resolve('@huggingface/transformers'))

const corpus = await jsonl('corpus.jsonl.gz')
const queries = (await jsonl('queries.jsonl.gz')).slice(0, limitQueries)
console.log(`${dataset}: ${corpus.length} documents, ${queries.length} queries, model ${model.id}`)

const extract = await pipeline('feature-extraction', model.id, { dtype: args.dtype ?? 'fp32' })

async function embed(texts, label) {
  const vectors = []
  for (let i = 0; i < texts.length; i += batch) {
    const output = await extract(texts.slice(i, i + batch), { pooling: model.pooling, normalize: true })
    vectors.push(...output.tolist())
    process.stdout.write(`\r  ${label}: ${vectors.length}/${texts.length}`)
  }
  process.stdout.write('\n')
  return vectors
}

const corpusVectors = await embed(
  corpus.map((doc) => `${model.passage}${doc.title ? `${doc.title}. ` : ''}${doc.text}`),
  'corpus'
)
const queryVectors = await embed(
  queries.map((query) => `${model.query}${query.text}`),
  'queries'
)

writeFileSync(out, JSON.stringify({ dataset, model: model.id, corpus: corpusVectors, queries: queryVectors }))
console.log(`wrote ${out}`)
