'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Highlighted, ZBSearchWordmark, groupHits, useSearch, type SearchHit } from '@zbsearch/searchbox-react'
import '@zbsearch/searchbox-react/styles.css'
import { create, insertMultiple, search } from 'zbsearch'
import { useTheme } from 'next-themes'
import { ArrowDown, ArrowUp, CornerDownLeft, FileText, Hash, Search } from 'lucide-react'
import { cn } from '@/lib/cn'

export type SearchBoxDemoDoc = {
  id: string
  url: string
  title: string
  section?: string
  snippet?: string
}

type Vars = Record<string, string>

type Preset = {
  id: string
  name: string
  blurb: string
  /**
   * Both modes are authored, never flipped - a theme that only works in one is
   * the thing this section is trying to disprove. The map shown in the code
   * panel is always the one currently painted.
   */
  light: Vars
  dark: Vars
}

/** Follows the docs site's own tokens, so it tracks the theme toggle for free. */
const siteVars: Vars = {
  '--zbs-surface': 'var(--color-fd-card)',
  '--zbs-surface-raised': 'var(--color-fd-muted)',
  '--zbs-surface-hover': 'color-mix(in oklab, var(--color-fd-primary) 10%, transparent)',
  '--zbs-border': 'var(--color-fd-border)',
  '--zbs-border-strong': 'var(--color-fd-border)',
  '--zbs-text': 'var(--color-fd-foreground)',
  '--zbs-text-muted': 'var(--color-fd-muted-foreground)',
  '--zbs-text-faint': 'var(--color-fd-muted-foreground)',
  '--zbs-accent': 'var(--color-fd-primary)',
  '--zbs-accent-soft': 'color-mix(in oklab, var(--color-fd-primary) 12%, transparent)',
  '--zbs-wordmark-ink': 'var(--color-fd-foreground)',
  '--zbs-radius': '8px',
  '--zbs-radius-sm': '4px'
}

