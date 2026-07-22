import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  encodeWalSegmentOps,
  getBufferHead,
  readBufferOps,
  clearBuffer,
  finalizeBufferAfterRebuild,
  freezeBufferForRebuild,
  saveBufferHead,
  WAL_SEGMENT_MAX_OPS
} from '../src/buffer.js'
import type {
  WalAppendResult,
  WalCoordinator,
  WalFreezeResult,
  WalRebuildResult
} from '../src/coordinator.js'
import { decodeJson, encodeNdjsonLine } from '../src/codec.js'
import {
  bufferSegmentKey,
  indexMetaKey,
  newChangeId,
  walEntryFileName,
  walEntryKey,
  walOpenSegmentKey,
  walSegmentKey,
  walSegmentsPrefix
} from '../src/paths.js'
import { getIndexMeta, saveIndexMeta } from '../src/registry.js'
import {
  bufferDelete,
  bufferUpsert,
  createIndex,
  getStatus,
  maybeScheduleRebuild,
  rebuildIndex,
  runSearch
} from '../src/service.js'
import { NoopShardCache } from '../src/storage.js'
import type { BufferOp, IndexMeta } from '../src/types.js'
import { MemoryObjectStorage } from './helpers/memory-storage.js'

interface OpenSegmentState {
  firstSeq: number
  changeId: string
  ops: BufferOp[]
  bytes: number
}

class MemoryWalCoordinator implements WalCoordinator {
  private open: OpenSegmentState | null = null
  private rebuildLock = false
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly storage: MemoryObjectStorage) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn)
    this.queue = run.catch(() => {})
    return run
  }

  appendOps(indexId: string, ops: BufferOp[]): Promise<WalAppendResult> {
    return this.enqueue(async () => {
      const storage = this.storage
      const head = await getBufferHead(storage, indexId)
      const firstSeq = head.opCount + 1
      const lastSeq = firstSeq + ops.length - 1
      const incomingBytes = encodeWalSegmentOps(ops).byteLength

      if (this.open && this.open.ops.length + ops.length > WAL_SEGMENT_MAX_OPS) {
        await this.flushOpenSegment(indexId)
      }

      if (!this.open) {
        this.open = { firstSeq, changeId: newChangeId(), ops: [], bytes: 0 }
      }
      this.open.ops.push(...ops)
      this.open.bytes += incomingBytes
      await storage.put(walOpenSegmentKey(indexId), encodeWalSegmentOps(this.open.ops), {
        contentType: 'application/x-ndjson'
      })

      head.opCount = lastSeq
      head.pendingOps += ops.length
      if (!head.oldestOpAt) {
        head.oldestOpAt = ops[0]!.ts
      }
      await saveBufferHead(storage, indexId, head)

      const metaObj = await storage.get(indexMetaKey(indexId))
      if (metaObj) {
        const meta = decodeJson<IndexMeta>(metaObj.body)
        meta.pendingOps = head.pendingOps
        meta.status = meta.liveVersion ? meta.status : 'empty'
        await saveIndexMeta(storage, meta)
      }

      return { changeId: this.open.changeId, bufferedAt: ops[ops.length - 1]!.ts, head }
    })
  }

  freezeForRebuild(indexId: string): Promise<WalFreezeResult> {
    return this.enqueue(async () => {
      if (this.open) {
        await this.flushOpenSegment(indexId)
      }
      return freezeBufferForRebuild(this.storage, indexId)
    })
  }

  finalizeAfterRebuild(
    indexId: string,
    frozenSegmentKeys: string[],
    result: WalRebuildResult
  ): Promise<IndexMeta> {
    return this.enqueue(async () => {
      const head = await finalizeBufferAfterRebuild(this.storage, indexId, frozenSegmentKeys)
      const meta = await getIndexMeta(this.storage, indexId)
      meta.liveVersion = result.version
      meta.buildingVersion = null
      meta.status = result.documents > 0 || head.pendingOps > 0 ? 'ready' : 'empty'
      meta.documents = result.documents
      meta.indexSizeBytes = result.indexSizeBytes
      meta.pendingOps = head.pendingOps
      meta.lastRebuildAt = result.lastRebuildAt
      meta.lastAppliedOffset = null
      await saveIndexMeta(this.storage, meta)
      return meta
    })
  }

  acquireRebuildLock(_indexId: string): Promise<boolean> {
    return this.enqueue(async () => {
      if (this.rebuildLock) {
        return false
      }
      this.rebuildLock = true
      return true
    })
  }

  releaseRebuildLock(_indexId: string): Promise<void> {
    return this.enqueue(async () => {
      this.rebuildLock = false
    })
  }

  clearBuffer(indexId: string): Promise<void> {
    return this.enqueue(async () => {
      this.open = null
      await clearBuffer(this.storage, indexId)
    })
  }

  private async flushOpenSegment(indexId: string): Promise<void> {
    const open = this.open!
    const lastSeq = open.firstSeq + open.ops.length - 1
    await this.storage.put(
      walSegmentKey(indexId, open.firstSeq, lastSeq, open.changeId),
      encodeWalSegmentOps(open.ops),
      { contentType: 'application/x-ndjson' }
    )
    await this.storage.delete(walOpenSegmentKey(indexId))
    this.open = null
  }
}

