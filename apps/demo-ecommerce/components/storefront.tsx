'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Suggestion } from 'zbsearch'
import { categoryLabels, priceBounds } from '@/lib/catalog'
import { activeDepartment } from '@/lib/departments'
import {
  browse,
  createEngine,
  runQuery,
  runSuggest,
  setPinningEnabled,
  type CatalogDB,
  type EngineStats
} from '@/lib/engine'
import { formatCount } from '@/lib/format'
import type { EngineSettings, SortKey, StoreFilters } from '@/lib/types'
import { CartDrawer, SavedDrawer, type CartState } from './cart'
import { FilterRail } from './filter-rail'
import { DepartmentTiles, Hero, SectionHeading } from './home-sections'
import { ProductCard } from './product-card'
import { ConsoleDock, SearchConsole } from './search-console'
import { SiteFooter } from './site-footer'
import { SiteHeader } from './site-header'

const PAGE_SIZE = 24

const DEFAULT_FILTERS: StoreFilters = {
  categories: [],
  brands: [],
  price: priceBounds,
  minRating: 0,
  inStockOnly: false
}

const DEFAULT_SETTINGS: EngineSettings = {
  boosts: { title: 3, brand: 2, category: 1.5, tags: 1.2, description: 1 },
  tolerance: 1,
  exact: false,
  threshold: 0,
  pinningEnabled: true
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Customer rating' },
  { value: 'discount', label: 'Biggest discount' }
]

function filtersActive(filters: StoreFilters): boolean {
  return (
    filters.categories.length > 0 ||
    filters.brands.length > 0 ||
    filters.minRating > 0 ||
    filters.inStockOnly ||
    filters.price[0] > priceBounds[0] ||
    filters.price[1] < priceBounds[1]
  )
}

