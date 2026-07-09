import type { AnyZBSearch, Results, SearchParamsVector, TypedDocument, Result } from '../types.js'
import type { InternalDocumentID } from '../components/internal-document-id-store.js'
import { getNanosecondsTime, formatNanoseconds, sortTokenScorePredicate, removeVectorsFromHits } from '../utils.js'
import { getFacets } from '../components/facets.js'
import { createError } from '../errors.js'
import { getGroups } from '../components/groups.js'
import { Language } from '../index.js'
import { runBeforeSearch, runAfterSearch } from '../components/hooks.js'
import { DEFAULT_SIMILARITY } from '../trees/vector.js'
import { applyPinningRules } from '../components/pinning-manager.js'
import { fetchDocuments } from './fetch-documents.js'

export function innerVectorSearch<T extends AnyZBSearch, ResultDocument = TypedDocument<T>>(
  zbsearch: T,
  params: Pick<SearchParamsVector<T, ResultDocument>, 'vector' | 'similarity' | 'where'>,
  language: Language | undefined
) {
  const vector = params.vector

  if (vector && (!('value' in vector) || !('property' in vector))) {
    throw createError('INVALID_VECTOR_INPUT', Object.keys(vector).join(', '))
  }

  const vectorIndex = zbsearch.data.index.vectorIndexes[vector!.property]
  if (!vectorIndex) {
    throw createError('UNKNOWN_VECTOR_PROPERTY', vector!.property)
  }

  const vectorSize = vectorIndex.node.size

  if (vector?.value.length !== vectorSize) {
    if (vector?.property === undefined || vector?.value.length === undefined) {
      throw createError('INVALID_INPUT_VECTOR', 'undefined', vectorSize, 'undefined')
    }
    throw createError('INVALID_INPUT_VECTOR', vector.property, vectorSize, vector.value.length)
  }

  const index = zbsearch.data.index
  let whereFiltersIDs: Set<InternalDocumentID> | undefined
  const hasFilters = Object.keys(params.where ?? {}).length > 0
  if (hasFilters) {
    whereFiltersIDs = zbsearch.index.searchByWhereClause(index, zbsearch.tokenizer, params.where!, language)
  }

  return vectorIndex.node.find(vector.value as Float32Array, params.similarity ?? DEFAULT_SIMILARITY, whereFiltersIDs)
}

export function searchVector<T extends AnyZBSearch, ResultDocument = TypedDocument<T>>(
  zbsearch: T,
  params: SearchParamsVector<T, ResultDocument>,
  language: Language = 'english'
): Results<ResultDocument> | Promise<Results<ResultDocument>> {
  const timeStart = getNanosecondsTime()

  function performSearchLogic(): Results<ResultDocument> {
    let results = innerVectorSearch(zbsearch, params, language).sort(sortTokenScorePredicate)

    // Apply pinning rules after sorting but before pagination
    results = applyPinningRules(zbsearch, zbsearch.data.pinning, results, undefined)

    let facetsResults: any = []

    const shouldCalculateFacets = params.facets && Object.keys(params.facets).length > 0
    if (shouldCalculateFacets) {
      const facets = getFacets(zbsearch, results, params.facets!)
      facetsResults = facets
    }

    const vectorProperty = params.vector!.property
    const includeVectors = params.includeVectors ?? false
    const limit = params.limit ?? 10
    const offset = params.offset ?? 0
    const hits = fetchDocuments(zbsearch, results, offset, limit).filter(Boolean)

    let groups: any = []

    if (params.groupBy) {
      groups = getGroups<T, ResultDocument>(zbsearch, results, params.groupBy)
    }

    const timeEnd = getNanosecondsTime()
    const elapsedTime = timeEnd - timeStart

    const searchResult: Results<ResultDocument> = {
      count: results.length,
      hits: hits as Result<ResultDocument>[],
      elapsed: {
        raw: Number(elapsedTime),
        formatted: formatNanoseconds(elapsedTime)
      },
      ...(facetsResults ? { facets: facetsResults } : {}),
      ...(groups ? { groups } : {})
    }

    if (!includeVectors) {
      removeVectorsFromHits(searchResult, [vectorProperty])
    }

    return searchResult
  }

  async function executeSearchAsync(): Promise<Results<ResultDocument>> {
    if (zbsearch.beforeSearch) {
      await runBeforeSearch(zbsearch.beforeSearch, zbsearch, params, language)
    }

    const results = performSearchLogic()

    if (zbsearch.afterSearch) {
      await runAfterSearch(zbsearch.afterSearch, zbsearch, params, language, results as any)
    }

    return results
  }

  const asyncNeeded = zbsearch.beforeSearch?.length || zbsearch.afterSearch?.length

  if (asyncNeeded) {
    return executeSearchAsync()
  }

  // Sync path
  return performSearchLogic()
}
