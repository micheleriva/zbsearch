import { createError } from '../errors.js'
import type { InsertOptions } from '../methods/insert.js'
import { AVLTree } from '../trees/avl.js'
import type { Point as BKDGeoPoint, Point } from '../trees/bkd.js'
import { BKDTree } from '../trees/bkd.js'
import { BoolNode } from '../trees/bool.js'
import { FlatTree } from '../trees/flat.js'
import { FindResult, RadixNodeJSON, RadixTree } from '../trees/radix.js'
import { VectorType } from '../trees/vector.js'
import { deserializeVectorIndex, resolveVectorIndexFactory } from '../trees/vector-index.js'
import type {
  AnyIndexStore,
  AnyZBSearch,
  ArraySearchableType,
  BM25Params,
  ComparisonOperator,
  EnumArrComparisonOperator,
  EnumComparisonOperator,
  GeosearchOperation,
  GeosearchPolygonOperator,
  GeosearchRadiusOperator,
  IIndex,
  ScalarSearchableType,
  SearchableType,
  SearchableValue,
  SuggestionDocumentMatch,
  SuggestionQueryToken,
  Tokenizer,
  TokenScore,
  WhereCondition
} from '../types.js'
import { convertDistanceToMeters, setIntersection, yieldToEventLoop, uniqueTokens } from '../utils.js'
import { BM25 } from './algorithms.js'
import { getInnerType, getVectorSize, isArrayType, isVectorType } from './defaults.js'
import { levenshtein } from './levenshtein.js'
import {
  DocumentID,
  getInternalDocumentId,
  InternalDocumentID,
  InternalDocumentIDStore
} from './internal-document-id-store.js'

export type FrequencyMap = {
  [property: string]: {
    [documentID: InternalDocumentID]:
      | {
          [token: string]: number
        }
      | undefined
  }
}

export type TreeType = 'AVL' | 'Radix' | 'Bool' | 'Flat' | 'BKD'

export type TTree<T = TreeType, N = unknown> = {
  type: T
  node: N
  isArray: boolean
}

export type Tree =
  | TTree<'Radix', RadixTree>
  | TTree<'AVL', AVLTree<number, InternalDocumentID>>
  | TTree<'Bool', BoolNode<InternalDocumentID>>
  | TTree<'Flat', FlatTree>
  | TTree<'BKD', BKDTree>

export interface Index extends AnyIndexStore {
  sharedInternalDocumentStore: InternalDocumentIDStore
  indexes: Record<string, Tree>
  // vectorIndexes: Record<string, TTree<'Vector', VectorIndex>>
  searchableProperties: string[]
  searchablePropertiesWithTypes: Record<string, SearchableType>
  frequencies: FrequencyMap
  tokenOccurrences: Record<string, Record<string, number>>
  avgFieldLength: Record<string, number>
  fieldLengths: Record<string, Record<InternalDocumentID, number | undefined>>
}

export function insertDocumentScoreParameters(
  index: Index,
  prop: string,
  id: DocumentID,
  tokens: string[],
  docsCount: number,
  internalId?: InternalDocumentID
): InternalDocumentID {
  const resolvedInternalId = internalId ?? getInternalDocumentId(index.sharedInternalDocumentStore, id)

  index.avgFieldLength[prop] = ((index.avgFieldLength[prop] ?? 0) * (docsCount - 1) + tokens.length) / docsCount
  index.fieldLengths[prop][resolvedInternalId] = tokens.length
  index.frequencies[prop][resolvedInternalId] = {}

  return resolvedInternalId
}

export function insertTokenScoreParameters(
  index: Index,
  prop: string,
  id: DocumentID,
  tokens: string[],
  token: string,
  internalId?: InternalDocumentID
): void {
  let tokenFrequency = 0
  const tokenLength = tokens.length

  for (let i = 0; i < tokenLength; i++) {
    if (tokens[i] === token) {
      tokenFrequency++
    }
  }

  const resolvedInternalId = internalId ?? getInternalDocumentId(index.sharedInternalDocumentStore, id)
  const tf = tokenLength > 0 ? tokenFrequency / tokenLength : 0

  index.frequencies[prop][resolvedInternalId]![token] = tf
}

export function insertRadixTokens(
  index: Index,
  prop: string,
  node: RadixTree,
  id: DocumentID,
  internalId: InternalDocumentID,
  tokens: string[],
  docsCount: number
): void {
  insertDocumentScoreParameters(index, prop, id, tokens, docsCount, internalId)
  const frequencies = index.frequencies[prop][internalId]!
  const tokenLength = tokens.length

  for (let i = 0; i < tokenLength; i++) {
    const token = tokens[i]!
    if (Object.hasOwn(frequencies, token)) {
      frequencies[token] += 1
    } else {
      frequencies[token] = 1
      node.insert(token, internalId)
    }
  }
}

export function removeDocumentScoreParameters(index: Index, prop: string, id: DocumentID, docsCount: number): void {
  const internalId = getInternalDocumentId(index.sharedInternalDocumentStore, id)

  if (docsCount > 1) {
    index.avgFieldLength[prop] =
      (index.avgFieldLength[prop] * docsCount - index.fieldLengths[prop][internalId]!) / (docsCount - 1)
  } else {
    index.avgFieldLength[prop] = undefined as unknown as number
  }
  index.fieldLengths[prop][internalId] = undefined
  index.frequencies[prop][internalId] = undefined
}

export function removeTokenScoreParameters(_index: Index, _prop: string, _token: string): void {
  // Document frequency is derived from radix postings at search time.
}

export function create<T extends AnyZBSearch, TSchema extends T['schema']>(
  zbsearch: T,
  sharedInternalDocumentStore: T['internalDocumentIDStore'],
  schema: TSchema,
  index?: Index,
  prefix = ''
): Index {
  if (!index) {
    index = {
      sharedInternalDocumentStore,
      indexes: {},
      vectorIndexes: {},
      searchableProperties: [],
      searchablePropertiesWithTypes: {},
      frequencies: {},
      tokenOccurrences: {},
      avgFieldLength: {},
      fieldLengths: {}
    }
  }

  for (const [prop, type] of Object.entries<SearchableType>(schema)) {
    const path = `${prefix}${prefix ? '.' : ''}${prop}`

    if (typeof type === 'object' && !Array.isArray(type)) {
      // Nested
      create(zbsearch, sharedInternalDocumentStore, type, index, path)
      continue
    }

    addSearchablePropertyToIndex(zbsearch, index, path, type)
  }

  return index
}

