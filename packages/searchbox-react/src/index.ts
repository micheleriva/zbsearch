export { SearchBox, type SearchBoxProps } from './components/SearchBox.js'
export { SearchButton, type SearchButtonProps } from './components/SearchButton.js'
export { Highlighted, type HighlightedProps } from './components/Highlighted.js'
export { ZBSearchLogo, type ZBSearchLogoProps } from './components/ZBSearchLogo.js'
export { ZBSearchWordmark, type ZBSearchWordmarkProps } from './components/ZBSearchWordmark.js'

export { useSearch, type SearchState, type SearchStatus } from './hooks/useSearch.js'
export { useIsApplePlatform, useIsMounted, useScrollLock, useSearchHotkeys } from './hooks/useHotkeys.js'

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
