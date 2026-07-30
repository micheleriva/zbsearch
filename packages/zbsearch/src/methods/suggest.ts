import { InternalDocumentID } from '../components/internal-document-id-store.js'
import { createError } from '../errors.js'
import type {
  AnyZBSearch,
  ElapsedTime,
  Suggestion,
  SuggestionDocumentMatch,
  SuggestionQueryToken,
  SuggestParams,
  SuggestResults
} from '../types.js'
import { getNanosecondsTime } from '../utils.js'
import { count } from './docs.js'
import { applyDefault, getPropertiesToSearch } from './search-fulltext.js'

/**
 * Returns the ranked query completions for a partially typed term, to build an autocomplete
 * dropdown without having to dedupe and rank the terms of full search results.
 *
 * Suggestions are indexed words, so they go through the same text analysis as the documents:
 * with a stemmer configured, the suggested words are stems.
 *
 * @example
 * const result = suggest(db, { term: 'noise can' })
 *
 * // {
 * //   elapsed: { raw: 181208, formatted: '181μs' },
 * //   count: 2,
 * //   suggestions: [
 * //     { suggestion: 'noise cancelling', terms: ['noise', 'cancelling'], score: 4.2, count: 3 },
 * //     { suggestion: 'noise cancellation', terms: ['noise', 'cancellation'], score: 1.1, count: 1 }
 * //   ]
 * // }
 */
export function suggest<T extends AnyZBSearch>(
  zbsearch: T,
  params: SuggestParams<T>,
  language?: string
): SuggestResults {
  const timeStart = getNanosecondsTime()

  const { term, limit = 10, offset = 0, threshold = 0, prefix = true, tolerance = 0 } = params

  const searchSuggestions = zbsearch.index.searchSuggestions

  if (typeof searchSuggestions !== 'function') {
    throw createError('SUGGEST_NOT_SUPPORTED')
  }

  const index = zbsearch.data.index
  const propertiesToSearch = getPropertiesToSearch(zbsearch, params.properties)
  const tokens = zbsearch.tokenizer.tokenize(term ?? '', language)

  if (!tokens.length || !propertiesToSearch.length) {
    return emptyResults(zbsearch, timeStart)
  }

  const lastToken = tokens.length - 1
  const queryTokens: SuggestionQueryToken[] = tokens.map((token, i) => ({
    token,
    exact: !tolerance && (prefix === false || (prefix === 'last' && i < lastToken)),
    tolerance,
    completion: i === lastToken
  }))

  const hasFilters = Object.keys(params.where ?? {}).length > 0
  const whereFiltersIDs = hasFilters
    ? zbsearch.index.searchByWhereClause(index, zbsearch.tokenizer, params.where!, language)
    : undefined

  if (hasFilters && !whereFiltersIDs!.size) {
    return emptyResults(zbsearch, timeStart)
  }

  const matches = searchSuggestions(
    index,
    queryTokens,
    propertiesToSearch,
    params.boost ?? {},
    applyDefault(params.relevance),
    count(zbsearch),
    whereFiltersIDs
  )

  const suggestions = aggregateSuggestions(matches, tokens, threshold)

  return {
    elapsed: zbsearch.formatElapsedTime(getNanosecondsTime() - timeStart) as ElapsedTime,
    count: suggestions.length,
    suggestions: suggestions.slice(offset, offset + limit)
  }
}

/**
 * Alias of {@link suggest}, for familiarity with other search engines.
 */
export const autoSuggest = suggest

function emptyResults<T extends AnyZBSearch>(zbsearch: T, timeStart: bigint): SuggestResults {
  return {
    elapsed: zbsearch.formatElapsedTime(getNanosecondsTime() - timeStart) as ElapsedTime,
    count: 0,
    suggestions: []
  }
}

function aggregateSuggestions(
  matches: Map<InternalDocumentID, SuggestionDocumentMatch>,
  tokens: string[],
  threshold: number
): Suggestion[] {
  const suggestions = new Map<string, Suggestion>()
  const partialMatches: SuggestionDocumentMatch[] = []

  for (const match of matches.values()) {
    if (match.matchedTokens < tokens.length) {
      if (threshold > 0) {
        partialMatches.push(match)
      }
      continue
    }

    addSuggestions(suggestions, match, tokens)
  }

  if (partialMatches.length > 0) {
    partialMatches.sort((a, b) => b.score - a.score)
    const partialsToKeep = Math.ceil(partialMatches.length * Math.min(threshold, 1))

    for (let i = 0; i < partialsToKeep; i++) {
      addSuggestions(suggestions, partialMatches[i], tokens)
    }
  }

  return Array.from(suggestions.values()).sort(
    (a, b) => b.score - a.score || b.count - a.count || (a.suggestion < b.suggestion ? -1 : 1)
  )
}

function addSuggestions(
  suggestions: Map<string, Suggestion>,
  match: SuggestionDocumentMatch,
  tokens: string[]
): void {
  const completionIndex = tokens.length - 1
  const context = match.words.map((word, i) => word ?? tokens[i])
  let contextScore = 0

  for (let i = 0; i < completionIndex; i++) {
    contextScore += match.wordScores[i]
  }

  if (!match.completions?.size) {
    addSuggestion(suggestions, context, contextScore + match.wordScores[completionIndex])
    return
  }

  for (const [word, score] of match.completions) {
    const terms = context.slice()
    terms[completionIndex] = word
    addSuggestion(suggestions, terms, contextScore + score)
  }
}

function addSuggestion(suggestions: Map<string, Suggestion>, terms: string[], score: number): void {
  const phrase = terms.join(' ')
  const existing = suggestions.get(phrase)

  if (existing) {
    existing.score += score
    existing.count++
    return
  }

  suggestions.set(phrase, { suggestion: phrase, terms, score, count: 1 })
}