export function addSearchablePropertyToIndex<T extends AnyZBSearch>(
  zbsearch: T,
  index: Index,
  path: string,
  type: SearchableType
): void {
  if (isVectorType(type)) {
    const factory = resolveVectorIndexFactory(path, zbsearch.indexes)
    index.searchableProperties.push(path)
    index.searchablePropertiesWithTypes[path] = type
    index.vectorIndexes[path] = {
      type: 'Vector',
      node: factory({ dim: getVectorSize(type), property: path }),
      isArray: false
    }
    return
  }

  const isArray = /\[/.test(type as string)
  switch (type) {
    case 'boolean':
    case 'boolean[]':
      index.indexes[path] = { type: 'Bool', node: new BoolNode(), isArray }
      break
    case 'number':
    case 'number[]':
      index.indexes[path] = { type: 'AVL', node: new AVLTree<number, InternalDocumentID>(0, []), isArray }
      break
    case 'string':
    case 'string[]':
      index.indexes[path] = { type: 'Radix', node: new RadixTree(), isArray }
      index.avgFieldLength[path] = 0
      index.frequencies[path] = {}
      index.tokenOccurrences[path] = {}
      index.fieldLengths[path] = {}
      break
    case 'enum':
    case 'enum[]':
      index.indexes[path] = { type: 'Flat', node: new FlatTree(), isArray }
      break
    case 'geopoint':
      index.indexes[path] = { type: 'BKD', node: new BKDTree(), isArray }
      break
    default:
      throw createError('INVALID_SCHEMA_TYPE', Array.isArray(type) ? 'array' : type, path)
  }

  index.searchableProperties.push(path)
  index.searchablePropertiesWithTypes[path] = type
}

function insertScalarValue(
  _implementation: IIndex<Index>,
  index: Index,
  prop: string,
  id: DocumentID,
  internalId: InternalDocumentID,
  value: SearchableValue,
  language: string | undefined,
  tokenizer: Tokenizer,
  docsCount: number,
  options?: InsertOptions
): void {
  const { type, node } = index.indexes[prop]
  switch (type) {
    case 'Bool': {
      node[value ? 'true' : 'false'].add(internalId)
      break
    }
    case 'AVL': {
      const avlRebalanceThreshold = options?.avlRebalanceThreshold ?? 1
      node.insert(value as number, internalId, avlRebalanceThreshold)
      break
    }
    case 'Radix': {
      const tokens = tokenizer.tokenize(value as string, language, prop)
      insertRadixTokens(index, prop, node as RadixTree, id, internalId, tokens, docsCount)
      break
    }
    case 'Flat': {
      node.insert(value as ScalarSearchableType, internalId)
      break
    }
    case 'BKD': {
      node.insert(value as unknown as BKDGeoPoint, [internalId])
      break
    }
  }
}

export function insert(
  implementation: IIndex<Index>,
  index: Index,
  prop: string,
  id: DocumentID,
  internalId: InternalDocumentID,
  value: SearchableValue,
  schemaType: SearchableType,
  language: string | undefined,
  tokenizer: Tokenizer,
  docsCount: number,
  options?: InsertOptions
): void {
  if (isVectorType(schemaType)) {
    return insertVector(index, prop, value as number[] | Float32Array, id, internalId)
  }

  if (!isArrayType(schemaType)) {
    return insertScalarValue(
      implementation,
      index,
      prop,
      id,
      internalId,
      value,
      language,
      tokenizer,
      docsCount,
      options
    )
  }

  const elements = value as Array<string | number | boolean>
  const elementsLength = elements.length
  for (let i = 0; i < elementsLength; i++) {
    insertScalarValue(
      implementation,
      index,
      prop,
      id,
      internalId,
      elements[i]!,
      language,
      tokenizer,
      docsCount,
      options
    )
  }
}

export function insertVector(
  index: AnyIndexStore,
  prop: string,
  value: number[] | VectorType,
  id: DocumentID,
  internalDocumentId: InternalDocumentID
): void {
  index.vectorIndexes[prop].node.add(internalDocumentId, value)
}

function removeScalar(
  implementation: IIndex<Index>,
  index: Index,
  prop: string,
  id: DocumentID,
  internalId: InternalDocumentID,
  value: SearchableValue,
  schemaType: ScalarSearchableType,
  language: string | undefined,
  tokenizer: Tokenizer,
  docsCount: number
): boolean {
  if (isVectorType(schemaType)) {
    index.vectorIndexes[prop].node.remove(internalId)
    return true
  }

  const { type, node } = index.indexes[prop]
  switch (type) {
    case 'AVL': {
      node.removeDocument(value as number, internalId)
      return true
    }
    case 'Bool': {
      node[value ? 'true' : 'false'].delete(internalId)
      return true
    }
    case 'Radix': {
      const tokens = tokenizer.tokenize(value as string, language, prop)

      implementation.removeDocumentScoreParameters(index, prop, id, docsCount)

      for (const token of tokens) {
        implementation.removeTokenScoreParameters(index, prop, token)
        node.removeDocumentByWord(token, internalId)
      }

      return true
    }
    case 'Flat': {
      node.removeDocument(internalId, value as ScalarSearchableType)
      return true
    }
    case 'BKD': {
      node.removeDocByID(value as unknown as BKDGeoPoint, internalId)
      return false
    }
  }
}

export function remove(
  implementation: IIndex<Index>,
  index: Index,
  prop: string,
  id: DocumentID,
  internalId: InternalDocumentID,
  value: SearchableValue,
  schemaType: SearchableType,
  language: string | undefined,
  tokenizer: Tokenizer,
  docsCount: number
): boolean {
  if (!isArrayType(schemaType)) {
    return removeScalar(
      implementation,
      index,
      prop,
      id,
      internalId,
      value,
      schemaType as ScalarSearchableType,
      language,
      tokenizer,
      docsCount
    )
  }

  const innerSchemaType = getInnerType(schemaType as ArraySearchableType)

  const elements = value as Array<string | number | boolean>
  const elementsLength = elements.length
  for (let i = 0; i < elementsLength; i++) {
    removeScalar(
      implementation,
      index,
      prop,
      id,
      internalId,
      elements[i],
      innerSchemaType,
      language,
      tokenizer,
      docsCount
    )
  }

  return true
}

export function calculateResultScores(
  index: Index,
  prop: string,
  term: string,
  ids: InternalDocumentID[],
  docsCount: number,
  bm25Relevance: Required<BM25Params>,
  resultsMap: Map<number, number>,
  boostPerProperty: number,
  whereFiltersIDs: Set<InternalDocumentID> | undefined,
  keywordMatchesMap?: Map<InternalDocumentID, Map<string, number>>
) {
  const avgFieldLength = index.avgFieldLength[prop]
  const fieldLengths = index.fieldLengths[prop]
  const zbsearchFrequencies = index.frequencies[prop]
  const termOccurrences = getTermDocumentFrequency(index, prop, term)

  // Calculate TF-IDF value for each term, in each document, for each index.
  const documentIDsLength = ids.length
  for (let k = 0; k < documentIDsLength; k++) {
    const internalId = ids[k]
    if (whereFiltersIDs && !whereFiltersIDs.has(internalId)) {
      continue
    }

    if (keywordMatchesMap) {
      // Track keyword matches per property
      if (!keywordMatchesMap.has(internalId)) {
        keywordMatchesMap.set(internalId, new Map())
      }
      const propertyMatches = keywordMatchesMap.get(internalId)!
      propertyMatches.set(prop, (propertyMatches.get(prop) || 0) + 1)
    }

    const tf = zbsearchFrequencies?.[internalId]?.[term] ?? 0

    const bm25 = BM25(tf, termOccurrences, docsCount, fieldLengths[internalId]!, avgFieldLength, bm25Relevance)

    if (resultsMap.has(internalId)) {
      resultsMap.set(internalId, resultsMap.get(internalId)! + bm25 * boostPerProperty)
    } else {
      resultsMap.set(internalId, bm25 * boostPerProperty)
    }
  }
}

// The scores of a search, accumulated per internal document ID in dense typed arrays instead of a Map. The arrays
// are reused by every search on the same index; `stamps[id] === stamp` tells the documents scored by the current one.
type ScoreAccumulator = {
  scores: Float64Array
  stamps: Uint32Array
  stamp: number
  // The scored IDs, in the order they were first scored (the order a Map would iterate them in)
  ids: InternalDocumentID[]
  // The filter set of the current search and, once looking IDs up in it has cost as much as marking all of its IDs,
  // `filterMarks[id] === stamp` for each of them
  filter: Set<InternalDocumentID> | undefined
  filterLookups: number
  filterMarked: boolean
  filterMarks: Uint32Array
  // Keyword matches per document within one property, allocated on first use: `matchCounts[id]` is current when
  // `matchMarks[id] === matchStamp`, and `matchedIds` lists those IDs. `fullMatchMarks[id] === stamp` for the
  // documents that matched all the keywords in at least one property.
  matchCounts: Uint32Array | undefined
  matchMarks: Uint32Array | undefined
  matchStamp: number
  matchedIds: InternalDocumentID[]
  fullMatchMarks: Uint32Array | undefined
}

const scoreAccumulators = new WeakMap<Index, ScoreAccumulator>()

function getScoreAccumulator(index: Index): ScoreAccumulator {
  let accumulator = scoreAccumulators.get(index)

  if (!accumulator) {
    const size = index.sharedInternalDocumentStore.internalIdToId.length + 1
    accumulator = {
      scores: new Float64Array(size),
      stamps: new Uint32Array(size),
      stamp: 0,
      ids: [],
      filter: undefined,
      filterLookups: 0,
      filterMarked: false,
      filterMarks: new Uint32Array(size),
      matchCounts: undefined,
      matchMarks: undefined,
      matchStamp: 0,
      matchedIds: [],
      fullMatchMarks: undefined
    }
    scoreAccumulators.set(index, accumulator)
  }

  if (accumulator.stamp === 0xffffffff) {
    accumulator.stamps.fill(0)
    accumulator.filterMarks.fill(0)
    accumulator.fullMatchMarks?.fill(0)
    accumulator.stamp = 0
  }

  accumulator.stamp++
  accumulator.ids = []
  accumulator.filter = undefined
  accumulator.filterLookups = 0
  accumulator.filterMarked = false

  return accumulator
}

function resizeUint32Array(array: Uint32Array, size: number): Uint32Array {
  const resized = new Uint32Array(size)
  resized.set(array)
  return resized
}

function growScoreAccumulator(accumulator: ScoreAccumulator, internalId: InternalDocumentID): void {
  const size = Math.max(internalId + 1, accumulator.scores.length * 2)
  const scores = new Float64Array(size)
  scores.set(accumulator.scores)
  accumulator.scores = scores
  accumulator.stamps = resizeUint32Array(accumulator.stamps, size)
  accumulator.filterMarks = resizeUint32Array(accumulator.filterMarks, size)

  if (accumulator.matchCounts && accumulator.matchMarks && accumulator.fullMatchMarks) {
    accumulator.matchCounts = resizeUint32Array(accumulator.matchCounts, size)
    accumulator.matchMarks = resizeUint32Array(accumulator.matchMarks, size)
    accumulator.fullMatchMarks = resizeUint32Array(accumulator.fullMatchMarks, size)
  }
}

// Starts counting keyword matches per document for a new property
function startPropertyMatches(accumulator: ScoreAccumulator): void {
  if (!accumulator.matchCounts || !accumulator.matchMarks || !accumulator.fullMatchMarks) {
    const size = accumulator.scores.length
    accumulator.matchCounts = new Uint32Array(size)
    accumulator.matchMarks = new Uint32Array(size)
    accumulator.fullMatchMarks = new Uint32Array(size)
  }

  if (accumulator.matchStamp === 0xffffffff) {
    accumulator.matchMarks.fill(0)
    accumulator.matchStamp = 0
  }

  accumulator.matchStamp++
  accumulator.matchedIds = []
}

// Marks the documents that matched `keywordsCount` keywords in the property started last
function markFullMatches(accumulator: ScoreAccumulator, keywordsCount: number): void {
  const { matchedIds, stamp } = accumulator
  const matchCounts = accumulator.matchCounts!
  const fullMatchMarks = accumulator.fullMatchMarks!
  const matchedIdsLength = matchedIds.length

  for (let i = 0; i < matchedIdsLength; i++) {
    const id = matchedIds[i]
    if (matchCounts[id] === keywordsCount) {
      fullMatchMarks[id] = stamp
    }
  }
}

// Returns the marks of `filter` once `lookups` more lookups would bring the lookups made so far to its size, or
// undefined while looking IDs up in the Set is still cheaper than marking all of them.
function getFilterMarks(
  accumulator: ScoreAccumulator,
  filter: Set<InternalDocumentID>,
  lookups: number
): Uint32Array | undefined {
  if (accumulator.filter !== filter) {
    if (accumulator.filter !== undefined) {
      // Only one filter set per search can be marked
      return undefined
    }
    accumulator.filter = filter
  }

  if (accumulator.filterMarked) {
    return accumulator.filterMarks
  }

  accumulator.filterLookups += lookups
  if (accumulator.filterLookups < filter.size) {
    return undefined
  }

  const stamp = accumulator.stamp
  for (const id of filter) {
    if (id >= accumulator.filterMarks.length) {
      growScoreAccumulator(accumulator, id)
    }
    accumulator.filterMarks[id] = stamp
  }
  accumulator.filterMarked = true

  return accumulator.filterMarks
}

function getAccumulatedScores(accumulator: ScoreAccumulator): TokenScore[] {
  const { ids, scores } = accumulator
  const idsLength = ids.length
  const results: TokenScore[] = new Array(idsLength)

  for (let i = 0; i < idsLength; i++) {
    const id = ids[i]
    results[i] = [id, scores[id]]
  }

  return results
}

// Adds the BM25 score of `term` to `accumulator` for each of `ids` (and, with `trackMatches`, counts the match per
// document, see startPropertyMatches). Same scores as calculateResultScores, bit for bit: it mirrors BM25() from
// algorithms.ts operation by operation, but computes the per-term factors (IDF, k + 1, 1 - b) once instead of once
// per document.
function scoreTermIds(
  index: Index,
  prop: string,
  term: string,
  ids: InternalDocumentID[],
  docsCount: number,
  bm25Relevance: Required<BM25Params>,
  accumulator: ScoreAccumulator,
  boostPerProperty: number,
  whereFiltersIDs: Set<InternalDocumentID> | undefined,
  trackMatches = false
): void {
  const avgFieldLength = index.avgFieldLength[prop]
  const fieldLengths = index.fieldLengths[prop]
  const zbsearchFrequencies = index.frequencies[prop]
  const matchingCount = getTermDocumentFrequency(index, prop, term)

  const { k, b, d } = bm25Relevance
  const idf = Math.log(1 + (docsCount - matchingCount + 0.5) / (matchingCount + 0.5))
  const kPlusOne = k + 1
  const oneMinusB = 1 - b

  const documentIDsLength = ids.length
  const filterMarks = whereFiltersIDs ? getFilterMarks(accumulator, whereFiltersIDs, documentIDsLength) : undefined

  const { stamp, ids: scoredIds, matchStamp, matchedIds } = accumulator
  let { scores, stamps, matchCounts, matchMarks } = accumulator

  // Calculate TF-IDF value for each term, in each document, for each index.
  for (let i = 0; i < documentIDsLength; i++) {
    const internalId = ids[i]
    if (whereFiltersIDs && (filterMarks ? filterMarks[internalId] !== stamp : !whereFiltersIDs.has(internalId))) {
      continue
    }

    const tf = zbsearchFrequencies?.[internalId]?.[term] ?? 0
    const bm25 = (idf * (d + tf * kPlusOne)) / (tf + k * (oneMinusB + (b * fieldLengths[internalId]!) / avgFieldLength))

    if (stamps[internalId] === stamp) {
      scores[internalId] += bm25 * boostPerProperty
    } else {
      if (internalId >= stamps.length) {
        growScoreAccumulator(accumulator, internalId)
        ;({ scores, stamps, matchCounts, matchMarks } = accumulator)
      }

      stamps[internalId] = stamp
      scores[internalId] = bm25 * boostPerProperty
      scoredIds.push(internalId)
    }

    // The ID is within the arrays' bounds now
    if (trackMatches) {
      if (matchMarks![internalId] === matchStamp) {
        matchCounts![internalId]++
      } else {
        matchMarks![internalId] = matchStamp
        matchCounts![internalId] = 1
        matchedIds.push(internalId)
      }
    }
  }
}

// Collects the IDs of the documents in `searchResult`, keeping only those in `within` when given (an intersection
// that never materializes the IDs outside of it).
function collectFindResultIds(
  searchResult: FindResult,
  within: Set<InternalDocumentID> | undefined
): Set<InternalDocumentID> {
  const ids = new Set<InternalDocumentID>()

  for (const word in searchResult) {
    const docIds = searchResult[word]
    const docIdsLength = docIds.length
    for (let i = 0; i < docIdsLength; i++) {
      const id = docIds[i]
      if (!within || within.has(id)) {
        ids.add(id)
      }
    }
  }

  return ids
}

function byScoreDescending(a: TokenScore, b: TokenScore): number {
  return b[1] - a[1]
}

const TYPED_SCORE_SORT_MIN_LENGTH = 64

// Returns `results` ordered exactly as the stable `results.sort(byScoreDescending)` would: by score, highest first,
// with equal scores in their original order. Small inputs are insertion sorted. Larger ones sort the (negated) scores
// as a Float64Array, natively and without a comparator, then place each result, in input order, at the next free slot
// of its score's run.
function sortByScoreDescending(results: TokenScore[]): TokenScore[] {
  const length = results.length

  for (let i = 0; i < length; i++) {
    const score = results[i][1]
    // NaN compares as equal to everything: leave that to the comparator sort
    if (score !== score) {
      return results.sort(byScoreDescending)
    }
  }

  if (length < TYPED_SCORE_SORT_MIN_LENGTH) {
    // Without NaNs, `b[1] - a[1] > 0` is `b[1] > a[1]`
    for (let i = 1; i < length; i++) {
      const result = results[i]
      const score = result[1]
      let j = i - 1

      while (j >= 0 && score > results[j][1]) {
        results[j + 1] = results[j]
        j--
      }

      results[j + 1] = result
    }

    return results
  }

  const keys = new Float64Array(length)
  for (let i = 0; i < length; i++) {
    keys[i] = -results[i][1]
  }

  const sortedKeys = keys.slice().sort()
  const takenSlots = new Uint32Array(length)
  const sorted: TokenScore[] = new Array(length)

  for (let i = 0; i < length; i++) {
    const key = keys[i]

    // First slot of this score's run (-0 and 0 share one, as they compare as equal)
    let low = 0
    let high = length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (sortedKeys[mid] < key) {
        low = mid + 1
      } else {
        high = mid
      }
    }

    sorted[low + takenSlots[low]++] = results[i]
  }

  return sorted
}

