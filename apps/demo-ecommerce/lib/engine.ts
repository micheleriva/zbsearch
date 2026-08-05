import {
  count,
  create,
  deletePin,
  insertMultiple,
  insertPin,
  search,
  suggest,
  type Results,
  type SearchParams,
  type SuggestResults,
} from 'zbsearch'
import { products } from './catalog'
import { merchandisingRules, ruleMatches } from './pins'
import type { EngineSettings, FacetBucket, Product, SortKey, StoreFilters } from './types'

/**
 * The catalog schema.
 *
 * `brand` / `category` are indexed twice on purpose: once as `string`, which is what
 * full-text search and field boosting run against, and once as `enum` (`brandKey`,
 * `categoryKey`), which is what `where` filters and facets run against. Enums are
 * matched by exact value, so they are immune to stemming.
 */
export const schema = {
  title: 'string',
  description: 'string',
  brand: 'string',
  category: 'string',
  tags: 'string[]',
  sku: 'string',
  brandKey: 'enum',
  categoryKey: 'enum',
  availability: 'enum',
  price: 'number',
  listPrice: 'number',
  discount: 'number',
  rating: 'number',
  reviews: 'number',
  stock: 'number',
  inStock: 'boolean',
} as const

export const PRICE_RANGES = [
  { from: 0, to: 25 },
  { from: 25, to: 100 },
  { from: 100, to: 500 },
  { from: 500, to: 2_000 },
  { from: 2_000, to: 100_000 },
]

export const RATING_RANGES = [
  { from: 4.5, to: 5 },
  { from: 4, to: 5 },
  { from: 3, to: 5 },
  { from: 0, to: 5 },
]

export type CatalogDB = ReturnType<typeof createEngine>['db']

/** ZBSearch is synchronous unless a plugin makes it otherwise; none is used here. */
function sync<T>(value: T | Promise<T>): T {
  if (value instanceof Promise) {
    throw new Error('The catalog index is expected to be fully synchronous')
  }

  return value
}

export interface EngineStats {
  documents: number
  /** Milliseconds spent building the index, measured on the client. */
  indexingMs: number
}

export function createEngine() {
  const startedAt = performance.now()

  const db = create({
    schema,
    components: {
      tokenizer: {
        stemming: true,
        // `sku` is an identifier: stemming "LAP-APP-APP-078" helps nobody.
        stemmerSkipProperties: ['sku'],
      },
    },
  })

  sync(insertMultiple(db, products as unknown as Record<string, unknown>[]))

  for (const { rule } of merchandisingRules) {
    insertPin(db, rule)
  }

  const stats: EngineStats = {
    documents: sync(count(db)),
    indexingMs: performance.now() - startedAt,
  }

  return { db, stats }
}

export function setPinningEnabled(db: CatalogDB, enabled: boolean): void {
  for (const { rule } of merchandisingRules) {
    if (enabled) {
      deletePin(db, rule.id)
      insertPin(db, rule)
    } else {
      deletePin(db, rule.id)
    }
  }
}

function sortByFor(sort: SortKey) {
  switch (sort) {
    case 'price-asc':
      return { property: 'price', order: 'ASC' } as const
    case 'price-desc':
      return { property: 'price', order: 'DESC' } as const
    case 'rating':
      return { property: 'rating', order: 'DESC' } as const
    case 'discount':
      return { property: 'discount', order: 'DESC' } as const
    default:
      return undefined
  }
}

type Where = Record<string, unknown>

function buildWhere(filters: StoreFilters, bounds: [number, number], skip?: 'categories' | 'brands'): Where {
  const where: Where = {}

  if (skip !== 'categories' && filters.categories.length > 0) {
    where.categoryKey = { in: filters.categories }
  }

  if (skip !== 'brands' && filters.brands.length > 0) {
    where.brandKey = { in: filters.brands }
  }

  if (filters.price[0] > bounds[0] || filters.price[1] < bounds[1]) {
    where.price = { between: filters.price }
  }

  if (filters.minRating > 0) {
    where.rating = { gte: filters.minRating }
  }

  if (filters.inStockOnly) {
    where.inStock = true
  }

  return where
}

export interface QueryInput {
  term: string
  filters: StoreFilters
  settings: EngineSettings
  sort: SortKey
  limit: number
  offset: number
  priceBounds: [number, number]
}

export interface QueryHit {
  id: string
  score: number
  document: Product
  /** True when the document only reached this position because a pinning rule put it there. */
  pinned: boolean
  pinnedBy?: string
}

export interface QueryOutput {
  hits: QueryHit[]
  count: number
  /** What ZBSearch reported for the main query, e.g. `"64μs"`. */
  elapsed: string
  elapsedRaw: number
  /** Wall clock for the whole round: main query plus the two disjunctive facet queries. */
  wallMs: number
  queries: number
  facets: {
    categories: FacetBucket[]
    brands: FacetBucket[]
    price: FacetBucket[]
    rating: FacetBucket[]
  }
  matchedRuleIds: string[]
  /** The exact params handed to `search()`, echoed for the query inspector. */
  params: Record<string, unknown>
}

function bucketsFrom(
  values: Record<string, number> | undefined,
  selected: string[],
  sortValues = true
): FacetBucket[] {
  const entries = Object.entries(values ?? {}).filter(([value]) => value !== '')
  const buckets = entries.map(([value, count]) => ({ value, count, selected: selected.includes(value) }))

  if (!sortValues) {
    return buckets
  }

  /*
   * Checked values come first. These facets are disjunctive — the dimension's own filter
   * is lifted so the counts stay explorable — which means a popular unselected value can
   * otherwise outrank what the shopper actually picked and push it below the fold.
   */
  return buckets.sort(
    (a, b) =>
      Number(b.selected) - Number(a.selected) || b.count - a.count || a.value.localeCompare(b.value)
  )
}