function op(id: string, n: number): BufferOp {
  return { op: 'upsert', id, ts: `t${n}`, doc: { n } }
}

describe('wal segments', () => {
  it('reads finalized segment objects in sequence order', async () => {
    const storage = new MemoryObjectStorage()
    await storage.put(
      walSegmentKey('idx', 1, 3, 'chg_a'),
      encodeWalSegmentOps([op('1', 1), op('2', 2), op('3', 3)])
    )

    const ops = await readBufferOps(storage, 'idx')
    assert.deepEqual(
      ops.map((o) => (o as { id: string }).id),
      ['1', '2', '3']
    )
  })

  it('merges legacy buffer segments, per-op entries, and segments in sequence order', async () => {
    const storage = new MemoryObjectStorage()
    // Oldest format: legacy buffer/ segment.
    await storage.put(bufferSegmentKey('idx', '000001.ndjson'), encodeNdjsonLine(op('legacy', 1)))
    // Migration-era per-op entries (seqs 2-3).
    await storage.put(
      walEntryKey('idx', walEntryFileName(2, 't2', 'chg_b')),
      encodeNdjsonLine(op('entry-2', 2))
    )
    await storage.put(
      walEntryKey('idx', walEntryFileName(3, 't3', 'chg_c')),
      encodeNdjsonLine(op('entry-3', 3))
    )
    // Coordinator-era finalized segment (seqs 4-5) plus the open segment (seq 6).
    await storage.put(
      walSegmentKey('idx', 4, 5, 'chg_d'),
      encodeWalSegmentOps([op('seg-4', 4), op('seg-5', 5)])
    )
    await storage.put(walOpenSegmentKey('idx'), encodeWalSegmentOps([op('open-6', 6)]))

    const ops = await readBufferOps(storage, 'idx')
    assert.deepEqual(
      ops.map((o) => (o as { id: string }).id),
      ['legacy', 'entry-2', 'entry-3', 'seg-4', 'seg-5', 'open-6']
    )
  })

  it('freeze/finalize deletes consumed segments and keeps post-freeze writes', async () => {
    const storage = new MemoryObjectStorage()
    await storage.put(walSegmentKey('idx', 1, 2, 'chg_a'), encodeWalSegmentOps([op('1', 1), op('2', 2)]))
    await storage.put(walOpenSegmentKey('idx'), encodeWalSegmentOps([op('3', 3)]))
    await saveBufferHead(storage, 'idx', { opCount: 3, pendingOps: 3, oldestOpAt: 't1' })

    const frozen = await freezeBufferForRebuild(storage, 'idx')
    assert.equal(frozen.ops.length, 3)
    assert.equal(frozen.frozenSegmentKeys.length, 2)

    // A write lands after the freeze, under a new finalized segment.
    await storage.put(walSegmentKey('idx', 4, 4, 'chg_b'), encodeWalSegmentOps([op('4', 4)]))

    const head = await finalizeBufferAfterRebuild(storage, 'idx', frozen.frozenSegmentKeys)
    assert.ok(!storage.has(walSegmentKey('idx', 1, 2, 'chg_a')))
    assert.ok(!storage.has(walOpenSegmentKey('idx')))

    const remaining = await readBufferOps(storage, 'idx')
    assert.deepEqual(
      remaining.map((o) => (o as { id: string }).id),
      ['4']
    )
    assert.equal(head.pendingOps, 1)
  })

  it('clearBuffer removes segments and the open segment', async () => {
    const storage = new MemoryObjectStorage()
    await storage.put(walSegmentKey('idx', 1, 1, 'chg_a'), encodeWalSegmentOps([op('1', 1)]))
    await storage.put(walOpenSegmentKey('idx'), encodeWalSegmentOps([op('2', 2)]))

    await clearBuffer(storage, 'idx')
    assert.equal((await readBufferOps(storage, 'idx')).length, 0)
    assert.deepEqual(await getBufferHead(storage, 'idx'), {
      opCount: 0,
      pendingOps: 0,
      oldestOpAt: null
    })
  })
})

