export { SearchBox, type SearchBoxProps } from './components/SearchBox.js'
export { SearchButton, type SearchButtonProps } from './components/SearchButton.js'
export { Highlighted, type HighlightedProps } from './components/Highlighted.js'
export { ZBSearchLogo, type ZBSearchLogoProps } from './components/ZBSearchLogo.js'
export { ZBSearchWordmark, type ZBSearchWordmarkProps } from './components/ZBSearchWordmark.js'

export { useSearch, type SearchState, type SearchStatus } from './hooks/useSearch.js'
export { useIsApplePlatform, useIsMounted, useScrollLock, useSearchHotkeys } from './hooks/useHotkeys.js'

export { defaultLabels, resolveLabels } from './labels.js'

export { flattenGroups, groupHits, wrapIndex } from './utils/group.js'
export { highlight, snippetAround, type HighlightSegment } from './utils/highlight.js'

export {
  addRecentSearch,
  DEFAULT_RECENT_SEARCHES_KEY,
  MAX_RECENT_SEARCHES,
  readRecentSearches,
  removeRecentSearch,
  type RecentSearch,
  type RecentSearchStorage
} from './utils/recent-searches.js'

export type { SearchBoxLabels, Searcher, SearchHit, SearchHitGroup } from './types.js'
