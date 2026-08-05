'use client'

import { useMemo } from 'react'
import { products } from '@/lib/catalog'
import { departments } from '@/lib/departments'
import type { Product } from '@/lib/types'
import { cx } from './ui'

/** One representative image per department: its best-rated product in stock. */
function useDepartmentTiles() {
  return useMemo(
    () =>
      departments.map(department => {
        const members = products.filter(product => department.categories.includes(product.categoryKey))
        const cover = [...members].sort((a, b) => b.rating - a.rating)[0]

        return { ...department, count: members.length, image: cover?.image }
      }),
    []
  )
}

export function Hero({ highlights, onSearch }: { highlights: Product[]; onSearch: (term: string) => void }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="grid items-center gap-8 p-8 sm:p-10 lg:grid-cols-[1.1fr_1fr] lg:p-12">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-shade px-3 py-1 text-[11.5px] font-medium text-ink-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            New season, 194 pieces in stock
          </span>

          <h1 className="mt-4 text-[32px] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[40px]">
            Everything you need,
            <br />
            found the moment you type it.
          </h1>

          <p className="mt-4 max-w-md text-[14px] leading-relaxed text-ink-muted">
            Tech, beauty, fashion and home — one shop, one search box. Spelling optional.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onSearch('gift')}
              className="rounded-xl bg-ink px-5 py-2.5 text-[13px] font-medium text-card transition-colors hover:bg-ink/85"
            >
              Shop the gift guide
            </button>
            <button
              type="button"
              onClick={() => onSearch('luxury watch')}
              className="rounded-xl border border-line px-5 py-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-shade"
            >
              Luxury watches
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {highlights.slice(0, 3).map((product, index) => (
            <button
              key={product.id}
              type="button"
              onClick={() => onSearch(product.title)}
              className={cx(
                'aspect-3/4 overflow-hidden rounded-xl border border-line bg-white transition-transform hover:-translate-y-1',
                index === 1 && 'translate-y-4'
              )}
            >
              <img
                src={product.image}
                alt={product.title}
                width={240}
                height={320}
                className="h-full w-full object-contain p-3"
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

export function DepartmentTiles({ onPick }: { onPick: (categories: string[]) => void }) {
  const tiles = useDepartmentTiles()

  return (
    <section>
      <h2 className="mb-3 text-[18px] font-semibold tracking-tight text-ink">Shop by department</h2>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(tile => (
          <button
            key={tile.slug}
            type="button"
            onClick={() => onPick(tile.categories)}
            className="group overflow-hidden rounded-xl border border-line bg-card text-left transition-shadow hover:shadow-lg hover:shadow-black/5"
          >
            <div className="aspect-4/3 overflow-hidden bg-white">
              {tile.image ? (
                <img
                  src={tile.image}
                  alt=""
                  width={200}
                  height={150}
                  loading="lazy"
                  className="h-full w-full object-contain p-4 transition-transform duration-300 group-hover:scale-105"
                />
              ) : null}
            </div>
            <div className="border-t border-line-soft px-3 py-2.5">
              <div className="text-[13px] font-medium text-ink">{tile.label}</div>
              <div className="text-[11px] text-ink-faint">{tile.count} items</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

export function SectionHeading({
  title,
  caption,
  action,
  onAction,
}: {
  title: string
  caption?: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-[18px] font-semibold tracking-tight text-ink">{title}</h2>
        {caption ? <p className="mt-0.5 text-[12.5px] text-ink-muted">{caption}</p> : null}
      </div>
      {action ? (
        <button
          type="button"
          onClick={onAction}
          className="shrink-0 text-[12.5px] font-medium text-brand-ink hover:underline"
        >
          {action} →
        </button>
      ) : null}
    </div>
  )
}
