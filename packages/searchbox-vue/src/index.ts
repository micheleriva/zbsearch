export { default as SearchBox } from './components/SearchBox.vue'
export { default as SearchButton } from './components/SearchButton.vue'
export { default as Highlighted } from './components/Highlighted.vue'
export { ZBSearchWordmark } from './components/ZBSearchWordmark.js'

export { useSearch, type SearchState, type SearchStatus } from './composables/useSearch.js'
export { useIsApplePlatform, useIsMounted, useScrollLock, useSearchHotkeys } from './composables/useHotkeys.js'

export {
  addRecentSearch,
  DEFAULT_RECENT_SEARCHES_KEY,
  defaultLabels,
  flattenGroups,
  groupHits,
  highlight,
  MAX_RECENT_SEARCHES,
  readRecentSearches,
  removeRecentSearch,
  resolveLabels,
  snippetAround,
  wrapIndex,
  type HighlightSegment,
  type RecentSearch,
  type RecentSearchStorage,
  type SearchBoxLabels,
  type Searcher,
  type SearchHit,
  type SearchHitGroup
} from '@zbsearch/searchbox-core'
