import type { SearchHit } from '../types.js'

export interface RecentSearch {
  id: string
  url: string
  title: string
  section?: string
  breadcrumb?: string[]
}

export interface RecentSearchStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const DEFAULT_RECENT_SEARCHES_KEY = 'zbsearch:searchbox:recent'
export const MAX_RECENT_SEARCHES = 5

function isRecentSearch(value: unknown): value is RecentSearch {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return typeof candidate.id === 'string' && typeof candidate.url === 'string' && typeof candidate.title === 'string'
}

export function readRecentSearches(storage: RecentSearchStorage, key = DEFAULT_RECENT_SEARCHES_KEY): RecentSearch[] {
  let raw: string | null

  try {
    raw = storage.getItem(key)
  } catch {
    return []
  }

  if (!raw) {
    return []
  }

  try {
    const parsed: unknown = JSON.parse(raw)

    return Array.isArray(parsed) ? parsed.filter(isRecentSearch).slice(0, MAX_RECENT_SEARCHES) : []
  } catch {
    return []
  }
}

function persist(storage: RecentSearchStorage, key: string, entries: RecentSearch[]): RecentSearch[] {
  try {
    storage.setItem(key, JSON.stringify(entries))
  } catch {}

  return entries
}

export function addRecentSearch(
  storage: RecentSearchStorage,
  hit: SearchHit,
  key = DEFAULT_RECENT_SEARCHES_KEY
): RecentSearch[] {
  const entry: RecentSearch = {
    id: hit.id,
    url: hit.url,
    title: hit.title,
    section: hit.section,
    breadcrumb: hit.breadcrumb
  }
  const rest = readRecentSearches(storage, key).filter((item) => item.url !== entry.url)

  return persist(storage, key, [entry, ...rest].slice(0, MAX_RECENT_SEARCHES))
}

export function removeRecentSearch(
  storage: RecentSearchStorage,
  url: string,
  key = DEFAULT_RECENT_SEARCHES_KEY
): RecentSearch[] {
  return persist(
    storage,
    key,
    readRecentSearches(storage, key).filter((item) => item.url !== url)
  )
}