// Prefix-expanded words (the query token is a strict prefix of the indexed word) score at a demoted weight so that documents matching the full query token always outrank partial, prefix-only matches.
const PREFIX_EXPANSION_SCORE_DEMOTION = 0.5

export function bm25Idf(documentFrequency: number, docsCount: number): number {
  return Math.log(1 + (docsCount - documentFrequency + 0.5) / (documentFrequency + 0.5))
}

// Demotion factor for a prefix-expanded word. Beyond the flat demotion, the word's effective IDF is capped at the exact token's IDF (Lucene blends term statistics across expansions the same way): a rare expansion must not outscore the exact token just because it appears in fewer documents.
export function prefixExpansionDemotion(tokenDf: number | undefined, wordDf: number, docsCount: number): number {
  if (tokenDf === undefined) {
    return PREFIX_EXPANSION_SCORE_DEMOTION
  }

  const wordIdf = bm25Idf(wordDf, docsCount)

  if (!wordIdf) {
    return PREFIX_EXPANSION_SCORE_DEMOTION
  }

  return PREFIX_EXPANSION_SCORE_DEMOTION * Math.min(1, bm25Idf(tokenDf, docsCount) / wordIdf)
}

function searchThresholdZero(
  index: Index,
  tokens: string[],
  propertiesToSearch: string[],
  exact: boolean,
  tolerance: number,
  boost: Record<string, number>,
  relevance: Required<BM25Params>,
  docsCount: number,
  whereFiltersIDs: Set<InternalDocumentID> | undefined
): TokenScore[] {
  const candidateIds = new Set<InternalDocumentID>()
  const matchingProperties: string[] = []
  // The radix search results of each matching property, one per token
  const matchingSearchResults: FindResult[][] = []

  for (const prop of propertiesToSearch) {
    if (!(prop in index.indexes)) {
      continue
    }

    const tree = index.indexes[prop]
    if (tree.type !== 'Radix') {
      throw createError('WRONG_SEARCH_PROPERTY_TYPE', prop)
    }

    const boostPerProperty = boost[prop] ?? 1
    if (boostPerProperty <= 0) {
      throw createError('INVALID_BOOST_VALUE', boostPerProperty)
    }

    const tokenLength = tokens.length
    const searchResults: FindResult[] = new Array(tokenLength)
    const postingsCounts: number[] = new Array(tokenLength)
    let hasEmptyToken = false

    for (let i = 0; i < tokenLength; i++) {
      const searchResult = (tree.node as RadixTree).find({ term: tokens[i], exact, tolerance })
      searchResults[i] = searchResult

      let postingsCount = 0
      for (const word in searchResult) {
        postingsCount += searchResult[word].length
      }

      if (!postingsCount) {
        hasEmptyToken = true
        break
      }
      postingsCounts[i] = postingsCount
    }

    if (hasEmptyToken) {
      continue
    }

    // Intersect starting from the token with the fewest postings, so that the sets stay as small as possible
    const tokenOrder = Array.from(tokens.keys()).sort((a, b) => postingsCounts[a] - postingsCounts[b])
    let propertyIntersection: Set<InternalDocumentID> | undefined
    for (let i = 0; i < tokenLength; i++) {
      propertyIntersection = collectFindResultIds(searchResults[tokenOrder[i]], propertyIntersection)

      if (!propertyIntersection.size) {
        break
      }
    }

    if (!propertyIntersection || !propertyIntersection.size) {
      continue
    }

    matchingProperties.push(prop)
    matchingSearchResults.push(searchResults)

    for (const id of propertyIntersection) {
      if (!whereFiltersIDs || whereFiltersIDs.has(id)) {
        candidateIds.add(id)
      }
    }
  }

  if (!candidateIds.size) {
    return []
  }

  const accumulator = getScoreAccumulator(index)

  const matchingPropertiesLength = matchingProperties.length
  for (let p = 0; p < matchingPropertiesLength; p++) {
    const prop = matchingProperties[p]
    const searchResults = matchingSearchResults[p]
    const boostPerProperty = boost[prop] ?? 1
    const tokenLength = tokens.length

    for (let i = 0; i < tokenLength; i++) {
      const token = tokens[i]
      const searchResult = searchResults[i]

      const words = Object.keys(searchResult)
      for (let j = 0; j < words.length; j++) {
        const word = words[j]

        // candidateIds is already restricted to whereFiltersIDs, so it is the only filter needed here.
        scoreTermIds(
          index,
          prop,
          word,
          searchResult[word],
          docsCount,
          relevance,
          accumulator,
          boostPerProperty *
            (word === token
              ? 1
              : prefixExpansionDemotion(searchResult[token]?.length, searchResult[word]!.length, docsCount)),
          candidateIds
        )
      }
    }
  }

  return sortByScoreDescending(getAccumulatedScores(accumulator))
}

