import { create, insertMultiple, load, save, search, type AnySchema, type AnyZBSearch } from 'zbsearch'
import { encode, decode } from '@msgpack/msgpack'

import { applyBufferOps, appendBufferOp, readBufferOps, clearBuffer } from './buffer.js'
import { badRequest, notFound } from './errors.js'
import { getIndexMeta, registerIndex, saveIndexMeta } from './registry.js'
import { indexMetaKey, newVersionId, snapshotKey } from './paths.js'
import type { ObjectStorage, ShardCache } from './storage.js'
import type {
  BufferedWriteResponse,
  BufferDeleteOp,
  BufferUpsertOp,
  IndexMeta,
  IndexSettings,
  IndexStatusResponse
} from './types.js'

export interface CreateIndexInput {
  name: string
  schema: AnySchema
  settings?: IndexSettings
}

export interface SearchInput {
  term?: string
  mode?: 'fulltext' | 'vector' | 'hybrid'
  where?: Record<string, unknown>
  limit?: number
  offset?: number
  properties?: string | string[]
  boost?: Record<string, number>
  similarity?: number
  vector?: {
    value: number[]
    property: string
  }
  hybridWeights?: {
    text: number
    vector: number
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function createIndex(
  storage: ObjectStorage,
  input: CreateIndexInput
): Promise<IndexMeta> {
  const id = slugify(input.name)
  if (!id) {
    throw badRequest('Invalid index name')
  }

  const existing = await storage.get(indexMetaKey(id))
  if (existing) {
    throw badRequest(`Index ${id} already exists`)
  }

  const now = new Date().toISOString()
  const meta: IndexMeta = {
    id,
    name: input.name,
    schema: input.schema,
    settings: {
      rebuildIntervalSec: 300,
      rebuildThresholdOps: 500,
      mode: 'edge',
      ...input.settings
    },
    liveVersion: null,
    buildingVersion: null,
    status: 'empty',
    documents: 0,
    indexSizeBytes: 0,
    pendingOps: 0,
    lastAppliedOffset: null,
    lastRebuildAt: null,
    createdAt: now,
    updatedAt: now
  }

  await registerIndex(storage, meta)
  return meta
}

export async function bufferUpsert(
  storage: ObjectStorage,
  indexId: string,
  docId: string,
  doc: Record<string, unknown>
): Promise<BufferedWriteResponse> {
  const meta = await getIndexMeta(storage, indexId)
  const ts = new Date().toISOString()
  const { changeId, bufferedAt, head } = await appendBufferOp(storage, indexId, {
    op: 'upsert',
    id: docId,
    ts,
    doc
  })

  meta.pendingOps = head.pendingOps
  meta.status = meta.liveVersion ? meta.status : 'empty'
  await saveIndexMeta(storage, meta)

  return {
    status: 'buffered',
    changeId,
    bufferedAt,
    indexStatus: meta.status
  }
}

export async function bufferDelete(
  storage: ObjectStorage,
  indexId: string,
  docId: string
): Promise<BufferedWriteResponse> {
  const meta = await getIndexMeta(storage, indexId)
  const ts = new Date().toISOString()
  const { changeId, bufferedAt, head } = await appendBufferOp(storage, indexId, {
    op: 'delete',
    id: docId,
    ts
  })

  meta.pendingOps = head.pendingOps
  await saveIndexMeta(storage, meta)

  return {
    status: 'buffered',
    changeId,
    bufferedAt,
    indexStatus: meta.status
  }
}

export async function getStatus(storage: ObjectStorage, indexId: string): Promise<IndexStatusResponse> {
  const meta = await getIndexMeta(storage, indexId)
  return {
    indexId: meta.id,
    liveVersion: meta.liveVersion,
    status: meta.status,
    documents: meta.documents,
    indexSizeBytes: meta.indexSizeBytes,
    pendingOps: meta.pendingOps,
    lastRebuildAt: meta.lastRebuildAt,
    lastAppliedOffset: meta.lastAppliedOffset
  }
}

async function loadSnapshotDb(
  storage: ObjectStorage,
  meta: IndexMeta,
  cache: ShardCache
): Promise<AnyZBSearch | null> {
  if (!meta.liveVersion) {
    return null
  }

  const key = snapshotKey(meta.id, meta.liveVersion)
  const cacheKey = `snapshot:${key}`

  let bytes = await cache.get(cacheKey)
  if (!bytes) {
    const obj = await storage.get(key)
    if (!obj) {
      return null
    }
    bytes = obj.body
    await cache.set(cacheKey, bytes, 3600)
  }

  const raw = decode(bytes)
  const db = create({ schema: meta.schema, language: meta.settings.language as any })
  load(db, raw as any)
  return db
}

async function loadDocumentsFromSnapshot(
  storage: ObjectStorage,
  meta: IndexMeta
): Promise<Map<string, Record<string, unknown>>> {
  const docs = new Map<string, Record<string, unknown>>()
  const db = await loadSnapshotDb(storage, meta, {
    get: async () => null,
    set: async () => {},
    delete: async () => {}
  })
  if (!db) {
    return docs
  }

  for (const doc of Object.values(db.data.docs.docs)) {
    if (doc && typeof doc === 'object' && 'id' in doc && doc.id != null) {
      docs.set(String(doc.id), doc as Record<string, unknown>)
    }
  }
  return docs
}

export async function rebuildIndex(storage: ObjectStorage, indexId: string): Promise<IndexMeta> {
  const meta = await getIndexMeta(storage, indexId)
  const version = newVersionId()

  meta.buildingVersion = version
  meta.status = 'building'
  await saveIndexMeta(storage, meta)

  const baseDocs = await loadDocumentsFromSnapshot(storage, meta)
  const bufferOps = await readBufferOps(storage, indexId)
  const merged = applyBufferOps(baseDocs, bufferOps)

  const db = create({ schema: meta.schema, language: meta.settings.language as any })
  const documents = [...merged.entries()].map(([id, doc]) => ({ id, ...doc }))
  if (documents.length > 0) {
    insertMultiple(db, documents as any)
  }

  const raw = await save(db)
  const snapshotBytes = encode(raw)
  await storage.put(snapshotKey(indexId, version), snapshotBytes, {
    contentType: 'application/msgpack'
  })

  await clearBuffer(storage, indexId)

  meta.liveVersion = version
  meta.buildingVersion = null
  meta.status = 'ready'
  meta.documents = documents.length
  meta.indexSizeBytes = snapshotBytes.byteLength
  meta.pendingOps = 0
  meta.lastRebuildAt = new Date().toISOString()
  meta.lastAppliedOffset = null
  await saveIndexMeta(storage, meta)

  return meta
}

export async function runSearch(
  storage: ObjectStorage,
  cache: ShardCache,
  indexId: string,
  params: SearchInput
): Promise<Record<string, unknown>> {
  const meta = await getIndexMeta(storage, indexId)
  const db = await loadSnapshotDb(storage, meta, cache)

  if (!db) {
    throw notFound(`Index ${indexId} has no searchable snapshot yet. Trigger a rebuild or wait for the scheduler.`)
  }

  const results = search(db, {
    term: params.term ?? '',
    mode: params.mode ?? 'fulltext',
    where: params.where as any,
    limit: params.limit ?? 20,
    offset: params.offset ?? 0,
    properties: params.properties as any,
    boost: params.boost as any,
    similarity: params.similarity,
    vector: params.vector as any,
    hybridWeights: params.hybridWeights
  } as any)

  return {
    ...results,
    indexVersion: meta.liveVersion
  } as Record<string, unknown>
}

export async function getIndexManifest(storage: ObjectStorage, indexId: string) {
  const meta = await getIndexMeta(storage, indexId)
  return {
    indexId: meta.id,
    name: meta.name,
    liveVersion: meta.liveVersion,
    status: meta.status,
    schema: meta.schema,
    settings: meta.settings,
    stats: {
      documents: meta.documents,
      totalBytes: meta.indexSizeBytes
    }
  }
}
