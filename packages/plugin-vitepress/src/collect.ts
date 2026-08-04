import { HIERARCHY_SEPARATOR, type SearchRecord } from '@zbsearch/docs-index'
import { parseMarkdown } from '@zbsearch/docs-index/node'
import { createRouteFilter, type ResolvedOptions } from './options.js'

export interface ContentEntry {
  url: string
  src?: string
  frontmatter?: Record<string, unknown>
}

function humanize(segment: string): string {
  return segment
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function breadcrumbOf(url: string): string[] {
  return url
    .replace(/\.html$/, '')
    .split('/')
    .filter(Boolean)
    .slice(0, -1)
    .map(humanize)
}

export function withBase(url: string, base: string): string {
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base

  return prefix ? `${prefix}${url}` : url
}

export function collectRecords(entries: ContentEntry[], options: ResolvedOptions, base = '/'): SearchRecord[] {
  const keepRoute = createRouteFilter(options.excludeRoutes)
  const records: SearchRecord[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    const frontmatter = entry.frontmatter ?? {}

    if (!options.indexDrafts && frontmatter.draft === true) {
      continue
    }

    // VitePress hides a page from search when `search: false` is set, and the
    // home layout is a landing page rather than prose.
    if (frontmatter.search === false || frontmatter.layout === 'home') {
      continue
    }

    if (!keepRoute(entry.url) || seen.has(entry.url)) {
      continue
    }

    seen.add(entry.url)

    const parsed = parseMarkdown(entry.src ?? '', { dialect: 'md' })
    const title = typeof frontmatter.title === 'string' ? frontmatter.title : (parsed.title ?? entry.url)
    const breadcrumb = breadcrumbOf(entry.url)
    const url = withBase(entry.url, base)

    for (const section of parsed.sections) {
      if (section.content === '' && section.heading === '') {
        continue
      }

      records.push({
        title,
        section: section.heading,
        hierarchy: [...breadcrumb, title, ...section.ancestors].join(HIERARCHY_SEPARATOR),
        content: section.content,
        url: section.anchor ? `${url}#${section.anchor}` : url,
        category: options.categoryLabel,
        path: section.ancestors.join(HIERARCHY_SEPARATOR)
      })
    }
  }

  return records
}
