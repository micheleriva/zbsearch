import type { RawData } from 'zbsearch'

export const PAYLOAD_VERSION = 2

export const HIERARCHY_SEPARATOR = ' › '

export interface SearchRecord {
  title: string
  section: string
  hierarchy: string
  content: string
  url: string
  category: string
  path: string
}

export const RECORD_SCHEMA = {
  title: 'string',
  section: 'string',
  hierarchy: 'string',
  content: 'string'
} as const

export const SEARCHABLE_PROPERTIES = ['title', 'section', 'hierarchy', 'content'] as const

export interface SearchBoost {
  title: number
  section: number
  hierarchy: number
  content: number
}

export const DEFAULT_BOOST: SearchBoost = {
  title: 4,
  section: 3,
  hierarchy: 1.5,
  content: 1
}

export interface SearchRuntimeOptions {
  maxResults: number
  boost: SearchBoost
  tolerance: number
  threshold: number
  snippetLength: number
  recentSearches: boolean
  hotkeys: boolean
  searchButtonLabel: string
  labels: Record<string, string>
}

/** Directory (relative to the site root) that sharded index artifacts are served from. */
export const STATIC_DIR = 'zbsearch-static'

export interface InlineIndexPayload {
  version: number
  language: string
  recordCount: number
  index: RawData
}

/**
 * Sentinel payload emitted instead of the inline index when the site is large
 * enough that the index ships as a sharded, lazily-fetched file set.
 */
export interface ShardedIndexPayload {
  version: number
  language: string
  recordCount: number
  mode: 'sharded'
  baseUrl: string
}

export type SearchIndexPayload = InlineIndexPayload | ShardedIndexPayload

export function isShardedPayload(payload: SearchIndexPayload): payload is ShardedIndexPayload {
  return (payload as ShardedIndexPayload).mode === 'sharded'
}
