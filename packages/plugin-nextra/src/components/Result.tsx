import React, { useState } from 'react'
import { listItem, resultText } from '../utils/classNames.js'
import NextLink from 'next/link'
import { HighlightedDocument } from './HighlightedDocument.js'
import { Result, TypedDocument } from 'zbsearch'
import { NextraZBSearch } from '../utils/index.js'
import { Position } from '@zbsearch/plugin-match-highlight'

export const SearchResult = ({ document, positions }) => {
  const [hovered, setHovered] = useState(false)
  return (
    <li
      key={document.url}
      className={`${listItem} ${hovered ? 'nx-bg-primary-500/10' : ''}`}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      <NextLink href={document.url} className="nx-block nx-scroll-m-12 nx-px-2.5 nx-py-2">
        <div className={resultText}>
          <HighlightedDocument
            hit={
              { document, positions } as Result<TypedDocument<NextraZBSearch>> & {
                positions: Record<string, Record<string, Position[]>>
              }
            }
          />
        </div>
      </NextLink>
    </li>
  )
}
