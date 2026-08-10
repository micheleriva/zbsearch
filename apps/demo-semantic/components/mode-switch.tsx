'use client'

import { MODES, MODE_LABELS } from '@/lib/engine'
import type { View } from '@/lib/types'
import { MODE_COLOR, cx } from './ui'

export const VIEW_DESCRIPTIONS: Record<View, string> = {
  fulltext: 'BM25 over an inverted index — finds the words you typed.',
  vector: 'Cosine similarity over sentence embeddings — finds what you meant.',
  hybrid: 'Both rankings, normalised and blended by weight.',
  compare: 'All three at once, lined up against each other.'
}

/**
 * A compact segmented control, sitting in the results header where a real search product
 * would put a sort order. It is the one piece of engine machinery the page surfaces
 * without opening the console, because it is the whole point of the demo.
 */
export function ModeSwitch({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const options: View[] = [...MODES, 'compare']

  return (
    <div className="flex items-center gap-2">
      <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint sm:block">ranking</span>

      <div role="tablist" aria-label="Search mode" className="inline-flex rounded-lg border border-line bg-page p-0.5">
        {options.map((option) => {
          const active = view === option
          const accent = option === 'compare' ? undefined : MODE_COLOR[option]

          return (
            <button
              key={option}
              role="tab"
              type="button"
              aria-selected={active}
              title={VIEW_DESCRIPTIONS[option]}
              onClick={() => onChange(option)}
              className={cx(
                'rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors',
                active ? cx('bg-card shadow-sm', accent ? accent.text : 'text-ink') : 'text-ink-muted hover:text-ink'
              )}
            >
              {option === 'compare' ? 'Compare' : MODE_LABELS[option]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