export function search(
  index: Index,
  term: string,
  tokenizer: Tokenizer,
  language: string | undefined,
  propertiesToSearch: string[],
  exact: boolean,
  tolerance: number,
  boost: Record<string, number>,
  relevance: Required<BM25Params>,
  docsCount: number,
  whereFiltersIDs: Set<InternalDocumentID> | undefined,
  threshold = 0,
  prefix = true
): TokenScore[] {
  const tokens = uniqueTokens(tokenizer.tokenize(term, language))
  const keywordsCount = tokens.length || 1

  if (!tokens.length && !term) {
    tokens.push('')
  }

  const radixExact = term ? exact || (!prefix && !tolerance) : false

  if (!threshold && tokens.length > 1) {
    return searchThresholdZero(
      index,
      tokens,
      propertiesToSearch,
      radixExact,
      tolerance,
      boost,
      relevance,
      docsCount,
      whereFiltersIDs
    )
  }

  // Per-property keyword match counts are only needed to find the documents that match all the keywords in at least
  // one property, which the threshold handling below skips when every result is returned anyway.
  const trackKeywordMatches = threshold !== 1 && !(threshold === 0 && keywordsCount === 1)
  // Track which tokens were found in the search
  const tokenFoundMap = new Map<string, boolean>()
  const accumulator = getScoreAccumulator(index)

  for (const prop of propertiesToSearch) {
    if (!(prop in index.indexes)) {
      continue
    }

    const tree = index.indexes[prop]
    const { type } = tree
    if (type !== 'Radix') {
      throw createError('WRONG_SEARCH_PROPERTY_TYPE', prop)
    }
    const boostPerProperty = boost[prop] ?? 1
    if (boostPerProperty <= 0) {
      throw createError('INVALID_BOOST_VALUE', boostPerProperty)
    }

    // Count keyword matches per document within this property
    if (trackKeywordMatches) {
      startPropertyMatches(accumulator)
    }

    // Process each token in the search term
    const tokenLength = tokens.length
    for (let i = 0; i < tokenLength; i++) {
      const token = tokens[i]
      const searchResult = tree.node.find({ term: token, exact: radixExact, tolerance })

      // See if this token was found (for threshold=0 filtering)
      const termsFound = Object.keys(searchResult)
      if (termsFound.length > 0) {
        tokenFoundMap.set(token, true)
      }

      // Process each matching term
      const termsFoundLength = termsFound.length
      for (let j = 0; j < termsFoundLength; j++) {
        const word = termsFound[j]
        const ids = searchResult[word]
        scoreTermIds(
          index,
          prop,
          word,
          ids,
          docsCount,
          relevance,
          accumulator,
          boostPerProperty *
            (word === token ? 1 : prefixExpansionDemotion(searchResult[token]?.length, ids!.length, docsCount)),
          whereFiltersIDs,
          trackKeywordMatches
        )
      }
    }

    if (trackKeywordMatches) {
      markFullMatches(accumulator, keywordsCount)
    }
  }

  // Convert to array and sort by score
  const results = sortByScoreDescending(getAccumulatedScores(accumulator))
  // Documents that have all keywords in at least one property are marked with the search's stamp
  const { fullMatchMarks, stamp } = accumulator

  if (results.length === 0) {
    return []
  }

  // If threshold is 1, return all results
  if (threshold === 1) {
    return results
  }

  // For threshold=0, check if all tokens were found
  if (threshold === 0) {
    // Quick return for single tokens - already validated
    if (keywordsCount === 1) {
      return results
    }

    // For multiple tokens, verify that ALL tokens were found
    // If any token wasn't found, return an empty result
    for (const token of tokens) {
      if (!tokenFoundMap.get(token)) {
        return []
      }
    }

    // Find documents that have all keywords in at least one property
    return results.filter(([id]) => fullMatchMarks?.[id] === stamp)
  }

  // Find documents that have all keywords in at least one property
  const fullMatches: TokenScore[] = []
  const remainingResults: TokenScore[] = []
  const resultsLength = results.length
  for (let i = 0; i < resultsLength; i++) {
    const result = results[i]
    if (fullMatchMarks?.[result[0]] === stamp) {
      fullMatches.push(result)
    } else {
      remainingResults.push(result)
    }
  }

  // If we have full matches and threshold < 1, return full matches plus a percentage of partial matches
  if (fullMatches.length > 0) {
    const additionalResults = Math.ceil(remainingResults.length * threshold)
    return [...fullMatches, ...remainingResults.slice(0, additionalResults)]
  }

  // If no full matches, return all results
  return results
}

