import {
  clearBuffer,
  encodeWalSegmentOps,
  finalizeBufferAfterRebuild,
  freezeBufferForRebuild,
  getBufferHead,
  newChangeId,
  saveBufferHead,
  saveIndexMeta,
  walOpenSegmentKey,
  walSegmentKey,
  WAL_SEGMENT_MAX_BYTES,
  WAL_SEGMENT_MAX_OPS,
  type BufferHead,
  type BufferOp,
  type IndexMeta,
  type ObjectStorage,
  type WalAppendResult,
  type WalCoordinator,
  type WalFreezeResult,
  type WalRebuildResult
} from '@zbsearch/edge-core'
import { decodeJson } from '@zbsearch/edge-core'
import { indexMetaKey } from '@zbsearch/edge-core'

import { R2ObjectStorage } from './storage.js'
import type { Env } from './worker.js'

const NDJSON_CONTENT_TYPE = 'application/x-ndjson'

const OPEN_SEGMENT_STATE_KEY = 'openSegment'
const REBUILD_LOCK_STATE_KEY = 'rebuildLock'
const REBUILD_LOCK_STALE_MS = 15 * 60 * 1000

interface OpenSegmentState {
  firstSeq: number
  changeId: string
  ops: BufferOp[]
  bytes: number
}

export class IndexCoordinator {
  private objectStorage: ObjectStorage | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  private get storage(): ObjectStorage {
    this.objectStorage ??= new R2ObjectStorage(this.env.BUCKET)
    return this.objectStorage
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn)
    this.queue = run.catch(() => {})
    return run
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const body = (await request.json()) as Record<string, unknown>
    const indexId = body.indexId as string