const presets: Preset[] = [
  {
    id: 'site',
    name: 'This site',
    blurb: 'Pointed at the design tokens already on the page.',
    light: siteVars,
    dark: siteVars
  },
  {
    id: 'minimal',
    name: 'Minimal',
    blurb: 'Neutral greys, tight corners, no brand colour at all.',
    light: {
      '--zbs-surface': '#ffffff',
      '--zbs-surface-raised': '#f4f4f5',
      '--zbs-surface-hover': 'rgb(9 9 11 / 5%)',
      '--zbs-border': 'rgb(9 9 11 / 10%)',
      '--zbs-border-strong': 'rgb(9 9 11 / 18%)',
      '--zbs-text': '#09090b',
      '--zbs-text-muted': '#52525b',
      '--zbs-text-faint': '#a1a1aa',
      '--zbs-accent': '#18181b',
      '--zbs-accent-soft': 'rgb(9 9 11 / 6%)',
      '--zbs-wordmark-ink': '#09090b',
      '--zbs-radius': '6px',
      '--zbs-radius-sm': '4px'
    },
    dark: {
      '--zbs-surface': '#09090b',
      '--zbs-surface-raised': '#18181b',
      '--zbs-surface-hover': 'rgb(255 255 255 / 7%)',
      '--zbs-border': 'rgb(255 255 255 / 12%)',
      '--zbs-border-strong': 'rgb(255 255 255 / 20%)',
      '--zbs-text': '#fafafa',
      '--zbs-text-muted': '#a1a1aa',
      '--zbs-text-faint': '#71717a',
      '--zbs-accent': '#fafafa',
      '--zbs-accent-soft': 'rgb(255 255 255 / 10%)',
      '--zbs-wordmark-ink': '#fafafa',
      '--zbs-radius': '6px',
      '--zbs-radius-sm': '4px'
    }
  },
  {
    id: 'terminal',
    name: 'Terminal',
    blurb: 'Monospace, square edges, one phosphor accent.',
    light: {
      '--zbs-font': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      '--zbs-surface': '#f6f8f6',
      '--zbs-surface-raised': '#e7ece7',
      '--zbs-surface-hover': 'rgb(21 128 61 / 10%)',
      '--zbs-border': 'rgb(21 128 61 / 28%)',
      '--zbs-border-strong': 'rgb(21 128 61 / 45%)',
      '--zbs-text': '#0d1f14',
      '--zbs-text-muted': '#2f6b45',
      '--zbs-text-faint': '#6b9179',
      '--zbs-accent': '#15803d',
      '--zbs-accent-soft': 'rgb(21 128 61 / 12%)',
      '--zbs-wordmark-ink': '#0d1f14',
      '--zbs-radius': '0px',
      '--zbs-radius-sm': '0px'
    },
    dark: {
      '--zbs-font': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      '--zbs-surface': '#0b0f0c',
      '--zbs-surface-raised': '#121a14',
      '--zbs-surface-hover': 'rgb(74 222 128 / 12%)',
      '--zbs-border': 'rgb(74 222 128 / 24%)',
      '--zbs-border-strong': 'rgb(74 222 128 / 40%)',
      '--zbs-text': '#d8ffe4',
      '--zbs-text-muted': '#71c78d',
      '--zbs-text-faint': '#4a8560',
      '--zbs-accent': '#4ade80',
      '--zbs-accent-soft': 'rgb(74 222 128 / 14%)',
      '--zbs-wordmark-ink': '#d8ffe4',
      '--zbs-radius': '0px',
      '--zbs-radius-sm': '0px'
    }
  },
  {
    id: 'soft',
    name: 'Soft',
    blurb: 'Warm paper, generous radius, low contrast.',
    light: {
      '--zbs-surface': '#fffaf3',
      '--zbs-surface-raised': '#f7eee1',
      '--zbs-surface-hover': 'rgb(193 116 60 / 10%)',
      '--zbs-border': 'rgb(120 82 48 / 16%)',
      '--zbs-border-strong': 'rgb(120 82 48 / 26%)',
      '--zbs-text': '#3a2c1e',
      '--zbs-text-muted': '#7d6a52',
      '--zbs-text-faint': '#a89478',
      '--zbs-accent': '#c1743c',
      '--zbs-accent-soft': 'rgb(193 116 60 / 14%)',
      '--zbs-wordmark-ink': '#3a2c1e',
      '--zbs-radius': '20px',
      '--zbs-radius-sm': '14px'
    },
    dark: {
      '--zbs-surface': '#1c1611',
      '--zbs-surface-raised': '#251d16',
      '--zbs-surface-hover': 'rgb(232 168 108 / 12%)',
      '--zbs-border': 'rgb(232 168 108 / 18%)',
      '--zbs-border-strong': 'rgb(232 168 108 / 30%)',
      '--zbs-text': '#f6ece0',
      '--zbs-text-muted': '#c2ab92',
      '--zbs-text-faint': '#8d7862',
      '--zbs-accent': '#e8a86c',
      '--zbs-accent-soft': 'rgb(232 168 108 / 16%)',
      '--zbs-wordmark-ink': '#f6ece0',
      '--zbs-radius': '20px',
      '--zbs-radius-sm': '14px'
    }
  }
]

function formatVars(vars: Vars): string {
  return Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n')
}

/**
 * `insertMultiple` is sync for this schema but typed as sync-or-async, so the
 * whole thing is awaited and callers get a promise either way.
 */
async function buildIndex(docs: SearchBoxDemoDoc[]) {
  const instance = create({
    schema: {
      url: 'string',
      title: 'string',
      section: 'string',
      snippet: 'string'
    } as const
  })

  await insertMultiple(
    instance,
    docs.map((doc) => ({
      url: doc.url,
      title: doc.title,
      section: doc.section ?? '',
      snippet: doc.snippet ?? ''
    }))
  )

  return instance
}

