import { create, insertMultiple, load, save, search, type AnySchema, type AnyZBSearch } from 'zbsearch'
import { encode, decode } from '@msgpack/msgpack'

import {
  applyBufferOps,
  appendBufferOp,
  appendWalBatch,
  clearBuffer,
  finalizeBufferAfterRebuild,
  freezeBufferForRebuild,
  readBufferOps
} from './buffer.js'
import { badRequest, notFound } from './errors.js'
import type { WalCoordinator } from './coordinator.js'
import { getIndexMeta, registerIndex, saveIndexMeta } from './registry.js'
import { indexMetaKey, newVersionId, snapshotKey } from './paths.js'
import { isShardGroupMeta, shardIndexId } from './shards.js'
import {
  bufferBatchSharded,
  bufferDeleteSharded,
  bufferUpsertSharded,
  getShardedManifest,
  getShardedStatus,
  maybeScheduleRebuildSharded,
  rebuildShardGroup,
  runShardedSearch
} from './shard-group.js'
import type { ObjectStorage, ShardCache } from './storage.js'
import type {
  BufferedWriteResponse,
  BufferOp,
  IndexMeta,
  IndexSettings,
  IndexStatusResponse
} from './types.js'

export interface CreateIndexInput {
  name: string
  schema: AnySchema
  settings?: IndexSettings
  shards?: number
}

export interface SnapshotDbCacheOptions {
  maxEntries?: number
  maxBytes?: number
}

const DEFAULT_SNAPSHOT_DB_CACHE_MAX_ENTRIES = 4
const DEFAULT_SNAPSHOT_DB_CACHE_MAX_BYTES = 64 * 1024 * 1024
const MAX_SHARD_COUNT = 64

interface SnapshotDbCacheEntry {
  db: AnyZBSearch
  bytes: number
}

const snapshotDbCache = new Map<string, SnapshotDbCacheEntry>()
let snapshotDbCacheBytes = 0
let snapshotDbCacheMaxEntries = DEFAULT_SNAPSHOT_DB_CACHE_MAX_ENTRIES
let snapshotDbCacheMaxBytes = DEFAULT_SNAPSHOT_DB_CACHE_MAX_BYTES

function evictSnapshotDbCache(): void {
  while (snapshotDbCache.size > snapshotDbCacheMaxEntries || snapshotDbCacheBytes > snapshotDbCacheMaxBytes) {
    const oldest = snapshotDbCache.keys().next()
    if (oldest.done) {
      break
    }
    const entry = snapshotDbCache.get(oldest.value)!
    snapshotDbCache.delete(oldest.value)
    snapshotDbCacheBytes -= entry.bytes
  }
}

export function configureSnapshotDbCache(options: SnapshotDbCacheOptions = {}): void {
  if (options.maxEntries !== undefined) {
    snapshotDbCacheMaxEntries = Math.max(0, options.maxEntries)
  }
  if (options.maxBytes !== undefined) {
    snapshotDbCacheMaxBytes = Math.max(0, options.maxBytes)
  }
  evictSnapshotDbCache()
}

export function clearSnapshotDbCache(): void {
  snapshotDbCache.clear()
  snapshotDbCacheBytes = 0
  snapshotDbCacheMaxEntries = DEFAULT_SNAPSHOT_DB_CACHE_MAX_ENTRIES
  snapshotDbCacheMaxBytes = DEFAULT_SNAPSHOT_DB_CACHE_MAX_BYTES
}

function getCachedSnapshotDb(key: string): AnyZBSearch | null {
  const entry = snapshotDbCache.get(key)

  if (!entry) {
    return null
  }

  snapshotDbCache.delete(key)
  snapshotDbCache.set(key, entry)

  return entry.db
}

