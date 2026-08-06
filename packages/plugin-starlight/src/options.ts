import { DEFAULT_BOOST, type SearchBoost, type SearchRuntimeOptions } from '@zbsearch/docs-index'

export interface ZBSearchStarlightOptions {
  language?: string
  excludeRoutes?: string[]
  categoryLabel?: string
  indexDrafts?: boolean
  maxResults?: number
  boost?: Partial<SearchBoost>
  tolerance?: number
  threshold?: number
  snippetLength?: number
  recentSearches?: boolean
  hotkeys?: boolean
  searchButtonLabel?: string
  placeholder?: string
  labels?: Record<string, string>
}

export interface ResolvedOptions extends SearchRuntimeOptions {
  language: string
  excludeRoutes: string[]
  categoryLabel: string
  indexDrafts: boolean
}

export interface RouteOptions {
  base: string
  format: 'file' | 'directory' | 'preserve'
  trailingSlash: 'always' | 'never' | 'ignore'
}

export interface VirtualOptions {
  runtime: ResolvedOptions
  route: RouteOptions
}

export function resolveOptions(options: ZBSearchStarlightOptions = {}): ResolvedOptions {
  const labels = { ...options.labels }

  if (options.placeholder) {
    labels.placeholder = options.placeholder
  }

  return {
    language: options.language ?? 'english',
    excludeRoutes: options.excludeRoutes ?? [],
    categoryLabel: options.categoryLabel ?? 'Docs',
    indexDrafts: options.indexDrafts ?? false,
    maxResults: options.maxResults ?? 12,
    boost: { ...DEFAULT_BOOST, ...options.boost },
    tolerance: options.tolerance ?? 1,
    threshold: options.threshold ?? 0,
    snippetLength: options.snippetLength ?? 140,
    recentSearches: options.recentSearches ?? true,
    hotkeys: options.hotkeys ?? true,
    searchButtonLabel: options.searchButtonLabel ?? 'Search',
    labels
  }
}

function compilePattern(pattern: string): RegExp {
  const source = pattern
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((segment) => segment.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*')
    )
    .join('.*')

  return new RegExp(`^${source}$`)
}

export function createRouteFilter(patterns: string[]): (route: string) => boolean {
  if (patterns.length === 0) {
    return () => true
  }

  const compiled = patterns.map(compilePattern)

  return (route) => !compiled.some((expression) => expression.test(route))
}
