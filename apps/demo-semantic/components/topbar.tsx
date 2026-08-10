'use client'

import { useEffect, useRef } from 'react'
import { cx } from './ui'

/**
 * The application bar: brand, search, and nothing else.
 *
 * Search lives here rather than in the page body because it is the only thing this product
 * does, and because it has to stay reachable from an article as well as from a results
 * list. `/` focuses it, which is the shortcut people already expect from a search-first app.
 */
export function Topbar({
  term,
  onTerm,
  onFocus,
  onHome,
  busy,
  documents
}: {
  term: string
  onTerm: (term: string) => void
  onFocus: () => void
  onHome: () => void
  busy: boolean
  documents: number
}) {
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'

      if (event.key === '/' && !typing) {
        event.preventDefault()
        input.current?.focus()
      }

      if (event.key === 'Escape' && typing) {
        input.current?.blur()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-card/85 backdrop-blur">
      <div className="flex h-14 items-center gap-4 px-4">
        <button
          type="button"
          onClick={onHome}
          className="flex shrink-0 items-center gap-2.5 rounded-md py-1 pr-2 text-left"
        >
          <span
            aria-hidden
            className="grid h-6 w-6 place-items-center rounded-md bg-gradient-to-br from-vector to-accent text-[12px] font-bold text-white"
          >
            A
          </span>
          <span className="hidden items-baseline gap-1.5 sm:flex">
            <span className="text-[14px] font-semibold text-ink">Atlas</span>
            <span className="text-[13px] text-ink-muted">Help Center</span>
          </span>
        </button>

        <div className="relative mx-auto w-full max-w-xl">
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="9" cy="9" r="6" />
            <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
          </svg>

          <input
            ref={input}
            type="search"
            value={term}
            onChange={(event) => onTerm(event.target.value)}
            onFocus={onFocus}
            placeholder="Search for help, in your own words…"
            aria-label="Search the help center"
            className={cx(
              'w-full rounded-lg border border-line bg-page py-2 pl-9 pr-20 text-[13.5px] text-ink outline-none transition-colors',
              'placeholder:text-ink-faint focus:border-ink-faint focus:bg-card'
            )}
          />

          <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-2">
            {busy ? (
              <span className="zbs-pulse font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-faint">
                encoding
              </span>
            ) : null}

            {term ? (
              <button
                type="button"
                onClick={() => {
                  onTerm('')
                  input.current?.focus()
                }}
                aria-label="Clear search"
                className="rounded px-1 text-[15px] leading-none text-ink-faint hover:text-ink"
              >
                ×
              </button>
            ) : (
              <kbd className="hidden rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-faint sm:block">
                /
              </kbd>
            )}
          </div>
        </div>

        <span className="hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint lg:block">
          {documents} articles · in-browser
        </span>
      </div>
    </header>
  )
}
