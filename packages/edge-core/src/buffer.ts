import { concatBytes, decodeJson, encodeJson, encodeNdjsonLine, parseNdjson } from './codec.js'
import {
  bufferHeadKey,
  legacyBufferSegmentsPrefix,
  newChangeId,
  walEntriesPrefix,
  walEntryFileName,
  walEntryKey,
  walHeadKey,
  walSegmentsPrefix
} from './paths.js'
import type { ObjectStorage } from './storage.js'
import type { BufferDeleteOp, BufferHead, BufferOp, BufferUpsertOp } from './types.js'

const defaultHead = (): BufferHead => ({
  opCount: 0,
  pendingOps: 0,
  oldestOpAt: null
})

export async function getBufferHead(storage: ObjectStorage, indexId: string): Promise<BufferHead> {
  const wal = await storage.get(walHeadKey(indexId))
  if (wal) {
    return decodeJson<BufferHead>(wal.body)
  }
  const legacy = await storage.get(bufferHeadKey(indexId))
  if (legacy) {
    return decodeJson<BufferHead>(legacy.body)
  }
  return defaultHead()
}

export async function saveBufferHead(
  storage: ObjectStorage,
  indexId: string,
  head: BufferHead
): Promise<void> {
  await storage.put(walHeadKey(indexId), encodeJson(head), { contentType: 'application/json' })
}

export const WAL_SEGMENT_MAX_OPS = 100
export const WAL_SEGMENT_MAX_BYTES = 256 * 1024

export function encodeWalSegmentOps(ops: BufferOp[]): Uint8Array {
  return concatBytes(ops.map((op) => encodeNdjsonLine(op)))
}

async function listWalObjectKeys(storage: ObjectStorage, indexId: string): Promise<string[]> {
  const keys: string[] = []
  for await (const entry of storage.list(walEntriesPrefix(indexId))) {
    keys.push(entry.key)
  }
  for await (const entry of storage.list(walSegmentsPrefix(indexId))) {
    keys.push(entry.key)
  }
  for await (const entry of storage.list(legacyBufferSegmentsPrefix(indexId))) {
    keys.push(entry.key)
  }
  keys.sort()
  return keys
}

const WAL_READ_CONCURRENCY = 10

async function readBufferOpsFromKeys(storage: ObjectStorage, keys: string[]): Promise<BufferOp[]> {
  const ops: BufferOp[] = []

  for (let i = 0; i < keys.length; i += WAL_READ_CONCURRENCY) {
    const chunk = keys.slice(i, i + WAL_READ_CONCURRENCY)
    const results = await Promise.all(chunk.map((key) => storage.get(key)))

    for (const obj of results) {
      if (!obj) {
        continue
      }

      const text = new TextDecoder().decode(obj.body)

      for (const line of parseNdjson(text)) {
        ops.push(line as BufferOp)
      }
    }
  }

  return ops
}

export async function appendBufferOp(
  storage: ObjectStorage,
  indexId: string,
  op: BufferUpsertOp | BufferDeleteOp
): Promise<{ changeId: string; bufferedAt: string; head: BufferHead }> {
  const head = await getBufferHead(storage, indexId)
  const seq = head.opCount + 1
  const changeId = newChangeId()
  const line = encodeNdjsonLine(op)
  await storage.put(walEntryKey(indexId, walEntryFileName(seq, op.ts, changeId)), line, {
    contentType: 'application/x-ndjson'
  })

  head.opCount = seq
  head.pendingOps += 1
  if (!head.oldestOpAt) {
    head.oldestOpAt = op.ts
  }

  await saveBufferHead(storage, indexId, head)

  return {
    changeId,
    bufferedAt: op.ts,
    head
  }
}

export async function appendWalBatch(
  storage: ObjectStorage,
  indexId: string,
  ops: BufferOp[]
): Promise<{ changeId: string; bufferedAt: string; head: BufferHead }> {
  if (ops.length === 0) {
    const head = await getBufferHead(storage, indexId)
    return { changeId: newChangeId(), bufferedAt: new Date().toISOString(), head }
  }

  const head = await getBufferHead(storage, indexId)
  const seq = head.opCount + 1
  const changeId = newChangeId()
  const bufferedAt = ops[ops.length - 1]!.ts
  const body = concatBytes(ops.map((op) => encodeNdjsonLine(op)))
  await storage.put(walEntryKey(indexId, walEntryFileName(seq, bufferedAt, changeId)), body, {
    contentType: 'application/x-ndjson'
  })

  head.opCount = seq
  head.pendingOps += ops.length
  if (!head.oldestOpAt) {
    head.oldestOpAt = ops[0]!.ts
  }

  await saveBufferHead(storage, indexId, head)

  return {
    changeId,
    bufferedAt,
    head
  }
}

export async function readBufferOps(storage: ObjectStorage, indexId: string): Promise<BufferOp[]> {
  return readBufferOpsFromKeys(storage, await listWalObjectKeys(storage, indexId))
}

export async function freezeBufferForRebuild(
  storage: ObjectStorage,
  indexId: string
): Promise<{ ops: BufferOp[]; frozenSegmentKeys: string[] }> {
  const frozenSegmentKeys = await listWalObjectKeys(storage, indexId)
  const ops = await readBufferOpsFromKeys(storage, frozenSegmentKeys)
  return { ops, frozenSegmentKeys }
}

export async function finalizeBufferAfterRebuild(
  storage: ObjectStorage,
  indexId: string,
  frozenSegmentKeys: string[]
): Promise<BufferHead> {
  for (const key of frozenSegmentKeys) {
    await storage.delete(key)
  }

  const remainingKeys = await listWalObjectKeys(storage, indexId)
  if (remainingKeys.length === 0) {
    await storage.delete(walHeadKey(indexId))
    await storage.delete(bufferHeadKey(indexId))
    return defaultHead()
  }

  const remainingOps = await readBufferOpsFromKeys(storage, remainingKeys)
  const head = await getBufferHead(storage, indexId)
  head.pendingOps = remainingOps.length
  head.oldestOpAt = remainingOps[0]?.ts ?? null
  await saveBufferHead(storage, indexId, head)
  return head
}

export async function clearBuffer(storage: ObjectStorage, indexId: string): Promise<void> {
  for await (const entry of storage.list(walEntriesPrefix(indexId))) {
    await storage.delete(entry.key)
  }

  for await (const entry of storage.list(walSegmentsPrefix(indexId))) {
    await storage.delete(entry.key)
  }

  for await (const entry of storage.list(legacyBufferSegmentsPrefix(indexId))) {
    await storage.delete(entry.key)
  }

  await storage.delete(walHeadKey(indexId))
  await storage.delete(bufferHeadKey(indexId))
}

export function applyBufferOps(
  documents: Map<string, Record<string, unknown>>,
  ops: BufferOp[]
): Map<string, Record<string, unknown>> {
  const next = new Map(documents)
  for (const op of ops) {
    if (op.op === 'upsert') {
      next.set(op.id, { ...op.doc })
    } else {
      next.delete(op.id)
    }
  }
  return next
}
