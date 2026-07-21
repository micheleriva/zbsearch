import { EdgeApiError, badRequest, notFound } from './errors.js'
import { newChangeId } from './paths.js'
import { getIndexMeta } from './registry.js'
import { isShardGroupMeta, shardForDoc, shardIndexId, shardIndexIds } from './shards.js'
import type { ObjectStorage, ShardCache } from './storage.js'
import type {
  BufferedWriteResponse,
  IndexMeta,
  IndexStatus,
  IndexStatusResponse,
  ShardStatusSummary,
  ShardWriteResult
} from './types.js'
import {
  bufferBatch,
  bufferDelete,
  bufferUpsert,
  createIndex,
  getStatus,
  importDocuments,
  maybeScheduleRebuild,
  rebuildIndex,
  runSearch,
  type BufferedWriteOptions,
  type CreateIndexInput,
  type ImportDocument,
  type RebuildOptions,
  type ScheduleRebuildOptions,
  type SearchInput,
  type SearchOptions
} from './service.js'

const DEFAULT_SEARCH_LIMIT = 20

function worstStatus(statuses: IndexStatus[]): IndexStatus {
  if (statuses.includes('building')) {
    return 'building'
  }

  if (statuses.includes('ready')) {
    return 'ready'
  }

  return 'empty'
}

function shardCountOf(group: IndexMeta): number {
  return group.shards?.count ?? 0
}

export async function bufferUpsertSharded(
  storage: ObjectStorage,
  group: IndexMeta,
  docId: string,
  doc: Record<string, unknown>,
  options: BufferedWriteOptions = {}
): Promise<BufferedWriteResponse> {
  const shardId = shardIndexId(group.id, shardForDoc(docId, shardCountOf(group)))
  return bufferUpsert(storage, shardId, docId, doc, options)
}

export async function bufferDeleteSharded(
  storage: ObjectStorage,
  group: IndexMeta,
  docId: string,
  options: BufferedWriteOptions = {}
): Promise<BufferedWriteResponse> {
  const shardId = shardIndexId(group.id, shardForDoc(docId, shardCountOf(group)))
  return bufferDelete(storage, shardId, docId, options)
}

type BatchOperation = { op: 'upsert'; id: string; doc: Record<string, unknown> } | { op: 'delete'; id: string }

export async function bufferBatchSharded(
  storage: ObjectStorage,
  group: IndexMeta,
  operations: BatchOperation[],
  options: BufferedWriteOptions = {}
): Promise<BufferedWriteResponse> {
  const count = shardCountOf(group)
  const bufferedAt = new Date().toISOString()

  const perShard: BatchOperation[][] = Array.from({ length: count }, () => [])
  for (const operation of operations) {
    perShard[shardForDoc(operation.id, count)]!.push(operation)
  }

  const results = await Promise.all(
    shardIndexIds(group.id, count).map(async (shardId, i): Promise<ShardWriteResult | null> => {
      const ops = perShard[i]!
      if (ops.length === 0) {
        return null
      }
      const result = await bufferBatch(storage, shardId, ops, options)
      return {
        indexId: shardId,
        ops: ops.length,
        changeId: result.changeId,
        bufferedAt: result.bufferedAt,
        indexStatus: result.indexStatus
      }
    })
  )

  const shards = results.filter((r): r is ShardWriteResult => r !== null)

  return {
    status: 'buffered',
    changeId: newChangeId(),
    bufferedAt,
    indexStatus: worstStatus(shards.map((s) => s.indexStatus)),
    shards
  }
}

export interface ShardSearchContribution {
  indexId: string
  result: Record<string, unknown>
}

interface SearchHit {
  id: string
  score: number
  document: unknown
}

type FacetResultShape = Record<string, { count: number; values: Record<string, number> }>