export function searchSuggestions(
  index: Index,
  queryTokens: SuggestionQueryToken[],
  propertiesToSearch: string[],
  boost: Record<string, number>,
  relevance: Required<BM25Params>,
  docsCount: number,
  whereFiltersIDs: Set<InternalDocumentID> | undefined
): Map<InternalDocumentID, SuggestionDocumentMatch> {
  const matches = new Map<InternalDocumentID, SuggestionDocumentMatch>()
  const tokenCount = queryTokens.length

  for (const prop of propertiesToSearch) {
    if (!(prop in index.indexes)) {
      continue
    }

    const tree = index.indexes[prop]
    if (tree.type !== 'Radix') {
      throw createError('WRONG_SEARCH_PROPERTY_TYPE', prop)
    }

    const boostPerProperty = boost[prop] ?? 1
    if (boostPerProperty <= 0) {
      throw createError('INVALID_BOOST_VALUE', boostPerProperty)
    }

    const avgFieldLength = index.avgFieldLength[prop]
    const fieldLengths = index.fieldLengths[prop]
    const frequencies = index.frequencies[prop]

    for (let i = 0; i < tokenCount; i++) {
      const { token, exact, tolerance, completion } = queryTokens[i]
      const wholeWordWithTolerance = exact && tolerance > 0
      const searchResult = (tree.node as RadixTree).find({
        term: token,
        exact: exact && !wholeWordWithTolerance,
        tolerance
      })
      const words = Object.keys(searchResult)
      const tokenDocumentFrequency = searchResult[token]?.length

      for (let j = 0; j < words.length; j++) {
        const word = words[j]
        const ids = searchResult[word]
        if (!ids.length) {
          continue
        }

        if (
          wholeWordWithTolerance &&
          word !== token &&
          (Math.abs(word.length - token.length) > tolerance || levenshtein(token, word) > tolerance)
        ) {
          continue
        }

        const wordBoost =
          boostPerProperty *
          (word === token ? 1 : prefixExpansionDemotion(tokenDocumentFrequency, ids.length, docsCount))
        const termOccurrences = getTermDocumentFrequency(index, prop, word)

        for (let k = 0; k < ids.length; k++) {
          const internalId = ids[k]
          if (whereFiltersIDs && !whereFiltersIDs.has(internalId)) {
            continue
          }

          const tf = frequencies?.[internalId]?.[word] ?? 0
          const score =
            BM25(tf, termOccurrences, docsCount, fieldLengths[internalId]!, avgFieldLength, relevance) * wordBoost

          let match = matches.get(internalId)
          if (!match) {
            match = {
              words: new Array<string | undefined>(tokenCount).fill(undefined),
              wordScores: new Array<number>(tokenCount).fill(0),
              matchedTokens: 0,
              score: 0
            }
            matches.set(internalId, match)
          }

          match.score += score

          if (completion) {
            const completions = match.completions ?? (match.completions = new Map<string, number>())
            completions.set(word, (completions.get(word) ?? 0) + score)
          }

          if (match.words[i] === undefined || score > match.wordScores[i]) {
            if (match.words[i] === undefined) {
              match.matchedTokens++
            }
            match.words[i] = word
            match.wordScores[i] = score
          }
        }
      }
    }
  }

  return matches
}

