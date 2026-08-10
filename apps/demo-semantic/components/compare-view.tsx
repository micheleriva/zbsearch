'use client'

import { MODES, MODE_LABELS } from '@/lib/engine'
import type { Comparison, ComparisonRow, Mode } from '@/lib/types'
import { MODE_COLOR, cx } from './ui'

/** How well some mode must rank a document before a disagreement about it is worth a label. */
const NOTEWORTHY = 3

/**
 * A short verdict for one row, or null when there is nothing interesting to say.
 *
 * Only sharp disagreements are annotated. Once the similarity floor has trimmed the
 * semantic ranking to a handful of articles, most rows are technically "missed by
 * semantic" — labelling all of them would drown out the two or three rows where a mode put
 * something first that another missed entirely, which is the whole point of the view.
 */
function verdict(row: ComparisonRow): { label: string; mode: Mode } | null {
  const best = Math.min(...MODES.map((mode) => row.ranks[mode] ?? Infinity))

  if (best > NOTEWORTHY) {
    return null
  }

  const found = MODES.filter((mode) => row.ranks[mode] !== null)

  if (found.length === 1) {
    return { label: `${MODE_LABELS[found[0]].toLowerCase()} only`, mode: found[0] }
  }

  const missing = MODES.filter((mode) => row.ranks[mode] === null)

  if (missing.length === 1 && missing[0] !== 'hybrid') {
    return { label: `missed by ${MODE_LABELS[missing[0]].toLowerCase()}`, mode: missing[0] }
  }

  return null
}

function RankCell({ rank, mode }: { rank: number | null; mode: Mode }) {
  if (rank === null) {
    return <span className="font-mono text-[12px] text-ink-faint">—</span>
  }

  const strong = rank <= 3

  return (
    <span
      className={cx(
        'inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 font-mono text-[11.5px] tabular-nums',
        strong ? cx(MODE_COLOR[mode].bg, 'font-semibold text-white') : 'bg-shade text-ink-muted'
      )}
    >
      {rank}
    </span>
  )
}

const GRID = 'grid grid-cols-[1fr_repeat(3,3.75rem)] items-center gap-x-3'

export function CompareView({ comparison, onOpen }: { comparison: Comparison; onOpen: (id: string) => void }) {
  const { results, rows } = comparison
  const visible = rows.slice(0, 12)

  if (rows.length === 0) {
    return <p className="px-6 py-16 text-center text-[13.5px] text-ink-muted">No mode returned anything.</p>
  }

  return (
    <div>
      <div className={cx(GRID, 'border-b border-line-soft bg-shade/40 px-4 py-2')}>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">article</span>

        {MODES.map((mode) => (
          <div key={mode} className="text-center">
            <div className={cx('text-[11px] font-semibold', MODE_COLOR[mode].text)}>{MODE_LABELS[mode]}</div>
            <div className="font-mono text-[9.5px] text-ink-faint">{results[mode].count} hits</div>
          </div>
        ))}
      </div>

      <ul>
        {visible.map((row) => {
          const note = verdict(row)

          return (
            <li key={row.document.id}>
              <button
                type="button"
                onClick={() => onOpen(row.document.id)}
                className={cx(
                  GRID,
                  'group w-full border-b border-line-soft px-4 py-2.5 text-left last:border-b-0 hover:bg-shade/50'
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] text-ink transition-colors group-hover:text-accent-ink">
                    {row.document.title}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
                    <span>{row.document.area}</span>
                    {note ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className={MODE_COLOR[note.mode].text}>{note.label}</span>
                      </>
                    ) : null}
                  </span>
                </span>

                {MODES.map((mode) => (
                  <span key={mode} className="text-center">
                    <RankCell rank={row.ranks[mode]} mode={mode} />
                  </span>
                ))}
              </button>
            </li>
          )
        })}
      </ul>

      {rows.length > visible.length ? (
        <p className="px-4 py-2.5 text-center text-[11.5px] text-ink-faint">
          {rows.length - visible.length} more appeared in at least one ranking.
        </p>
      ) : null}
    </div>
  )
}
