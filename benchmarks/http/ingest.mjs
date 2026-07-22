#!/usr/bin/env node
// Timed ingest driver for HTTP load tests.
//
// Default mode (offline snapshot): shells out to the edge-index-builder CLI,
// which builds the index locally and uploads it to R2 via the S3 API.
//   node ingest.mjs --corpus data/corpus-100k.jsonl [--index loadtest]
//   Requires R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT
//   (falling back to deploy/cloudflare/.env when present).
//
// --via-api mode: streams the corpus through POST /v1/indexes/:id/documents/batch.
//   node ingest.mjs --via-api --corpus data/corpus-10k.jsonl \
//     --base-url https://worker.example.com --api-key secret [--batch-size 100] [--concurrency 4]

import { spawn } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../..')
const CLI_PATH = resolve(REPO_ROOT, 'packages/edge-index-builder/dist/cli.js')
const ENV_FILE = resolve(REPO_ROOT, 'deploy/cloudflare/.env')

const SCHEMA = {
  title: 'string',
  description: 'string',
  rating: 'number',
  'genres[]': 'string'
}

function parseArgs(argv) {
  const args = {
    viaApi: false,
    corpus: null,
    index: 'loadtest',
    baseUrl: process.env.BASE_URL || null,
    apiKey: process.env.API_KEY || null,
    batchSize: 100,
    concurrency: 4,
    schemaFile: null
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--via-api') args.viaApi = true
    else if (arg === '--corpus') args.corpus = argv[++i]
    else if (arg === '--index') args.index = argv[++i]
    else if (arg === '--base-url') args.baseUrl = argv[++i]
    else if (arg === '--api-key') args.apiKey = argv[++i]
    else if (arg === '--batch-size') args.batchSize = Number(argv[++i])
    else if (arg === '--concurrency') args.concurrency = Number(argv[++i])
    else if (arg === '--schema-file') args.schemaFile = argv[++i]
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage:
  node ingest.mjs --corpus <file.jsonl> [--index loadtest] [--schema-file <path>]
  node ingest.mjs --via-api --corpus <file.jsonl> --base-url <url> --api-key <key>
                  [--index loadtest] [--batch-size 100] [--concurrency 4]`)
      process.exit(0)
    } else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(1)
    }
  }
  return args
}

function fail(message) {
  console.error(`ingest: ${message}`)
  process.exit(1)
}

// Pull R2 credentials from deploy/cloudflare/.env if they are not already set,
// mirroring the flow in deploy/cloudflare/ingest-unicorns.sh.
function loadR2Env() {
  const required = ['R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT']
  const missing = required.filter((key) => !process.env[key])
  if (missing.length === 0) return

  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2]
      }
    }
  }

  const stillMissing = required.filter((key) => !process.env[key])
  if (stillMissing.length > 0) {
    fail(
      `missing required env vars for R2 upload: ${stillMissing.join(', ')}\n` +
        `Set them directly or in ${ENV_FILE} (see deploy/cloudflare/.env.example).`
    )
  }
}

async function ensureCliBuilt() {
  if (existsSync(CLI_PATH)) return
  console.error('edge-index-builder not built; running `pnpm --filter @zbsearch/edge-index-builder... build`')
  const child = spawn('pnpm', ['--filter', '@zbsearch/edge-index-builder...', 'build'], {
    cwd: REPO_ROOT,
    stdio: 'inherit'
  })
  const code = await new Promise((resolvePromise) => child.on('close', resolvePromise))
  if (code !== 0 || !existsSync(CLI_PATH)) {
    fail('failed to build @zbsearch/edge-index-builder')
  }
}

async function countLines(path) {
  let count = 0
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Number.POSITIVE_INFINITY })
  for await (const _line of rl) count++
  return count
}

async function fetchStatus(args) {
  if (!args.baseUrl || !args.apiKey) return null
  try {
    const res = await fetch(`${args.baseUrl}/v1/indexes/${args.index}/status`, {
      headers: { authorization: `Bearer ${args.apiKey}` }
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, idx)]
}

function latencyStats(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b)
  const avg = latencies.reduce((sum, v) => sum + v, 0) / latencies.length
  return {
    min: Math.round(sorted[0] * 10) / 10,
    avg: Math.round(avg * 10) / 10,
    p95: Math.round(percentile(sorted, 95) * 10) / 10,
    p99: Math.round(percentile(sorted, 99) * 10) / 10,
    max: Math.round(sorted[sorted.length - 1] * 10) / 10
  }
}

async function ingestViaCli(args) {
  loadR2Env()
  await ensureCliBuilt()

  const schemaFile = args.schemaFile ?? `${args.corpus}.schema.json`
  writeFileSync(schemaFile, `${JSON.stringify(SCHEMA, null, 2)}\n`)

  console.error(`Counting documents in ${args.corpus}...`)
  const docs = await countLines(args.corpus)
  console.error(`Importing ${docs} documents into index "${args.index}" via edge-index-builder CLI`)

  const started = performance.now()
  const child = spawn(
    process.execPath,
    [CLI_PATH, 'import', args.index, args.corpus, '--create', '--name', args.index, '--schema-file', schemaFile, '--language', 'english'],
    { cwd: REPO_ROOT, env: process.env }
  )
  let stdout = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.pipe(process.stderr)
  const code = await new Promise((resolvePromise) => child.on('close', resolvePromise))
  const seconds = (performance.now() - started) / 1000

  if (code !== 0) {
    fail(`edge-index-builder import exited with code ${code}`)
  }

  let cliResult = null
  try {
    cliResult = JSON.parse(stdout.trim().split('\n').pop())
  } catch {
    // CLI output is best-effort; the status endpoint below is authoritative.
  }

  const status = await fetchStatus(args)
  console.log(
    JSON.stringify(
      {
        mode: 'cli-snapshot',
        index: args.index,
        docs,
        seconds: Math.round(seconds * 100) / 100,
        docsPerSecond: Math.round(docs / seconds),
        indexSizeBytes: status?.indexSizeBytes ?? cliResult?.indexSizeBytes ?? null,
        liveVersion: status?.liveVersion ?? cliResult?.liveVersion ?? null,
        status: status ?? undefined
      },
      null,
      2
    )
  )
}

async function postBatch(args, operations) {
  const started = performance.now()
  const res = await fetch(`${args.baseUrl}/v1/indexes/${args.index}/documents/batch`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ operations })
  })
  const latencyMs = performance.now() - started
  if (res.status !== 202) {
    const body = await res.text()
    throw new Error(`batch failed with HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  await res.json()
  return latencyMs
}

async function ingestViaApi(args) {
  const rl = createInterface({ input: createReadStream(args.corpus), crlfDelay: Number.POSITIVE_INFINITY })

  let pending = []
  const queue = []
  let readingDone = false
  let docs = 0
  let batches = 0
  let failures = 0
  const latencies = []
  const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

  const worker = async () => {
    for (;;) {
      if (queue.length > 0) {
        const operations = queue.shift()
        try {
          latencies.push(await postBatch(args, operations))
        } catch (err) {
          failures++
          console.error(`batch ${batches} failed: ${err.message}`)
        }
        batches++
        if (batches % 100 === 0) {
          console.error(`... ${docs} docs read, ${batches} batches sent`)
        }
      } else if (readingDone) {
        return
      } else {
        await sleep(1)
      }
    }
  }

  const started = performance.now()
  const workers = Array.from({ length: args.concurrency }, worker)

  for await (const line of rl) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const doc = JSON.parse(trimmed)
    const { id, ...rest } = doc
    pending.push({ op: 'upsert', id: String(id), doc: rest })
    docs++
    if (pending.length >= args.batchSize) {
      queue.push(pending)
      pending = []
    }
  }
  if (pending.length > 0) queue.push(pending)

  readingDone = true
  await Promise.all(workers)

  const seconds = (performance.now() - started) / 1000
  const status = await fetchStatus(args)

  console.log(
    JSON.stringify(
      {
        mode: 'via-api',
        index: args.index,
        docs,
        batches,
        failedBatches: failures,
        seconds: Math.round(seconds * 100) / 100,
        docsPerSecond: Math.round(docs / seconds),
        batchLatencyMs: latencies.length > 0 ? latencyStats(latencies) : null,
        pendingOps: status?.pendingOps ?? null
      },
      null,
      2
    )
  )

  if (failures > 0) {
    fail(`${failures} batch(es) failed`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!args.corpus) fail('missing required --corpus <file.jsonl>')
  if (!existsSync(args.corpus)) fail(`corpus file not found: ${args.corpus}`)

  if (args.viaApi) {
    const missing = []
    if (!args.baseUrl) missing.push('--base-url (or BASE_URL env)')
    if (!args.apiKey) missing.push('--api-key (or API_KEY env)')
    if (missing.length > 0) fail(`--via-api mode requires: ${missing.join(', ')}`)
    await ingestViaApi(args)
  } else {
    await ingestViaCli(args)
  }
}

main().catch((err) => {
  fail(err.message)
})
