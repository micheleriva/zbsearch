import { stopwords } from '@zbsearch/stopwords/english'

export const SEARCH_LIMIT = 10

export const PLAIN_SEARCH_TERM = 'Legend of Zelda'
export const FILTER_SEARCH_TERM = 'Super Hero'
export const COMPLEX_SEARCH_TERM = 'classic run gun, action game focused on boss battles'

export const stopWordTokenizer = {
  stopWords: stopwords
}

export const stopWordSet = new Set(stopwords)

// Sort indexes are disabled so insert benchmarks compare index construction,
// not optional sort-structure maintenance that text-only libraries do not perform.
export const databaseSortConfig = {
  unsortableProperties: ['title', 'description', 'rating']
}

export const searchParams = {
  plain: { term: PLAIN_SEARCH_TERM, limit: SEARCH_LIMIT, threshold: 0 },
  filters: { term: FILTER_SEARCH_TERM, where: { rating: { gte: 4 } }, limit: SEARCH_LIMIT },
  complex: {
    term: COMPLEX_SEARCH_TERM,
    where: { rating: { gte: 4 }, genres: { containsAll: ['Shooter'] } },
    limit: SEARCH_LIMIT
  }
}

export function tokenizeSearchTerm(term) {
  return term
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !stopWordSet.has(token))
}

export function toSearchRecord(record, id) {
  return {
    id,
    content: `${record.title} ${record.description}`,
    ...record
  }
}
