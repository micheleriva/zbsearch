export interface SearchHit {
  id: string
  url: string
  title: string
  section?: string
  snippet?: string
  breadcrumb?: string[]
  category?: string
}

export interface SearchHitGroup {
  id: string
  title: string
  category?: string
  hits: SearchHit[]
}

export type Searcher = (term: string, signal: AbortSignal) => Promise<SearchHit[]> | SearchHit[]

export interface SearchBoxLabels {
  placeholder: string
  dialogLabel: string
  inputLabel: string
  clearLabel: string
  closeLabel: string
  searching: string
  noResults: (term: string) => string
  noResultsHint: string
  recentSearches: string
  removeRecentSearch: string
  startTyping: string
  errored: string
  navigateHint: string
  selectHint: string
  closeHint: string
  poweredBy: string
}