/** Matches the `lg` breakpoint the section is gated on. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(min-width: 64rem)')
    const update = () => setIsDesktop(query.matches)

    update()
    query.addEventListener('change', update)

    return () => query.removeEventListener('change', update)
  }, [])

  return isDesktop
}

export function SearchBoxDemo({
  docs,
  stacked = false,
  defaultTerm
}: {
  docs: SearchBoxDemoDoc[]
  stacked?: boolean
  defaultTerm?: string
}) {
  const [presetId, setPresetId] = useState(presets[0].id)
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const isDesktop = useIsDesktop()

  useEffect(() => setMounted(true), [])

  const preset = presets.find((entry) => entry.id === presetId) ?? presets[0]
  const vars = mounted && resolvedTheme === 'dark' ? preset.dark : preset.light

  // The index lives in the browser: no API call behind this box. Built on the
  // first keystroke rather than on render, so neither the server nor a phone
  // (where the section is hidden) pays for an index nobody searches.
  const dbRef = useRef<ReturnType<typeof buildIndex> | null>(null)

  const searcher = useCallback(
    async (term: string): Promise<SearchHit[]> => {
      dbRef.current ??= buildIndex(docs)
      const db = await dbRef.current
      const results = await search(db, {
        term,
        properties: ['title', 'snippet'],
        boost: { title: 2 },
        tolerance: 1,
        limit: 12
      })

      return results.hits.map((hit) => ({
        id: String(hit.id),
        url: hit.document.url,
        title: hit.document.title,
        snippet: hit.document.snippet || undefined,
        category: hit.document.section || undefined
      }))
    },
    [docs]
  )

  // The stacked layout below `lg` reads worse than nothing; the band is hidden
  // there in CSS, and this keeps the panel out of the DOM to match.
  if (!isDesktop) return null

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
        {presets.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setPresetId(entry.id)}
            aria-pressed={entry.id === presetId}
            className={cn(
              'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
              entry.id === presetId
                ? 'border-fd-primary/40 bg-fd-primary/10 text-fd-foreground'
                : 'border-fd-border bg-fd-background text-fd-muted-foreground hover:text-fd-foreground'
            )}
          >
            {entry.name}
          </button>
        ))}
      </div>

      <div
        className={cn(
          'grid overflow-hidden rounded-2xl border border-fd-border',
          !stacked && 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'
        )}
      >
        <div className="bg-fd-muted/40 p-4 sm:p-6" style={vars as CSSProperties}>
          <InlinePanel searcher={searcher} defaultTerm={defaultTerm} />
        </div>

        <div className={cn('flex flex-col border-fd-border', stacked ? 'border-t' : 'max-lg:border-t lg:border-l')}>
          <div className="flex items-baseline justify-between gap-3 border-b border-fd-border px-4 py-2.5">
            <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-fd-muted-foreground">
              {preset.name}
            </span>
            <span className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-fd-muted-foreground">
              {mounted && resolvedTheme === 'dark' ? 'dark' : 'light'}
            </span>
          </div>
          <p className="border-b border-fd-border px-4 py-3 text-sm text-fd-muted-foreground">{preset.blurb}</p>
          <pre className="flex-1 whitespace-pre-wrap break-words px-4 py-4 font-mono text-xs leading-relaxed text-fd-muted-foreground">
            <code>
              {'.my-search {\n'}
              {formatVars(vars)}
              {'\n}'}
            </code>
          </pre>
        </div>
      </div>
    </div>
  )
}

/**
 * The dialog's own markup, minus the modal shell. `SearchBox` locks body scroll
 * for as long as it is open, so an always-open copy of it would freeze the page;
 * this rebuilds the panel from the exported hooks and reuses the shipped
 * `zbs-searchbox__*` classes, which is the headless path the section describes.
 */
