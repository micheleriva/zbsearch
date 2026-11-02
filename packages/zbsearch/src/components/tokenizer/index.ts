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

// One long-lived key iterator per cache, used to find the oldest entry. A fresh `cache.keys()` per
// eviction would have to step over the slots of every entry deleted since the Map last compacted
// its storage, which made evictions quadratic on large corpora. A live iterator stays just past the
// entries it has already handed out (and that were then evicted), and still sees entries added later.
const evictionCursors = new WeakMap<Map<string, string>, Iterator<string>>()

function cacheNormalizedToken(tokenizer: DefaultTokenizer, key: string, token: string): void {
  const cache = tokenizer.normalizationCache
  const maxSize = tokenizer.normalizationCacheSize ?? DEFAULT_NORMALIZATION_CACHE_SIZE

  if (maxSize <= 0) {
    return
  }

  if (cache.size >= maxSize && !cache.has(key)) {
    // Map iterates in insertion order, so the next key of the cursor is the oldest entry.
    let cursor = evictionCursors.get(cache)
    let oldest = cursor?.next()
    if (!oldest || oldest.done) {
      cursor = cache.keys()
      evictionCursors.set(cache, cursor)
      oldest = cursor.next()
    }
    cache.delete(oldest.value!)
  }

  cache.set(key, token)
}

// The cache key is `${language}:${property.length}:${property}:${token}`. The property length is
// part of the key so that the boundary between property and token is unambiguous: property `a`
// with the unsplit token `x:y` and property `a:x` with token `y` would otherwise share the key
// `english:a:x:y`, and a cache hit would index the wrong token. Everything before the token only
// depends on the property, so `tokenize` builds that prefix once per call instead of once per token.
function cacheKeyPrefix(language: string, property: string): string {
  return `${language}:${property.length}:${property}:`
}

function shouldStem(tokenizer: DefaultTokenizer, property: string): boolean {
  return !!tokenizer.stemmer && !tokenizer.stemmerSkipProperties.has(property)
}

// `stem` and `fold` only depend on the tokenizer and the property, so `tokenize` computes them once
// per call rather than once per token. `keyPrefix` is undefined when the cache must not be used.
function normalize(
  tokenizer: DefaultTokenizer,
  token: string,
  stem: boolean,
  fold: boolean,
  keyPrefix: Optional<string>
): string {
  // Only stemming is expensive enough to be worth caching: folding diacritics and looking the token
  // up in the stopword set cost less than building and hashing the cache key, so tokens that are not
  // stemmed skip the cache altogether.
  const key = keyPrefix !== undefined ? keyPrefix + token : undefined

  if (key !== undefined) {
    const cached = tokenizer.normalizationCache.get(key)
    if (cached !== undefined) {
      return cached
    }
  }

  // Fold diacritics BEFORE stopword lookup and stemming, so that accented and unaccented surface forms of the same word converge (e.g. Portuguese "pão"/"pao" must neither stem differently nor be treated as a stopword only in one of its two spellings, depending on how the user typed it). `stopWordsSet` is folded to match, see `createTokenizer`.
  if (fold) {
    token = replaceDiacritics(token)
  }

  // Remove stopwords if enabled
  if (tokenizer.stopWordsSet?.has(token)) {
    if (key !== undefined) {
      cacheNormalizedToken(tokenizer, key, '')
    }
    return ''
  }

  // Apply stemming if enabled
  if (stem) {
    token = tokenizer.stemmer!(token)
  }
  if (key !== undefined) {
    cacheNormalizedToken(tokenizer, key, token)
  }
  return token
}

