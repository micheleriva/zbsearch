export type { SearchBoxLabels, Searcher, SearchHit, SearchHitGroup } from './types.js'

export { defaultLabels, resolveLabels } from './labels.js'

export { flattenGroups, groupHits, wrapIndex } from './group.js'
export { highlight, snippetAround, type HighlightSegment } from './highlight.js'

export {
  addRecentSearch,
  DEFAULT_RECENT_SEARCHES_KEY,
  MAX_RECENT_SEARCHES,
  readRecentSearches,
  removeRecentSearch,
  type RecentSearch,
  type RecentSearchStorage
} from './recent-searches.js'
