'use client'

import { useEffect } from 'react'
import type { CatalogDB, EngineStats, QueryOutput } from '@/lib/engine'
import { formatCount, formatMs } from '@/lib/format'
import type { EngineSettings } from '@/lib/types'
import { BenchmarkPanel } from './benchmark-panel'
import { BoostPanel, MatchingPanel } from './engine-console'
import { MerchandisingPanel } from './merchandising-panel'
import { QueryInspector } from './query-inspector'
import { Panel, Stat, cx } from './ui'

const EXAMPLES: { term: string; note: string }[] = [
  { term: 'gift', note: 'no natural matches — fully merchandised' },
  { term: 'lether bag', note: 'typo tolerance' },
  { term: 'luxury watch', note: 'two-condition pinning rule' },
  { term: 'blue cotton shirt', note: 'threshold' },
  { term: 'chanel', note: 'brand boost' },
]

/**
 * The docked strip along the bottom of the shop. It is the only thing on the storefront
 * that admits to being a demo, and it is how the console gets opened.
 */
export function ConsoleDock({
  results,
  stats,
  open,
  onToggle,
}: {
  results: QueryOutput | null
  stats: EngineStats | null
  open: boolean
  onToggle: () => void
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-console-line bg-console text-console-ink">
      <div className="mx-auto flex max-w-[1500px] items-center gap-x-5 gap-y-1 overflow-x-auto px-4 py-2 lg:px-6">
        <span className="flex shrink-0 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-console-brand" />
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-console-muted">zbsearch demo</span>
        </span>

        <span className="hidden shrink-0 font-mono text-[11px] text-console-muted sm:block">
          {stats ? `${formatCount(stats.documents)} products indexed in ${formatMs(stats.indexingMs)}` : 'indexing…'}
        </span>

        {results ? (
          <span className="shrink-0 font-mono text-[11px] text-console-muted">
            last query{' '}
            <span key={results.elapsedRaw + results.count} className="zbs-flash text-console-ink">
              {results.elapsedRaw === 0 ? '<0.1ms' : results.elapsed}
            </span>{' '}
            · {formatCount(results.count)} hits
          </span>
        ) : null}

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={cx(
            'ml-auto shrink-0 rounded-lg border px-3 py-1 font-mono text-[11px] transition-colors',
            open
              ? 'border-console-brand text-console-brand'
              : 'border-console-line text-console-muted hover:border-console-brand hover:text-console-brand'
          )}
        >
          {open ? 'close console' : 'search console'}
        </button>
      </div>
    </div>
  )
}

export function SearchConsole({
  open,
  db,
  stats,
  results,
  settings,
  showScores,
  onClose,
  onSettings,
  onShowScores,
  onSearch,
}: {
  open: boolean
  db: CatalogDB
  stats: EngineStats
  results: QueryOutput | null
  settings: EngineSettings
  showScores: boolean
  onClose: () => void
  onSettings: (next: EngineSettings) => void
  onShowScores: (value: boolean) => void
  onSearch: (term: string) => void
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    if (open) {
      window.addEventListener('keydown', onKeyDown)
    }

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) {
    return null
  }

  return (
    <aside className="zbs-slide-in fixed bottom-[41px] right-0 top-0 z-50 flex w-full max-w-[380px] flex-col border-l border-console-line bg-console text-console-ink shadow-2xl shadow-black/40">
      <header className="flex items-center justify-between gap-3 border-b border-console-line px-4 py-3">
        <div>
          <h2 className="font-mono text-[12px] uppercase tracking-[0.14em] text-console-ink">Search console</h2>
          <p className="mt-0.5 text-[11px] text-console-muted">Everything the shop above runs on.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the search console"
          className="grid h-7 w-7 place-items-center rounded text-console-muted hover:bg-console-line hover:text-console-ink"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
            <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <Panel title="Index">
          <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
            <Stat label="documents" value={formatCount(stats.documents)} />
            <Stat label="indexed in" value={formatMs(stats.indexingMs)} />
            <Stat
              label="last query"
              tone="brand"
              title="What ZBSearch reported. Browser clocks are clamped to roughly 100μs, so single readings are quantised — see the benchmark below."
              value={results ? (results.elapsedRaw === 0 ? '<0.1ms' : results.elapsed) : '—'}
            />
            <Stat
              label="round trip"
              title="The rendered grid is three queries: the main one plus two preflight queries for disjunctive category and brand facets."
              value={results ? `${formatMs(results.wallMs)} · ${results.queries}q` : '—'}
            />
          </div>

          <div className="mt-3 border-t border-console-line pt-3">
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-console-muted">try a query</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map(example => (
                <button
                  key={example.term}
                  type="button"
                  title={example.note}
                  onClick={() => onSearch(example.term)}
                  className="rounded border border-console-line px-2 py-[3px] font-mono text-[10.5px] text-console-muted transition-colors hover:border-console-brand hover:text-console-brand"
                >
                  {example.term}
                </button>
              ))}
            </div>
          </div>
        </Panel>

        <MerchandisingPanel
          settings={settings}
          matchedRuleIds={results?.matchedRuleIds ?? []}
          onChange={onSettings}
          onTry={onSearch}
        />
        <BoostPanel
          settings={settings}
          showScores={showScores}
          onChange={onSettings}
          onShowScores={onShowScores}
        />
        <MatchingPanel settings={settings} onChange={onSettings} />
        <BenchmarkPanel db={db} />
        {results ? <QueryInspector params={results.params} /> : null}
      </div>
    </aside>
  )
}
