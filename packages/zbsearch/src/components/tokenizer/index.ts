import type { Optional } from '../../types.js'
import { createError } from '../../errors.js'
import { Stemmer, Tokenizer, DefaultTokenizerConfig } from '../../types.js'
import { replaceDiacritics } from './diacritics.js'
import {
  Language,
  MULTILINGUAL_LANGUAGE,
  SPLITTERS,
  SUPPORTED_LANGUAGES,
  LANGUAGES_WITH_SIGNIFICANT_DIACRITICS,
  SupportedLanguage
} from './languages.js'
import { stemmer as english } from './english-stemmer.js'

// Upper bound on the number of entries kept in `normalizationCache`. The cache is keyed by
// language, property and surface form, so indexing a large corpus with many distinct tokens
// would otherwise grow it without limit. Once full, the oldest entry is evicted for each new one.
export const DEFAULT_NORMALIZATION_CACHE_SIZE = 50_000

export interface DefaultTokenizer extends Tokenizer {
  language: Language
  stemmer?: Stemmer
  tokenizeSkipProperties: Set<string>
  stemmerSkipProperties: Set<string>
  stopWords?: string[]
  stopWordsSet?: Set<string>
  allowDuplicates: boolean
  normalizationCache: Map<string, string>
  normalizationCacheSize?: number
  normalizeToken(this: DefaultTokenizer, prop: Optional<string>, token: string, withCache: Optional<boolean>): string
}

function cacheNormalizedToken(tokenizer: DefaultTokenizer, key: string, token: string): void {
  const cache = tokenizer.normalizationCache
  const maxSize = tokenizer.normalizationCacheSize ?? DEFAULT_NORMALIZATION_CACHE_SIZE

  if (maxSize <= 0) {
    return
  }

  if (cache.size >= maxSize && !cache.has(key)) {
    // Map iterates in insertion order, so the first key is the oldest entry.
    cache.delete(cache.keys().next().value!)
  }

  cache.set(key, token)
}

export function normalizeToken(
  this: DefaultTokenizer,
  prop: Optional<string>,
  token: string,
  withCache: boolean = true
): string {
  // Custom tokenizers may call this without a property: an omitted property is the empty property.
  const property = prop ?? ''
  // The property length is part of the key so that the boundary between property and token is
  // unambiguous: property `a` with the unsplit token `x:y` and property `a:x` with token `y` would
  // otherwise share the key `english:a:x:y`, and a cache hit would index the wrong token.
  const key = `${this.language}:${property.length}:${property}:${token}`

  if (withCache && this.normalizationCache.has(key)) {
    return this.normalizationCache.get(key)!
  }

  // Fold diacritics BEFORE stopword lookup and stemming, so that accented and unaccented surface forms of the same word converge (e.g. Portuguese "pão"/"pao" must neither stem differently nor be treated as a stopword only in one of its two spellings, depending on how the user typed it). `stopWordsSet` is folded to match, see `createTokenizer`.
  if (!LANGUAGES_WITH_SIGNIFICANT_DIACRITICS.has(this.language)) {
    token = replaceDiacritics(token)
  }

  // Remove stopwords if enabled
  if (this.stopWordsSet?.has(token)) {
    if (withCache) {
      cacheNormalizedToken(this, key, '')
    }
    return ''
  }

  // Apply stemming if enabled
  if (this.stemmer && !this.stemmerSkipProperties.has(property)) {
    token = this.stemmer(token)
  }
  if (withCache) {
    cacheNormalizedToken(this, key, token)
  }
  return token
}

/* c8 ignore next 10 */
function trim(text: string[]): string[] {
  while (text[text.length - 1] === '') {
    text.pop()
  }
  while (text[0] === '') {
    text.shift()
  }
  return text
}

// Fallback for runtimes without Intl.Segmenter: maximal runs of Unicode letters/numbers.
// Less precise than UAX #29 word segmentation (e.g. it keeps "l'amour" whole instead of splitting on the apostrophe) but script-agnostic.
const UNICODE_WORD = /[\p{L}\p{N}]+/gu

let multilingualSegmenter: Intl.Segmenter | undefined

function splitMultilingual(input: string): string[] {
  if (multilingualSegmenter === undefined && typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    multilingualSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
  }

  if (multilingualSegmenter) {
    const parts: string[] = []
    for (const { segment, isWordLike } of multilingualSegmenter.segment(input)) {
      if (isWordLike) {
        parts.push(segment.toLowerCase())
      }
    }
    return parts
  }

  return input.toLowerCase().match(UNICODE_WORD) ?? []
}

