import { DEFAULT_BOOST, type SearchBoost } from '@zbsearch/docs-index'

export interface CategoryLabels {
  docs: string
  blog: string
  pages: string
}

export interface ZBSearchDocusaurusOptions {
  language?: string
  docs?: boolean
  blog?: boolean
  pages?: boolean
  indexAllDocsVersions?: boolean
  excludeRoutes?: string[]
  categoryLabels?: Partial<CategoryLabels>
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

export interface ResolvedOptions {
  language: string
  docs: boolean
  blog: boolean
  pages: boolean
  indexAllDocsVersions: boolean
  excludeRoutes: string[]
  categoryLabels: CategoryLabels
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

const DEFAULT_CATEGORY_LABELS: CategoryLabels = {
  docs: 'Docs',
  blog: 'Blog',
  pages: 'Pages'
}

export function resolveOptions(options: ZBSearchDocusaurusOptions = {}): ResolvedOptions {
  const labels = { ...options.labels }
  if (options.placeholder) {
    labels.placeholder = options.placeholder
  }

  return {
    language: options.language ?? 'english',
    docs: options.docs ?? true,
    blog: options.blog ?? true,
    pages: options.pages ?? true,
    indexAllDocsVersions: options.indexAllDocsVersions ?? false,
    excludeRoutes: options.excludeRoutes ?? [],
    categoryLabels: { ...DEFAULT_CATEGORY_LABELS, ...options.categoryLabels },
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
