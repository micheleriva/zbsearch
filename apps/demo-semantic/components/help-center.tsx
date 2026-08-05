'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Encoder, type EncoderStatus } from '@/lib/encoder'
import { areas, articles, encoderModel, examples, vectorById, vectorBytes } from '@/lib/corpus'
import { browse, compare, createEngine, related, runQuery } from '@/lib/engine'
import {
  DEFAULT_BOOST,
  DEFAULT_HYBRID_WEIGHTS,
  DEFAULT_SIMILARITY,
  DEFAULT_TOLERANCE,
} from '@/lib/schema.mjs'
import type { Comparison, Filters, QueryResult, Settings, View } from '@/lib/types'
import { ArticleView } from './article-view'
import { Home } from './home'
import { Results } from './results'
import { SearchConsole } from './search-console'
import { Sidebar } from './sidebar'
import { Topbar } from './topbar'

const RESULT_LIMIT = 10
const DEBOUNCE_MS = 180
const POPULAR_LIMIT = 6

const NO_FILTERS: Filters = { areas: [], topics: [], audiences: [] }

const DEFAULT_SETTINGS: Settings = {
  similarity: DEFAULT_SIMILARITY,
  vectorWeight: DEFAULT_HYBRID_WEIGHTS.vector,
  tolerance: DEFAULT_TOLERANCE,
  boosts: { ...DEFAULT_BOOST },
}

const EMPTY_FACETS = { areas: [], topics: [], audiences: [] }

