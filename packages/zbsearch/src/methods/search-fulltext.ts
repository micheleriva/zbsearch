import { getFacets } from '../components/facets.js'
import { getGroups } from '../components/groups.js'
import { runAfterSearch, runBeforeSearch } from '../components/hooks.js'
import { getInternalDocumentId } from '../components/internal-document-id-store.js'
import { searchByGeoWhereClause } from '../components/index.js'
import { applyPinningRules } from '../components/pinning-manager.js'
import { Language } from '../components/tokenizer/languages.js'
import { createError } from '../errors.js'
import type {
  AnyZBSearch,
  BM25Params,
  CustomSorterFunctionItem,
  ElapsedTime,
  Results,
  SearchParamsFullText,
  TokenScore,
  TypedDocument
} from '../types.js'
import { getNanosecondsTime, removeVectorsFromHits, sortTokenScorePredicate } from '../utils.js'
import { count } from './docs.js'
import { fetchDocuments, fetchDocumentsWithDistinct } from './fetch-documents.js'

export function innerFullTextSearch<T extends AnyZBSearch>(
  zbsearch: T,
  params: Pick<
    SearchParamsFullText<T>,
    'term' | 'properties' | 'where' | 'exact' | 'tolerance' | 'boost' | 'relevance' | 'threshold'
  >,
  language: Language | undefined
) {
  const { term, properties } = params

  const index = zbsearch.data.index
  // Get searchable string properties
  let propertiesToSearch = zbsearch.caches['propertiesToSearch'] as string[]
  if (!propertiesToSearch) {
    const propertiesToSearchWithTypes = zbsearch.index.getSearchablePropertiesWithTypes(index)

    propertiesToSearch = zbsearch.index.getSearchableProperties(index)
    propertiesToSearch = propertiesToSearch.filter((prop: string) =>
      propertiesToSearchWithTypes[prop].startsWith('string')
    )

    zbsearch.caches['propertiesToSearch'] = propertiesToSearch
  }

  if (properties && properties !== '*') {
    for (const prop of properties) {
      if (!propertiesToSearch.includes(prop as string)) {
        throw createError('UNKNOWN_INDEX', prop as string, propertiesToSearch.join(', '))
      }
    }

    propertiesToSearch = propertiesToSearch.filter((prop: string) => (properties as string[]).includes(prop))
  }

  // If filters are enabled, we need to get the IDs of the documents that match the filters.
  const hasFilters = Object.keys(params.where ?? {}).length > 0
  let whereFiltersIDs: Set<number> | undefined
  if (hasFilters) {
    whereFiltersIDs = zbsearch.index.searchByWhereClause(index, zbsearch.tokenizer, params.where!, language)
  }

  let uniqueDocsIDs: TokenScore[]
  // We need to perform the search if:
  // - we have a search term
  // - or we have properties to search
  //   in this case, we need to return all the documents that contains at least one of the given properties
  const threshold = params.threshold !== undefined && params.threshold !== null ? params.threshold : 1

  if (term || properties) {
    const docsCount = count(zbsearch)
    uniqueDocsIDs = zbsearch.index.search(
      index,
      term || '',
      zbsearch.tokenizer,
      language,
      propertiesToSearch,
      params.exact || false,
      params.tolerance || 0,
      params.boost || {},
      applyDefault(params.relevance),
      docsCount,
      whereFiltersIDs,
      threshold
    )

    // When exact is true and we have a term, filter results to only include documents
    // where the original text contains the exact search term (case-sensitive).
    // This is a highly requested feature and although ZBSearch is not case-sensitive by design,
    // this is a reasonable compromise.
    if (params.exact && term) {
      const searchTerms = term.trim().split(/\s+/)
      const exactRegexes = searchTerms.map((searchTerm) => new RegExp(`\\b${escapeRegex(searchTerm)}\\b`))
      uniqueDocsIDs = uniqueDocsIDs.filter(([docId]) => {
        const doc = zbsearch.documentsStore.get(zbsearch.data.docs, docId)
        if (!doc) return false

        for (const prop of propertiesToSearch) {
          const propValue = getPropValue(doc, prop)
          if (typeof propValue === 'string') {
            const hasAllTerms = exactRegexes.every((regex) => regex.test(propValue))
            if (hasAllTerms) {
              return true
            }
          }
        }
        return false
      })
    }
  } else {
    // Check if this is a geosearch-only query first
    if (hasFilters) {
      const geoResults = searchByGeoWhereClause(index, params.where!)
      if (geoResults) {
        // This is a geosearch-only query with distance scoring
        uniqueDocsIDs = geoResults
      } else {
        // Regular filter query without search term
        const docIds = whereFiltersIDs ? Array.from(whereFiltersIDs) : []
        uniqueDocsIDs = docIds.map((k) => [+k, 0] as TokenScore)
      }
    } else {
      // No search term and no filters - return all documents
      const docIds = Object.keys(zbsearch.documentsStore.getAll(zbsearch.data.docs))
      uniqueDocsIDs = docIds.map((k) => [+k, 0] as TokenScore)
    }
  }

  return uniqueDocsIDs
}

