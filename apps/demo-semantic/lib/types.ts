export interface Article {
  id: string
  title: string
  summary: string
  body: string
  area: string
  topic: string
  tags: string[]
  audience: string
  updated: string
  views: number
  helpful: number
}

export type Mode = 'fulltext' | 'vector' | 'hybrid'

/** The three modes plus the side-by-side view, which is what the switch offers. */
export type View = Mode | 'compare'

export interface Filters {
  areas: string[]
  topics: string[]
  audiences: string[]
}

export interface Settings {
  /** Minimum cosine for a document to count as a vector hit. */
  similarity: number
  /** Split between the lexical and vector halves of a hybrid query; the two sum to 1. */
  vectorWeight: number
  /** Edit distance allowed on a lexical term. */
  tolerance: number
  boosts: Record<string, number>
}

export interface Hit {
  id: string
  score: number
  document: Article
  /** 1-based position in this mode's own ranking. */
  rank: number
}

export interface FacetBucket {
  value: string
  count: number
  selected: boolean
}

export interface ModeResult {
  mode: Mode
  hits: Hit[]
  count: number
  /** What ZBSearch reported for the query, e.g. `"212μs"`. */
  elapsed: string
  /** The exact object handed to `search()`, for the query inspector. */
  params: Record<string, unknown>
}

export interface QueryResult extends ModeResult {
  facets: {
    areas: FacetBucket[]
    topics: FacetBucket[]
    audiences: FacetBucket[]
  }
  /** Milliseconds spent encoding the query, or null when the mode needed no vector. */
  encodeMs: number | null
  encodeCached: boolean
}

/** One row of the compare view: an article and where each mode ranked it. */
export interface ComparisonRow {
  document: Article
  ranks: Record<Mode, number | null>
  scores: Record<Mode, number | null>
}

export interface Comparison {
  results: Record<Mode, ModeResult>
  rows: ComparisonRow[]
  encodeMs: number | null
}
