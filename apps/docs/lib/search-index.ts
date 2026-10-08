import { HIERARCHY_SEPARATOR, type SearchRecord } from '@zbsearch/docs-index'
import { buildIndexAuto, type AutoIndexResult } from '@zbsearch/docs-index/node'
import type * as PageTree from 'fumadocs-core/page-tree'
import { searchStaticRoute } from './shared'
import { source } from './source'

const LANGUAGE = 'english'

function folderTrails(root: PageTree.Root): Map<string, string[]> {
  const trails = new Map<string, string[]>()

  function visit(node: PageTree.Node, ancestors: string[]) {
    if (node.type === 'page') {
      if (!trails.has(node.url)) trails.set(node.url, ancestors)
      return
    }

    if (node.type !== 'folder') {
      return
    }

    if (node.index && !trails.has(node.index.url)) {
      trails.set(node.index.url, ancestors)
    }

    const next = typeof node.name === 'string' ? [...ancestors, node.name] : ancestors

    for (const child of node.children) {
      visit(child, next)
    }
  }

  for (const child of root.children) {
    visit(child, [])
  }

  return trails
}

type Page = ReturnType<typeof source.getPages>[number]

interface Section {
  heading: string
  anchor: string
  ancestors: string[]
  content: string
}

function sectionsOf(page: Page): Section[] {
  const { headings, contents } = page.data.structuredData
  const depths = new Map(page.data.toc.map((item) => [item.url.replace(/^#/, ''), item.depth]))
  const text = new Map<string | undefined, string[]>()

  for (const block of contents) {
    const existing = text.get(block.heading)
    if (existing) existing.push(block.content)
    else text.set(block.heading, [block.content])
  }

  const sections: Section[] = []
  const intro = text.get(undefined)

  if (intro) sections.push({ heading: '', anchor: '', ancestors: [], content: intro.join(' ') })

  const stack: { depth: number; name: string }[] = []

  for (const heading of headings) {
    const depth = depths.get(heading.id) ?? 2
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop()

    sections.push({
      heading: heading.content,
      anchor: heading.id,
      ancestors: stack.map((item) => item.name),
      content: (text.get(heading.id) ?? []).join(' ')
    })

    stack.push({ depth, name: heading.content })
  }

  return sections
}

function collectRecords(): SearchRecord[] {
  const tree = source.getPageTree()
  const trails = folderTrails(tree)
  const records: SearchRecord[] = []
  const firstTab = tree.children.find((node) => node.type === 'folder')
  const defaultTab = firstTab && typeof firstTab.name === 'string' ? firstTab.name : undefined

  for (const page of source.getPages()) {
    const title = page.data.title ?? page.url
    const trail = trails.get(page.url) ?? []
    const category = trail[0] === defaultTab ? '' : (trail[0] ?? '')

    for (const section of sectionsOf(page)) {
      records.push({
        title,
        section: section.heading,
        hierarchy: [...trail, title, ...section.ancestors].join(HIERARCHY_SEPARATOR),
        content: section.content,
        url: section.anchor ? `${page.url}#${section.anchor}` : page.url,
        category,
        path: section.ancestors.join(HIERARCHY_SEPARATOR)
      })
    }
  }

  return records
}

let pending: Promise<AutoIndexResult> | undefined

export function getSearchIndex(): Promise<AutoIndexResult> {
  pending ??= buildIndexAuto(collectRecords(), LANGUAGE, { baseUrl: `${searchStaticRoute}/` }).catch(
    (error: unknown) => {
      pending = undefined
      throw error
    }
  )

  return pending
}
