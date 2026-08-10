'use client'

import type { ExampleQuery } from '@/lib/corpus'
import type { Comparison, Mode, QueryResult, Settings, View } from '@/lib/types'
import { CompareView } from './compare-view'
import { ModeSwitch, VIEW_DESCRIPTIONS } from './mode-switch'
import { ResultRow } from './result-row'
import { MODE_COLOR, cx } from './ui'

/**
 * Why nothing came back, phrased for the mode that returned nothing.
 *
 * An empty result is the most instructive thing either mode does, and the two fail for
 * completely different reasons: keyword search has no matching token, vector search has
 * nothing above the similarity floor. Saying which is more useful than a shared shrug.
 */
function Empty({
  mode,
  _term,
  settings,
  onMode
}: {
  mode: Mode
  term: string
  settings: Settings
  onMode: (view: View) => void
}) {
  const copy: Record<Mode, { headline: string; detail: string; suggest?: View }> = {
    fulltext: {
      headline: 'No article contains those words.',
      detail:
        'An inverted index can only find terms that are literally present, and nothing in the corpus uses this wording.',
      suggest: 'vector'
    },
    vector: {
      headline: `Nothing reached a cosine of ${settings.similarity.toFixed(2)}.`,
      detail:
        'Every article was compared against the query and none came close enough. Lower the similarity floor in the console, or search by keyword if this is an identifier rather than a sentence.',
      suggest: 'fulltext'
    },
    hybrid: {
      headline: 'Neither half of the query matched.',
      detail:
        'No lexical hit, and nothing above the similarity floor. This is the rare case where hybrid has nothing to blend.'
    }
  }

  const { headline, detail, suggest } = copy[mode]

  return (
    <div className="px-6 py-16 text-center">
      <p className={cx('text-[15px] font-medium', MODE_COLOR[mode].text)}>{headline}</p>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-muted">{detail}</p>

      {suggest ? (
        <button
          type="button"
          onClick={() => onMode(suggest)}
          className="mt-4 rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-ink-faint"
        >
          Try {suggest === 'vector' ? 'semantic' : 'keyword'} search instead
        </button>
      ) : null}
    </div>
  )
}

export function Results({
  view,
  onView,
  term,
  result,
  comparison,
  settings,
  example,
  onOpen
}: {
  view: View
  onView: (view: View) => void
  term: string
  result: QueryResult | null
  comparison: Comparison | null
  settings: Settings
  /** Set when the current query is one of the curated ones, so its note can be shown. */
  example: ExampleQuery | undefined
  onOpen: (id: string) => void
}) {
  const count = view === 'compare' ? comparison?.rows.length : result?.count

  return (
    <div className="rounded-xl border border-line bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-[13px] text-ink">
            <span className="font-semibold">{count ?? 0}</span>{' '}
            {view === 'compare' ? 'articles ranked by at least one mode' : `result${count === 1 ? '' : 's'}`}
            <span className="text-ink-faint"> for “{term}”</span>
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-faint">
            {VIEW_DESCRIPTIONS[view]}
            {result ? <span className="font-mono"> · {result.elapsed}</span> : null}
          </p>
        </div>

        <ModeSwitch view={view} onChange={onView} />
      </header>

      {example ? (
        <p className="border-b border-line-soft bg-shade/40 px-4 py-2.5 text-[12.5px] italic leading-relaxed text-ink-muted">
          {example.note}
        </p>
      ) : null}

      {view === 'compare' ? (
        comparison ? (
          <CompareView comparison={comparison} onOpen={onOpen} />
        ) : null
      ) : result && result.hits.length === 0 ? (
        <Empty mode={result.mode} term={term} settings={settings} onMode={onView} />
      ) : result ? (
        <ul>
          {result.hits.map((hit) => (
            <ResultRow
              key={hit.id}
              hit={hit}
              mode={result.mode}
              term={term}
              // Bars are relative to the best hit in this list: the three modes score on
              // scales that are not comparable, so an absolute width would mean nothing.
              relative={hit.score / (result.hits[0].score || 1)}
              showScore
              onOpen={() => onOpen(hit.id)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
