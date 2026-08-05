import { count, create, insertMultiple, search, type AnySchema, type AnyZBSearch, type Results } from 'zbsearch'
import { articles, vectors } from './corpus'
import { EMBEDDING_DIMENSIONS, SCHEMA, TOKENIZER, toDocument } from './schema.mjs'
import type {
  Article,
  Comparison,
  ComparisonRow,
  FacetBucket,
  Filters,
  Hit,
  Mode,
  ModeResult,
  QueryResult,
  Settings,
} from './types'

export const MODES: Mode[] = ['fulltext', 'vector', 'hybrid']

export const MODE_LABELS: Record<Mode, string> = {
  fulltext: 'Keyword',
  vector: 'Semantic',
  hybrid: 'Hybrid',
}

/** How far down each ranking the compare view looks before calling a document unranked. */
const COMPARE_DEPTH = 20

export type ArticleDB = ReturnType<typeof createEngine>['db']

/** ZBSearch is synchronous unless a plugin makes it otherwise, and none is used here. */
function sync<T>(value: T | Promise<T>): T {
  if (value instanceof Promise) {
    throw new Error('The article index is expected to be fully synchronous')
  }

  return value
}

/**
 * Runs a search and hands back the hits.
 *
 * The params are assembled at runtime from the mode and the console's settings, so they
 * cannot be described by `SearchParams<typeof db>` — the union of the three modes' shapes
 * is exactly what is being built here. The document type is recovered on the way out,
 * which is the part callers actually depend on.
 */
function runSearch(db: ArticleDB, params: Record<string, unknown>): Results<Article> {
  return sync(search(db as AnyZBSearch, params as never)) as Results<Article>
}

export interface EngineStats {
  documents: number
  dimensions: number
  /** Milliseconds spent building the index, measured on the client. */
  indexingMs: number
}

export function createEngine() {
  const startedAt = performance.now()

  const db = create({
    /*
     * SCHEMA lives in a plain .mjs module so the evaluation script and the browser build
     * the same index. Property values widen to `string` on the way out of a JS file, so
     * the literal types ZBSearch would otherwise infer the document shape from are gone;
     * `toDocument` and the `Article` types carry that guarantee here instead.
     */
    schema: SCHEMA as AnySchema,
    components: { tokenizer: TOKENIZER },
  })

  sync(insertMultiple(db, articles.map((article, i) => toDocument(article, vectors[i])) as never))

  return {
    db,
    stats: {
      documents: sync(count(db)),
      dimensions: EMBEDDING_DIMENSIONS,
      indexingMs: performance.now() - startedAt,
    } satisfies EngineStats,
  }
}

export interface QueryInput {
  term: string
  /** The encoded query, or null when the mode does not need one. */
  vector: number[] | null
  filters: Filters
  settings: Settings
  limit: number
}

function buildWhere(filters: Filters): Record<string, unknown> {
  const where: Record<string, unknown> = {}

  if (filters.areas.length > 0) {
    where.areaKey = { in: filters.areas }
  }

  if (filters.topics.length > 0) {
    where.topicKey = { in: filters.topics }
  }

  if (filters.audiences.length > 0) {
    where.audience = { in: filters.audiences }
  }

  return where
}

/**
 * Assembles the `search()` call for one mode.
 *
 * The three modes differ by less than people expect: same index, same filters, same
 * facets. `fulltext` passes a term, `vector` passes a vector, and `hybrid` passes both
 * plus the weights used to blend the two rankings.
 */
export function buildParams(mode: Mode, input: QueryInput, extra: Record<string, unknown> = {}) {
  const { term, vector, filters, settings, limit } = input
  const where = buildWhere(filters)
  const trimmed = term.trim()

  const params: Record<string, unknown> = {
    mode,
    limit,
    facets: { areaKey: {}, topicKey: {}, audience: {} },
    ...extra,
  }

  if (Object.keys(where).length > 0) {
    params.where = where
  }

  if (mode !== 'vector' && trimmed !== '') {
    params.term = trimmed
    params.boost = settings.boosts
    // ZBSearch rejects a tolerance of 0 alongside no term, and 0 means "off" anyway.
    if (settings.tolerance > 0) {
      params.tolerance = settings.tolerance
    }
  }

  if (mode !== 'fulltext') {
    if (!vector) {
      throw new Error(`${mode} search needs an encoded query`)
    }

    params.vector = { property: 'embedding', value: vector }
    params.similarity = settings.similarity
  }

  if (mode === 'hybrid') {
    params.hybridWeights = {
      text: Number((1 - settings.vectorWeight).toFixed(2)),
      vector: Number(settings.vectorWeight.toFixed(2)),
    }
  }

  return params
}

function toHits(results: Results<Article>): Hit[] {
  return results.hits.map((hit, index) => ({
    id: String(hit.id),
    score: hit.score,
    document: hit.document,
    rank: index + 1,
  }))
}

function bucketsFrom(values: Record<string, number> | undefined, selected: string[]): FacetBucket[] {
  return Object.entries(values ?? {})
    .filter(([value]) => value !== '')
    .map(([value, count]) => ({ value, count, selected: selected.includes(value) }))
    .sort((a, b) => Number(b.selected) - Number(a.selected) || b.count - a.count || a.value.localeCompare(b.value))
}

