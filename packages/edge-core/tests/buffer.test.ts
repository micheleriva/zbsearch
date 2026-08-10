import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import {
  appendBufferOp,
  appendWalBatch,
  applyBufferOps,
  clearBuffer,
  finalizeBufferAfterRebuild,
  freezeBufferForRebuild,
  getBufferHead,
  readBufferOps
} from '../src/buffer.js'
import { encodeNdjsonLine } from '../src/codec.js'
import { bufferSegmentKey } from '../src/paths.js'
import type { ObjectStorage } from '../src/storage.js'
import { MemoryObjectStorage } from './helpers/memory-storage.js'

describe('buffer', () => {
  it('returns default head when missing', async () => {
    const storage = new MemoryObjectStorage()
    const head = await getBufferHead(storage, 'new')
    assert.deepEqual(head, {
      opCount: 0,
      pendingOps: 0,
      oldestOpAt: null
    })
  })

  it('appends upsert ops and increments counters', async () => {
    const storage = new MemoryObjectStorage()
    const result = await appendBufferOp(storage, 'idx', {
      op: 'upsert',
      id: '1',
      ts: '2020-01-01T00:00:00.000Z',
      doc: { title: 'A' }
    })

    assert.match(result.changeId, /^chg_/)
    assert.equal(result.bufferedAt, '2020-01-01T00:00:00.000Z')
    assert.equal(result.head.pendingOps, 1)
    assert.equal(result.head.opCount, 1)
    assert.equal(result.head.oldestOpAt, '2020-01-01T00:00:00.000Z')
  })

  it('appends delete ops', async () => {
    const storage = new MemoryObjectStorage()
    await appendBufferOp(storage, 'idx', {
      op: 'delete',
      id: '1',
      ts: 't1'
    })
    const ops = await readBufferOps(storage, 'idx')
    assert.equal(ops.length, 1)
    assert.deepEqual(ops[0], { op: 'delete', id: '1', ts: 't1' })
  })

  it('reads legacy segment files in sorted order', async () => {
    const storage = new MemoryObjectStorage()
    const seg1 = bufferSegmentKey('idx', '000001.ndjson')
    const seg2 = bufferSegmentKey('idx', '000002.ndjson')
    const line1 = encodeNdjsonLine({ op: 'upsert', id: '1', ts: 't1', doc: { x: 1 } })
    const line2 = encodeNdjsonLine({ op: 'upsert', id: '2', ts: 't2', doc: { x: 2 } })
    await storage.put(seg1, line1)
    await storage.put(seg2, line2)

    const ops = await readBufferOps(storage, 'idx')
    assert.equal(ops.length, 2)
    assert.equal((ops[0] as { id: string }).id, '1')
    assert.equal((ops[1] as { id: string }).id, '2')
  })

  it('clears WAL entries and head', async () => {
    const storage = new MemoryObjectStorage()
    await appendBufferOp(storage, 'idx', {
      op: 'upsert',
      id: '1',
      ts: 't',
      doc: { a: 1 }
    })
    await clearBuffer(storage, 'idx')
    assert.equal((await readBufferOps(storage, 'idx')).length, 0)
    assert.equal((await getBufferHead(storage, 'idx')).pendingOps, 0)
  })

  it('applyBufferOps upserts and deletes documents', () => {
    const docs = new Map<string, Record<string, unknown>>([
      ['1', { title: 'A' }],
      ['2', { title: 'B' }]
    ])
    const next = applyBufferOps(docs, [
      { op: 'upsert', id: '2', ts: 't', doc: { title: 'Updated' } },
      { op: 'upsert', id: '3', ts: 't', doc: { title: 'C' } },
      { op: 'delete', id: '1', ts: 't' }
    ])
    assert.equal(next.size, 2)
    assert.deepEqual(next.get('2'), { title: 'Updated' })
    assert.deepEqual(next.get('3'), { title: 'C' })
    assert.equal(next.has('1'), false)
  })

  it('applyBufferOps does not mutate source map', () => {
    const docs = new Map([['1', { x: 1 }]])
    applyBufferOps(docs, [{ op: 'delete', id: '1', ts: 't' }])
    assert.equal(docs.size, 1)
  })

  it('creates separate WAL entries per append', async () => {
    const storage = new MemoryObjectStorage()
    await appendBufferOp(storage, 'idx', { op: 'upsert', id: '1', ts: 't1', doc: { a: 1 } })
    await appendBufferOp(storage, 'idx', { op: 'upsert', id: '2', ts: 't2', doc: { a: 2 } })
    const ops = await readBufferOps(storage, 'idx')
    assert.equal(ops.length, 2)
    const head = await getBufferHead(storage, 'idx')
    assert.equal(head.pendingOps, 2)
    assert.equal(head.opCount, 2)
  })

  it('appendWalBatch writes multiple ops to one entry', async () => {
    const storage = new MemoryObjectStorage()
    await appendWalBatch(storage, 'idx', [
      { op: 'upsert', id: '1', ts: 't1', doc: { a: 1 } },
      { op: 'upsert', id: '2', ts: 't2', doc: { a: 2 } }
    ])
    const ops = await readBufferOps(storage, 'idx')
    assert.equal(ops.length, 2)
    const head = await getBufferHead(storage, 'idx')
    assert.equal(head.pendingOps, 2)
  })

  it('freezeBufferForRebuild isolates new writes from frozen entries', async () => {
    const storage = new MemoryObjectStorage()
    await appendBufferOp(storage, 'idx', { op: 'upsert', id: '1', ts: 't1', doc: { a: 1 } })

    const frozen = await freezeBufferForRebuild(storage, 'idx')
    assert.equal(frozen.ops.length, 1)
    assert.equal(frozen.frozenSegmentKeys.length, 1)

    await appendBufferOp(storage, 'idx', { op: 'upsert', id: '2', ts: 't2', doc: { a: 2 } })

    const head = await finalizeBufferAfterRebuild(storage, 'idx', frozen.frozenSegmentKeys)
    const remaining = await readBufferOps(storage, 'idx')
    assert.equal(remaining.length, 1)
    assert.equal((remaining[0] as { id: string }).id, '2')
    assert.equal(head.pendingOps, 1)
  })

  it('finalizeBufferAfterRebuild clears head when all entries are compacted', async () => {
    const storage = new MemoryObjectStorage()
    await appendBufferOp(storage, 'idx', { op: 'upsert', id: '1', ts: 't1', doc: { a: 1 } })

    const frozen = await freezeBufferForRebuild(storage, 'idx')
    const head = await finalizeBufferAfterRebuild(storage, 'idx', frozen.frozenSegmentKeys)

    assert.equal((await readBufferOps(storage, 'idx')).length, 0)
    assert.deepEqual(head, {
      opCount: 0,
      pendingOps: 0,
      oldestOpAt: null
    })
  })

  it('freezeBufferForRebuild returns empty when buffer has no entries', async () => {
    const storage = new MemoryObjectStorage()
    const frozen = await freezeBufferForRebuild(storage, 'idx')
    assert.equal(frozen.ops.length, 0)
    assert.equal(frozen.frozenSegmentKeys.length, 0)
  })

  it('reads many WAL entries in listed order across fetch chunks', async () => {
    const storage = new MemoryObjectStorage()
    for (let i = 1; i <= 25; i++) {
      await appendBufferOp(storage, 'idx', {
        op: 'upsert',
        id: String(i),
        ts: `t${i}`,
        doc: { n: i }
      })
    }

    const ops = await readBufferOps(storage, 'idx')
    assert.equal(ops.length, 25)
    assert.deepEqual(
      ops.map((op) => (op as { id: string }).id),
      Array.from({ length: 25 }, (_, i) => String(i + 1))
    )
  })

  it('fetches WAL entries with bounded concurrency', async () => {
    const memory = new MemoryObjectStorage()
    for (let i = 1; i <= 25; i++) {
      await appendBufferOp(memory, 'idx', {
        op: 'upsert',
        id: String(i),
        ts: `t${i}`,
        doc: { n: i }
      })
    }

    let inFlight = 0
    let maxInFlight = 0
    const storage: ObjectStorage = {
      get: async (key) => {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        // Yield so concurrent gets within a chunk overlap.
        await new Promise((resolve) => setTimeout(resolve, 1))
        inFlight -= 1
        return memory.get(key)
      },
      put: (key, body, opts) => memory.put(key, body, opts),
      delete: (key) => memory.delete(key),
      list: (prefix) => memory.list(prefix)
    }

    const ops = await readBufferOps(storage, 'idx')
    assert.equal(ops.length, 25)
    assert.ok(maxInFlight > 1, `expected parallel fetches, max in-flight was ${maxInFlight}`)
    assert.ok(maxInFlight <= 10, `expected at most 10 in-flight fetches, got ${maxInFlight}`)
  })
})