export function searchByWhereClause<T extends AnyZBSearch>(
  index: Index,
  tokenizer: Tokenizer,
  filters: Partial<WhereCondition<T['schema']>>,
  language: string | undefined
): Set<InternalDocumentID> {
  // Handle logical operators
  if ('and' in filters && filters.and && Array.isArray(filters.and)) {
    const andFilters = filters.and
    if (andFilters.length === 0) {
      return new Set()
    }

    const results = andFilters.map((filter) => searchByWhereClause(index, tokenizer, filter, language))
    return setIntersection(...results)
  }

  if ('or' in filters && filters.or && Array.isArray(filters.or)) {
    const orFilters = filters.or
    if (orFilters.length === 0) {
      return new Set()
    }

    const union = searchByWhereClause(index, tokenizer, orFilters[0], language)
    for (let i = 1; i < orFilters.length; i++) {
      const result = searchByWhereClause(index, tokenizer, orFilters[i], language)
      for (const id of result) {
        union.add(id)
      }
    }
    return union
  }

  if ('not' in filters && filters.not) {
    const notResult = searchByWhereClause(index, tokenizer, filters.not, language)

    // All the internal document IDs that are not in the negated result
    const result = new Set<InternalDocumentID>()
    const docsCount = index.sharedInternalDocumentStore.internalIdToId.length
    for (let i = 1; i <= docsCount; i++) {
      if (!notResult.has(i)) {
        result.add(i)
      }
    }
    return result
  }

  // Handle regular property filters (existing logic)
  const filterKeys = Object.keys(filters)

  const filterKeysLength = filterKeys.length

  // The intersection order (and so the resulting Set iteration order) follows the keys order of this map,
  // which historically lists the filter keys in reverse order.
  const filtersMap: Record<string, Set<InternalDocumentID> | undefined> = {}
  for (let i = filterKeysLength - 1; i >= 0; i--) {
    filtersMap[filterKeys[i]] = undefined
  }
  // Whether the last computed set is owned by an index structure (and so must be copied before being returned)
  let isSharedSet = false

  for (const param of filterKeys) {
    const operation = filters[param]!

    if (typeof index.indexes[param] === 'undefined') {
      throw createError('UNKNOWN_FILTER_PROPERTY', param)
    }

    const { node, type, isArray } = index.indexes[param]

    if (type === 'Bool') {
      const idx = node
      filtersMap[param] = operation ? idx.true : idx.false
      isSharedSet = true
      continue
    }

    if (type === 'BKD') {
      let reqOperation: 'radius' | 'polygon'

      if ('radius' in (operation as GeosearchOperation)) {
        reqOperation = 'radius'
      } else if ('polygon' in (operation as GeosearchOperation)) {
        reqOperation = 'polygon'
      } else {
        throw new Error(`Invalid operation ${operation}`)
      }

      if (reqOperation === 'radius') {
        const {
          value,
          coordinates,
          unit = 'm',
          inside = true,
          highPrecision = false
        } = operation[reqOperation] as GeosearchRadiusOperator['radius']
        const distanceInMeters = convertDistanceToMeters(value, unit)
        const ids = node.searchByRadius(coordinates as BKDGeoPoint, distanceInMeters, inside, undefined, highPrecision)
        filtersMap[param] = addGeoResult(undefined, ids)
      } else {
        const {
          coordinates,
          inside = true,
          highPrecision = false
        } = operation[reqOperation] as GeosearchPolygonOperator['polygon']
        const ids = node.searchByPolygon(coordinates as BKDGeoPoint[], inside, undefined, highPrecision)
        filtersMap[param] = addGeoResult(undefined, ids)
      }
      isSharedSet = false

      continue
    }

    if (type === 'Radix' && (typeof operation === 'string' || Array.isArray(operation))) {
      let filteredIDs: Set<InternalDocumentID> | undefined
      for (const raw of [operation].flat()) {
        const term = tokenizer.tokenize(raw, language, param)
        for (const t of term) {
          const filteredIDsResults = node.find({ term: t, exact: true })
          filteredIDs = addFindResult(filteredIDs, filteredIDsResults)
        }
      }
      filtersMap[param] = filteredIDs
      isSharedSet = false

      continue
    }

    const operationKeys = Object.keys(operation)

    if (operationKeys.length > 1) {
      throw createError('INVALID_FILTER_OPERATION', operationKeys.length)
    }

    if (type === 'Flat') {
      filtersMap[param] = isArray
        ? node.filterArrSet(operation as EnumArrComparisonOperator)
        : node.filterSet(operation as EnumComparisonOperator)
      isSharedSet = true

      continue
    }

    if (type === 'AVL') {
      const operationOpt = operationKeys[0] as keyof ComparisonOperator
      const operationValue = (operation as ComparisonOperator)[operationOpt]
      let filteredIDs: Set<InternalDocumentID>
      isSharedSet = false

      switch (operationOpt) {
        case 'gt': {
          filteredIDs = node.greaterThan(operationValue as number, false)
          break
        }
        case 'gte': {
          filteredIDs = node.greaterThan(operationValue as number, true)
          break
        }
        case 'lt': {
          filteredIDs = node.lessThan(operationValue as number, false)
          break
        }
        case 'lte': {
          filteredIDs = node.lessThan(operationValue as number, true)
          break
        }
        case 'eq': {
          const ret = node.find(operationValue as number)
          filteredIDs = ret ?? new Set()
          isSharedSet = true
          break
        }
        case 'between': {
          const [min, max] = operationValue as number[]
          filteredIDs = node.rangeSearch(min, max)
          break
        }
        default:
          throw createError('INVALID_FILTER_OPERATION', operationOpt)
      }

      filtersMap[param] = filteredIDs
    }
  }

  const sets = Object.values(filtersMap) as Array<Set<InternalDocumentID> | undefined>
  for (let i = 0; i < sets.length; i++) {
    if (sets[i] === undefined) {
      sets[i] = new Set()
    }
  }

  if (sets.length === 1) {
    // Never hand out a Set owned by an index structure
    return isSharedSet ? new Set(sets[0]) : sets[0]!
  }

  // AND operation: calculate the intersection between all the IDs in filterMap
  return setIntersection(...(sets as Set<InternalDocumentID>[]))
}

