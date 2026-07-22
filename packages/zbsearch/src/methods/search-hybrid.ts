import type {
  AnyZBSearch,
  TypedDocument,
  SearchParamsHybrid,
  Results,
  TokenScore,
  Result,
  HybridWeights
} from '../types.js'
import { getNanosecondsTime, formatNanoseconds, removeVectorsFromHits } from '../utils.js'
import { getFacets } from '../components/facets.js'
import { getGroups } from '../components/groups.js'
import { fetchDocuments } from './fetch-documents.js'
import { innerFullTextSearch } from './search-fulltext.js'
import { innerVectorSearch } from './search-vector.js'
import { runAfterSearch, runBeforeSearch } from '../components/hooks.js'
import { applyPinningRules } from '../components/pinning-manager.js'

export function innerHybridSearch<T extends AnyZBSearch, ResultDocument = TypedDocument<T>>(
  zbsearch: T,
  params: SearchParamsHybrid<T, ResultDocument>,
  language?: string
) {
  const fullTextIDs = innerFullTextSearch(zbsearch, params, language)
  const vectorIDs = innerVectorSearch(zbsearch, params, language)

  const hybridWeights = params.hybridWeights
  return mergeAndRankResults(fullTextIDs, vectorIDs, params.term ?? '', hybridWeights)
}

export function hybridSearch<T extends AnyZBSearch, ResultDocument = TypedDocument<T>>(
  zbsearch: T,
  params: SearchParamsHybrid<T, ResultDocument>,
  language?: string
): Results<ResultDocument> | Promise<Results<ResultDocument>> {
  const timeStart = getNanosecondsTime()

  function performSearchLogic(): Results<ResultDocument> {
    let uniqueTokenScores = innerHybridSearch(zbsearch, params, language)

    // Apply pinning rules after merging results but before pagination
    uniqueTokenScores = applyPinningRules(zbsearch, zbsearch.data.pinning, uniqueTokenScores, params.term)

    let facetsResults: any
    const shouldCalculateFacets = params.facets && Object.keys(params.facets).length > 0
    if (shouldCalculateFacets) {
      facetsResults = getFacets(zbsearch, uniqueTokenScores, params.facets!)
    }

    let groups: any
    if (params.groupBy) {
      groups = getGroups<T, ResultDocument>(zbsearch, uniqueTokenScores, params.groupBy)
    }

    const offset = params.offset ?? 0
    const limit = params.limit ?? 10

    const results = fetchDocuments(zbsearch, uniqueTokenScores, offset, limit).filter(Boolean)

    const timeEnd = getNanosecondsTime()

    const returningResults = {
      count: uniqueTokenScores.length,
      elapsed: {
        raw: Number(timeEnd - timeStart),
        formatted: formatNanoseconds(timeEnd - timeStart)
      },
      hits: results as Result<ResultDocument>[],
      ...(facetsResults ? { facets: facetsResults } : {}),
      ...(groups ? { groups } : {})
    }

    const includeVectors = params.includeVectors ?? false
    if (!includeVectors) {
      const vectorProperties = Object.keys(zbsearch.data.index.vectorIndexes)
      removeVectorsFromHits(returningResults, vectorProperties)
    }

    return returningResults
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

  return performSearchLogic()
}

function extractScore(token: TokenScore) {
  return token[1]
}

function normalizeScore(score: number, maxScore: number) {
  return score / maxScore
}

function hybridScoreBuilder(textWeight: number, vectorWeight: number) {
  return (textScore: number, vectorScore: number) => textScore * textWeight + vectorScore * vectorWeight
}

function mergeAndRankResults(
  textResults: TokenScore[],
  vectorResults: TokenScore[],
  query: string,
  hybridWeights: HybridWeights | undefined
) {
  const maxTextScore = Math.max(...textResults.map(extractScore))
  const maxVectorScore = Math.max(...vectorResults.map(extractScore))
  const hasHybridWeights = hybridWeights && hybridWeights.text && hybridWeights.vector

  const { text: textWeight, vector: vectorWeight } = hasHybridWeights ? hybridWeights : getQueryWeights(query)
  const mergedResults = new Map()

  const textResultsLength = textResults.length
  const hybridScore = hybridScoreBuilder(textWeight, vectorWeight)
  for (let i = 0; i < textResultsLength; i++) {
    const [id, score] = textResults[i]
    const normalizedScore = normalizeScore(score, maxTextScore)
    const hybridScoreValue = hybridScore(normalizedScore, 0)
    mergedResults.set(id, hybridScoreValue)
  }

  const vectorResultsLength = vectorResults.length
  for (let i = 0; i < vectorResultsLength; i++) {
    const [resultId, score] = vectorResults[i]
    const normalizedScore = normalizeScore(score, maxVectorScore)
    const existingRes = mergedResults.get(resultId) ?? 0
    mergedResults.set(resultId, existingRes + hybridScore(0, normalizedScore))
  }

  return [...mergedResults].sort((a, b) => b[1] - a[1])
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getQueryWeights(query: string): HybridWeights {
  // In the next versions of ZBSearch, we will ship a plugin containing a ML model to adjust the weights
  // based on whether the query is keyword-focused, conceptual, etc.
  // For now, we just return a fixed value.
  return {
    text: 0.5,
    vector: 0.5
  }
}
