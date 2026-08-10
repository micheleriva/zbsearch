export type { ObjectGetResult, ObjectStorage, ShardCache } from './storage.js'
export { NoopShardCache } from './storage.js'
export type {
  ApiErrorBody,
  BufferDeleteOp,
  BufferHead,
  BufferOp,
  BufferUpsertOp,
  BufferedWriteResponse,
  IndexMeta,
  IndexMode,
  IndexSettings,
  IndexStatus,
  IndexStatusResponse,
  Registry,
  ShardStatusSummary,
  ShardWriteResult
} from './types.js'
export type { WalAppendResult, WalCoordinator, WalFreezeResult, WalRebuildResult } from './coordinator.js'
export {
  appendBufferOp,
  appendWalBatch,
  applyBufferOps,
  clearBuffer,
  encodeWalSegmentOps,
  finalizeBufferAfterRebuild,
  freezeBufferForRebuild,
  getBufferHead,
  readBufferOps,
  saveBufferHead,
  WAL_SEGMENT_MAX_BYTES,
  WAL_SEGMENT_MAX_OPS
} from './buffer.js'
export { decodeJson, encodeJson, encodeNdjsonLine, parseNdjson } from './codec.js'
export { EdgeApiError, badRequest, conflict, notFound, unauthorized } from './errors.js'
export {
  bufferHeadKey,
  bufferSegmentKey,
  indexMetaKey,
  legacyBufferSegmentsPrefix,
  newChangeId,
  newVersionId,
  nextSegmentName,
  registryKey,
  snapshotKey,
  walEntriesPrefix,
  walEntryFileName,
  walEntryKey,
  walHeadKey,
  walOpenSegmentKey,
  walSegmentFileName,
  walSegmentKey,
  walSegmentsPrefix
} from './paths.js'
export {
  deleteIndexMeta,
  getIndexMeta,
  listIndexMetas,
  loadRegistry,
  registerIndex,
  saveIndexMeta
} from './registry.js'
export type {
  BufferedWriteOptions,
  CreateIndexInput,
  ImportDocument,
  RebuildOptions,
  ScheduleRebuildOptions,
  SearchInput,
  SearchOptions,
  SnapshotDbCacheOptions
} from './service.js'
export {
  bufferBatch,
  bufferDelete,
  bufferUpsert,
  clearSnapshotDbCache,
  configureSnapshotDbCache,
  createIndex,
  getIndexManifest,
  getStatus,
  importDocuments,
  maybeScheduleRebuild,
  rebuildIndex,
  runSearch
} from './service.js'
export type { HttpRequest, HttpResponse, RouterContext } from './router.js'
export { handleRequest, toResponse } from './router.js'
export {
  SHARD_ID_SEPARATOR,
  fnv1a32,
  isShardGroupMeta,
  physicalShardIds,
  shardForDoc,
  shardIndexId,
  shardIndexIds
} from './shards.js'
export type { ShardSearchContribution, ShardedImportResult } from './shard-group.js'
export { importShardedDocuments, mergeShardSearchResults } from './shard-group.js'