function setCachedSnapshotDb(key: string, db: AnyZBSearch, bytes: number): void {
  if (snapshotDbCacheMaxEntries === 0 || bytes > snapshotDbCacheMaxBytes) {
    return
  }

  const existing = snapshotDbCache.get(key)

  if (existing) {
    snapshotDbCacheBytes -= existing.bytes
  }

  snapshotDbCache.set(key, { db, bytes })
  snapshotDbCacheBytes += bytes

  evictSnapshotDbCache()
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

export async function createIndex(storage: ObjectStorage, input: CreateIndexInput): Promise<IndexMeta> {
  if (!input || typeof input.name !== 'string') {
    throw badRequest('Missing index name')
  }

  const id = slugify(input.name)

  if (!id) {
    throw badRequest('Invalid index name')
  }

  if (input.shards !== undefined) {
    if (!Number.isInteger(input.shards) || input.shards < 2 || input.shards > MAX_SHARD_COUNT) {
      throw badRequest(`shards must be an integer between 2 and ${MAX_SHARD_COUNT}`)
    }
  }

  const meta = await createIndexWithId(storage, id, input)

  if (input.shards !== undefined) {
    for (let i = 0; i < input.shards; i++) {
      await createIndexWithId(storage, shardIndexId(id, i), {
        name: shardIndexId(id, i),
        schema: input.schema,
        settings: input.settings
      })
    }
  }

  return meta
}

async function createIndexWithId(storage: ObjectStorage, id: string, input: CreateIndexInput): Promise<IndexMeta> {
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
    ...(input.shards !== undefined ? { shards: { count: input.shards } } : {}),
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

export interface BufferedWriteOptions {
  walCoordinator?: WalCoordinator
}

async function appendWriteOps(
  storage: ObjectStorage,
  meta: IndexMeta,
  ops: BufferOp[],
  options: BufferedWriteOptions
): Promise<BufferedWriteResponse> {
  if (options.walCoordinator) {
    const { changeId, bufferedAt } = await options.walCoordinator.appendOps(meta.id, ops)
    return {
      status: 'buffered',
      changeId,
      bufferedAt,
      indexStatus: meta.liveVersion ? meta.status : 'empty'
    }
  }

  const { changeId, bufferedAt, head } =
    ops.length === 1 ? await appendBufferOp(storage, meta.id, ops[0]!) : await appendWalBatch(storage, meta.id, ops)

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

export async function bufferUpsert(
  storage: ObjectStorage,
  indexId: string,
  docId: string,
  doc: Record<string, unknown>,
  options: BufferedWriteOptions = {}
): Promise<BufferedWriteResponse> {
  const meta = await getIndexMeta(storage, indexId)

  if (isShardGroupMeta(meta)) {
    return bufferUpsertSharded(storage, meta, docId, doc, options)
  }

  const ts = new Date().toISOString()

  return appendWriteOps(storage, meta, [{ op: 'upsert', id: docId, ts, doc }], options)
}

export interface ImportDocument {
  id: string
  doc: Record<string, unknown>
}

export async function importDocuments(
  storage: ObjectStorage,
  indexId: string,
  documents: ImportDocument[],
  options?: { create?: CreateIndexInput; walCoordinator?: WalCoordinator }
): Promise<IndexMeta> {
  let meta: IndexMeta
  try {
    meta = await getIndexMeta(storage, indexId)
  } catch (err) {
    if (!options?.create) {
      throw err
    }
    meta = await createIndex(storage, { ...options.create, name: options.create.name || indexId })
  }

  if (isShardGroupMeta(meta)) {
    throw badRequest(`Index ${indexId} is a shard group; import into its shards or use importShardedDocuments`)
  }

  const version = newVersionId()
  const db = create({ schema: meta.schema, language: meta.settings.language as any })
  const rows = documents.map(({ id, doc }) => ({ id, ...doc }))
  if (rows.length > 0) {
    insertMultiple(db, rows as any)
  }

  const snapshotBytes = encode(await save(db))
  await storage.put(snapshotKey(indexId, version), snapshotBytes, {
    contentType: 'application/msgpack'
  })

  if (options?.walCoordinator) {
    await options.walCoordinator.clearBuffer(indexId)
  } else {
    await clearBuffer(storage, indexId)
  }

  meta.liveVersion = version
  meta.buildingVersion = null
  meta.status = documents.length > 0 ? 'ready' : 'empty'
  meta.documents = documents.length
  meta.indexSizeBytes = snapshotBytes.byteLength
  meta.pendingOps = 0
  meta.lastRebuildAt = new Date().toISOString()
  meta.lastAppliedOffset = null
  await saveIndexMeta(storage, meta)

  return meta
}

export async function bufferBatch(
  storage: ObjectStorage,
  indexId: string,
  operations: Array<{ op: 'upsert'; id: string; doc: Record<string, unknown> } | { op: 'delete'; id: string }>,
  options: BufferedWriteOptions = {}
): Promise<BufferedWriteResponse> {
  const meta = await getIndexMeta(storage, indexId)
  if (isShardGroupMeta(meta)) {
    return bufferBatchSharded(storage, meta, operations, options)
  }
  const ts = new Date().toISOString()
  const ops: BufferOp[] = operations.map((operation) =>
    operation.op === 'upsert'
      ? { op: 'upsert', id: operation.id, ts, doc: operation.doc }
      : { op: 'delete', id: operation.id, ts }
  )

  return appendWriteOps(storage, meta, ops, options)
}

export async function bufferDelete(
  storage: ObjectStorage,
  indexId: string,
  docId: string,
  options: BufferedWriteOptions = {}
): Promise<BufferedWriteResponse> {
  const meta = await getIndexMeta(storage, indexId)

  if (isShardGroupMeta(meta)) {
    return bufferDeleteSharded(storage, meta, docId, options)
  }

  const ts = new Date().toISOString()
  return appendWriteOps(storage, meta, [{ op: 'delete', id: docId, ts }], options)
}

export async function getStatus(storage: ObjectStorage, indexId: string): Promise<IndexStatusResponse> {
  const meta = await getIndexMeta(storage, indexId)

  if (isShardGroupMeta(meta)) {
    return getShardedStatus(storage, meta)
  }

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

async function loadSnapshotDb(storage: ObjectStorage, meta: IndexMeta, cache: ShardCache): Promise<AnyZBSearch | null> {
  if (!meta.liveVersion) {
    return null
  }

  const key = snapshotKey(meta.id, meta.liveVersion)

  const cachedDb = getCachedSnapshotDb(key)
  if (cachedDb) {
    return cachedDb
  }

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
  setCachedSnapshotDb(key, db, bytes.byteLength)
  return db
}

async function loadDocumentsFromSnapshot(
  storage: ObjectStorage,
  meta: IndexMeta,
  cache: ShardCache
): Promise<Map<string, Record<string, unknown>>> {
  const docs = new Map<string, Record<string, unknown>>()
  const db = await loadSnapshotDb(storage, meta, cache)
  if (!db) {
    return docs
  }

  for (const doc of Object.values(db.data.docs.docs)) {
    if (doc && typeof doc === 'object' && 'id' in doc && doc.id != null) {
      docs.set(String(doc.id), { ...(doc as Record<string, unknown>) })
    }
  }

  return docs
}

async function readPendingBufferOps(storage: ObjectStorage, meta: IndexMeta): Promise<BufferOp[]> {
  if (meta.pendingOps === 0) {
    return []
  }

  const ops = await readBufferOps(storage, meta.id)
  if (ops.length !== meta.pendingOps) {
    meta.pendingOps = ops.length
    await saveIndexMeta(storage, meta)
  }
  return ops
}

async function loadSearchableDb(
  storage: ObjectStorage,
  meta: IndexMeta,
  cache: ShardCache
): Promise<{ db: AnyZBSearch; includesBuffer: boolean } | null> {
  const bufferOps = await readPendingBufferOps(storage, meta)

  if (!meta.liveVersion && bufferOps.length === 0) {
    return null
  }

  if (bufferOps.length === 0) {
    const db = await loadSnapshotDb(storage, meta, cache)
    if (!db) {
      return null
    }
    return { db, includesBuffer: false }
  }

  const baseDocs = await loadDocumentsFromSnapshot(storage, meta, cache)
  const merged = applyBufferOps(baseDocs, bufferOps)
  if (merged.size === 0) {
    return null
  }

  const db = create({ schema: meta.schema, language: meta.settings.language as any })
  const documents = [...merged.entries()].map(([id, doc]) => ({ id, ...doc }))
  if (documents.length > 0) {
    insertMultiple(db, documents as any)
  }
  return { db, includesBuffer: true }
}

export interface ScheduleRebuildOptions {
  threshold?: number
  builderWebhookUrl?: string
  schedule?: (task: Promise<unknown>) => void
  source?: 'threshold' | 'scheduler'
  walCoordinator?: WalCoordinator
}

const REBUILD_STATUS_STALE_MS = 15 * 60 * 1000

export async function maybeScheduleRebuild(
  storage: ObjectStorage,
  indexId: string,
  options: ScheduleRebuildOptions = {}
): Promise<void> {
  if (!options.schedule) {
    return
  }

  const meta = await getIndexMeta(storage, indexId)

  if (isShardGroupMeta(meta)) {
    await maybeScheduleRebuildSharded(storage, meta, options)
    return
  }

  if (
    meta.status === 'building' &&
    Date.now() - Date.parse(meta.updatedAt) <= REBUILD_STATUS_STALE_MS
  ) {
    return
  }

  const threshold = options.threshold ?? meta.settings.rebuildThresholdOps ?? 500
  if (meta.pendingOps < threshold) {
    return
  }

  if (options.builderWebhookUrl) {
    options.schedule(
      fetch(options.builderWebhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ indexId, source: options.source ?? 'threshold' })
      })
    )
    return
  }

  options.schedule(rebuildIndex(storage, indexId, { walCoordinator: options.walCoordinator }))
}

export interface RebuildOptions {
  walCoordinator?: WalCoordinator
}

export async function rebuildIndex(
  storage: ObjectStorage,
  indexId: string,
  options: RebuildOptions = {}
): Promise<IndexMeta> {
  const groupMeta = await getIndexMeta(storage, indexId)

  if (isShardGroupMeta(groupMeta)) {
    return rebuildShardGroup(storage, groupMeta, options)
  }

  const coordinator = options.walCoordinator

  if (coordinator) {
    const acquired = await coordinator.acquireRebuildLock(indexId)

    if (!acquired) {
      return getIndexMeta(storage, indexId)
    }
    try {
      return await runRebuild(storage, indexId, coordinator)
    } finally {
      await coordinator.releaseRebuildLock(indexId)
    }
  }

  return runRebuild(storage, indexId, undefined)
}

async function runRebuild(
  storage: ObjectStorage,
  indexId: string,
  coordinator: WalCoordinator | undefined
): Promise<IndexMeta> {
  const meta = await getIndexMeta(storage, indexId)
  if (
    !coordinator &&
    meta.status === 'building' &&
    Date.now() - Date.parse(meta.updatedAt) <= REBUILD_STATUS_STALE_MS
  ) {
    return meta
  }

  const version = newVersionId()

  meta.buildingVersion = version
  meta.status = 'building'
  await saveIndexMeta(storage, meta)

  try {
    const baseDocs = await loadDocumentsFromSnapshot(storage, meta, {
      get: async () => null,
      set: async () => {},
      delete: async () => {}
    })
    const { ops: bufferOps, frozenSegmentKeys } = coordinator
      ? await coordinator.freezeForRebuild(indexId)
      : await freezeBufferForRebuild(storage, indexId)
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

    const lastRebuildAt = new Date().toISOString()

    if (coordinator) {
      return await coordinator.finalizeAfterRebuild(indexId, frozenSegmentKeys, {
        version,
        documents: documents.length,
        indexSizeBytes: snapshotBytes.byteLength,
        lastRebuildAt
      })
    }

    const head = await finalizeBufferAfterRebuild(storage, indexId, frozenSegmentKeys)

    meta.liveVersion = version
    meta.buildingVersion = null
    meta.status = documents.length > 0 || head.pendingOps > 0 ? 'ready' : 'empty'
    meta.documents = documents.length
    meta.indexSizeBytes = snapshotBytes.byteLength
    meta.pendingOps = head.pendingOps
    meta.lastRebuildAt = lastRebuildAt
    meta.lastAppliedOffset = null
    await saveIndexMeta(storage, meta)

    return meta
  } catch (err) {
    const failed = await getIndexMeta(storage, indexId).catch(() => meta)
    failed.buildingVersion = null
    failed.status = failed.liveVersion ? 'ready' : 'empty'
    await saveIndexMeta(storage, failed).catch(() => {})
    throw err
  }
}

export interface SearchOptions {
  snapshotCache?: SnapshotDbCacheOptions
}

export async function runSearch(
  storage: ObjectStorage,
  cache: ShardCache,
  indexId: string,
  params: SearchInput,
  options: SearchOptions = {}
): Promise<Record<string, unknown>> {
  if (options.snapshotCache) {
    configureSnapshotDbCache(options.snapshotCache)
  }

  const meta = await getIndexMeta(storage, indexId)
  
  if (isShardGroupMeta(meta)) {
    return runShardedSearch(storage, cache, meta, params, options)
  }

  const loaded = await loadSearchableDb(storage, meta, cache)

  if (!loaded) {
    throw notFound(`Index ${indexId} has no searchable documents yet.`)
  }

  const results = search(loaded.db, {
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
    indexVersion: meta.liveVersion,
    includesBuffer: loaded.includesBuffer
  } as Record<string, unknown>
}

export async function getIndexManifest(storage: ObjectStorage, indexId: string) {
  const meta = await getIndexMeta(storage, indexId)

  if (isShardGroupMeta(meta)) {
    return getShardedManifest(storage, meta)
  }

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
