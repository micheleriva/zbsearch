import {
  EdgeApiError,
  handleRequest,
  isShardGroupMeta,
  listIndexMetas,
  maybeScheduleRebuild,
  toResponse,
  type HttpRequest
} from '@zbsearch/edge-core'

import { createWalCoordinator, IndexCoordinator } from './coordinator.js'
import { ShardSearch } from './search-node.js'
import { R2ObjectStorage, WorkersShardCache } from './storage.js'

export { IndexCoordinator, ShardSearch }

export interface Env {
  BUCKET: R2Bucket
  INDEX_COORDINATOR?: DurableObjectNamespace
  SEARCH_SHARD?: DurableObjectNamespace
  API_KEY?: string
  READ_API_KEY?: string
  WRITE_API_KEY?: string
  REBUILD_THRESHOLD_OPS?: string
  BUILDER_WEBHOOK_URL?: string
  SNAPSHOT_CACHE_MAX_ENTRIES?: string
  SNAPSHOT_CACHE_MAX_BYTES?: string
}

function parseOptionalInt(value: string | undefined): number | undefined {
  return value ? Number.parseInt(value, 10) : undefined
}

function rebuildOptions(env: Env) {
  return {
    threshold: parseOptionalInt(env.REBUILD_THRESHOLD_OPS),
    builderWebhookUrl: env.BUILDER_WEBHOOK_URL,
    walCoordinator: createWalCoordinator(env.INDEX_COORDINATOR),
    schedule: undefined as ((task: Promise<unknown>) => void) | undefined
  }
}

function snapshotCacheOptions(env: Env) {
  const maxEntries = parseOptionalInt(env.SNAPSHOT_CACHE_MAX_ENTRIES)
  const maxBytes = parseOptionalInt(env.SNAPSHOT_CACHE_MAX_BYTES)
  if (maxEntries === undefined && maxBytes === undefined) {
    return undefined
  }
  return { maxEntries, maxBytes }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const storage = new R2ObjectStorage(env.BUCKET)
    const cache = new WorkersShardCache(caches.default)

    const req: HttpRequest = {
      method: request.method,
      pathname: url.pathname,
      searchParams: url.searchParams,
      headers: request.headers,
      json: () => request.json()
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': 'authorization,content-type'
        }
      })
    }

    const options = rebuildOptions(env)
    options.schedule = (task) => ctx.waitUntil(task)

    // Fan shard-group searches out to one Durable Object per shard: each shard search runs in its own isolate (and stays warm there), so total
    // index size is not capped by a single isolate's 128MB memory limit. Without the binding, searches fall back to the in-process fan-out.
    const shardSearchExecutor = env.SEARCH_SHARD
      ? async (shardId: string, params: Record<string, unknown>) => {
          const namespace = env.SEARCH_SHARD!
          const stub = namespace.get(namespace.idFromName(shardId))
          const res = await stub.fetch('https://shard-search/search', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ indexId: shardId, params })
          })
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
            throw new EdgeApiError(
              res.status,
              body.error?.code ?? 'SHARD_SEARCH_FAILED',
              body.error?.message ?? `Shard search failed with HTTP ${res.status}`
            )
          }
          return (await res.json()) as Record<string, unknown>
        }
      : undefined

    const response = toResponse(
      await handleRequest(
        {
          storage,
          cache,
          apiKey: env.API_KEY,
          readApiKey: env.READ_API_KEY,
          writeApiKey: env.WRITE_API_KEY,
          shardSearchExecutor,
          scheduleBackground: options.schedule,
          rebuildThresholdOps: options.threshold,
          builderWebhookUrl: options.builderWebhookUrl,
          walCoordinator: options.walCoordinator,
          snapshotCache: snapshotCacheOptions(env)
        },
        req
      )
    )

    response.headers.set('access-control-allow-origin', '*')
    return response
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const storage = new R2ObjectStorage(env.BUCKET)
    const options = rebuildOptions(env)
    options.schedule = (task) => ctx.waitUntil(task)
    const indexes = await listIndexMetas(storage)

    for (const index of indexes) {
      if (isShardGroupMeta(index)) {
        continue
      }

      await maybeScheduleRebuild(storage, index.id, { ...options, source: 'scheduler', runInline: true })
    }
  }
}