function runMode(db: ArticleDB, mode: Mode, input: QueryInput, extra?: Record<string, unknown>): ModeResult {
  const params = buildParams(mode, input, extra)
  const results = runSearch(db, params)

  return {
    mode,
    hits: toHits(results),
    count: results.count,
    elapsed: results.elapsed.formatted,
    params,
  }
}

export function runQuery(
  db: ArticleDB,
  mode: Mode,
  input: QueryInput,
  encoding: { ms: number; cached: boolean } | null,
  extra?: Record<string, unknown>
): QueryResult {
  const params = buildParams(mode, input, extra)
  const results = runSearch(db, params)

  return {
    mode,
    hits: toHits(results),
    count: results.count,
    elapsed: results.elapsed.formatted,
    params,
    facets: {
      areas: bucketsFrom(results.facets?.areaKey?.values, input.filters.areas),
      topics: bucketsFrom(results.facets?.topicKey?.values, input.filters.topics),
      audiences: bucketsFrom(results.facets?.audience?.values, input.filters.audiences),
    },
    encodeMs: encoding ? encoding.ms : null,
    encodeCached: encoding?.cached ?? false,
  }
}

/**
 * The "related articles" list at the foot of an article.
 *
 * This is vector search with no query at all: the article's own stored embedding is handed
 * back to the index as the search vector, so the nearest neighbours are simply the closest
 * documents in the same space. It costs nothing — no encoder, no round trip — because the
 * vector was computed at build time and is already in memory.
 */
export function related(db: ArticleDB, article: Article, vector: number[], limit = 4): Hit[] {
  const results = runSearch(db, {
    mode: 'vector',
    vector: { property: 'embedding', value: vector },
    // Lower than the search floor: neighbours are a browsing aid, not an answer.
    similarity: 0.25,
    limit: limit + 1,
  })

  // The article is always its own nearest neighbour, at a cosine of 1.
  return toHits(results)
    .filter(hit => hit.id !== article.id)
    .slice(0, limit)
}

/**
 * The termless listing behind the landing page.
 *
 * Omitting `term` makes `search` return every document, which is exactly the browse case;
 * sorting by view count turns it into the "most read" list a help center opens with.
 */
export function browse(db: ArticleDB, input: QueryInput): QueryResult {
  return runQuery(db, 'fulltext', input, null, {
    sortBy: { property: 'views', order: 'DESC' },
  })
}

/**
 * Runs the same query three ways and lines the rankings up against each other.
 *
 * Rows are ordered by the best position any mode gave the document, so an article that
 * one mode found and the others missed entirely rises to the top instead of being buried
 * — which is the whole point of looking at the three side by side.
 */
export function compare(db: ArticleDB, input: QueryInput, encodeMs: number | null): Comparison {
  const deep = { ...input, limit: COMPARE_DEPTH }
  const results = {
    fulltext: runMode(db, 'fulltext', deep),
    vector: runMode(db, 'vector', deep),
    hybrid: runMode(db, 'hybrid', deep),
  } satisfies Record<Mode, ModeResult>

  const documents = new Map<string, Article>()

  for (const mode of MODES) {
    for (const hit of results[mode].hits) {
      documents.set(hit.id, hit.document)
    }
  }

  const rows: ComparisonRow[] = [...documents].map(([id, document]) => {
    const ranks = {} as ComparisonRow['ranks']
    const scores = {} as ComparisonRow['scores']

    for (const mode of MODES) {
      const hit = results[mode].hits.find(candidate => candidate.id === id)
      ranks[mode] = hit?.rank ?? null
      scores[mode] = hit?.score ?? null
    }

    return { document, ranks, scores }
  })

  const best = (row: ComparisonRow) => Math.min(...MODES.map(mode => row.ranks[mode] ?? Infinity))
  rows.sort((a, b) => best(a) - best(b))

  return { results, rows, encodeMs }
}

export interface BenchmarkRow {
  mode: Mode
  queries: number
  mean: number
  qps: number
}

/**
 * Times each mode over the same set of queries.
 *
 * Encoding is deliberately excluded: the vectors are prepared before the clock starts, so
 * what is measured is the index rather than the transformer in front of it. Encoding is
 * timed separately, in the encoder panel, because it is three orders of magnitude slower
 * and would otherwise be the only thing this number reflects.
 *
 * Browsers clamp `performance.now()` to roughly 100μs, which is coarser than a single
 * query over 150 documents, so a whole pass is timed as one sample and divided back down.
 */
export function benchmark(
  db: ArticleDB,
  terms: string[],
  queryVectors: number[][],
  settings: Settings,
  rounds: number
): BenchmarkRow[] {
  const input = (i: number): QueryInput => ({
    term: terms[i % terms.length],
    vector: queryVectors[i % queryVectors.length],
    filters: { areas: [], topics: [], audiences: [] },
    settings,
    limit: 10,
  })

  return MODES.map(mode => {
    // One untimed pass so every mode is measured with the same caches warm.
    for (let i = 0; i < terms.length; i++) {
      runSearch(db, buildParams(mode, input(i)))
    }

    const started = performance.now()

    for (let round = 0; round < rounds; round++) {
      for (let i = 0; i < terms.length; i++) {
        runSearch(db, buildParams(mode, input(i)))
      }
    }

    const totalMs = performance.now() - started
    const queries = rounds * terms.length

    return { mode, queries, mean: totalMs / queries, qps: queries / (totalMs / 1000) }
  })
}
