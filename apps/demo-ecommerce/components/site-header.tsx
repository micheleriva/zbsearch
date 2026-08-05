'use client'

import type { Suggestion } from 'zbsearch'
import { activeDepartment, departments } from '@/lib/departments'
import { SearchBar } from './search-bar'
import { cx } from './ui'

function Wordmark() {
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-[13px] font-bold leading-none text-card">
        1
      </span>
      <span className="text-[17px] font-semibold tracking-tight text-ink">OneStore</span>
    </span>
  )
}

function IconButton({
  label,
  badge,
  onClick,
  children,
}: {
  label: string
  badge?: number
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="relative grid h-9 w-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-shade hover:text-ink"
    >
      {children}
      {badge !== undefined && badge > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-none text-white tabular-nums">
          {badge}
        </span>
      ) : null}
    </button>
  )
}

export function SiteHeader({
  term,
  suggestions,
  suggestElapsed,
  selectedCategories,
  cartCount,
  savedCount,
  onTerm,
  onDepartment,
  onOpenCart,
  onOpenSaved,
}: {
  term: string
  suggestions: Suggestion[]
  suggestElapsed: string
  selectedCategories: string[]
  cartCount: number
  savedCount: number
  onTerm: (term: string) => void
  onDepartment: (categories: string[]) => void
  onOpenCart: () => void
  onOpenSaved: () => void
}) {
  const current = activeDepartment(selectedCategories)

  return (
    <header className="sticky top-0 z-40 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <div className="bg-ink px-4 py-1.5 text-center text-[11.5px] text-card/80 lg:px-6">
        Free delivery over $50 · 30-day returns · Members get 10% off their first order
      </div>

      <div className="border-b border-line">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 lg:px-6">
          <Wordmark />

          <div className="order-3 w-full min-w-0 lg:order-none lg:flex-1">
            <SearchBar
              term={term}
              suggestions={suggestions}
              suggestElapsed={suggestElapsed}
              onChange={onTerm}
              onSubmit={onTerm}
            />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <IconButton label="Saved items" badge={savedCount} onClick={onOpenSaved}>
              <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" aria-hidden>
                <path
                  d="M10 16.5S3.5 12.8 3.5 8.4A3.4 3.4 0 0 1 10 6.9a3.4 3.4 0 0 1 6.5 1.5c0 4.4-6.5 8.1-6.5 8.1Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </IconButton>

            <IconButton label="Cart" badge={cartCount} onClick={onOpenCart}>
              <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" aria-hidden>
                <path
                  d="M3 4h2l1.6 8.4a1.5 1.5 0 0 0 1.5 1.2h6.3a1.5 1.5 0 0 0 1.5-1.2L17 7H6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="8.5" cy="16.5" r="1.2" fill="currentColor" />
                <circle cx="14.5" cy="16.5" r="1.2" fill="currentColor" />
              </svg>
            </IconButton>
          </div>
        </div>
      </div>

      <nav className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-[1500px] items-center gap-1 overflow-x-auto px-4 lg:px-6">
          <button
            type="button"
            onClick={() => onDepartment([])}
            className={cx(
              'shrink-0 border-b-2 px-3 py-2.5 text-[13px] transition-colors',
              selectedCategories.length === 0
                ? 'border-ink font-medium text-ink'
                : 'border-transparent text-ink-muted hover:text-ink'
            )}
          >
            All
          </button>

          {departments.map(department => (
            <button
              key={department.slug}
              type="button"
              onClick={() => onDepartment(current?.slug === department.slug ? [] : department.categories)}
              className={cx(
                'shrink-0 border-b-2 px-3 py-2.5 text-[13px] transition-colors',
                current?.slug === department.slug
                  ? 'border-ink font-medium text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink'
              )}
            >
              {department.label}
            </button>
          ))}
        </div>
      </nav>
    </header>
  )
}
