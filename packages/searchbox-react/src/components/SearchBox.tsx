import { type KeyboardEvent, type MouseEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsMounted, useScrollLock } from '../hooks/useHotkeys.js'
import { useSearch } from '../hooks/useSearch.js'
import { resolveLabels } from '../labels.js'
import type { SearchBoxLabels, SearchHit, Searcher } from '../types.js'
import { flattenGroups, groupHits, wrapIndex } from '../utils/group.js'

import {
  addRecentSearch,
  DEFAULT_RECENT_SEARCHES_KEY,
  type RecentSearch,
  readRecentSearches,
  removeRecentSearch
} from '../utils/recent-searches.js'

import { Highlighted } from './Highlighted.js'

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CloseIcon,
  EnterIcon,
  ErrorIcon,
  HistoryIcon,
  PageIcon,
  SearchIcon,
  SectionIcon
} from './icons.js'

import { ZBSearchWordmark } from './ZBSearchWordmark.js'

const ZBSEARCH_URL = 'https://zbsearch.dev'

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface SearchBoxProps {
  open: boolean
  onClose: () => void
  searcher: Searcher
  onNavigate?: (url: string, hit: SearchHit) => void
  labels?: Partial<SearchBoxLabels>
  debounceMs?: number
  recentSearches?: boolean
  recentSearchesKey?: string
  className?: string
  container?: HTMLElement | null
}

function recentToHit(recent: RecentSearch): SearchHit {
  return { ...recent, snippet: undefined, category: undefined }
}

type BodyState = 'recent' | 'empty-start' | 'loading' | 'error' | 'no-results' | 'results'

