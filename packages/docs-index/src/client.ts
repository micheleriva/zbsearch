import type { SearchHit } from '@zbsearch/searchbox-core'
import { snippetAround } from '@zbsearch/searchbox-core'
import type { Results } from 'zbsearch'
import {
  HIERARCHY_SEPARATOR,
  PAYLOAD_VERSION,
  RECORD_SCHEMA,
  SEARCHABLE_PROPERTIES,
  isShardedPayload,
  type SearchIndexPayload,
  type SearchRecord,
  type SearchRuntimeOptions
} from './records.js'

export interface QueryOptions {
  term: string
  properties?: string[]
  boost?: Record<string, number>
  limit?: number
  tolerance?: number
  threshold?: number
}

export interface LoadedIndex {
  query: (options: QueryOptions) => Promise<Results<SearchRecord>>
}

export function assertPayloadVersion(payload: SearchIndexPayload): SearchIndexPayload {
  if (payload.version !== PAYLOAD_VERSION) {
    throw new Error(
      `[zbsearch] search index version ${payload.version} does not match the expected ${PAYLOAD_VERSION}. ` +
        'Clear the build cache and start again.'
    )
  }

  return payload
}

export async function hydrateIndex(payload: SearchIndexPayload): Promise<LoadedIndex> {
  if (isShardedPayload(payload)) {
    const { createStaticSearchClient } = await import('@zbsearch/static')
    const client = createStaticSearchClient({ baseUrl: payload.baseUrl })

    // Fetch the manifest and dictionary now, so a hydrated index is
    // ready-to-query in both modes and the hover/focus prefetch keeps
    // hiding the bootstrap cost.
    await client.preload()

    return {
      query: (options) => client.search<SearchRecord>(options) as Promise<Results<SearchRecord>>
    }
  }

  const { create, loadAsync, search } = await import('zbsearch')
  const db = create({ schema: RECORD_SCHEMA, language: payload.language, inferSchema: false, sort: { enabled: false } })

  await loadAsync(db, payload.index)

  return {
    query: async (options) => (await search(db, options as never)) as unknown as Results<SearchRecord>
  }
}

export function createIndexLoader(fetchPayload: () => Promise<SearchIndexPayload>): () => Promise<LoadedIndex> {
  let pending: Promise<LoadedIndex> | undefined

  return () => {
    pending ??= fetchPayload()
      .then(assertPayloadVersion)
      .then(hydrateIndex)
      .catch((error: unknown) => {
        pending = undefined
        throw error
      })

    return pending
  }
}

function toHit(id: string, record: SearchRecord, term: string, snippetLength: number): SearchHit {
  const breadcrumb = record.path ? record.path.split(HIERARCHY_SEPARATOR).filter(Boolean) : undefined
  const snippet = snippetAround(record.content, term, snippetLength)

  return {
    id,
    url: record.url,
    title: record.title,
    section: record.section || undefined,
    snippet: snippet || undefined,
    breadcrumb: breadcrumb && breadcrumb.length > 0 ? breadcrumb : undefined,
    category: record.category
  }
}

export type SearcherOptions = Pick<
  SearchRuntimeOptions,
  'boost' | 'maxResults' | 'tolerance' | 'threshold' | 'snippetLength'
>

export function createSearcher(getIndex: () => Promise<LoadedIndex>, options: SearcherOptions) {
  return async (term: string, signal: AbortSignal): Promise<SearchHit[]> => {
    const { query } = await getIndex()

    if (signal.aborted) {
      return []
    }

    const boost: Record<string, number> = { ...options.boost }

    const results = await query({
      term,
      properties: [...SEARCHABLE_PROPERTIES],
      boost,
      limit: options.maxResults,
      tolerance: options.tolerance,
      threshold: options.threshold
    })

    return results.hits.map((hit) =>
      toHit(String(hit.id), hit.document as unknown as SearchRecord, term, options.snippetLength)
    )
  }
}
