import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { HIERARCHY_SEPARATOR, type SearchRecord } from '@zbsearch/docs-index'
import { dialectOf, parseMarkdown } from '@zbsearch/docs-index/node'
import { createRouteFilter, type ResolvedOptions } from './options.js'

const DOCS_PLUGIN = 'docusaurus-plugin-content-docs'
const BLOG_PLUGIN = 'docusaurus-plugin-content-blog'
const PAGES_PLUGIN = 'docusaurus-plugin-content-pages'

export type AllContent = Record<string, Record<string, unknown>>

export interface SourceDocument {
  permalink: string
  file: string
  title?: string
  breadcrumb: string[]
  category: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function instancesOf(allContent: AllContent, pluginName: string): unknown[] {
  const byId = allContent[pluginName]

  return isRecord(byId) ? Object.values(byId) : []
}

export function resolveSourcePath(source: string, siteDir: string): string {
  if (source.startsWith('@site/')) {
    return path.join(siteDir, source.slice('@site/'.length))
  }

  return path.isAbsolute(source) ? source : path.join(siteDir, source)
}

function humanize(segment: string): string {
  return segment
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function collectDocs(allContent: AllContent, options: ResolvedOptions): SourceDocument[] {
  const documents: SourceDocument[] = []

  for (const content of instancesOf(allContent, DOCS_PLUGIN)) {
    if (!isRecord(content)) {
      continue
    }

    for (const rawVersion of asArray(content.loadedVersions)) {
      if (!isRecord(rawVersion)) {
        continue
      }

      const isLast = rawVersion.isLast !== false

      if (!options.indexAllDocsVersions && !isLast) {
        continue
      }

      const versionLabel = asString(rawVersion.label)

      for (const rawDoc of asArray(rawVersion.docs)) {
        if (!isRecord(rawDoc)) {
          continue
        }

        const permalink = asString(rawDoc.permalink)
        const source = asString(rawDoc.source)

        if (!permalink || !source) {
          continue
        }

        const directories = asString(rawDoc.sourceDirName)
        const breadcrumb = [
          ...(isLast ? [] : versionLabel ? [versionLabel] : []),
          ...(directories && directories !== '.' ? directories.split('/').filter(Boolean).map(humanize) : [])
        ]

        documents.push({
          permalink,
          file: source,
          title: asString(rawDoc.title),
          breadcrumb,
          category: options.categoryLabels.docs
        })
      }
    }
  }

  return documents
}

function collectBlog(allContent: AllContent, options: ResolvedOptions): SourceDocument[] {
  const documents: SourceDocument[] = []

  for (const content of instancesOf(allContent, BLOG_PLUGIN)) {
    if (!isRecord(content)) {
      continue
    }

    for (const rawPost of asArray(content.blogPosts)) {
      if (!isRecord(rawPost) || !isRecord(rawPost.metadata)) {
        continue
      }
      const { metadata } = rawPost
      const permalink = asString(metadata.permalink)
      const source = asString(metadata.source)

      if (!permalink || !source) {
        continue
      }

      documents.push({
        permalink,
        file: source,
        title: asString(metadata.title),
        breadcrumb: [],
        category: options.categoryLabels.blog
      })
    }
  }

  return documents
}

function collectPages(allContent: AllContent, options: ResolvedOptions): SourceDocument[] {
  const documents: SourceDocument[] = []

  for (const content of instancesOf(allContent, PAGES_PLUGIN)) {
    for (const rawPage of asArray(content)) {
      if (!isRecord(rawPage) || rawPage.type !== 'mdx') {
        continue
      }

      const permalink = asString(rawPage.permalink)
      const source = asString(rawPage.source)

      if (!permalink || !source) {
        continue
      }

      documents.push({
        permalink,
        file: source,
        title: asString(rawPage.title),
        breadcrumb: [],
        category: options.categoryLabels.pages
      })
    }
  }

  return documents
}

export function collectSourceDocuments(
  allContent: AllContent,
  siteDir: string,
  options: ResolvedOptions
): SourceDocument[] {
  const keepRoute = createRouteFilter(options.excludeRoutes)

  const documents = [
    ...(options.docs ? collectDocs(allContent, options) : []),
    ...(options.blog ? collectBlog(allContent, options) : []),
    ...(options.pages ? collectPages(allContent, options) : [])
  ]

  const seen = new Set<string>()

  return documents
    .filter((document) => keepRoute(document.permalink))
    .filter((document) => {
      if (seen.has(document.permalink)) {
        return false
      }

      seen.add(document.permalink)
      return true
    })
    .map((document) => ({ ...document, file: resolveSourcePath(document.file, siteDir) }))
}

export async function readRecords(document: SourceDocument): Promise<SearchRecord[]> {
  const source = await readFile(document.file, 'utf8')
  const parsed = parseMarkdown(source, { dialect: dialectOf(document.file) })
  const title = document.title ?? parsed.title ?? document.permalink

  return parsed.sections
    .filter((section) => section.content !== '' || section.heading !== '')
    .map((section) => ({
      title,
      section: section.heading,
      hierarchy: [...document.breadcrumb, title, ...section.ancestors].join(HIERARCHY_SEPARATOR),
      content: section.content,
      url: section.anchor ? `${document.permalink}#${section.anchor}` : document.permalink,
      category: document.category,
      path: section.ancestors.join(HIERARCHY_SEPARATOR)
    }))
}

export interface CollectResult {
  records: SearchRecord[]
  failures: { file: string; reason: string }[]
}

export async function collectRecords(
  allContent: AllContent,
  siteDir: string,
  options: ResolvedOptions
): Promise<CollectResult> {
  const documents = collectSourceDocuments(allContent, siteDir, options)
  const failures: CollectResult['failures'] = []

  const results = await Promise.all(
    documents.map(async (document) => {
      try {
        return await readRecords(document)
      } catch (error) {
        failures.push({ file: document.file, reason: error instanceof Error ? error.message : String(error) })
        return []
      }
    })
  )
  return { records: results.flat(), failures }
}
