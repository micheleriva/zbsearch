import { Fragment } from 'react'
import { highlight } from '../utils/highlight.js'

export interface HighlightedProps {
  text: string
  query: string
  className?: string
}

export function Highlighted({ text, query, className }: HighlightedProps) {
  const segments = highlight(text, query)

  return (
    <span className={className}>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark key={index} className="zbs-searchbox__mark zbsearch-highlight">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        )
      )}
    </span>
  )
}