    switch (url.pathname) {
      case '/append':
        return jsonResponse(await this.appendOps(indexId, body.ops as BufferOp[]))
      case '/freeze':
        return jsonResponse(await this.freezeForRebuild(indexId))
      case '/finalize':
        return jsonResponse(
          await this.finalizeAfterRebuild(indexId, body.frozenSegmentKeys as string[], body.result as WalRebuildResult)
        )
      case '/acquire-rebuild-lock':
        return jsonResponse(await this.acquireRebuildLock(indexId))
      case '/release-rebuild-lock':
        await this.releaseRebuildLock(indexId)
        return jsonResponse({ ok: true })
      case '/clear':
        await this.clearBuffer(indexId)
        return jsonResponse({ ok: true })
      default:
        return jsonResponse({ error: 'not found' }, 404)
    }
  }

  async appendOps(indexId: string, ops: BufferOp[]): Promise<WalAppendResult> {
    return this.enqueue(async () => {
      if (ops.length === 0) {
        const head = await getBufferHead(this.storage, indexId)
        return { changeId: newChangeId(), bufferedAt: new Date().toISOString(), head }
      }

      const storage = this.storage
      const head = await getBufferHead(storage, indexId)
      const firstSeq = head.opCount + 1
      const lastSeq = firstSeq + ops.length - 1
      const incomingBytes = encodeWalSegmentOps(ops).byteLength

      let open = await this.loadOpenSegment()

      if (
        open &&
        (open.ops.length + ops.length > WAL_SEGMENT_MAX_OPS || open.bytes + incomingBytes > WAL_SEGMENT_MAX_BYTES)
      ) {
        await this.flushOpenSegment(indexId, open)
        open = null
      }

      let changeId: string
      if (!open && (ops.length >= WAL_SEGMENT_MAX_OPS || incomingBytes >= WAL_SEGMENT_MAX_BYTES)) {
        // A batch that fills a segment on its own is written finalized directly.
        changeId = newChangeId()
        await storage.put(walSegmentKey(indexId, firstSeq, lastSeq, changeId), encodeWalSegmentOps(ops), {
          contentType: NDJSON_CONTENT_TYPE
        })
      } else {
        open = open ?? { firstSeq, changeId: newChangeId(), ops: [], bytes: 0 }
        open.ops.push(...ops)
        open.bytes += incomingBytes
        changeId = open.changeId

        await storage.put(walOpenSegmentKey(indexId), encodeWalSegmentOps(open.ops), {
          contentType: NDJSON_CONTENT_TYPE
        })

        await this.state.storage.put(OPEN_SEGMENT_STATE_KEY, open)
      }

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

      return { changeId, bufferedAt: ops[ops.length - 1]!.ts, head }
    })
  }

  async freezeForRebuild(indexId: string): Promise<WalFreezeResult> {
    return this.enqueue(async () => {
      const open = await this.loadOpenSegment()
      if (open) {
        await this.flushOpenSegment(indexId, open)
      }
      return freezeBufferForRebuild(this.storage, indexId)
    })
  }

  async finalizeAfterRebuild(
    indexId: string,
    frozenSegmentKeys: string[],
    result: WalRebuildResult
  ): Promise<IndexMeta> {
    return this.enqueue(async () => {
      const head = await finalizeBufferAfterRebuild(this.storage, indexId, frozenSegmentKeys)

      const metaObj = await this.storage.get(indexMetaKey(indexId))
      if (!metaObj) {
        throw new Error(`Index ${indexId} not found`)
      }
      const meta = decodeJson<IndexMeta>(metaObj.body)
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

  async acquireRebuildLock(_indexId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const existing = await this.state.storage.get<{ acquiredAt: string }>(REBUILD_LOCK_STATE_KEY)
      if (existing) {
        const stale = Date.now() - Date.parse(existing.acquiredAt) > REBUILD_LOCK_STALE_MS
        if (!stale) {
          return false
        }
      }
      await this.state.storage.put(REBUILD_LOCK_STATE_KEY, { acquiredAt: new Date().toISOString() })
      return true
    })
  }

  async releaseRebuildLock(_indexId: string): Promise<void> {
    return this.enqueue(async () => {
      await this.state.storage.delete(REBUILD_LOCK_STATE_KEY)
    })
  }

  async clearBuffer(indexId: string): Promise<void> {
    return this.enqueue(async () => {
      await this.state.storage.delete(OPEN_SEGMENT_STATE_KEY)
      await clearBuffer(this.storage, indexId)
    })
  }

  private async loadOpenSegment(): Promise<OpenSegmentState | null> {
    return (await this.state.storage.get<OpenSegmentState>(OPEN_SEGMENT_STATE_KEY)) ?? null
  }

  private async flushOpenSegment(indexId: string, open: OpenSegmentState): Promise<void> {
    const lastSeq = open.firstSeq + open.ops.length - 1
    await this.storage.put(
      walSegmentKey(indexId, open.firstSeq, lastSeq, open.changeId),
      encodeWalSegmentOps(open.ops),
      { contentType: NDJSON_CONTENT_TYPE }
    )
    await this.storage.delete(walOpenSegmentKey(indexId))
    await this.state.storage.delete(OPEN_SEGMENT_STATE_KEY)
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

export function createWalCoordinator(namespace: DurableObjectNamespace | undefined): WalCoordinator | undefined {
  if (!namespace) {
    return undefined
  }

  const call = async <T>(indexId: string, path: string, body: Record<string, unknown>): Promise<T> => {
    const stub = namespace.get(namespace.idFromName(indexId))
    const res = await stub.fetch(`https://index-coordinator${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ indexId, ...body })
    })
    if (!res.ok) {
      throw new Error(`IndexCoordinator ${path} failed for ${indexId}: ${res.status}`)
    }
    return (await res.json()) as T
  }

  return {
    appendOps: (indexId, ops) => call(indexId, '/append', { ops }),
    freezeForRebuild: (indexId) => call(indexId, '/freeze', {}),
    finalizeAfterRebuild: (indexId, frozenSegmentKeys, result) =>
      call(indexId, '/finalize', { frozenSegmentKeys, result }),
    acquireRebuildLock: (indexId) => call(indexId, '/acquire-rebuild-lock', {}),
    releaseRebuildLock: async (indexId) => {
      await call(indexId, '/release-rebuild-lock', {})
    },
    clearBuffer: async (indexId) => {
      await call(indexId, '/clear', {})
    }
  }
}
