import {
  getBufferHead,
  handleRequest,
  listIndexMetas,
  rebuildIndex,
  toResponse,
  type HttpRequest
} from '@zbsearch/edge-core'

import { R2ObjectStorage, WorkersShardCache } from './storage.js'

export interface Env {
  BUCKET: R2Bucket
  API_KEY?: string
  REBUILD_THRESHOLD_OPS?: string
  BUILDER_WEBHOOK_URL?: string
}

async function maybeTriggerExternalRebuild(env: Env, indexId: string): Promise<void> {
  if (!env.BUILDER_WEBHOOK_URL) {
    return
  }
  await fetch(env.BUILDER_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ indexId, source: 'scheduler' })
  })
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

    const response = toResponse(
      await handleRequest(
        {
          storage,
          cache,
          apiKey: env.API_KEY
        },
        req
      )
    )

    response.headers.set('access-control-allow-origin', '*')
    return response
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const storage = new R2ObjectStorage(env.BUCKET)
    const threshold = Number.parseInt(env.REBUILD_THRESHOLD_OPS ?? '500', 10)
    const indexes = await listIndexMetas(storage)

    for (const index of indexes) {
      const head = await getBufferHead(storage, index.id)
      if (head.pendingOps < threshold) {
        continue
      }

      if (env.BUILDER_WEBHOOK_URL) {
        ctx.waitUntil(maybeTriggerExternalRebuild(env, index.id))
        continue
      }

      ctx.waitUntil(rebuildIndex(storage, index.id))
    }
  }
}
