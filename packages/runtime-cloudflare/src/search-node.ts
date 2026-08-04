import { EdgeApiError, runSearch, type ObjectStorage, type SearchInput, type ShardCache } from '@zbsearch/edge-core'

import { R2ObjectStorage, WorkersShardCache } from './storage.js'
import type { Env } from './worker.js'

// One Durable Object per physical shard. Group searches fan out here (one stub per shard) so every shard search runs in its own isolate with its own
// 128MB: the total index size is not capped by a single isolate. The DO isolate also keeps edge-core's in-isolate snapshot cache warm across
// requests, so repeat searches skip the snapshot reload entirely.
export class ShardSearch {
  private objectStorage: ObjectStorage | null = null
  private shardCache: ShardCache | null = null

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  private get storage(): ObjectStorage {
    this.objectStorage ??= new R2ObjectStorage(this.env.BUCKET)
    return this.objectStorage
  }

  private get cache(): ShardCache {
    this.shardCache ??= new WorkersShardCache(caches.default)
    return this.shardCache
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname !== '/search') {
      return Response.json({ error: 'not found' }, { status: 404 })
    }

    const body = (await request.json()) as { indexId: string; params: SearchInput }

    try {
      const result = await runSearch(this.storage, this.cache, body.indexId, body.params)
      return Response.json(result)
    } catch (err) {
      if (err instanceof EdgeApiError) {
        return Response.json(err.toBody(), { status: err.status })
      }
      throw err
    }
  }
}
