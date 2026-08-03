import GithubSlugger from 'github-slugger'

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

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
const FRONT_MATTER_TITLE_RE = /^title:[ \t]*(.+?)[ \t]*$/m
const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})/
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/
const EXPLICIT_ANCHOR_RE = /\{#([^}]+)\}[ \t]*$/
const ESM_RE = /^[ \t]*(?:import|export)\b/
const ESM_CONTINUES_RE = /[{,][ \t]*$/
const ADMONITION_RE = /^[ \t]*:::[a-z]*(?:\[[^\]]*\])?[ \t]*(.*)$/i

function countBraces(line: string): number {
  let depth = 0

  for (const character of line) {
    if (character === '{') {
      depth++
    } else if (character === '}') {
      depth--
    }
  }

  return depth
}

function splitFrontMatter(source: string): { frontMatter: string; body: string } {
  const match = FRONT_MATTER_RE.exec(source)

  if (!match) {
    return { frontMatter: '', body: source }
  }
  return { frontMatter: match[1], body: source.slice(match[0].length) }
}

export function stripInlineMarkup(text: string): string {
  return text

    .replaceAll(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replaceAll(/<!--[\s\S]*?-->/g, ' ')

    .replaceAll(/!\[[^\]]*\]\([^)]*\)/g, ' ')

    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replaceAll(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')

    .replaceAll(/<\/?[A-Za-z][^>]*\/?>/g, ' ')

    .replaceAll(/<https?:\/\/[^>]*>/g, ' ')
    .replaceAll(/\bhttps?:\/\/\S+/g, ' ')

    .replaceAll(/`+/g, '')
    .replaceAll(/(\*\*|__|~~)/g, '')
    .replaceAll(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')

    .replaceAll(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, ' ')
    .replaceAll(/\|/g, ' ')

    .replaceAll(/^[ \t]*>[ \t]?/gm, '')
    .replaceAll(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
    .replaceAll(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, ' ')
    .replaceAll(/&nbsp;|&#160;/gi, ' ')
    .replaceAll(/&amp;/gi, '&')
    .replaceAll(/&lt;/gi, '<')
    .replaceAll(/&gt;/gi, '>')
    .replaceAll(/&quot;/gi, '"')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

function splitHeading(raw: string): { text: string; anchor?: string } {
  const match = EXPLICIT_ANCHOR_RE.exec(raw)

  if (!match) {
    return { text: stripInlineMarkup(raw) }
  }
  return { text: stripInlineMarkup(raw.slice(0, match.index)), anchor: match[1].trim() }
}

export function parseMarkdown(source: string): ParsedMarkdown {
  const { frontMatter, body } = splitFrontMatter(source)
  const slugger = new GithubSlugger()

  const frontMatterTitle = FRONT_MATTER_TITLE_RE.exec(frontMatter)?.[1]
  const title = frontMatterTitle ? stripInlineMarkup(frontMatterTitle.replace(/^['"]|['"]$/g, '')) : undefined

  const sections: MarkdownSection[] = []
  const intro: MarkdownSection = { heading: '', anchor: '', level: 0, ancestors: [], content: '' }
  let current = intro
  let buffer: string[] = []

  const openHeadings: string[] = []
  let firstHeading: string | undefined

  let fence: string | undefined
  let skippingEsm = false
  let esmDepth = 0

  const flush = () => {
    current.content = stripInlineMarkup(buffer.join('\n'))
    buffer = []
  }

  const lines = body.split(/\r?\n/)

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]

    if (fence !== undefined) {
      if (line.trimStart().startsWith(fence)) {
        fence = undefined
      }
      continue
    }

    const fenceMatch = FENCE_RE.exec(line)

    if (fenceMatch) {
      fence = fenceMatch[2]
      continue
    }

    if (skippingEsm || ESM_RE.test(line)) {
      esmDepth += countBraces(line)
      skippingEsm = esmDepth > 0 || ESM_CONTINUES_RE.test(line)

      if (!skippingEsm) {
        esmDepth = 0
      }

      continue
    }

    const admonition = ADMONITION_RE.exec(line)

    if (admonition) {
      if (admonition[1]) {
        buffer.push(admonition[1])
      }
      continue
    }

    const headingMatch = HEADING_RE.exec(line)
    const setextLevel =
      !headingMatch && SETEXT_RE.test(line) && buffer.length > 0 && buffer[buffer.length - 1].trim() !== ''
        ? line.trim().startsWith('=')
          ? 1
          : 2
        : 0

    if (!headingMatch && setextLevel === 0) {
      buffer.push(line)
      continue
    }

    let level: number
    let rawHeading: string

    if (headingMatch) {
      level = headingMatch[1].length
      rawHeading = headingMatch[2]
    } else {
      level = setextLevel

      rawHeading = buffer.pop() as string
    }

    flush()

    if (current === intro ? intro.content !== '' : true) {
      sections.push(current)
    }
    const { text, anchor } = splitHeading(rawHeading)
    firstHeading ??= level === 1 ? text : undefined

    openHeadings.length = Math.max(0, level - 1)
    const ancestors = openHeadings.filter((heading) => heading !== undefined && heading !== '')
    openHeadings[level - 1] = text

    current = {
      heading: text,
      anchor: anchor ?? slugger.slug(text),
      level,
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
