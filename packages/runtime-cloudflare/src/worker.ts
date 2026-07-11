import {
  handleRequest,
  listIndexMetas,
  maybeScheduleRebuild,
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

function rebuildOptions(env: Env) {
  const threshold = env.REBUILD_THRESHOLD_OPS
    ? Number.parseInt(env.REBUILD_THRESHOLD_OPS, 10)
    : undefined
  return {
    threshold,
    builderWebhookUrl: env.BUILDER_WEBHOOK_URL,
    schedule: undefined as ((task: Promise<unknown>) => void) | undefined
  }
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

    const response = toResponse(
      await handleRequest(
        {
          storage,
          cache,
          apiKey: env.API_KEY,
          scheduleBackground: options.schedule,
          rebuildThresholdOps: options.threshold,
          builderWebhookUrl: options.builderWebhookUrl
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
      await maybeScheduleRebuild(storage, index.id, { ...options, source: 'scheduler' })
    }
  }
}
