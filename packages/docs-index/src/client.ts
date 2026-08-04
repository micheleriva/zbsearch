import type { SearchHit } from '@zbsearch/searchbox-core'
import { snippetAround } from '@zbsearch/searchbox-core'
import type { AnyZBSearch } from 'zbsearch'
import {
  HIERARCHY_SEPARATOR,
  PAYLOAD_VERSION,
  RECORD_SCHEMA,
  SEARCHABLE_PROPERTIES,
  type SearchIndexPayload,
  type SearchRecord,
  type SearchRuntimeOptions
} from './records.js'

export interface LoadedIndex {
  db: AnyZBSearch
  search: typeof import('zbsearch').search
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
  const { create, load, search } = await import('zbsearch')
  const db = create({ schema: RECORD_SCHEMA, language: payload.language, inferSchema: false })

  load(db, payload.index)

  return { db, search }
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
    const { db, search } = await getIndex()

    if (signal.aborted) {
      return []
    }

    const boost: Record<string, number> = { ...options.boost }

    const results = await search(db, {
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
