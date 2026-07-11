import type { EdgeApiError } from './errors.js'
import { EdgeApiError as EdgeApiErrorClass } from './errors.js'
import type { ObjectStorage, ShardCache } from './storage.js'
import {
  bufferDelete,
  bufferBatch,
  bufferUpsert,
  createIndex,
  getIndexManifest,
  getStatus,
  maybeScheduleRebuild,
  rebuildIndex,
  runSearch,
  type CreateIndexInput,
  type ScheduleRebuildOptions,
  type SearchInput
} from './service.js'
import { deleteIndexMeta, getIndexMeta, listIndexMetas, saveIndexMeta } from './registry.js'
import type { IndexSettings } from './types.js'

export interface RouterContext {
  storage: ObjectStorage
  cache: ShardCache
  apiKey?: string
  scheduleBackground?: ScheduleRebuildOptions['schedule']
  rebuildThresholdOps?: number
  builderWebhookUrl?: string
}

function scheduleOptions(ctx: RouterContext): ScheduleRebuildOptions {
  return {
    schedule: ctx.scheduleBackground,
    threshold: ctx.rebuildThresholdOps,
    builderWebhookUrl: ctx.builderWebhookUrl,
    source: 'threshold'
  }
}

async function afterBufferedWrite(ctx: RouterContext, indexId: string): Promise<void> {
  await maybeScheduleRebuild(ctx.storage, indexId, scheduleOptions(ctx))
}

export interface HttpRequest {
  method: string
  pathname: string
  searchParams: URLSearchParams
  headers: Headers
  json<T>(): Promise<T>
}

export interface HttpResponse {
  status: number
  headers?: Record<string, string>
  body?: unknown
}

function json(status: number, body: unknown): HttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body
  }
}

function ensureAuth(ctx: RouterContext, req: HttpRequest): void {
  if (!ctx.apiKey) {
    return
  }
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${ctx.apiKey}`) {
    throw new EdgeApiErrorClass(401, 'UNAUTHORIZED', 'Invalid or missing API key')
  }
}

function matchPath(pathname: string, pattern: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = pathname.split('/').filter(Boolean)
  if (patternParts.length !== pathParts.length) {
    return null
  }
  const params: Record<string, string> = {}
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i]!
    const value = pathParts[i]!
    if (part.startsWith(':')) {
      params[part.slice(1)] = value
    } else if (part !== value) {
      return null
    }
  }
  return params
}

export async function handleRequest(ctx: RouterContext, req: HttpRequest): Promise<HttpResponse> {
  try {
    if (req.pathname === '/health') {
      return json(200, { ok: true })
    }

    if (req.pathname === '/v1/info') {
      return json(200, { name: 'zbsearch-edge', version: '0.1.0' })
    }

    ensureAuth(ctx, req)

    if (req.method === 'GET' && req.pathname === '/v1/indexes') {
      const indexes = await listIndexMetas(ctx.storage)
      return json(200, { indexes })
    }

    if (req.method === 'POST' && req.pathname === '/v1/indexes') {
      const body = await req.json<CreateIndexInput>()
      const index = await createIndex(ctx.storage, body)
      return json(201, index)
    }

    const indexMatch = matchPath(req.pathname, '/v1/indexes/:indexId')
    if (indexMatch) {
      const indexId = indexMatch.indexId!

      if (req.method === 'GET') {
        const meta = await getIndexMeta(ctx.storage, indexId)
        return json(200, meta)
      }

      if (req.method === 'PATCH') {
        const meta = await getIndexMeta(ctx.storage, indexId)
        const patch = await req.json<{ settings?: IndexSettings }>()
        meta.settings = { ...meta.settings, ...patch.settings }
        await saveIndexMeta(ctx.storage, meta)
        return json(200, meta)
      }

      if (req.method === 'DELETE') {
        await deleteIndexMeta(ctx.storage, indexId)
        return json(202, { status: 'deleting', indexId })
      }
    }

    const statusMatch = matchPath(req.pathname, '/v1/indexes/:indexId/status')
    if (statusMatch && req.method === 'GET') {
      const status = await getStatus(ctx.storage, statusMatch.indexId!)
      return json(200, status)
    }

    const manifestMatch = matchPath(req.pathname, '/v1/indexes/:indexId/manifest')
    if (manifestMatch && req.method === 'GET') {
      const manifest = await getIndexManifest(ctx.storage, manifestMatch.indexId!)
      return json(200, manifest)
    }

    const rebuildMatch = matchPath(req.pathname, '/v1/indexes/:indexId/rebuild')
    if (rebuildMatch && req.method === 'POST') {
      const meta = await rebuildIndex(ctx.storage, rebuildMatch.indexId!)
      return json(202, { status: 'rebuilt', indexId: meta.id, liveVersion: meta.liveVersion })
    }

    const searchMatch = matchPath(req.pathname, '/v1/indexes/:indexId/search')
    if (searchMatch && req.method === 'POST') {
      const body = await req.json<SearchInput>()
      const results = await runSearch(ctx.storage, ctx.cache, searchMatch.indexId!, body)
      return json(200, results)
    }

    const docCollectionMatch = matchPath(req.pathname, '/v1/indexes/:indexId/documents')
    if (docCollectionMatch && req.method === 'POST') {
      const body = await req.json<{ id: string; document: Record<string, unknown> }>()
      const result = await bufferUpsert(ctx.storage, docCollectionMatch.indexId!, body.id, body.document)
      await afterBufferedWrite(ctx, docCollectionMatch.indexId!)
      return json(202, result)
    }

    const docMatch = matchPath(req.pathname, '/v1/indexes/:indexId/documents/:docId')
    if (docMatch) {
      const indexId = docMatch.indexId!
      const docId = docMatch.docId!

      if (req.method === 'PUT') {
        const body = await req.json<Record<string, unknown>>()
        const result = await bufferUpsert(ctx.storage, indexId, docId, body)
        await afterBufferedWrite(ctx, indexId)
        return json(202, result)
      }

      if (req.method === 'DELETE') {
        const result = await bufferDelete(ctx.storage, indexId, docId)
        await afterBufferedWrite(ctx, indexId)
        return json(202, result)
      }
    }

    const batchMatch = matchPath(req.pathname, '/v1/indexes/:indexId/documents/batch')
    if (batchMatch && req.method === 'POST') {
      const body = await req.json<{
        operations: Array<
          | { op: 'upsert'; id: string; doc: Record<string, unknown> }
          | { op: 'delete'; id: string }
        >
      }>()
      const indexId = batchMatch.indexId!
      const result = await bufferBatch(ctx.storage, indexId, body.operations)
      await afterBufferedWrite(ctx, indexId)
      return json(202, result)
    }

    return json(404, { error: { code: 'NOT_FOUND', message: 'Route not found' } })
  } catch (err) {
    if (err instanceof EdgeApiErrorClass) {
      return json(err.status, err.toBody())
    }
    throw err
  }
}

export function toResponse(http: HttpResponse): Response {
  return new Response(http.body === undefined ? null : JSON.stringify(http.body), {
    status: http.status,
    headers: http.headers
  })
}