describe('service with wal coordinator', () => {
  it('buffers writes into segments instead of per-op entries', async () => {
    const storage = new MemoryObjectStorage()
    const coordinator = new MemoryWalCoordinator(storage)
    await createIndex(storage, { name: 'seg', schema: { title: 'string' } })

    const res = await bufferUpsert(storage, 'seg', '1', { title: 'Segmented' }, { walCoordinator: coordinator })
    assert.equal(res.status, 'buffered')
    assert.ok(storage.has(walOpenSegmentKey('seg')))
    assert.equal(storage.keys().filter((k) => k.includes('/entries/')).length, 0)
    assert.equal((await getStatus(storage, 'seg')).pendingOps, 1)

    const results = await runSearch(storage, new NoopShardCache(), 'seg', { term: 'segmented' })
    assert.equal(results.includesBuffer, true)
    assert.ok((results.count as number) >= 1)
  })

  it('rebuilds through the coordinator and consumes segments', async () => {
    const storage = new MemoryObjectStorage()
    const coordinator = new MemoryWalCoordinator(storage)
    const options = { walCoordinator: coordinator }
    await createIndex(storage, { name: 'seg', schema: { title: 'string' } })
    await bufferUpsert(storage, 'seg', '1', { title: 'One' }, options)
    await bufferUpsert(storage, 'seg', '2', { title: 'Two' }, options)

    const meta = await rebuildIndex(storage, 'seg', options)
    assert.equal(meta.status, 'ready')
    assert.equal(meta.documents, 2)
    assert.equal(meta.pendingOps, 0)

    assert.equal(storage.keys().filter((k) => k.startsWith(walSegmentsPrefix('seg'))).length, 0)
    const results = await runSearch(storage, new NoopShardCache(), 'seg', { term: 'one' })
    assert.equal(results.includesBuffer, false)
    assert.ok((results.count as number) >= 1)
  })

  it('keeps writes that land between freeze and finalize', async () => {
    const storage = new MemoryObjectStorage()
    const coordinator = new MemoryWalCoordinator(storage)
    const options = { walCoordinator: coordinator }
    await createIndex(storage, { name: 'seg', schema: { title: 'string' } })
    await bufferUpsert(storage, 'seg', '1', { title: 'One' }, options)

    const frozen = await coordinator.freezeForRebuild('seg')
    assert.equal(frozen.ops.length, 1)
    await bufferUpsert(storage, 'seg', '2', { title: 'Two' }, options)

    const meta = await coordinator.finalizeAfterRebuild('seg', frozen.frozenSegmentKeys, {
      version: 'v1',
      documents: 1,
      indexSizeBytes: 10,
      lastRebuildAt: new Date().toISOString()
    })
    assert.equal(meta.pendingOps, 1)
    assert.equal(meta.status, 'ready')

    const remaining = await readBufferOps(storage, 'seg')
    assert.deepEqual(
      remaining.map((o) => (o as { id: string }).id),
      ['2']
    )
  })

  it('excludes concurrent rebuilds via the coordinator lock', async () => {
    const storage = new MemoryObjectStorage()
    const coordinator = new MemoryWalCoordinator(storage)
    const options = { walCoordinator: coordinator }
    await createIndex(storage, { name: 'seg', schema: { title: 'string' } })
    await bufferUpsert(storage, 'seg', '1', { title: 'One' }, options)

    assert.equal(await coordinator.acquireRebuildLock('seg'), true)
    // Lock held: rebuildIndex returns current meta without building.
    const skipped = await rebuildIndex(storage, 'seg', options)
    assert.notEqual(skipped.status, 'building')
    assert.equal(skipped.liveVersion, null)
    assert.equal((await getStatus(storage, 'seg')).pendingOps, 1)
    await coordinator.releaseRebuildLock('seg')

    const rebuilt = await rebuildIndex(storage, 'seg', options)
    assert.equal(rebuilt.status, 'ready')
  })

  it('schedules threshold rebuilds through the coordinator', async () => {
    const storage = new MemoryObjectStorage()
    const coordinator = new MemoryWalCoordinator(storage)
    const options = { walCoordinator: coordinator }
    await createIndex(storage, {
      name: 'seg',
      schema: { title: 'string' },
      settings: { rebuildThresholdOps: 2 }
    })
    await bufferUpsert(storage, 'seg', '1', { title: 'One' }, options)
    await bufferUpsert(storage, 'seg', '2', { title: 'Two' }, options)

    const scheduled: Promise<unknown>[] = []
    await maybeScheduleRebuild(storage, 'seg', {
      threshold: 2,
      walCoordinator: coordinator,
      schedule: (task) => {
        scheduled.push(task)
      }
    })
    assert.equal(scheduled.length, 1)
    await scheduled[0]

    assert.equal((await getStatus(storage, 'seg')).pendingOps, 0)
    const results = await runSearch(storage, new NoopShardCache(), 'seg', { term: 'two' })
    assert.equal(results.includesBuffer, false)
  })

  it('serializes concurrent appends without lost counter updates', async () => {
    const storage = new MemoryObjectStorage()
    const coordinator = new MemoryWalCoordinator(storage)
    const options = { walCoordinator: coordinator }
    await createIndex(storage, { name: 'seg', schema: { title: 'string' } })

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => bufferUpsert(storage, 'seg', String(i), { title: `Doc ${i}` }, options))
    )

    const head = await getBufferHead(storage, 'seg')
    assert.equal(head.pendingOps, 20)
    assert.equal(head.opCount, 20)
    assert.equal((await getStatus(storage, 'seg')).pendingOps, 20)
    assert.equal((await readBufferOps(storage, 'seg')).length, 20)
  })

  it('deletes via the coordinator', async () => {
    const storage = new MemoryObjectStorage()
    const coordinator = new MemoryWalCoordinator(storage)
    const options = { walCoordinator: coordinator }
    await createIndex(storage, { name: 'seg', schema: { title: 'string' } })
    await bufferUpsert(storage, 'seg', '1', { title: 'One' }, options)
    await bufferDelete(storage, 'seg', '1', options)

    const ops = await readBufferOps(storage, 'seg')
    assert.equal(ops.length, 2)
    assert.equal(ops[1]!.op, 'delete')
    assert.equal((await getStatus(storage, 'seg')).pendingOps, 2)
  })
})

describe('wal without coordinator (fallback)', () => {
  it('keeps writing one entry object per op and no segments', async () => {
    const storage = new MemoryObjectStorage()
    await createIndex(storage, { name: 'plain', schema: { title: 'string' } })
    await bufferUpsert(storage, 'plain', '1', { title: 'One' })
    await bufferUpsert(storage, 'plain', '2', { title: 'Two' })

    assert.equal(storage.keys().filter((k) => k.includes('/entries/')).length, 2)
    assert.equal(storage.keys().filter((k) => k.startsWith(walSegmentsPrefix('plain'))).length, 0)
    assert.equal((await readBufferOps(storage, 'plain')).length, 2)
  })

  it('encodes head as JSON for manual inspection', async () => {
    const storage = new MemoryObjectStorage()
    await saveBufferHead(storage, 'idx', { opCount: 5, pendingOps: 2, oldestOpAt: 't1' })
    const raw = await storage.get('wal/idx/head.json')
    assert.ok(raw)
    assert.deepEqual(JSON.parse(new TextDecoder().decode(raw.body)), {
      opCount: 5,
      pendingOps: 2,
      oldestOpAt: 't1'
    })
  })
})
