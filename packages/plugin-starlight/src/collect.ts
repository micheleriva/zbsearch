import { HIERARCHY_SEPARATOR, type SearchRecord } from '@zbsearch/docs-index'
import { dialectOf, parseMarkdown } from '@zbsearch/docs-index/node'
import { createRouteFilter, type ResolvedOptions, type RouteOptions } from './options.js'
import { createPathFormatter, slugToPathname } from './routes.js'

export interface DocsEntry {
  id: string
  body?: string
  filePath?: string
  data?: { title?: string; draft?: boolean }
}

function humanize(segment: string): string {
  return segment
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function breadcrumbOf(id: string): string[] {
  const segments = id.split('/').slice(0, -1)

  return segments.map(humanize)
}

export function collectRecords(entries: DocsEntry[], options: ResolvedOptions, route: RouteOptions): SearchRecord[] {
  const keepRoute = createRouteFilter(options.excludeRoutes)
  const formatPath = createPathFormatter(route)
  const records: SearchRecord[] = []
  const seen = new Set<string>()

  for (const entry of entries) {
    if (!options.indexDrafts && entry.data?.draft === true) {
      continue
    }

    const pathname = slugToPathname(entry.id)

    if (!keepRoute(pathname) || seen.has(pathname)) {
      continue
    }

    seen.add(pathname)

    const url = formatPath(pathname)
    const parsed = parseMarkdown(entry.body ?? '', { dialect: dialectOf(entry.filePath) })
    const title = entry.data?.title ?? parsed.title ?? pathname
    const breadcrumb = breadcrumbOf(entry.id)

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