function tokenize(
  this: DefaultTokenizer,
  input: string,
  language?: string,
  prop?: string,
  withCache: boolean = true
): string[] {
  if (language && language !== this.language) {
    throw createError('LANGUAGE_NOT_SUPPORTED', language)
  }

  /* c8 ignore next 3 */
  if (typeof input !== 'string') {
    return [input]
  }

  const property = prop ?? ''

  if (prop && this.tokenizeSkipProperties.has(prop)) {
    const token = this.normalizeToken(property, input, withCache)
    return token ? [token] : []
  }

  const parts =
    this.language === MULTILINGUAL_LANGUAGE
      ? splitMultilingual(input)
      : input.toLowerCase().split(SPLITTERS[this.language as SupportedLanguage])
  const tokens: string[] = []
  const partsLength = parts.length

  for (let i = 0; i < partsLength; i++) {
    const part = parts[i]!
    if (!part) continue
    const token = this.normalizeToken(property, part, withCache)
    if (token) {
      tokens.push(token)
    }
  }

  const trimTokens = trim(tokens)

  if (!this.allowDuplicates) {
    return Array.from(new Set(trimTokens))
  }

  return trimTokens
}

export function createTokenizer(config: DefaultTokenizerConfig = {}): DefaultTokenizer {
  if (!config.language) {
    config.language = 'english'
  } else if (config.language !== MULTILINGUAL_LANGUAGE && !SUPPORTED_LANGUAGES.includes(config.language)) {
    throw createError('LANGUAGE_NOT_SUPPORTED', config.language)
  }

  // Handle stemming - It is disabled by default
  let stemmer: Optional<Stemmer>

  if (config.stemming || (config.stemmer && !('stemming' in config))) {
    if (config.stemmer) {
      if (typeof config.stemmer !== 'function') {
        throw createError('INVALID_STEMMER_FUNCTION_TYPE')
      }

      stemmer = config.stemmer
    } else {
      if (config.language === 'english') {
        stemmer = english
      } else {
        throw createError('MISSING_STEMMER', config.language)
      }
    }
  }

  if (
    config.normalizationCacheSize !== undefined &&
    (!Number.isInteger(config.normalizationCacheSize) || config.normalizationCacheSize < 0)
  ) {
    throw createError('INVALID_NORMALIZATION_CACHE_SIZE', String(config.normalizationCacheSize))
  }

  // Handle stopwords
  let stopWords: Optional<string[]>

  if (config.stopWords !== false) {
    stopWords = []

    if (Array.isArray(config.stopWords)) {
      stopWords = config.stopWords
    } else if (typeof config.stopWords === 'function') {
      stopWords = config.stopWords(stopWords)
    } else if (config.stopWords) {
      throw createError('CUSTOM_STOP_WORDS_MUST_BE_FUNCTION_OR_ARRAY')
    }

    // Make sure stopWords is just an array of strings
    if (!Array.isArray(stopWords)) {
      throw createError('CUSTOM_STOP_WORDS_MUST_BE_FUNCTION_OR_ARRAY')
    }

    for (const s of stopWords) {
      if (typeof s !== 'string') {
        throw createError('CUSTOM_STOP_WORDS_MUST_BE_FUNCTION_OR_ARRAY')
      }
    }
  }

  // Create the tokenizer
  const tokenizer: DefaultTokenizer = {
    tokenize,
    language: config.language,
    stemmer,
    stemmerSkipProperties: new Set(config.stemmerSkipProperties ? [config.stemmerSkipProperties].flat() : []),
    tokenizeSkipProperties: new Set(config.tokenizeSkipProperties ? [config.tokenizeSkipProperties].flat() : []),
    stopWords,
    stopWordsSet: stopWords
      ? new Set(
          LANGUAGES_WITH_SIGNIFICANT_DIACRITICS.has(config.language) ? stopWords : stopWords.map(replaceDiacritics)
        )
      : undefined,
    allowDuplicates: config.allowDuplicates ?? true,
    normalizeToken,
    normalizationCache: new Map(),
    normalizationCacheSize: config.normalizationCacheSize ?? DEFAULT_NORMALIZATION_CACHE_SIZE
  }

  tokenizer.tokenize = tokenize.bind(tokenizer)
  tokenizer.normalizeToken = normalizeToken

  return tokenizer
}