function compareHits(a: SearchHit, b: SearchHit): number {
  if (b.score !== a.score) {
    return b.score - a.score
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function mergeHits(allHits: SearchHit[], offset: number, limit: number): SearchHit[] {
  return allHits.sort(compareHits).slice(offset, offset + limit)
}

function mergeFacets(facetResults: FacetResultShape[]): FacetResultShape {
  const merged: FacetResultShape = {}

  for (const facets of facetResults) {
    for (const [property, facet] of Object.entries(facets)) {
      const target = (merged[property] ??= { count: 0, values: {} })
      target.count += facet.count
      for (const [value, valueCount] of Object.entries(facet.values)) {
        target.values[value] = (target.values[value] ?? 0) + valueCount
      }
    }
  }

  return merged
}

export function mergeShardSearchResults(
  contributions: ShardSearchContribution[],
  options: { limit: number; offset: number }
): Record<string, unknown> {
  const { limit, offset } = options

  const allHits: SearchHit[] = []
  const allVectorHits: SearchHit[] = []
  const facetResults: FacetResultShape[] = []
  let count = 0
  let includesBuffer = false
  let maxElapsed: { raw: number; formatted: string } | null = null
  let hasVectorHits = false

  for (const { result } of contributions) {
    count += (result.count as number) ?? 0
    includesBuffer = includesBuffer || result.includesBuffer === true
    allHits.push(...((result.hits as SearchHit[] | undefined) ?? []))

    const vectorHits = result.hitsVector as SearchHit[] | undefined
    if (vectorHits) {
      hasVectorHits = true
      allVectorHits.push(...vectorHits)
    }

    const facets = result.facets as FacetResultShape | undefined
    if (facets) {
      facetResults.push(facets)
    }

    const elapsed = result.elapsed as { raw: number; formatted: string } | undefined

    if (elapsed && (!maxElapsed || elapsed.raw > maxElapsed.raw)) {
      maxElapsed = elapsed
    }
  }

  const merged: Record<string, unknown> = {
    count,
    hits: mergeHits(allHits, offset, limit),
    elapsed: maxElapsed ?? { raw: 0, formatted: '0ms' },
    indexVersion: null,
    includesBuffer,
    shards: contributions.map(({ indexId, result }) => ({
      indexId,
      liveVersion: (result.indexVersion as string | null) ?? null,
      includesBuffer: result.includesBuffer === true,
      count: (result.count as number) ?? 0
    }))
  }

  if (facetResults.length > 0) {
    merged.facets = mergeFacets(facetResults)
  }

  if (hasVectorHits) {
    merged.hitsVector = mergeHits(allVectorHits, offset, limit)
  }

  return merged
}

export async function runShardedSearch(
  storage: ObjectStorage,
  cache: ShardCache,
  group: IndexMeta,
  params: SearchInput,
  options: SearchOptions = {}
): Promise<Record<string, unknown>> {
  const count = shardCountOf(group)
  const limit = params.limit ?? DEFAULT_SEARCH_LIMIT
  const offset = params.offset ?? 0

  const shardIds = shardIndexIds(group.id, count)
  const shardMetas = await Promise.all(shardIds.map((id) => getIndexMeta(storage, id)))

  const contributions = await Promise.all(
    shardIds.map(async (shardId, i): Promise<ShardSearchContribution | null> => {
      const shardMeta = shardMetas[i]!

      if (!shardMeta.liveVersion && shardMeta.pendingOps === 0) {
        return null
      }

      try {
        const result = await runSearch(
          storage,
          cache,
          shardId,
          { ...params, limit: offset + limit, offset: 0 },
          options
        )
        return { indexId: shardId, result }
      } catch (err) {

        if (err instanceof EdgeApiError && err.status === 404) {
          return null
        }

        throw err
      }
    })
  )

  const present = contributions.filter((c): c is ShardSearchContribution => c !== null)
  if (present.length === 0) {
    throw notFound(`Index ${group.id} has no searchable documents yet.`)
  }

  return mergeShardSearchResults(present, { limit, offset })
}

export async function rebuildShardGroup(
  storage: ObjectStorage,
  group: IndexMeta,
  options: RebuildOptions = {}
): Promise<IndexMeta> {
  await Promise.all(
    shardIndexIds(group.id, shardCountOf(group)).map((shardId) => rebuildIndex(storage, shardId, options))
  )

  return group
}

export async function maybeScheduleRebuildSharded(
  storage: ObjectStorage,
  group: IndexMeta,
  options: ScheduleRebuildOptions = {}
): Promise<void> {
  await Promise.all(
    shardIndexIds(group.id, shardCountOf(group)).map((shardId) => maybeScheduleRebuild(storage, shardId, options))
  )
}

function toShardSummary(status: IndexStatusResponse): ShardStatusSummary {
  return {
    indexId: status.indexId,
    liveVersion: status.liveVersion,
    status: status.status,
    documents: status.documents,
    indexSizeBytes: status.indexSizeBytes,
    pendingOps: status.pendingOps,
    lastRebuildAt: status.lastRebuildAt
  }
}

export async function getShardedStatus(storage: ObjectStorage, group: IndexMeta): Promise<IndexStatusResponse> {
  const shardStatuses = await Promise.all(
    shardIndexIds(group.id, shardCountOf(group)).map((shardId) => getStatus(storage, shardId))
  )

  return {
    indexId: group.id,
    liveVersion: null,
    status: worstStatus(shardStatuses.map((s) => s.status)),
    documents: shardStatuses.reduce((sum, s) => sum + s.documents, 0),
    indexSizeBytes: shardStatuses.reduce((sum, s) => sum + s.indexSizeBytes, 0),
    pendingOps: shardStatuses.reduce((sum, s) => sum + s.pendingOps, 0),
    lastRebuildAt:
      shardStatuses
        .map((s) => s.lastRebuildAt)
        .filter((t): t is string => t !== null)
        .sort()
        .at(-1) ?? null,
    lastAppliedOffset: null,
    shards: shardStatuses.map(toShardSummary)
  }
}

export async function getShardedManifest(storage: ObjectStorage, group: IndexMeta) {
  const status = await getShardedStatus(storage, group)
  return {
    indexId: group.id,
    name: group.name,
    liveVersion: null,
    status: status.status,
    schema: group.schema,
    settings: group.settings,
    shards: status.shards,
    stats: {
      documents: status.documents,
      totalBytes: status.indexSizeBytes
    }
  }
}

export interface ShardedImportResult {
  indexId: string
  shardCount: number
  documents: number
  indexSizeBytes: number
  shards: Array<{
    indexId: string
    liveVersion: string | null
    documents: number
    indexSizeBytes: number
    status: IndexStatus
  }>
}

export async function importShardedDocuments(
  storage: ObjectStorage,
  logicalId: string,
  documents: ImportDocument[],
  options: { shards: number; create?: CreateIndexInput }
): Promise<ShardedImportResult> {
  const { shards } = options
  if (!Number.isInteger(shards) || shards < 2) {
    throw badRequest('Shard count must be an integer >= 2')
  }

  let group: IndexMeta | null = null

  try {
    group = await getIndexMeta(storage, logicalId)
  } catch (err) {
    if (!(err instanceof EdgeApiError && err.status === 404)) {
      throw err
    }
  }

  if (!group) {
    if (!options.create) {
      throw notFound(`Index ${logicalId} not found`)
    }

    group = await createIndex(storage, {
      ...options.create,
      name: options.create.name || logicalId,
      shards
    })

  } else {
    if (!isShardGroupMeta(group)) {
      throw badRequest(`Index ${logicalId} is not a shard group; import without shard routing`)
    }

    if (shardCountOf(group) !== shards) {
      throw badRequest(
        `Index ${logicalId} was created with ${shardCountOf(group)} shards, got --shards ${shards}. Re-sharding requires a re-import into a new index.`
      )
    }
  }

  const buckets: ImportDocument[][] = Array.from({ length: shards }, () => [])
  for (const document of documents) {
    buckets[shardForDoc(document.id, shards)]!.push(document)
  }

  const shardMetas = await Promise.all(
    shardIndexIds(logicalId, shards).map((shardId, i) => importDocuments(storage, shardId, buckets[i]!))
  )

  return {
    indexId: logicalId,
    shardCount: shards,
    documents: shardMetas.reduce((sum, m) => sum + m.documents, 0),
    indexSizeBytes: shardMetas.reduce((sum, m) => sum + m.indexSizeBytes, 0),
    shards: shardMetas.map((m) => ({
      indexId: m.id,
      liveVersion: m.liveVersion,
      documents: m.documents,
      indexSizeBytes: m.indexSizeBytes,
      status: m.status
    }))
  }
}
