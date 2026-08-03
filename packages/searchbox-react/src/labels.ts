import type { SearchBoxLabels } from './types.js'

export const defaultLabels: SearchBoxLabels = {
  placeholder: 'Search documentation...',
  dialogLabel: 'Search',
  inputLabel: 'Search',
  clearLabel: 'Clear the query',
  closeLabel: 'Close search',
  searching: 'Searching...',
  noResults: (term) => `No results for "${term}"`,
  noResultsHint: 'Try a different term, or check the spelling.',
  recentSearches: 'Recent',
  removeRecentSearch: 'Remove this search from history',
  startTyping: 'Start typing to search the documentation.',
  errored: 'Something went wrong while searching.',
  navigateHint: 'to navigate',
  selectHint: 'to select',
  closeHint: 'to close',
  poweredBy: 'Search by'
}

export function resolveLabels(overrides?: Partial<SearchBoxLabels>): SearchBoxLabels {
  return overrides ? { ...defaultLabels, ...overrides } : defaultLabels
}