export function normalizeToken(
  this: DefaultTokenizer,
  prop: Optional<string>,
  token: string,
  withCache: boolean = true
): string {
  // Custom tokenizers may call this without a property: an omitted property is the empty property.
  const property = prop ?? ''
  const stem = shouldStem(this, property)
  return normalize(
    this,
    token,
    stem,
    !LANGUAGES_WITH_SIGNIFICANT_DIACRITICS.has(this.language),
    stem && withCache ? cacheKeyPrefix(this.language, property) : undefined
  )
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

// Fallback for runtimes without Intl.Segmenter: maximal runs of Unicode letters, combining marks and numbers.
// Less precise than UAX #29 word segmentation (e.g. it keeps "l'amour" whole instead of splitting on the apostrophe) but script-agnostic.
const UNICODE_WORD = /[\p{L}\p{M}\p{N}]+/gu

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

// Hyphens and apostrophes are word characters in several splitters so that "t-shirt" and "it's"
// stay whole. At the edges of a token they are punctuation instead ("-blockers", "'quoted'", "rock-")
// and would keep the word from matching, so they are trimmed off.
const EDGE_PUNCTUATION = /^['-]+|['-]+$/g

function trimEdgePunctuation(part: string): string {
  const first = part.charCodeAt(0)
  const last = part.charCodeAt(part.length - 1)
  // 39 is `'`, 45 is `-`. Most parts have neither, so skip the regex for them.
  if (first === 39 || first === 45 || last === 39 || last === 45) {
    return part.replace(EDGE_PUNCTUATION, '')
  }
  return part
}

// Splitting with the language's `SPLITTERS` regex is slow because of its Unicode property classes,
// so `splitWords` scans the string by hand and asks the regex only once per distinct character:
// `WORD_CHARS[language][code]` is 0 while unknown, 1 for a word character and 2 for a separator.
// Each answer comes from testing the character against the splitter itself, so the split is always
// the same as the regex one. Strings with surrogates fall back to the regex, as there a code unit
// is not a whole character.
const WORD_CHARS: Partial<Record<string, Uint8Array>> = {}

function classifyChar(language: string, table: Uint8Array, code: number): number {
  const splitter = SPLITTERS[language as SupportedLanguage]!
  // `split` leaves the splitter's `lastIndex` alone, so the shared global regex can be used here.
  return (table[code] = String.fromCharCode(code).split(splitter).length > 1 ? 2 : 1)
}

// Returns the words of `input` with edge punctuation already trimmed (see `trimEdgePunctuation`)
// and empty words dropped, or undefined if `input` contains a surrogate. With `fold`, words with
// diacritics are passed through `replaceDiacritics`, so that most words skip it.
function splitWords(input: string, language: string, fold: boolean): string[] | undefined {
  const table = (WORD_CHARS[language] ??= new Uint8Array(65536))
  const words: string[] = []
  const length = input.length
  let start = -1
  let foldable = false

  for (let i = 0; i <= length; i++) {
    const code = i < length ? input.charCodeAt(i) : -1
    if (code >= 0xd800 && code <= 0xdfff) {
      return undefined
    }

    if (code !== -1) {
      let kind = table[code]!
      if (kind === 0) kind = classifyChar(language, table, code)
      if (kind === 1) {
        if (start === -1) start = i
        // 192 is the first code point `replaceDiacritics` may change.
        if (code >= 192) foldable = true
        continue
      }
    }

    if (start !== -1) {
      let end = i
      // 39 is `'`, 45 is `-`.
      while (start < end && (input.charCodeAt(start) === 39 || input.charCodeAt(start) === 45)) start++
      while (end > start && (input.charCodeAt(end - 1) === 39 || input.charCodeAt(end - 1) === 45)) end--
      if (start < end) {
        const word = input.slice(start, end)
        words.push(fold && foldable ? replaceDiacritics(word) : word)
      }
      start = -1
      foldable = false
    }
  }

  return words
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

  // Unless a custom `normalizeToken` was installed, normalize directly with a cache key prefix built
  // once. Only then may `splitWords` fold diacritics itself: a custom one must see the words as split.
  const direct = this.normalizeToken === normalizeToken
  const stem = direct && shouldStem(this, property)
  let fold = direct && !LANGUAGES_WITH_SIGNIFICANT_DIACRITICS.has(this.language)
  const keyPrefix = stem && withCache ? cacheKeyPrefix(this.language, property) : undefined

  let parts: string[] | undefined
  // Whether `parts` still needs `trimEdgePunctuation` and diacritics folding.
  let raw = true
  if (this.language === MULTILINGUAL_LANGUAGE) {
    parts = splitMultilingual(input)
  } else {
    const lowercased = input.toLowerCase()
    parts = splitWords(lowercased, this.language, fold)
    if (parts) {
      raw = false
      fold = false
    } else {
      parts = lowercased.split(SPLITTERS[this.language as SupportedLanguage])
    }
  }

  const tokens: string[] = []
  const partsLength = parts.length

  for (let i = 0; i < partsLength; i++) {
    const part = raw ? trimEdgePunctuation(parts[i]!) : parts[i]!
    if (!part) continue
    const token = direct ? normalize(this, part, stem, fold, keyPrefix) : this.normalizeToken(property, part, withCache)
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
