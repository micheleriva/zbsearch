'use client'

import { lexicalTerm } from '@/lib/schema.mjs'
import type { Hit, Mode } from '@/lib/types'
import { HighlightedText } from './highlighted-text'
import { MODE_COLOR, cx } from './ui'

/**
 * The three modes produce numbers on genuinely different scales — BM25 is unbounded, a
 * cosine sits in 0..1, and a hybrid score is a weighted sum of two normalised rankings — so
 * the label names the unit instead of implying they are comparable.
 */
function scoreLabel(mode: Mode, score: number): string {
  return mode === 'vector' ? `cos ${score.toFixed(2)}` : score.toFixed(2)
}

export function ResultRow({
  hit,
  mode,
  term,
  relative,
  showScore,
  onOpen,
}: {
  hit: Hit
  mode: Mode
  term: string
  /** The hit's score over the best score in this result set, for the bar width. */
  relative: number
  showScore: boolean
  onOpen: () => void
}) {
  const { document } = hit
  /*
   * Vector hits matched on meaning, so there is nothing honest to underline in them. For
   * the other two modes the marks are restricted to the terms the index really looked for,
   * or a query like "i can't log in" would mark every "is", "it" and "in" on the page.
   */
  const highlightTerm = mode === 'vector' ? '' : lexicalTerm(term)

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group block w-full border-b border-line-soft px-4 py-3.5 text-left transition-colors hover:bg-shade/50"
      >
        <div className="flex items-baseline gap-3">
          <span className="w-4 shrink-0 font-mono text-[11px] tabular-nums text-ink-faint">{hit.rank}</span>

          <div className="min-w-0 flex-1">
            <h3 className="text-[14.5px] font-semibold leading-snug text-ink transition-colors group-hover:text-accent-ink group-hover:underline group-hover:underline-offset-2">
              <HighlightedText text={document.title} term={highlightTerm} />
            </h3>

            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
              <HighlightedText text={document.summary} term={highlightTerm} />
            </p>

            <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-faint">
              <span>{document.area}</span>
              <span aria-hidden>›</span>
              <span>{document.topic}</span>
            </p>
          </div>

          {showScore ? (
            <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
              <span className={cx('font-mono text-[10.5px] tabular-nums', MODE_COLOR[mode].text)}>
                {scoreLabel(mode, hit.score)}
              </span>
              <span className="block h-[3px] w-16 overflow-hidden rounded-full bg-shade">
                <span
                  className={cx('block h-full rounded-full', MODE_COLOR[mode].bg)}
                  style={{ width: `${Math.max(3, Math.min(100, relative * 100))}%` }}
                />
              </span>
            </span>
          ) : (
            <span className="shrink-0 pt-0.5 font-mono text-[10.5px] tabular-nums text-ink-faint">
              {document.views.toLocaleString()} reads
            </span>
          )}
        </div>
      </button>
    </li>
  )
}
