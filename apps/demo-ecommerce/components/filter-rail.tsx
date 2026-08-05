'use client'

import { useState, type ReactNode } from 'react'
import { categoryLabels } from '@/lib/catalog'
import { formatPriceShort } from '@/lib/format'
import type { FacetBucket, StoreFilters } from '@/lib/types'
import { cx } from './ui'

function Check({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  // A bucket that would return nothing is kept in place, so the list doesn't jump, but is dead.
  const empty = count === 0 && !active

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={empty}
      className={cx(
        'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors',
        empty ? 'cursor-default text-ink-faint/50' : 'text-ink-muted hover:bg-shade hover:text-ink'
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className={cx(
            'grid h-[15px] w-[15px] shrink-0 place-items-center rounded-sm border transition-colors',
            active ? 'border-ink bg-ink' : 'border-line'
          )}
        >
          {active ? (
            <svg viewBox="0 0 10 10" className="h-[9px] w-[9px] text-card" aria-hidden>
              <path
                d="M1.5 5.2 4 7.5 8.5 2.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </span>
        <span className={cx('truncate', active && 'font-medium text-ink')}>{label}</span>
      </span>
      {count === undefined ? null : <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">{count}</span>}
    </button>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-line-soft px-4 py-3.5 last:border-b-0">
      <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">{title}</h3>
      <div className="-mx-2">{children}</div>
    </div>
  )
}

function FacetGroup({
  title,
  buckets,
  labelOf,
  onToggle,
  initiallyVisible = 7,
}: {
  title: string
  buckets: FacetBucket[]
  labelOf?: (value: string) => string
  onToggle: (value: string) => void
  initiallyVisible?: number
}) {
  const [expanded, setExpanded] = useState(false)
  // Buckets arrive selected-first, so never collapse away a value the shopper checked.
  const cutoff = Math.max(initiallyVisible, buckets.filter(bucket => bucket.selected).length)
  const shown = expanded ? buckets : buckets.slice(0, cutoff)

  return (
    <Group title={title}>
      {shown.map(bucket => (
        <Check
          key={bucket.value}
          label={labelOf ? labelOf(bucket.value) : bucket.value}
          count={bucket.count}
          active={bucket.selected}
          onClick={() => onToggle(bucket.value)}
        />
      ))}

      {buckets.length > cutoff ? (
        <button
          type="button"
          onClick={() => setExpanded(current => !current)}
          className="mx-2 mt-1 text-[12px] font-medium text-brand-ink hover:underline"
        >
          {expanded ? 'Show less' : `Show ${buckets.length - cutoff} more`}
        </button>
      ) : null}
    </Group>
  )
}

export function FilterRail({
  filters,
  facets,
  priceBounds,
  onChange,
  onReset,
}: {
  filters: StoreFilters
  facets: { categories: FacetBucket[]; brands: FacetBucket[]; price: FacetBucket[]; rating: FacetBucket[] }
  priceBounds: [number, number]
  onChange: (next: StoreFilters) => void
  onReset: () => void
}) {
  const [mobileOpen, setMobileOpen] = useState(false)

  const active =
    filters.categories.length +
    filters.brands.length +
    (filters.minRating > 0 ? 1 : 0) +
    (filters.inStockOnly ? 1 : 0) +
    (filters.price[0] > priceBounds[0] || filters.price[1] < priceBounds[1] ? 1 : 0)

  function toggleIn(list: string[], value: string) {
    return list.includes(value) ? list.filter(item => item !== value) : [...list, value]
  }

  return (
    <aside className="overflow-hidden rounded-xl border border-line bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-[14px] font-semibold text-ink">
          Filters
          {active > 0 ? <span className="ml-1.5 text-[12px] font-normal text-ink-faint">({active})</span> : null}
        </h2>

        <span className="flex items-center gap-3">
          {active > 0 ? (
            <button type="button" onClick={onReset} className="text-[12px] font-medium text-brand-ink hover:underline">
              Clear all
            </button>
          ) : null}
          <button
            type="button"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(current => !current)}
            className="text-[12px] font-medium text-ink-muted lg:hidden"
          >
            {mobileOpen ? 'Hide' : 'Show'}
          </button>
        </span>
      </header>

      <div className={cx(!mobileOpen && 'hidden lg:block')}>
        <FacetGroup
          title="Category"
          buckets={facets.categories}
          labelOf={value => categoryLabels.get(value) ?? value}
          onToggle={value => onChange({ ...filters, categories: toggleIn(filters.categories, value) })}
        />

        <FacetGroup
          title="Brand"
          buckets={facets.brands}
          onToggle={value => onChange({ ...filters, brands: toggleIn(filters.brands, value) })}
        />

        <Group title="Price">
          {facets.price.map(bucket => {
            const [from, to] = bucket.value.split('-').map(Number) as [number, number]
            const selected = filters.price[0] === from && filters.price[1] === to

            return (
              <Check
                key={bucket.value}
                label={`${formatPriceShort(from)} – ${to >= 100_000 ? 'up' : formatPriceShort(to)}`}
                count={bucket.count}
                active={selected}
                onClick={() => onChange({ ...filters, price: selected ? priceBounds : [from, to] })}
              />
            )
          })}
        </Group>

        <Group title="Customer rating">
          {[4.5, 4, 3].map(min => (
            <Check
              key={min}
              label={`${min.toFixed(1)} & up`}
              count={facets.rating.find(item => item.value === `${min}-5`)?.count}
              active={filters.minRating === min}
              onClick={() => onChange({ ...filters, minRating: filters.minRating === min ? 0 : min })}
            />
          ))}
        </Group>

        <Group title="Availability">
          <Check
            label="In stock only"
            active={filters.inStockOnly}
            onClick={() => onChange({ ...filters, inStockOnly: !filters.inStockOnly })}
          />
        </Group>
      </div>
    </aside>
  )
}
