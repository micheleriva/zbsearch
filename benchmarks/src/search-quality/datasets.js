// BEIR dataset download, cache, and parsing.
//
// Datasets are fetched on demand from the official BEIR hosting
// (https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/{name}.zip)
// and extracted into benchmarks/.cache/beir/{name}/. Each zip contains:
//
//   {name}/corpus.jsonl      {"_id": ..., "title": ..., "text": ...}
//   {name}/queries.jsonl     {"_id": ..., "text": ...}
//   {name}/qrels/test.tsv    "query-id\tcorpus-id\tscore" (header row, int score)
//
// Nothing is committed to the repo: BEIR datasets carry per-dataset licenses
// (e.g. SciFact is CC BY-NC 2.0), so they are downloaded on first use.

import { createReadStream } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.cache', 'beir')
const BASE_URL = 'https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets'

export const DATASETS = {
  scifact: { documents: 5183, queries: 300 },
  nfcorpus: { documents: 3633, queries: 323 },
  arguana: { documents: 8674, queries: 1406 }
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function* readJsonl(filePath) {
  const lines = createInterface({ input: createReadStream(filePath, 'utf8'), crlfDelay: Infinity })
  for await (const line of lines) {
    if (line.trim().length > 0) {
      yield JSON.parse(line)
    }
  }
}

async function ensureDataset(name) {
  const dir = path.join(CACHE_DIR, name)
  if (await exists(path.join(dir, 'corpus.jsonl'))) {
    return dir
  }

  await mkdir(CACHE_DIR, { recursive: true })
  const zipPath = path.join(CACHE_DIR, `${name}.zip`)

  if (!(await exists(zipPath))) {
    const url = `${BASE_URL}/${name}.zip`
    console.log(`Downloading ${url} ...`)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
    }
    await writeFile(zipPath, Buffer.from(await response.arrayBuffer()))
  }

  try {
    await execFileAsync('unzip', ['-o', '-q', zipPath, '-d', CACHE_DIR])
  } catch (error) {
    throw new Error(`Failed to extract ${zipPath} — is the "unzip" command available? (${error.message})`)
  }

  return dir
}

// Loads a BEIR dataset into:
//   documents: [{ id, text }]   (title and text concatenated, BEIR "multifield" style)
//   queries:   [{ id, text }]   (only queries judged in qrels/test.tsv)
//   qrels:     Map<queryId, Map<docId, score>>
export async function loadDataset(name) {
  const dir = await ensureDataset(name)

  const qrels = new Map()
  const tsvLines = createInterface({ input: createReadStream(path.join(dir, 'qrels', 'test.tsv'), 'utf8'), crlfDelay: Infinity })
  let isHeader = true
  for await (const line of tsvLines) {
    if (isHeader) {
      isHeader = false
      continue
    }
    const [queryId, docId, score] = line.split('\t')
    if (!qrels.has(queryId)) {
      qrels.set(queryId, new Map())
    }
    qrels.get(queryId).set(docId, Number(score))
  }

  const documents = []
  for await (const record of readJsonl(path.join(dir, 'corpus.jsonl'))) {
    const title = record.title ? `${record.title} ` : ''
    documents.push({ id: String(record._id), text: `${title}${record.text ?? ''}` })
  }

  const queries = []
  for await (const record of readJsonl(path.join(dir, 'queries.jsonl'))) {
    const id = String(record._id)
    if (qrels.has(id)) {
      queries.push({ id, text: record.text })
    }
  }

  return { name, documents, queries, qrels }
}
