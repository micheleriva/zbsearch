'use client'

import { areas as allAreas } from '@/lib/corpus'
import type { FacetBucket, Filters } from '@/lib/types'
import { cx } from './ui'

/**
 * The persistent left rail: navigation and filtering in the same place.
 *
 * A help center browses by area, and a search narrows by area, and those are the same
 * control — so the counts come from the live facets while a query is running and from the
 * corpus otherwise. Nothing appears or disappears as you type; only the numbers move.
 */
export function Sidebar({
  filters,
  facets,
  searching,
  onChange,
  onHome,
}: {
  filters: Filters
  facets: { areas: FacetBucket[]; topics: FacetBucket[]; audiences: FacetBucket[] }
  /** True when a query is active, which is when the counts mean "matching" rather than "total". */
  searching: boolean
  onChange: (filters: Filters) => void
  onHome: () => void
}) {
  const toggle = (key: keyof Filters, value: string) => {
    const current = filters[key]
    onChange({
      ...filters,
      [key]: current.includes(value) ? current.filter(entry => entry !== value) : [...current, value],
    })
  }

  const counts = new Map(facets.areas.map(bucket => [bucket.value, bucket.count]))
  const active = filters.areas.length + filters.topics.length + filters.audiences.length

  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <Section title="Browse">
        <ul>
          {allAreas.map(area => {
            const selected = filters.areas.includes(area)
            const count = counts.get(area) ?? 0
            const dimmed = searching && count === 0

            return (
              <li key={area}>
                <button
                  type="button"
                  onClick={() => toggle('areas', area)}
                  disabled={dimmed && !selected}
                  className={cx(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-[5px] text-left text-[13px] transition-colors',
                    selected
                      ? 'bg-accent font-medium text-white'
                      : dimmed
                        ? 'text-ink-faint/60'
                        : 'text-ink-muted hover:bg-shade hover:text-ink'
                  )}
                >
                  <span className="truncate">{area}</span>
                  <span
                    className={cx(
                      'font-mono text-[10.5px] tabular-nums',
                      selected ? 'text-white/70' : 'text-ink-faint'
                    )}
                  >
                    {searching ? count : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title="Written for">
        <ul>
          {facets.audiences.map(bucket => (
            <li key={bucket.value}>
              <button
                type="button"
                onClick={() => toggle('audiences', bucket.value)}
                className={cx(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-[5px] text-left text-[13px] capitalize transition-colors',
                  bucket.selected
                    ? 'bg-accent font-medium text-white'
                    : 'text-ink-muted hover:bg-shade hover:text-ink'
                )}
              >
                <span>{bucket.value}</span>
                <span
                  className={cx(
                    'font-mono text-[10.5px] tabular-nums',
                    bucket.selected ? 'text-white/70' : 'text-ink-faint'
                  )}
                >
                  {bucket.count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      {searching && facets.topics.length > 0 ? (
        <Section title="Topic">
          <div className="flex flex-wrap gap-1 px-1">
            {facets.topics.slice(0, 10).map(bucket => (
              <button
                key={bucket.value}
                type="button"
                onClick={() => toggle('topics', bucket.value)}
                className={cx(
                  'rounded-full border px-2 py-[3px] text-[11.5px] transition-colors',
                  bucket.selected
                    ? 'border-accent bg-accent text-white'
                    : 'border-line text-ink-muted hover:border-ink-faint hover:text-ink'
                )}
              >
                {bucket.value}
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      <div className="mt-auto space-y-2 px-2.5 pt-2">
        {active > 0 ? (
          <button
            type="button"
            onClick={() => onChange({ areas: [], topics: [], audiences: [] })}
            className="text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Clear {active} filter{active === 1 ? '' : 's'}
          </button>
        ) : null}

        {searching ? (
          <button
            type="button"
            onClick={onHome}
            className="block text-[12px] text-ink-faint hover:text-ink-muted"
          >
            Back to help center home
          </button>
        ) : null}
      </div>
    </nav>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
        {title}
      </h3>
      {children}
    </section>
  )
}
