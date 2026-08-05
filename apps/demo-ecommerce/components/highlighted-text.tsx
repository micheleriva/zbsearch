'use client'

import { Highlight } from '@zbsearch/highlight'
import { Fragment, useMemo } from 'react'

const OPTIONS = { strategy: 'partialMatchFullWord' } as const

/**
 * Marks the query inside a piece of text with `@zbsearch/highlight`.
 *
 * The library hands back ready-made HTML, but this renders from `positions` instead so
 * the app never needs `dangerouslySetInnerHTML`.
 */
export function HighlightedText({ text, term, trim }: { text: string; term: string; trim?: number }) {
  const parts = useMemo(() => {
    const query = term.trim()
    const source = trim === undefined ? text : excerpt(text, query, trim)

    if (query === '') {
      return [{ text: source, marked: false }]
    }

    return split(source, new Highlight(OPTIONS).highlight(source, query).positions)
  }, [text, term, trim])

  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part.marked ? <mark className="zbsearch-highlight">{part.text}</mark> : part.text}
        </Fragment>
      ))}
    </>
  )
}

/**
 * `Highlight#trim` crops the text around its first match, but returns it as HTML.
 * The marks are stripped back out here — they get re-applied from `positions` at render
 * time, against a plain string.
 */
function excerpt(text: string, query: string, length: number): string {
  const html = new Highlight(OPTIONS).highlight(text, query).trim(length)
  return html.replace(/<\/?mark[^>]*>/g, '')
}

function split(text: string, positions: { start: number; end: number }[]) {
  const parts: { text: string; marked: boolean }[] = []
  let cursor = 0

  for (const position of positions) {
    if (position.start > cursor) {
      parts.push({ text: text.slice(cursor, position.start), marked: false })
    }

    parts.push({ text: text.slice(position.start, position.end + 1), marked: true })
    cursor = position.end + 1
  }

  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor), marked: false })
  }

  return parts
}