function InlinePanel({
  searcher,
  defaultTerm
}: {
  searcher: (term: string) => Promise<SearchHit[]>
  defaultTerm?: string
}) {
  const { term, setTerm, hits, status } = useSearch(searcher, 80)
  const [selected, setSelected] = useState(0)
  const groups = useMemo(() => groupHits(hits), [hits])
  const trimmed = term.trim()

  // Pre-filled once on mount so the panel opens showing real results; typing
  // takes over from there.
  useEffect(() => {
    if (defaultTerm) setTerm(defaultTerm)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="zbs-searchbox zbs-demo-panel mx-auto">
      <div className="zbs-searchbox__header">
        <span className="zbs-searchbox__input-icon" aria-hidden="true">
          <Search />
        </span>
        <input
          className="zbs-searchbox__input"
          type="search"
          autoComplete="off"
          spellCheck="false"
          placeholder="Search the ZBSearch docs"
          aria-label="Search the ZBSearch docs"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value)
            setSelected(0)
          }}
        />
      </div>

      <div className="zbs-searchbox__body">
        <div className="zbs-searchbox__list" role="listbox" aria-label="Search results">
          {trimmed !== '' &&
            status === 'ready' &&
            groups.map((group) => (
              <section key={group.id} className="zbs-searchbox__group">
                <header className="zbs-searchbox__group-title">
                  <span className="zbs-searchbox__group-name">{group.title}</span>
                  {group.category ? <span className="zbs-searchbox__group-tag">{group.category}</span> : null}
                </header>
                {group.hits.map((hit) => (
                  <div
                    key={hit.id}
                    className="zbs-searchbox__hit"
                    role="option"
                    aria-selected={hit.id === hits[selected]?.id}
                    data-selected={hit.id === hits[selected]?.id ? 'true' : undefined}
                    onMouseMove={() => setSelected(hits.findIndex((entry) => entry.id === hit.id))}
                  >
                    <a className="zbs-searchbox__hit-link" href={hit.url}>
                      <span className="zbs-searchbox__hit-icon" aria-hidden="true">
                        {hit.category ? <Hash /> : <FileText />}
                      </span>
                      <span className="zbs-searchbox__hit-body">
                        <span className="zbs-searchbox__hit-title">
                          <Highlighted text={hit.title} query={term} />
                        </span>
                        {hit.snippet ? (
                          <span className="zbs-searchbox__hit-snippet">
                            <Highlighted text={hit.snippet} query={term} />
                          </span>
                        ) : null}
                      </span>
                    </a>
                    <span className="zbs-searchbox__hit-enter" aria-hidden="true">
                      <CornerDownLeft />
                    </span>
                  </div>
                ))}
              </section>
            ))}
        </div>

        {trimmed === '' ? (
          <p className="zbs-searchbox__state zbs-searchbox__state--muted">Try “vector”, “facets”, or “cloudflare”.</p>
        ) : null}

        {trimmed !== '' && status === 'loading' ? (
          <p className="zbs-searchbox__state">
            <span className="zbs-searchbox__spinner" aria-hidden="true" />
            Searching…
          </p>
        ) : null}

        {trimmed !== '' && status === 'ready' && hits.length === 0 ? (
          <div className="zbs-searchbox__state zbs-searchbox__state--empty">
            <Search className="zbs-searchbox__state-icon" />
            <p className="zbs-searchbox__state-title">No results for “{trimmed}”</p>
            <p className="zbs-searchbox__state-hint">Try a different term, or check the spelling.</p>
          </div>
        ) : null}
      </div>

      <footer className="zbs-searchbox__footer">
        <ul className="zbs-searchbox__legend">
          <li className="zbs-searchbox__legend-item">
            <kbd className="zbs-searchbox__kbd">
              <CornerDownLeft />
            </kbd>
            to select
          </li>
          <li className="zbs-searchbox__legend-item">
            <kbd className="zbs-searchbox__kbd">
              <ArrowUp />
            </kbd>
            <kbd className="zbs-searchbox__kbd">
              <ArrowDown />
            </kbd>
            to navigate
          </li>
        </ul>

        <span className="zbs-searchbox__branding">
          <span className="zbs-searchbox__branding-text">Search by</span>
          <ZBSearchWordmark className="zbs-searchbox__branding-logo" size={19} />
        </span>
      </footer>
    </div>
  )
}