// Helper function to escape regex special characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Helper function to get nested property value
function getPropValue(obj: any, path: string): any {
  const keys = path.split('.')
  let value = obj
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key]
    } else {
      return undefined
    }
  }
  return value
}

export function fullTextSearch<T extends AnyZBSearch, ResultDocument = TypedDocument<T>>(
  zbsearch: T,
  params: SearchParamsFullText<T, ResultDocument>,
  language?: string
): Results<ResultDocument> | Promise<Results<ResultDocument>> {
  const timeStart = getNanosecondsTime()

  function performSearchLogic(): Results<ResultDocument> {
    const vectorProperties = Object.keys(zbsearch.data.index.vectorIndexes)
    const shouldCalculateFacets = params.facets && Object.keys(params.facets).length > 0
    const { limit = 10, offset = 0, distinctOn, includeVectors = false } = params
    const isPreflight = params.preflight === true

    let uniqueDocsArray = innerFullTextSearch(zbsearch, params, language)

    if (params.sortBy) {
      if (typeof params.sortBy === 'function') {
        const ids = uniqueDocsArray.map(([id]) => id)
        const docs = zbsearch.documentsStore.getMultiple(zbsearch.data.docs, ids)
        const docsWithIdAndScore: CustomSorterFunctionItem<ResultDocument>[] = docs.map((d, i) => [
          uniqueDocsArray[i][0],
          uniqueDocsArray[i][1],
          d!
        ])
        docsWithIdAndScore.sort(params.sortBy)
        uniqueDocsArray = docsWithIdAndScore.map(([id, score]) => [id, score])
      } else {
        uniqueDocsArray = zbsearch.sorter
          .sortBy(zbsearch.data.sorting, uniqueDocsArray, params.sortBy)
          .map(([id, score]) => [getInternalDocumentId(zbsearch.internalDocumentIDStore, id), score])
      }
    } else {
      uniqueDocsArray = uniqueDocsArray.sort(sortTokenScorePredicate)
    }

    // Apply pinning rules after sorting but before pagination
    uniqueDocsArray = applyPinningRules(zbsearch, zbsearch.data.pinning, uniqueDocsArray, params.term)

    let results
    if (!isPreflight) {
      results = distinctOn
        ? fetchDocumentsWithDistinct(zbsearch, uniqueDocsArray, offset, limit, distinctOn)
        : fetchDocuments(zbsearch, uniqueDocsArray, offset, limit)
    }

    const searchResult: Results<ResultDocument> = {
      elapsed: {
        formatted: '',
        raw: 0
      },
      hits: [],
      count: uniqueDocsArray.length
    }

    if (typeof results !== 'undefined') {
      searchResult.hits = results.filter(Boolean)
      if (!includeVectors) {
        removeVectorsFromHits(searchResult, vectorProperties)
      }
    }

    if (shouldCalculateFacets) {
      const facets = getFacets(zbsearch, uniqueDocsArray, params.facets!)
      searchResult.facets = facets
    }

    if (params.groupBy) {
      searchResult.groups = getGroups<T, ResultDocument>(zbsearch, uniqueDocsArray, params.groupBy)
    }

    searchResult.elapsed = zbsearch.formatElapsedTime(getNanosecondsTime() - timeStart) as ElapsedTime

    return searchResult
  }

  async function executeSearchAsync() {
    if (zbsearch.beforeSearch) {
      await runBeforeSearch(zbsearch.beforeSearch, zbsearch, params, language)
    }

    const searchResult = performSearchLogic()

    if (zbsearch.afterSearch) {
      await runAfterSearch(zbsearch.afterSearch, zbsearch, params, language, searchResult)
    }

    return searchResult
  }

  const asyncNeeded = zbsearch.beforeSearch?.length || zbsearch.afterSearch?.length
  if (asyncNeeded) {
    return executeSearchAsync()
  }

  return performSearchLogic()
}

export const defaultBM25Params: BM25Params = {
  k: 1.2,
  b: 0.75,
  d: 0.5
}
function applyDefault(bm25Relevance?: BM25Params): Required<BM25Params> {
  const r = bm25Relevance ?? {}
  r.k = r.k ?? defaultBM25Params.k
  r.b = r.b ?? defaultBM25Params.b
  r.d = r.d ?? defaultBM25Params.d
  return r as Required<BM25Params>
}
