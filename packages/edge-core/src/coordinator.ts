import type { BufferHead, BufferOp, IndexMeta } from './types.js'

export interface WalAppendResult {
  changeId: string
  bufferedAt: string
  head: BufferHead
}

export interface WalFreezeResult {
  ops: BufferOp[]
  frozenSegmentKeys: string[]
}

export interface WalRebuildResult {
  version: string
  documents: number
  indexSizeBytes: number
  lastRebuildAt: string
}

export interface WalCoordinator {
  appendOps(indexId: string, ops: BufferOp[]): Promise<WalAppendResult>
  freezeForRebuild(indexId: string): Promise<WalFreezeResult>
  finalizeAfterRebuild(
    indexId: string,
    frozenSegmentKeys: string[],
    result: WalRebuildResult
  ): Promise<IndexMeta>
  acquireRebuildLock(indexId: string): Promise<boolean>
  releaseRebuildLock(indexId: string): Promise<void>
  clearBuffer(indexId: string): Promise<void>
}