export function runQuery(db: CatalogDB, input: QueryInput): QueryOutput {
  const { term, filters, settings, sort, limit, offset, priceBounds } = input
  const trimmed = term.trim()

  const params: SearchParams<any> = {
    ...(trimmed === '' ? {} : { term: trimmed }),
    limit,
    offset,
    // ZBSearch throws on a boost of 0 or less, so anything unset falls back to a neutral 1.
    boost: {
      title: settings.boosts.title || 1,
      brand: settings.boosts.brand || 1,
      category: settings.boosts.category || 1,
      tags: settings.boosts.tags || 1,
      description: settings.boosts.description || 1,
    },
    threshold: settings.threshold,
    facets: {
      price: { ranges: PRICE_RANGES },
      rating: { ranges: RATING_RANGES },
    },
  }

  if (settings.exact) {
    params.exact = true
  } else if (settings.tolerance > 0) {
    params.tolerance = settings.tolerance
  }

  const where = buildWhere(filters, priceBounds)
  if (Object.keys(where).length > 0) {
    params.where = where as SearchParams<any>['where']
  }

  const sortBy = sortByFor(sort)
  if (sortBy) {
    params.sortBy = sortBy
  }

  const wallStart = performance.now()
  const results = sync(search(db, params)) as Results<Product>

  /*
   * Category and brand facets are computed disjunctively: each one runs an extra query
   * with its own filter lifted, so selecting "Laptops" doesn't zero out every other
   * category. `preflight` skips document retrieval and returns counts and facets only.
   */
  const categoryFacets = sync(
    search(db, {
      ...params,
      preflight: true,
      limit: 0,
      facets: { categoryKey: {} },
      where: buildWhere(filters, priceBounds, 'categories') as SearchParams<any>['where'],
    })
  ) as Results<Product>

  const brandFacets = sync(
    search(db, {
      ...params,
      preflight: true,
      limit: 0,
      facets: { brandKey: {} },
      where: buildWhere(filters, priceBounds, 'brands') as SearchParams<any>['where'],
    })
  ) as Results<Product>

  const wallMs = performance.now() - wallStart

  const matchedRuleIds = settings.pinningEnabled
    ? merchandisingRules.filter(({ rule }) => ruleMatches(rule, trimmed)).map(({ rule }) => rule.id)
    : []

  const pinnedBy = new Map<string, string>()
  for (const { rule } of merchandisingRules) {
    if (!matchedRuleIds.includes(rule.id)) {
      continue
    }

    for (const promotion of rule.consequence.promote) {
      pinnedBy.set(String(promotion.doc_id), rule.id)
    }
  }

  return {
    hits: results.hits.map(hit => ({
      id: String(hit.id),
      score: hit.score,
      document: hit.document,
      pinned: pinnedBy.has(String(hit.id)),
      pinnedBy: pinnedBy.get(String(hit.id)),
    })),
    count: results.count,
    elapsed: results.elapsed.formatted,
    elapsedRaw: results.elapsed.raw,
    wallMs,
    queries: 3,
    facets: {
      categories: bucketsFrom(categoryFacets.facets?.categoryKey?.values, filters.categories),
      brands: bucketsFrom(brandFacets.facets?.brandKey?.values, filters.brands),
      price: bucketsFrom(results.facets?.price?.values, [], false),
      rating: bucketsFrom(results.facets?.rating?.values, [], false),
    },
    matchedRuleIds,
    params: params as Record<string, unknown>,
  }
}

/**
 * A termless, sorted slice of the catalog — what the home page's "trending" and "deals"
 * rows are built from. Omitting `term` makes `search` return every document, which is
 * exactly the browse case.
 */
export function browse(db: CatalogDB, sort: SortKey, limit: number, where: Where = {}): Product[] {
  const results = sync(
    search(db, {
      limit,
      sortBy: sortByFor(sort),
      where: { inStock: true, ...where } as SearchParams<any>['where'],
    })
  ) as Results<Product>

  return results.hits.map(hit => hit.document)
}

export function runSuggest(db: CatalogDB, term: string, limit = 6): SuggestResults {
  return sync(
    suggest(db, {
      term,
      limit,
      prefix: 'last',
      properties: ['title', 'brand', 'category', 'tags'],
      boost: { title: 3, brand: 2 },
    })
  )
}

export interface BenchmarkResult {
  queries: number
  totalMs: number
  mean: number
  p50: number
  p95: number
  qps: number
}

/**
 * Replays a set of terms many times over and reports how long the queries took.
 *
 * Browsers clamp `performance.now()` to roughly 100μs, which is an order of magnitude
 * coarser than a single query — timing one at a time would report a meaningless string
 * of zeroes. So a whole pass over `terms` is timed as one sample and divided back down,
 * which puts every sample well above the clock's resolution.
 */
export function benchmark(db: CatalogDB, terms: string[], rounds: number): BenchmarkResult {
  const perQuery: number[] = []
  const started = performance.now()

  for (let round = 0; round < rounds; round++) {
    const at = performance.now()

    for (const term of terms) {
      sync(search(db, { term, limit: 10, boost: { title: 3, brand: 2 } }))
    }

    perQuery.push((performance.now() - at) / terms.length)
  }

  const totalMs = performance.now() - started
  const queries = rounds * terms.length
  perQuery.sort((a, b) => a - b)

  const percentile = (p: number) => perQuery[Math.min(perQuery.length - 1, Math.floor(perQuery.length * p))] ?? 0

  return {
    queries,
    totalMs,
    mean: totalMs / queries,
    p50: percentile(0.5),
    p95: percentile(0.95),
    qps: queries / (totalMs / 1000),
  }
}