export function HelpCenter() {
  const { db, stats } = useMemo(() => createEngine(), [])

  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const [view, setView] = useState<View>('hybrid')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [openId, setOpenId] = useState<string | null>(null)
  const [consoleOpen, setConsoleOpen] = useState(false)

  const [encoderStatus, setEncoderStatus] = useState<EncoderStatus>({ state: 'cold' })
  const [result, setResult] = useState<QueryResult | null>(null)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [encoding, setEncoding] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const encoder = useRef<Encoder | null>(null)

  if (encoder.current === null && typeof window !== 'undefined') {
    encoder.current = new Encoder(encoderModel, setEncoderStatus)
  }

  useEffect(() => () => encoder.current?.dispose(), [])

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term])

  const query = debounced.trim()
  const filtering = filters.areas.length + filters.topics.length + filters.audiences.length > 0

  useEffect(() => {
    const input = { term: query, vector: null, filters, settings, limit: RESULT_LIMIT }

    if (query === '') {
      setResult(browse(db, { ...input, limit: filtering ? RESULT_LIMIT : POPULAR_LIMIT }))
      setComparison(null)
      setFailure(null)
      return
    }

    /*
     * Every mode but keyword needs the query encoded first, which is asynchronous and slow
     * enough that a later keystroke can easily overtake an earlier one. `stale` drops
     * whatever comes back for a query that is no longer the current one.
     */
    let stale = false

    const run = async () => {
      let vector: number[] | null = null
      let encoded: { ms: number; cached: boolean } | null = null

      if (view !== 'fulltext') {
        try {
          setEncoding(true)
          const encoding = await encoder.current!.embed(query)
          if (stale) {
            return
          }

          vector = encoding.vector
          encoded = { ms: encoding.ms, cached: encoding.cached }
        } catch (error) {
          if (!stale) {
            setFailure(error instanceof Error ? error.message : String(error))
          }
          return
        } finally {
          if (!stale) {
            setEncoding(false)
          }
        }
      }

      setFailure(null)
      const withVector = { ...input, vector }

      if (view === 'compare') {
        setComparison(compare(db, withVector, encoded?.ms ?? null))
        // Hybrid backs the facets and the console while the compare table is on screen.
        setResult(runQuery(db, 'hybrid', withVector, encoded))
        return
      }

      setComparison(null)
      setResult(runQuery(db, view, withVector, encoded))
    }

    void run()

    return () => {
      stale = true
    }
  }, [db, query, view, filters, settings, filtering])

  const warm = () => encoder.current?.warm()

  const open = (id: string) => {
    setOpenId(id)
    window.scrollTo({ top: 0 })
  }

  const goHome = () => {
    setOpenId(null)
    setTerm('')
    setDebounced('')
    setFilters(NO_FILTERS)
  }

  const ask = (next: string) => {
    setOpenId(null)
    setTerm(next)
    warm()
  }

  const openArea = (area: string) => {
    setOpenId(null)
    setFilters({ ...NO_FILTERS, areas: [area] })
  }

  const article = openId ? articles.find(candidate => candidate.id === openId) : undefined
  const neighbours = useMemo(
    () => (article ? related(db, article, vectorById.get(article.id)!) : []),
    [db, article]
  )

  const areaCounts = useMemo(
    () => areas.map(area => ({ area, count: articles.filter(a => a.area === area).length })),
    []
  )

  const facets = result?.facets ?? EMPTY_FACETS
  const searching = query !== '' || filtering
  const downloading = encoderStatus.state === 'loading' && view !== 'fulltext'

  return (
    <div className="flex min-h-screen flex-col">
      <Topbar
        term={term}
        onTerm={next => {
          setTerm(next)
          setOpenId(null)
        }}
        onFocus={warm}
        onHome={goHome}
        busy={encoding}
        documents={stats.documents}
      />

      <div className="flex flex-1 items-stretch">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 border-r border-line bg-card md:block">
          <Sidebar
            filters={filters}
            facets={facets}
            searching={searching}
            onChange={next => {
              setFilters(next)
              setOpenId(null)
            }}
            onHome={goHome}
          />
        </aside>

        <main className="min-w-0 flex-1 px-5 py-7 lg:px-8">
          <div className="mx-auto max-w-3xl">
            {failure ? (
              <p className="mb-4 rounded-lg border border-warn/40 bg-card px-4 py-3 text-[13px] text-warn">
                The encoder failed: {failure}. Keyword search still works.
              </p>
            ) : null}

            {downloading ? (
              <div className="mb-4 rounded-lg border border-line bg-card px-4 py-3">
                <p className="text-[13px] text-ink">Downloading the sentence encoder…</p>
                <p className="mt-1 text-[12px] text-ink-muted">
                  About 23 MB, once per browser, then cached. Keyword search needs none of it and works
                  right now.
                </p>
                <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-shade">
                  <span
                    className="block h-full rounded-full bg-vector transition-[width] duration-300"
                    style={{
                      width: `${
                        encoderStatus.state === 'loading' && encoderStatus.total > 0
                          ? (encoderStatus.received / encoderStatus.total) * 100
                          : 4
                      }%`,
                    }}
                  />
                </span>
              </div>
            ) : null}

            {article ? (
              <ArticleView
                article={article}
                related={neighbours}
                backLabel={query === '' ? 'Help' : 'Results'}
                onOpen={open}
                onArea={openArea}
                onBack={query === '' ? goHome : () => setOpenId(null)}
              />
            ) : query !== '' ? (
              <Results
                view={view}
                onView={setView}
                term={query}
                result={result}
                comparison={comparison}
                settings={settings}
                example={examples.find(candidate => candidate.term === query)}
                onOpen={open}
              />
            ) : filtering ? (
              <BrowseByFilter result={result} onOpen={open} />
            ) : (
              <Home
                examples={examples}
                popular={result?.hits ?? []}
                areaCounts={areaCounts}
                onAsk={ask}
                onArea={openArea}
                onOpen={open}
              />
            )}

            <footer className="mt-14 border-t border-line pt-5 text-[11.5px] leading-relaxed text-ink-faint">
              <p>
                Atlas is not a real product and these articles describe nothing that exists. They were
                written for this demo so the queries in it have somewhere honest to land.
              </p>
              <p className="mt-1.5">
                Search runs entirely on{' '}
                <a
                  href="https://zbsearch.dev"
                  className="text-accent-ink underline underline-offset-2 hover:text-accent"
                >
                  ZBSearch
                </a>{' '}
                in this tab. Query embeddings come from all-MiniLM-L6-v2 running locally through
                transformers.js — nothing you type is sent anywhere.
              </p>
            </footer>
          </div>
        </main>
      </div>

      <SearchConsole
        open={consoleOpen}
        onOpen={setConsoleOpen}
        view={view}
        db={db}
        stats={stats}
        vectorBytes={vectorBytes}
        result={result}
        encoderModel={encoderModel}
        encoderStatus={encoderStatus}
        encodeMs={result?.encodeMs ?? null}
        encodeCached={result?.encodeCached ?? false}
        onWarm={warm}
        settings={settings}
        onSettings={setSettings}
      />
    </div>
  )
}

/**
 * Browsing a filtered slice with no query — what clicking an area in the sidebar produces.
 *
 * There is no ranking to show here: `search` was given filters and a sort and no term at
 * all, so every document scores zero and the order is by read count.
 */
function BrowseByFilter({ result, onOpen }: { result: QueryResult | null; onOpen: (id: string) => void }) {
  if (!result) {
    return null
  }

  return (
    <div className="rounded-xl border border-line bg-card">
      <header className="border-b border-line px-4 py-3">
        <p className="text-[13px] text-ink">
          <span className="font-semibold">{result.count}</span> article{result.count === 1 ? '' : 's'}
        </p>
        <p className="mt-0.5 text-[11.5px] text-ink-faint">Most read first. Search to rank them instead.</p>
      </header>

      <ul className="divide-y divide-line-soft">
        {result.hits.map(hit => (
          <li key={hit.id}>
            <button
              type="button"
              onClick={() => onOpen(hit.id)}
              className="group block w-full px-4 py-3 text-left hover:bg-shade/50"
            >
              <span className="block text-[14px] font-medium text-ink transition-colors group-hover:text-accent-ink group-hover:underline group-hover:underline-offset-2">
                {hit.document.title}
              </span>
              <span className="mt-0.5 block text-[12.5px] text-ink-muted">{hit.document.summary}</span>
              <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.06em] text-ink-faint">
                {hit.document.area} › {hit.document.topic}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