export function Storefront() {
  const [engine, setEngine] = useState<{ db: CatalogDB; stats: EngineStats } | null>(null)
  const [term, setTerm] = useState('')
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [sort, setSort] = useState<SortKey>('relevance')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [showScores, setShowScores] = useState(false)
  const [cart, setCart] = useState<CartState>({})
  const [saved, setSaved] = useState<string[]>([])
  const [drawer, setDrawer] = useState<'cart' | 'saved' | null>(null)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const resultsRef = useRef<HTMLDivElement>(null)

  // The index is built in the browser, on mount, so the timing on screen is real.
  useEffect(() => {
    setEngine(createEngine())
  }, [])

  const signature = JSON.stringify([term, filters, settings, sort])
  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [signature])

  const browsing = term.trim() === '' && !filtersActive(filters)

  const results = useMemo(() => {
    if (!engine) {
      return null
    }

    // Rules live on the index itself, so the toggle adds or removes them before querying.
    setPinningEnabled(engine.db, settings.pinningEnabled)

    return runQuery(engine.db, {
      term,
      filters,
      settings,
      sort,
      limit: visible,
      offset: 0,
      priceBounds
    })
  }, [engine, term, filters, settings, sort, visible])

  const home = useMemo(() => {
    if (!engine || !browsing) {
      return null
    }

    return {
      // The rating leaders include bottled water and a punnet of mulberries; a price
      // floor keeps the row reading like a curated shelf rather than a grocery aisle.
      trending: browse(engine.db, 'rating', 5, { price: { gte: 25 } }),
      deals: browse(engine.db, 'discount', 5)
    }
  }, [engine, browsing])

  const suggestions = useMemo(() => {
    if (!engine || term.trim().length < 2) {
      return { list: [] as Suggestion[], elapsed: '' }
    }

    const output = runSuggest(engine.db, term.trim())
    const query = term.trim().toLowerCase()

    return {
      list: output.suggestions.filter((item) => item.suggestion.toLowerCase() !== query),
      elapsed: output.elapsed.formatted
    }
  }, [engine, term])

  const addToCart = useCallback((id: string) => {
    setCart((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }))
  }, [])

  const setQuantity = useCallback((id: string, quantity: number) => {
    setCart((current) => {
      const next = { ...current }

      if (quantity <= 0) {
        delete next[id]
      } else {
        next[id] = quantity
      }

      return next
    })
  }, [])

  const toggleSaved = useCallback((id: string) => {
    setSaved((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }, [])

  const search = useCallback((next: string) => {
    setTerm(next)
    setFilters(DEFAULT_FILTERS)
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [])

  const cartCount = Object.values(cart).reduce((total, quantity) => total + quantity, 0)
  const department = activeDepartment(filters.categories)

  const heading = term.trim()
    ? `Results for “${term.trim()}”`
    : department
      ? department.label
      : filters.categories.length === 1
        ? (categoryLabels.get(filters.categories[0]!) ?? 'Products')
        : 'All products'

  return (
    <div className="flex min-h-screen flex-col pb-[41px]">
      <SiteHeader
        term={term}
        suggestions={suggestions.list}
        suggestElapsed={suggestions.elapsed}
        selectedCategories={filters.categories}
        cartCount={cartCount}
        savedCount={saved.length}
        onTerm={setTerm}
        onDepartment={(categories) => {
          setTerm('')
          setFilters({ ...DEFAULT_FILTERS, categories })
        }}
        onOpenCart={() => setDrawer('cart')}
        onOpenSaved={() => setDrawer('saved')}
      />

      <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 lg:px-6">
        {browsing && home ? (
          <div className="space-y-10">
            <Hero highlights={home.trending} onSearch={search} />

            <DepartmentTiles onPick={(categories) => setFilters({ ...DEFAULT_FILTERS, categories })} />

            <section>
              <SectionHeading
                title="Trending now"
                caption="Highest rated across the shop"
                action="See all"
                onAction={() => {
                  setSort('rating')
                  setFilters({ ...DEFAULT_FILTERS, inStockOnly: true })
                }}
              />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {home.trending.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    inCart={cart[product.id] ?? 0}
                    saved={saved.includes(product.id)}
                    onAdd={() => addToCart(product.id)}
                    onSave={() => toggleSaved(product.id)}
                  />
                ))}
              </div>
            </section>

            <section>
              <SectionHeading
                title="Deals of the week"
                caption="Biggest markdowns right now"
                action="See all"
                onAction={() => {
                  setSort('discount')
                  setFilters({ ...DEFAULT_FILTERS, inStockOnly: true })
                }}
              />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {home.deals.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    inCart={cart[product.id] ?? 0}
                    saved={saved.includes(product.id)}
                    onAdd={() => addToCart(product.id)}
                    onSave={() => toggleSaved(product.id)}
                  />
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div ref={resultsRef} className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
            <div className="lg:sticky lg:top-[168px] lg:self-start">
              {results ? (
                <FilterRail
                  filters={filters}
                  facets={results.facets}
                  priceBounds={priceBounds}
                  onChange={setFilters}
                  onReset={() => setFilters(DEFAULT_FILTERS)}
                />
              ) : null}
            </div>

            <section className="min-w-0">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h1 className="text-[22px] font-semibold tracking-tight text-ink">{heading}</h1>
                  <p className="mt-0.5 text-[12.5px] text-ink-muted">
                    {results ? (
                      <>
                        {formatCount(results.count)} product{results.count === 1 ? '' : 's'}
                        <span className="text-ink-faint">
                          {' '}
                          · found in {results.elapsedRaw === 0 ? '<0.1 ms' : results.elapsed}
                        </span>
                      </>
                    ) : (
                      'Loading…'
                    )}
                  </p>
                </div>

                <label className="flex items-center gap-2">
                  <span className="text-[12.5px] text-ink-muted">Sort by</span>
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as SortKey)}
                    className="rounded-lg border border-line bg-card px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink"
                  >
                    {SORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {results && results.hits.length === 0 ? (
                <EmptyState
                  term={term}
                  suggestion={suggestions.list[0]?.suggestion}
                  onPick={search}
                  onRelax={() => setSettings((current) => ({ ...current, threshold: 1, tolerance: 2, exact: false }))}
                />
              ) : null}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {results?.hits.map((hit) => (
                  <ProductCard
                    key={hit.id}
                    product={hit.document}
                    term={term}
                    featured={hit.pinned}
                    score={showScores ? hit.score : undefined}
                    inCart={cart[hit.id] ?? 0}
                    saved={saved.includes(hit.id)}
                    onAdd={() => addToCart(hit.id)}
                    onSave={() => toggleSaved(hit.id)}
                  />
                ))}
              </div>

              {results && results.count > results.hits.length ? (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setVisible((current) => current + PAGE_SIZE)}
                    className="rounded-xl border border-line bg-card px-5 py-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-shade"
                  >
                    Show {Math.min(PAGE_SIZE, results.count - results.hits.length)} more
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        )}
      </main>

      <SiteFooter />

      <ConsoleDock
        results={results}
        stats={engine?.stats ?? null}
        open={consoleOpen}
        onToggle={() => setConsoleOpen((current) => !current)}
      />

      {engine ? (
        <SearchConsole
          open={consoleOpen}
          db={engine.db}
          stats={engine.stats}
          results={results}
          settings={settings}
          showScores={showScores}
          onClose={() => setConsoleOpen(false)}
          onSettings={setSettings}
          onShowScores={setShowScores}
          onSearch={search}
        />
      ) : null}

      {drawer === 'cart' ? (
        <CartDrawer cart={cart} onClose={() => setDrawer(null)} onSetQuantity={setQuantity} />
      ) : null}

      {drawer === 'saved' ? (
        <SavedDrawer saved={saved} onClose={() => setDrawer(null)} onRemove={toggleSaved} onAddToCart={addToCart} />
      ) : null}
    </div>
  )
}

function EmptyState({
  term,
  suggestion,
  onPick,
  onRelax
}: {
  term: string
  suggestion?: string
  onPick: (term: string) => void
  onRelax: () => void
}) {
  return (
    <div className="rounded-xl border border-line bg-card p-8 text-center">
      <p className="text-[15px] font-medium text-ink">No results for “{term.trim() || 'that'}”</p>

      {suggestion ? (
        <p className="mt-2 text-[13px] text-ink-muted">
          Did you mean{' '}
          <button
            type="button"
            onClick={() => onPick(suggestion)}
            className="font-medium text-brand-ink hover:underline"
          >
            {suggestion}
          </button>
          ?
        </p>
      ) : null}

      <p className="mt-2 text-[13px] text-ink-muted">
        Try fewer words, or{' '}
        <button type="button" onClick={onRelax} className="font-medium text-brand-ink hover:underline">
          loosen the matching
        </button>
        .
      </p>
    </div>
  )
}
