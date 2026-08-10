'use client'

import { useEffect, useRef, useState } from 'react'
import type { Suggestion } from 'zbsearch'
import { cx } from './ui'

export function SearchBar({
  term,
  suggestions,
  suggestElapsed,
  onChange,
  onSubmit
}: {
  term: string
  suggestions: Suggestion[]
  suggestElapsed: string
  onChange: (term: string) => void
  onSubmit: (term: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCursor(-1)
  }, [suggestions])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === '/' && document.activeElement !== inputRef.current) {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  const visible = open && suggestions.length > 0

  function accept(value: string) {
    onChange(value)
    onSubmit(value)
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className="flex items-center gap-2.5 rounded-xl border border-line bg-page px-3.5 transition-colors focus-within:border-ink">
        <svg viewBox="0 0 16 16" className="h-[15px] w-[15px] shrink-0 text-ink-faint" aria-hidden>
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>

        <input
          ref={inputRef}
          value={term}
          placeholder="Search everything — try “lether bag”, “luxury watch” or “gift”"
          aria-label="Search products"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
              setCursor((current) => Math.min(current + 1, suggestions.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setCursor((current) => Math.max(current - 1, -1))
            } else if (event.key === 'Enter') {
              accept(cursor >= 0 ? suggestions[cursor]!.suggestion : term)
            } else if (event.key === 'Escape') {
              setOpen(false)
            }
          }}
          className="h-10 w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
        />

        {term ? (
          <button
            type="button"
            onClick={() => {
              onChange('')
              inputRef.current?.focus()
            }}
            aria-label="Clear the search"
            className="shrink-0 text-[12px] text-ink-faint hover:text-ink"
          >
            Clear
          </button>
        ) : (
          <kbd className="hidden shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-faint sm:block">
            /
          </kbd>
        )}
      </div>

      {visible ? (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 overflow-hidden rounded-xl border border-line bg-card shadow-xl shadow-black/10">
          <ul className="py-1">
            {suggestions.map((suggestion, index) => (
              <li key={suggestion.suggestion}>
                <button
                  type="button"
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => accept(suggestion.suggestion)}
                  className={cx(
                    'flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[13px]',
                    index === cursor ? 'bg-shade text-ink' : 'text-ink-muted'
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <svg viewBox="0 0 16 16" className="h-[13px] w-[13px] shrink-0 text-ink-faint" aria-hidden>
                      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                      <path d="m10.5 10.5 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <span className="truncate">{suggestion.suggestion}</span>
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                    {suggestion.count} item{suggestion.count === 1 ? '' : 's'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between border-t border-line-soft px-3.5 py-1.5">
            <span className="text-[10.5px] text-ink-faint">Suggestions from your catalog</span>
            <span className="font-mono text-[10.5px] text-ink-faint">{suggestElapsed}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