export function SearchBox({
  open,
  onClose,
  searcher,
  onNavigate,
  labels: labelOverrides,
  debounceMs = 0,
  recentSearches = true,
  recentSearchesKey = DEFAULT_RECENT_SEARCHES_KEY,
  className,
  container
}: SearchBoxProps) {
  const labels = useMemo(() => resolveLabels(labelOverrides), [labelOverrides])
  const mounted = useIsMounted()
  const { term, setTerm, hits, status, reset } = useSearch(searcher, debounceMs)
  const [recents, setRecents] = useState<RecentSearch[]>([])
  const [selected, setSelected] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<Element | null>(null)

  const backdropMouseDownRef = useRef(false)

  const baseId = useId()
  const listboxId = `zbs-searchbox-list-${baseId}`
  const optionId = (index: number) => `zbs-searchbox-option-${baseId}-${index}`

  useScrollLock(open)

  const groups = useMemo(() => groupHits(hits), [hits])

  const bodyState = useMemo<BodyState>(() => {
    if (term.trim() === '') {
      return recentSearches && recents.length > 0 ? 'recent' : 'empty-start'
    }

    if (status === 'error') {
      return 'error'
    }

    if (hits.length > 0) {
      return 'results'
    }

    return status === 'loading' ? 'loading' : 'no-results'
  }, [term, status, hits.length, recents.length, recentSearches])

  const navigable = useMemo<SearchHit[]>(() => {
    if (bodyState === 'results') {
      return flattenGroups(groups)
    }

    return bodyState === 'recent' ? recents.map(recentToHit) : []
  }, [bodyState, groups, recents])

  useEffect(() => {
    if (!open) {
      return
    }

    restoreFocusRef.current = document.activeElement
    setRecents(recentSearches ? readRecentSearches(window.localStorage, recentSearchesKey) : [])
    setSelected(0)

    const frame = requestAnimationFrame(() => inputRef.current?.focus())

    return () => cancelAnimationFrame(frame)
  }, [open, recentSearches, recentSearchesKey])

  useEffect(() => {
    if (open) {
      return
    }

    reset()

    const previous = restoreFocusRef.current

    if (previous instanceof HTMLElement && previous.isConnected) {
      previous.focus()
    }

    restoreFocusRef.current = null
  }, [open, reset])

  useEffect(() => setSelected(0), [navigable])

  useEffect(() => {
    if (navigable.length === 0) {
      return
    }
    listRef.current?.querySelector(`#${CSS.escape(optionId(selected))}`)?.scrollIntoView({ block: 'nearest' })
  })

  const navigate = useCallback(
    (hit: SearchHit) => {
      if (recentSearches) {
        addRecentSearch(window.localStorage, hit, recentSearchesKey)
      }

      onClose()

      if (onNavigate) {
        onNavigate(hit.url, hit)
        return
      }

      window.location.assign(hit.url)
    },
    [onClose, onNavigate, recentSearches, recentSearchesKey]
  )

  const trapTab = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const focusable = event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)

    if (focusable.length === 0) {
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement

    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
      return
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'Tab':
          trapTab(event)
          return
        case 'Escape':
          event.preventDefault()
          onClose()
          return
        case 'ArrowDown':
          event.preventDefault()
          setSelected((current) => wrapIndex(current, 1, navigable.length))
          return
        case 'ArrowUp':
          event.preventDefault()
          setSelected((current) => wrapIndex(current, -1, navigable.length))
          return
        case 'Home':
          if (navigable.length > 0) {
            event.preventDefault()
            setSelected(0)
          }
          return
        case 'End':
          if (navigable.length > 0) {
            event.preventDefault()
            setSelected(navigable.length - 1)
          }
          return
        case 'Enter': {
          const hit = navigable[selected]

          if (!hit) {
            return
          }

          event.preventDefault()
          navigate(hit)
        }
      }
    },
    [navigable, selected, navigate, onClose, trapTab]
  )

  const onBackdropMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    backdropMouseDownRef.current = event.target === event.currentTarget
  }, [])

  const onBackdropClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (backdropMouseDownRef.current && event.target === event.currentTarget) {
        onClose()
      }

      backdropMouseDownRef.current = false
    },
    [onClose]
  )

  const onRowClick = useCallback(
    (event: MouseEvent<HTMLDivElement>, hit: SearchHit) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return
      }

      event.preventDefault()
      navigate(hit)
    },
    [navigate]
  )

  const dropRecent = useCallback(
    (url: string) => {
      setRecents(removeRecentSearch(window.localStorage, url, recentSearchesKey))
      inputRef.current?.focus()
    },
    [recentSearchesKey]
  )

  if (!open || !mounted) {
    return null
  }

  const flatIndex = new Map(navigable.map((hit, index) => [hit.id, index]))

  const renderRow = (hit: SearchHit, kind: 'result' | 'recent') => {
    const index = flatIndex.get(hit.id) ?? -1
    const isSelected = index === selected

    return (
      <div
        key={hit.id}
        id={optionId(index)}
        className="zbs-searchbox__hit"
        role="option"
        aria-selected={isSelected}
        data-selected={isSelected ? 'true' : undefined}
        data-testid="zbs-hit"
        onMouseMove={() => setSelected(index)}
        onClick={(event) => onRowClick(event, hit)}
      >
        <a className="zbs-searchbox__hit-link" href={hit.url} tabIndex={-1}>
          <span className="zbs-searchbox__hit-icon" aria-hidden="true">
            {kind === 'recent' ? <HistoryIcon /> : hit.section ? <SectionIcon /> : <PageIcon />}
          </span>

          <span className="zbs-searchbox__hit-body">
            <span className="zbs-searchbox__hit-title">
              <Highlighted text={hit.section || hit.title} query={term} />
            </span>

            {hit.breadcrumb && hit.breadcrumb.length > 0 ? (
              <span className="zbs-searchbox__hit-breadcrumb">
                {hit.breadcrumb.map((crumb, crumbIndex) => (
                  <span key={`${hit.id}-crumb-${crumb}-${crumbIndex}`} className="zbs-searchbox__crumb">
                    {crumb}
                  </span>
                ))}
              </span>
            ) : null}

            {hit.snippet ? (
              <span className="zbs-searchbox__hit-snippet">
                <Highlighted text={hit.snippet} query={term} />
              </span>
            ) : null}
          </span>
        </a>

        {kind === 'recent' ? (
          <button
            type="button"
            className="zbs-searchbox__hit-action"
            aria-label={labels.removeRecentSearch}
            onClick={(event) => {
              event.stopPropagation()
              dropRecent(hit.url)
            }}
          >
            <CloseIcon />
          </button>
        ) : (
          <span className="zbs-searchbox__hit-enter" aria-hidden="true">
            <EnterIcon />
          </span>
        )}
      </div>
    )
  }

  const dialog = (
    <div
      className="zbs-searchbox-backdrop"
      data-testid="zbs-searchbox-backdrop"
      onMouseDown={onBackdropMouseDown}
      onClick={onBackdropClick}
    >
      <div
        className={className ? `zbs-searchbox ${className}` : 'zbs-searchbox'}
        role="dialog"
        aria-modal="true"
        aria-label={labels.dialogLabel}
        data-testid="zbs-searchbox"
        onKeyDown={onKeyDown}
      >
        <div className="zbs-searchbox__header">
          <span className="zbs-searchbox__input-icon" aria-hidden="true">
            <SearchIcon />
          </span>

          <input
            ref={inputRef}
            className="zbs-searchbox__input"
            data-testid="zbs-searchbox-input"
            type="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            enterKeyHint="go"
            placeholder={labels.placeholder}
            aria-label={labels.inputLabel}
            role="combobox"
            aria-expanded={navigable.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={navigable.length > 0 ? optionId(selected) : undefined}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />

          {term ? (
            <button
              type="button"
              className="zbs-searchbox__clear"
              aria-label={labels.clearLabel}
              onClick={() => {
                reset()
                inputRef.current?.focus()
              }}
            >
              <CloseIcon />
            </button>
          ) : null}

          <button
            type="button"
            className="zbs-searchbox__close"
            aria-label={labels.closeLabel}
            data-testid="zbs-searchbox-close"
            onClick={onClose}
          >
            <kbd className="zbs-searchbox__kbd">esc</kbd>
          </button>
        </div>
        <div className="zbs-searchbox__body" ref={listRef}>
          <div
            id={listboxId}
            role="listbox"
            aria-label={labels.dialogLabel}
            className="zbs-searchbox__list"
            data-state={bodyState}
          >
            {bodyState === 'results'
              ? groups.map((group) => (
                  <section key={group.id} className="zbs-searchbox__group">
                    <header className="zbs-searchbox__group-title">
                      <span className="zbs-searchbox__group-name">{group.title}</span>
                      {group.category ? <span className="zbs-searchbox__group-tag">{group.category}</span> : null}
                    </header>
                    {group.hits.map((hit) => renderRow(hit, 'result'))}
                  </section>
                ))
              : null}

            {bodyState === 'recent' ? (
              <section className="zbs-searchbox__group">
                <header className="zbs-searchbox__group-title">
                  <span className="zbs-searchbox__group-name">{labels.recentSearches}</span>
                </header>
                {navigable.map((hit) => renderRow(hit, 'recent'))}
              </section>
            ) : null}
          </div>

          {bodyState === 'loading' ? (
            <p className="zbs-searchbox__state" data-testid="zbs-searchbox-loading">
              <span className="zbs-searchbox__spinner" aria-hidden="true" />
              {labels.searching}
            </p>
          ) : null}

          {bodyState === 'empty-start' ? (
            <p className="zbs-searchbox__state zbs-searchbox__state--muted">{labels.startTyping}</p>
          ) : null}

          {bodyState === 'error' ? (
            <p className="zbs-searchbox__state zbs-searchbox__state--error" data-testid="zbs-searchbox-error">
              <ErrorIcon className="zbs-searchbox__state-icon" />
              {labels.errored}
            </p>
          ) : null}

          {bodyState === 'no-results' ? (
            <div className="zbs-searchbox__state zbs-searchbox__state--empty" data-testid="zbs-searchbox-no-results">
              <SearchIcon className="zbs-searchbox__state-icon" />
              <p className="zbs-searchbox__state-title">{labels.noResults(term.trim())}</p>
              <p className="zbs-searchbox__state-hint">{labels.noResultsHint}</p>
            </div>
          ) : null}
        </div>

        <footer className="zbs-searchbox__footer">
          <ul className="zbs-searchbox__legend">
            <li className="zbs-searchbox__legend-item">
              <kbd className="zbs-searchbox__kbd">
                <EnterIcon />
              </kbd>
              {labels.selectHint}
            </li>
            <li className="zbs-searchbox__legend-item">
              <kbd className="zbs-searchbox__kbd">
                <ArrowUpIcon />
              </kbd>
              <kbd className="zbs-searchbox__kbd">
                <ArrowDownIcon />
              </kbd>
              {labels.navigateHint}
            </li>
            <li className="zbs-searchbox__legend-item">
              <kbd className="zbs-searchbox__kbd">esc</kbd>
              {labels.closeHint}
            </li>
          </ul>

          <a
            className="zbs-searchbox__branding"
            data-testid="zbs-searchbox-branding"
            href={ZBSEARCH_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            <span className="zbs-searchbox__branding-text">{labels.poweredBy}</span>
            <ZBSearchWordmark className="zbs-searchbox__branding-logo" size={19} />
          </a>
        </footer>
      </div>
    </div>
  )

  return createPortal(dialog, container ?? document.body)
}
