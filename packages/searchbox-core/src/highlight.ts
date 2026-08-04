import { Highlight, highlightStrategy } from '@zbsearch/highlight'

export interface HighlightSegment {
  text: string
  match: boolean
}

const ELLIPSIS = '…'

function matcher(): Highlight {
  return new Highlight({ strategy: highlightStrategy.PARTIAL_MATCH_FULL_WORD })
}

export function highlight(text: string, query: string): HighlightSegment[] {
  if (!text) {
    return []
  }

  const positions = matcher().highlight(text, query).positions

  if (positions.length === 0) {
    return [{ text, match: false }]
  }

  const segments: HighlightSegment[] = []
  let cursor = 0

  for (const { start, end } of positions) {
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), match: false })
    }

    segments.push({ text: text.slice(start, end + 1), match: true })
    cursor = end + 1
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false })
  }

  return segments
}

export function snippetAround(text: string, query: string, maxLength = 160): string {
  const normalized = text.replace(/\s+/g, ' ').trim()

  if (normalized.length <= maxLength) {
    return normalized
  }

  const [first] = matcher().highlight(normalized, query).positions

  const anchor = first ? first.start : 0
  const matched = first ? first.end + 1 - first.start : 0
  const padding = Math.floor((maxLength - Math.min(matched, maxLength)) / 2)

  let start = Math.max(0, anchor - padding)
  let end = Math.min(normalized.length, start + maxLength)
  start = Math.max(0, end - maxLength)

  if (start > 0) {
    const boundary = normalized.indexOf(' ', start)
    start = boundary === -1 || boundary > anchor ? start : boundary + 1
  }

  if (end < normalized.length) {
    const boundary = normalized.lastIndexOf(' ', end)
    end = boundary <= start ? end : boundary
  }

  return `${start > 0 ? ELLIPSIS : ''}${normalized.slice(start, end).trim()}${end < normalized.length ? ELLIPSIS : ''}`
}
