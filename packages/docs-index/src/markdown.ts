import * as acorn from 'acorn'
import GithubSlugger from 'github-slugger'
import type { Nodes, Parents, Root, RootContent } from 'mdast'
import { directiveFromMarkdown } from 'mdast-util-directive'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mdxFromMarkdown } from 'mdast-util-mdx'
import { mdxjsEsmFromMarkdown } from 'mdast-util-mdxjs-esm'
import { directive } from 'micromark-extension-directive'
import { frontmatter } from 'micromark-extension-frontmatter'
import { gfm } from 'micromark-extension-gfm'
import { mdxjs } from 'micromark-extension-mdxjs'
import { mdxjsEsm } from 'micromark-extension-mdxjs-esm'
import { parse as parseYaml } from 'yaml'

export type MarkdownDialect = 'md' | 'mdx'

export interface ParseMarkdownOptions {
  dialect?: MarkdownDialect
}

export interface MarkdownSection {
  heading: string
  anchor: string
  level: number
  ancestors: string[]
  content: string
}

export interface ParsedMarkdown {
  title?: string
  sections: MarkdownSection[]
}

export function dialectOf(filePath: string | undefined): MarkdownDialect {
  return filePath !== undefined && /\.mdx$/i.test(filePath) ? 'mdx' : 'md'
}

const EXPLICIT_ANCHOR_RE = /\{#([^}]+)\}[ \t]*$/
const MDX_COMMENT_RE = /\{\s*\/\*[\s\S]*?\*\/\s*\}/g
const HTML_TAG_RE = /<[^>]*>/g
const HTML_EMBEDDED_RE = /^[ \t]*<(?:style|script)\b/i
const ENTITY_RE = /&(?:nbsp|amp|lt|gt|quot|#39);/gi

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'"
}

const BLOCK_CONTAINERS = new Set([
  'root',
  'blockquote',
  'list',
  'listItem',
  'containerDirective',
  'footnoteDefinition',
  'table',
  'tableRow'
])

const IGNORED = new Set([
  'code',
  'definition',
  'footnoteReference',
  'image',
  'imageReference',
  'mdxFlowExpression',
  'mdxTextExpression',
  'mdxjsEsm',
  'thematicBreak',
  'toml',
  'yaml'
])

function decodeEntities(value: string): string {
  return value.replaceAll(ENTITY_RE, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
}

function normalize(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim()
}

function htmlText(value: string): string {
  if (HTML_EMBEDDED_RE.test(value)) {
    return ''
  }

  return decodeEntities(value.replaceAll(HTML_TAG_RE, ' '))
}

function isEmbeddedElement(name: string | null | undefined): boolean {
  return name === 'style' || name === 'script'
}

function isSelfLabelledLink(node: Nodes): boolean {
  if (node.type !== 'link' || node.children.length !== 1) {
    return false
  }

  const [child] = node.children

  return child.type === 'text' && (child.value === node.url || `mailto:${child.value}` === node.url)
}

function textOf(node: Nodes, dialect: MarkdownDialect): string {
  if (node.type === 'html') {
    return htmlText(node.value)
  }

  if (IGNORED.has(node.type) || isSelfLabelledLink(node)) {
    return ''
  }

  if ((node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && isEmbeddedElement(node.name)) {
    return ''
  }

  if ('children' in node) {
    return (node as Parents).children
      .map((child) => textOf(child, dialect))
      .join(BLOCK_CONTAINERS.has(node.type) ? ' ' : '')
  }

  if (node.type === 'text' && dialect === 'mdx') {
    return node.value.replaceAll(MDX_COMMENT_RE, ' ')
  }

  return 'value' in node ? node.value : ''
}

function frontMatterTitle(node: RootContent): string | undefined {
  if (node.type !== 'yaml') {
    return undefined
  }

  try {
    const data: unknown = parseYaml(node.value)
    const title = (data as Record<string, unknown> | null)?.title

    return typeof title === 'string' && title !== '' ? normalize(title) : undefined
  } catch {
    return undefined
  }
}

const BASE_EXTENSIONS = [frontmatter(['yaml']), gfm(), directive()]
const BASE_MDAST_EXTENSIONS = [frontmatterFromMarkdown(['yaml']), gfmFromMarkdown(), directiveFromMarkdown()]

const esmOnly = mdxjsEsm({ acorn: acorn as never, acornOptions: { ecmaVersion: 2024, sourceType: 'module' } })

const MDX_ATTEMPTS = [
  { extensions: [mdxjs()], mdastExtensions: [mdxFromMarkdown()] },
  { extensions: [esmOnly], mdastExtensions: [mdxjsEsmFromMarkdown()] },
  { extensions: [], mdastExtensions: [] }
]

const MD_ATTEMPTS = [{ extensions: [], mdastExtensions: [] }]

function toTree(source: string, dialect: MarkdownDialect): Root {
  let lastError: unknown

  for (const attempt of dialect === 'mdx' ? MDX_ATTEMPTS : MD_ATTEMPTS) {
    try {
      return fromMarkdown(source, {
        extensions: [...BASE_EXTENSIONS, ...attempt.extensions],
        mdastExtensions: [...BASE_MDAST_EXTENSIONS, ...attempt.mdastExtensions]
      })
    } catch (error) {
      lastError = error
    }
  }

  throw lastError
}

export function stripInlineMarkup(text: string, options: ParseMarkdownOptions = {}): string {
  const dialect = options.dialect ?? 'md'

  return normalize(textOf(toTree(text, dialect), dialect))
}

function splitHeading(raw: string): { text: string; anchor?: string } {
  const match = EXPLICIT_ANCHOR_RE.exec(raw)

  if (!match) {
    return { text: normalize(raw) }
  }

  return { text: normalize(raw.slice(0, match.index)), anchor: match[1].trim() }
}

export function parseMarkdown(source: string, options: ParseMarkdownOptions = {}): ParsedMarkdown {
  const dialect = options.dialect ?? 'md'
  const tree = toTree(source, dialect)
  const slugger = new GithubSlugger()

  const sections: MarkdownSection[] = []
  const intro: MarkdownSection = { heading: '', anchor: '', level: 0, ancestors: [], content: '' }
  let current = intro
  let buffer: string[] = []

  const openHeadings: string[] = []
  let title: string | undefined
  let firstHeading: string | undefined

  const flush = () => {
    current.content = normalize(buffer.join(' '))
    buffer = []
  }

  for (const node of tree.children) {
    if (node.type !== 'heading') {
      title ??= frontMatterTitle(node)

      const text = textOf(node, dialect)

      if (text !== '') {
        buffer.push(text)
      }

      continue
    }

    flush()

    if (current === intro ? intro.content !== '' : true) {
      sections.push(current)
    }

    const { text, anchor } = splitHeading(textOf(node, dialect))
    firstHeading ??= node.depth === 1 ? text : undefined

    openHeadings.length = Math.max(0, node.depth - 1)
    const ancestors = openHeadings.filter((heading) => heading !== undefined && heading !== '')
    openHeadings[node.depth - 1] = text

    current = {
      heading: text,
      anchor: anchor ?? slugger.slug(text),
      level: node.depth,
      ancestors,
      content: ''
    }
  }

  flush()

  if (current === intro ? intro.content !== '' : true) {
    sections.push(current)
  }

  return { title: title ?? firstHeading, sections }
}
