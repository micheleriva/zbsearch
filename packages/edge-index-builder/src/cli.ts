#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import type { CreateIndexInput } from '@zbsearch/edge-core'
import { importDocuments, importShardedDocuments, listIndexMetas, rebuildIndex } from '@zbsearch/edge-core'
import { createS3StorageFromEnv } from '@zbsearch/storage-s3'

import { loadImportDocuments } from './import-documents.js'

function parseArgs(argv: string[]): {
  command: string
  indexId?: string
  filePath?: string
  create: boolean
  name?: string
  schema?: CreateIndexInput['schema']
  schemaFile?: string
  language?: string
  shards?: number
  inferSchema?: boolean
} {
  const [command, indexId, filePath, ...rest] = argv
  let create = false
  let name: string | undefined
  let schema: CreateIndexInput['schema'] | undefined
  let schemaFile: string | undefined
  let language: string | undefined
  let shards: number | undefined
  let inferSchema: boolean | undefined

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    if (arg === '--create') {
      create = true
      continue
    }
    if (arg === '--infer-schema') {
      inferSchema = true
      continue
    }
    if (arg === '--name') {
      name = rest[++i]
      continue
    }
    if (arg === '--language') {
      language = rest[++i]
      continue
    }
    if (arg === '--shards') {
      const value = rest[++i]

      if (!value) {
        throw new Error('--shards requires a count')
      }

      shards = Number.parseInt(value, 10)

      if (!Number.isInteger(shards) || shards < 2) {
        throw new Error('--shards must be an integer >= 2')
      }

      continue
    }
    if (arg === '--schema') {
      const value = rest[++i]
      if (!value) {
        throw new Error('--schema requires inline JSON')
      }
      schema = JSON.parse(value) as CreateIndexInput['schema']
      continue
    }
    if (arg === '--schema-file') {
      schemaFile = rest[++i]
    }
  }

  return { command: command ?? '', indexId, filePath, create, name, schema, schemaFile, language, shards, inferSchema }
}

async function runImport(
  indexId: string,
  filePath: string,
  options: {
    create: boolean
    name?: string
    schema?: CreateIndexInput['schema']
    schemaFile?: string
    language?: string
    shards?: number
    inferSchema?: boolean
  }
): Promise<void> {
  const storage = createS3StorageFromEnv()
  const documents = await loadImportDocuments(filePath)

  let schema = options.schema
  if (!schema && options.schemaFile) {
    schema = JSON.parse(await readFile(options.schemaFile, 'utf8')) as CreateIndexInput['schema']
  }

  const settings =
    options.language || options.inferSchema
      ? {
          ...(options.language ? { language: options.language } : {}),
          ...(options.inferSchema ? { inferSchema: true } : {})
        }
      : undefined

  if (options.shards !== undefined) {
    const result = await importShardedDocuments(storage, indexId, documents, {
      shards: options.shards,
      create: options.create
        ? {
            name: options.name ?? indexId,
            ...(schema ? { schema } : {}),
            settings
          }
        : undefined
    })

    console.log(JSON.stringify(result))
    return
  }

  const meta = await importDocuments(storage, indexId, documents, {
    create: options.create
      ? {
          name: options.name ?? indexId,
          ...(schema ? { schema } : {}),
          settings
        }
      : undefined
  })

  console.log(
    JSON.stringify({
      indexId: meta.id,
      liveVersion: meta.liveVersion,
      documents: meta.documents,
      indexSizeBytes: meta.indexSizeBytes,
      status: meta.status
    })
  )
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (args.command === 'rebuild') {
    const storage = createS3StorageFromEnv()
    const indexId = args.indexId

    if (indexId && indexId !== '--all') {
      const meta = await rebuildIndex(storage, indexId)
      console.log(JSON.stringify({ indexId: meta.id, liveVersion: meta.liveVersion, documents: meta.documents }))
      return
    }

    const indexes = await listIndexMetas(storage)
    for (const index of indexes) {
      if (index.pendingOps === 0 && index.status === 'ready' && index.liveVersion) {
        continue
      }
      const meta = await rebuildIndex(storage, index.id)
      console.log(JSON.stringify({ indexId: meta.id, liveVersion: meta.liveVersion, documents: meta.documents }))
    }
    return
  }

  if (args.command === 'import') {
    if (!args.indexId || !args.filePath) {
      throw new Error('import requires indexId and file path')
    }
    await runImport(args.indexId, args.filePath, {
      create: args.create,
      name: args.name,
      schema: args.schema,
      schemaFile: args.schemaFile,
      language: args.language,
      shards: args.shards,
      inferSchema: args.inferSchema
    })
    return
  }

  console.log(`Usage:
  zbsearch-edge-builder rebuild [indexId]
  zbsearch-edge-builder rebuild --all
  zbsearch-edge-builder import <indexId> <file> [--create] [--name <name>] [--schema '<json>'] [--schema-file <path>] [--language <lang>] [--shards <n>] [--infer-schema]`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
