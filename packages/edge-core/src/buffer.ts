import { concatBytes, decodeJson, encodeJson, encodeNdjsonLine, parseNdjson } from './codec.js'
import { bufferHeadKey, bufferSegmentKey, newChangeId, nextSegmentName } from './paths.js'
import type { ObjectStorage } from './storage.js'
import type { BufferDeleteOp, BufferHead, BufferOp, BufferUpsertOp } from './types.js'

const MAX_SEGMENT_BYTES = 64 * 1024 * 1024

const defaultHead = (): BufferHead => ({
  segment: '000001.ndjson',
  offset: 0,
  opCount: 0,
  pendingOps: 0,
  oldestOpAt: null
})

export async function getBufferHead(storage: ObjectStorage, indexId: string): Promise<BufferHead> {
  const obj = await storage.get(bufferHeadKey(indexId))
  if (!obj) {
    return defaultHead()
  }
  return decodeJson<BufferHead>(obj.body)
}

async function saveBufferHead(storage: ObjectStorage, indexId: string, head: BufferHead): Promise<void> {
  await storage.put(bufferHeadKey(indexId), encodeJson(head), { contentType: 'application/json' })
}

export async function appendBufferOp(
  storage: ObjectStorage,
  indexId: string,
  op: BufferUpsertOp | BufferDeleteOp
): Promise<{ changeId: string; bufferedAt: string; head: BufferHead }> {
  const head = await getBufferHead(storage, indexId)
  const line = encodeNdjsonLine(op)
  const segmentKey = bufferSegmentKey(indexId, head.segment)

  let segmentBody: Uint8Array
  const existing = await storage.get(segmentKey)
  if (existing) {
    segmentBody = concatBytes([existing.body, line])
  } else {
    segmentBody = line
  }

  if (segmentBody.byteLength > MAX_SEGMENT_BYTES) {
    head.segment = nextSegmentName(head.segment)
    head.offset = 0
    await storage.put(bufferSegmentKey(indexId, head.segment), line, { contentType: 'application/x-ndjson' })
    head.offset = line.byteLength
  } else {
    await storage.put(segmentKey, segmentBody, { contentType: 'application/x-ndjson' })
    head.offset = segmentBody.byteLength
  }

  head.opCount += 1
  head.pendingOps += 1
  if (!head.oldestOpAt) {
    head.oldestOpAt = op.ts
  }

  await saveBufferHead(storage, indexId, head)

  return {
    changeId: newChangeId(),
    bufferedAt: op.ts,
    head
  }
}

export async function readBufferOps(storage: ObjectStorage, indexId: string): Promise<BufferOp[]> {
  const prefix = `buffer/${indexId}/segments/`
  const keys: string[] = []
  for await (const entry of storage.list(prefix)) {
    keys.push(entry.key)
  }
  keys.sort()

  const ops: BufferOp[] = []
  for (const key of keys) {
    const obj = await storage.get(key)
    if (!obj) {
      continue
    }
    const text = new TextDecoder().decode(obj.body)
    for (const line of parseNdjson(text)) {
      ops.push(line as BufferOp)
    }
  }
  return ops
}

export async function clearBuffer(storage: ObjectStorage, indexId: string): Promise<void> {
  const prefix = `buffer/${indexId}/segments/`
  for await (const entry of storage.list(prefix)) {
    await storage.delete(entry.key)
  }
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
