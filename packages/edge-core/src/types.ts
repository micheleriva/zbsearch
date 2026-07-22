import type { AnySchema } from 'zbsearch'

export type IndexStatus = 'ready' | 'building' | 'empty'

export type IndexMode = 'edge' | 'hybrid' | 'client'

export interface IndexSettings {
  language?: string
  rebuildIntervalSec?: number
  rebuildThresholdOps?: number
  mode?: IndexMode
}

export interface IndexMeta {
  id: string
  name: string
  schema: AnySchema
  settings: IndexSettings
  shards?: { count: number }
  liveVersion: string | null
  buildingVersion: string | null
  status: IndexStatus
  documents: number
  indexSizeBytes: number
  pendingOps: number
  lastAppliedOffset: string | null
  lastRebuildAt: string | null
  createdAt: string
  updatedAt: string
}

export interface BufferHead {
  opCount: number
  pendingOps: number
  oldestOpAt: string | null
  /** @deprecated Legacy in-place segment buffer. */
  segment?: string
  offset?: number
}

export type BufferOp = BufferUpsertOp | BufferDeleteOp

export interface BufferUpsertOp {
  op: 'upsert'
  id: string
  ts: string
  doc: Record<string, unknown>
}

export interface BufferDeleteOp {
  op: 'delete'
  id: string
  ts: string
}

export interface Registry {
  indexes: string[]
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
  }
}

export interface BufferedWriteResponse {
  status: 'buffered'
  changeId: string
  bufferedAt: string
  indexStatus: IndexStatus
  shards?: ShardWriteResult[]
}

export interface ShardWriteResult {
  indexId: string
  ops: number
  changeId: string
  bufferedAt: string
  indexStatus: IndexStatus
}

export interface ShardStatusSummary {
  indexId: string
  liveVersion: string | null
  status: IndexStatus
  documents: number
  indexSizeBytes: number
  pendingOps: number
  lastRebuildAt: string | null
}

export interface IndexStatusResponse {
  indexId: string
  liveVersion: string | null
  status: IndexStatus
  documents: number
  indexSizeBytes: number
  pendingOps: number
  lastRebuildAt: string | null
  lastAppliedOffset: string | null
  shards?: ShardStatusSummary[]
}