export function getSearchableProperties(index: Index): string[] {
  return index.searchableProperties
}

export function getSearchablePropertiesWithTypes(index: Index): Record<string, SearchableType> {
  return index.searchablePropertiesWithTypes
}

function deserializeIndexEntry(rawIndex: Index['indexes'][string]): Index['indexes'][string] {
  const { node, type, isArray } = rawIndex

  switch (type) {
    case 'Radix':
      return { type: 'Radix', node: RadixTree.fromJSON(node as unknown as RadixNodeJSON), isArray }
    case 'Flat':
      return { type: 'Flat', node: FlatTree.fromJSON(node), isArray }
    case 'AVL':
      return { type: 'AVL', node: AVLTree.fromJSON(node), isArray }
    case 'BKD':
      return { type: 'BKD', node: BKDTree.fromJSON(node), isArray }
    case 'Bool':
      return { type: 'Bool', node: BoolNode.fromJSON(node), isArray }
    default:
      return rawIndex
  }
}

export function load<R = unknown>(
  sharedInternalDocumentStore: InternalDocumentIDStore,
  raw: R,
  indexesConfig?: import('../types.js').IndexesConfig
): Index {
  const {
    indexes: rawIndexes,
    vectorIndexes: rawVectorIndexes,
    searchableProperties,
    searchablePropertiesWithTypes,
    frequencies,
    tokenOccurrences,
    avgFieldLength,
    fieldLengths
  } = raw as Index

  const indexes: Index['indexes'] = {}
  const vectorIndexes: Index['vectorIndexes'] = {}

  for (const prop of Object.keys(rawIndexes)) {
    indexes[prop] = deserializeIndexEntry(rawIndexes[prop])
  }

  for (const idx of Object.keys(rawVectorIndexes)) {
    vectorIndexes[idx] = {
      type: 'Vector',
      isArray: false,
      node: deserializeVectorIndex(idx, rawVectorIndexes[idx], indexesConfig)
    }
  }

  return {
    sharedInternalDocumentStore,
    indexes,
    vectorIndexes,
    searchableProperties,
    searchablePropertiesWithTypes,
    frequencies,
    tokenOccurrences,
    avgFieldLength,
    fieldLengths
  }
}

export async function loadAsync<R = unknown>(
  sharedInternalDocumentStore: InternalDocumentIDStore,
  raw: R,
  indexesConfig?: import('../types.js').IndexesConfig
): Promise<Index> {
  const {
    indexes: rawIndexes,
    vectorIndexes: rawVectorIndexes,
    searchableProperties,
    searchablePropertiesWithTypes,
    frequencies,
    tokenOccurrences,
    avgFieldLength,
    fieldLengths
  } = raw as Index

  const indexes: Index['indexes'] = {}
  const vectorIndexes: Index['vectorIndexes'] = {}

  const props = Object.keys(rawIndexes)
  const vectorProps = Object.keys(rawVectorIndexes)

  for (let i = 0; i < props.length; i++) {
    const prop = props[i]
    indexes[prop] = deserializeIndexEntry(rawIndexes[prop])

    if (i < props.length - 1 || vectorProps.length > 0) {
      await yieldToEventLoop()
    }
  }

  for (let i = 0; i < vectorProps.length; i++) {
    const idx = vectorProps[i]
    vectorIndexes[idx] = {
      type: 'Vector',
      isArray: false,
      node: deserializeVectorIndex(idx, rawVectorIndexes[idx], indexesConfig)
    }

    if (i < vectorProps.length - 1) {
      await yieldToEventLoop()
    }
  }

  return {
    sharedInternalDocumentStore,
    indexes,
    vectorIndexes,
    searchableProperties,
    searchablePropertiesWithTypes,
    frequencies,
    tokenOccurrences,
    avgFieldLength,
    fieldLengths
  }
}

export function save<R = unknown>(index: Index): R {
  const {
    indexes,
    vectorIndexes,
    searchableProperties,
    searchablePropertiesWithTypes,
    frequencies,
    tokenOccurrences: _tokenOccurrences,
    avgFieldLength,
    fieldLengths
  } = index

  const dumpVectorIndexes: Record<string, unknown> = {}
  for (const idx of Object.keys(vectorIndexes)) {
    dumpVectorIndexes[idx] = vectorIndexes[idx].node.toJSON()
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const savedIndexes: any = {}
  for (const name of Object.keys(indexes)) {
    const { type, node, isArray } = indexes[name]
    if (type === 'Flat' || type === 'Radix' || type === 'AVL' || type === 'BKD' || type === 'Bool') {
      savedIndexes[name] = {
        type,
        node: node.toJSON(),
        isArray
      }
    } else {
      savedIndexes[name] = indexes[name]
      savedIndexes[name].node = savedIndexes[name].node.toJSON()
    }
  }

  return {
    indexes: savedIndexes,
    vectorIndexes: dumpVectorIndexes,
    searchableProperties,
    searchablePropertiesWithTypes,
    frequencies,
    tokenOccurrences: {},
    avgFieldLength,
    fieldLengths
  } as R
}

function getTermDocumentFrequency(index: Index, prop: string, term: string): number {
  const treeIndex = index.indexes[prop]
  if (treeIndex?.type === 'Radix') {
    return (treeIndex.node as RadixTree).getDocumentFrequency(term)
  }

  const stored = index.tokenOccurrences[prop]?.[term]
  return typeof stored === 'number' ? stored : 0
}

export function createIndex(): IIndex<Index> {
  return {
    create,
    insert,
    remove,
    insertDocumentScoreParameters,
    insertTokenScoreParameters,
    removeDocumentScoreParameters,
    removeTokenScoreParameters,
    calculateResultScores,
    search,
    supportsSuggestions: true,
    searchByWhereClause,
    getSearchableProperties,
    getSearchablePropertiesWithTypes,
    load,
    loadAsync,
    save
  }
}

function addGeoResult(
  set: Set<InternalDocumentID> | undefined,
  ids: Array<{ docIDs: InternalDocumentID[] }>
): Set<InternalDocumentID> {
  if (!set) {
    set = new Set()
  }

  const idsLength = ids.length
  for (let i = 0; i < idsLength; i++) {
    const entry = ids[i].docIDs
    const idsLength = entry.length
    for (let j = 0; j < idsLength; j++) {
      set.add(entry[j])
    }
  }

  return set
}

function createGeoTokenScores(
  ids: Array<{ point: Point; docIDs: InternalDocumentID[] }>,
  centerPoint: Point,
  highPrecision = false
): TokenScore[] {
  const distanceFn = highPrecision ? BKDTree.vincentyDistance : BKDTree.haversineDistance
  const results: TokenScore[] = []

  // Calculate distances for all results to find the maximum
  const distances: number[] = []
  for (const { point } of ids) {
    distances.push(distanceFn(centerPoint, point))
  }
  const maxDistance = Math.max(...distances)

  // Create results with inverse distance scores (higher score = closer)
  let index = 0
  for (const { docIDs } of ids) {
    const distance = distances[index]
    // Use inverse score: closer points get higher scores
    // Add 1 to avoid division by zero for points at exact center
    const score = maxDistance - distance + 1
    for (const docID of docIDs) {
      results.push([docID, score])
    }
    index++
  }

  // Sort by score (higher first - closer points)
  results.sort((a, b) => b[1] - a[1])
  return results
}

function isGeosearchOnlyQuery<T extends AnyZBSearch>(
  filters: Partial<WhereCondition<T['schema']>>,
  index: Index
): { isGeoOnly: boolean; geoProperty?: string; geoOperation?: any } {
  const filterKeys = Object.keys(filters)

  if (filterKeys.length !== 1) {
    return { isGeoOnly: false }
  }

  const param = filterKeys[0]
  const operation = filters[param]

  if (typeof index.indexes[param] === 'undefined') {
    return { isGeoOnly: false }
  }

  const { type } = index.indexes[param]

  if (type === 'BKD' && operation && ('radius' in operation || 'polygon' in operation)) {
    return { isGeoOnly: true, geoProperty: param, geoOperation: operation }
  }

  return { isGeoOnly: false }
}

export function searchByGeoWhereClause<T extends AnyZBSearch>(
  index: AnyIndexStore,
  filters: Partial<WhereCondition<T['schema']>>
): TokenScore[] | null {
  const indexTyped = index as Index
  const geoInfo = isGeosearchOnlyQuery(filters, indexTyped)

  if (!geoInfo.isGeoOnly || !geoInfo.geoProperty || !geoInfo.geoOperation) {
    return null
  }

  const { node } = indexTyped.indexes[geoInfo.geoProperty]
  const operation = geoInfo.geoOperation

  // Cast node to BKDTree since we already verified it's type 'BKD'
  const bkdNode = node as BKDTree

  let results: Array<{ point: Point; docIDs: InternalDocumentID[] }>

  if ('radius' in operation) {
    const {
      value,
      coordinates,
      unit = 'm',
      inside = true,
      highPrecision = false
    } = operation.radius as GeosearchRadiusOperator['radius']

    const centerPoint = coordinates as Point
    const distanceInMeters = convertDistanceToMeters(value, unit)
    results = bkdNode.searchByRadius(centerPoint, distanceInMeters, inside, 'asc', highPrecision)

    return createGeoTokenScores(results, centerPoint, highPrecision)
  } else if ('polygon' in operation) {
    const {
      coordinates,
      inside = true,
      highPrecision = false
    } = operation.polygon as GeosearchPolygonOperator['polygon']

    results = bkdNode.searchByPolygon(coordinates as Point[], inside, 'asc', highPrecision)
    const centroid = BKDTree.calculatePolygonCentroid(coordinates as Point[])

    return createGeoTokenScores(results, centroid, highPrecision)
  }

  return null
}

function addFindResult(
  set: Set<InternalDocumentID> | undefined,
  filteredIDsResults: FindResult
): Set<InternalDocumentID> {
  if (!set) {
    set = new Set()
  }

  const keys = Object.keys(filteredIDsResults)
  const keysLength = keys.length
  for (let i = 0; i < keysLength; i++) {
    const ids = filteredIDsResults[keys[i]]
    const idsLength = ids.length
    for (let j = 0; j < idsLength; j++) {
      set.add(ids[j])
    }
  }

  return set
}
