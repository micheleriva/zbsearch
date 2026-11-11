import { createError } from '../errors.js'
import type { InsertOptions } from '../methods/insert.js'
import { AVLTree } from '../trees/avl.js'
import type { Point as BKDGeoPoint, Point } from '../trees/bkd.js'
import { BKDTree } from '../trees/bkd.js'
import { BoolNode } from '../trees/bool.js'
import { FlatTree } from '../trees/flat.js'
import { FindResult, RadixNodeJSON, RadixTree } from '../trees/radix.js'
import {
  decodePostings,
  deserializeFrozenSegment,
  findOrdinals,
  FrozenSegment,
  isLiveDocument,
  liveDocumentFrequency,
  mergeSegments,
  serializeFrozenSegment,
  SerializedFrozenSegment,
  termOrdinal,
  tombstoneDocument
} from '../trees/frozen.js'
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
  TopKRequest,
  WhereCondition
} from '../types.js'
import { convertDistanceToMeters, setIntersection, sortTokenScores, yieldToEventLoop, uniqueTokens } from '../utils.js'
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

/**
 * The distinct terms of the `string[]` values that are not in the documents store, so that they can be removed from
 * the radix tree. Terms are kept once per property, in `terms`, and each document lists the IDs of its terms.
 */
export interface UnstoredTerms {
  // Term ID -> term
  terms: string[]
  // Term -> term ID, rebuilt from `terms` on load
  termIds: Map<string, number>
  // Internal document ID -> the IDs of the document's distinct terms
  docs: Record<InternalDocumentID, Uint32Array>
}

export type SerializedUnstoredTerms = {
  terms: string[]
  docs: Record<InternalDocumentID, number[]>
}

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
  // What `removeUnstored` needs to remove values that are not in the documents store (see StoreConfig):
  // - number, number[], enum, enum[] and geopoint values are kept as they are, in `unstoredValues`;
  // - the terms of string[] values are kept in `unstoredTerms`;
  // - string values need nothing: `frequencies[prop][id]` already lists the terms of the document;
  // - booleans and vectors need nothing: they are removed by document ID.
  unstoredValues: Record<string, Record<InternalDocumentID, SearchableValue>>
  unstoredTerms: Record<string, UnstoredTerms>
  // Frozen segments of string properties (see freeze()), oldest first. The radix tree, `frequencies` and
  // `unstoredTerms` of a property only hold the documents inserted since its last freeze (its mutable tail).
  frozen?: Record<string, FrozenSegment[]>
}

/**
 * Corpus statistics that BM25 scoring reads in place of the ones derived from the index itself. A database that holds
 * only a part of a larger corpus (one shard of a sharded index) scores its documents exactly as the whole corpus would
 * when it is given the whole corpus' statistics: the number of documents, the average length of each field and the
 * document frequency of each term.
 */
export interface CorpusStatistics {
  /** Number of documents in the whole corpus. */
  docsCount: number
  /** Average field length (in tokens) of each string property across the whole corpus. */
  avgFieldLength: Record<string, number | undefined>
  /** Number of documents of the whole corpus that contain `term` in `prop`. */
  documentFrequency(prop: string, term: string): number
}

// Keyed by the database's internal document ID store, which (unlike the index) survives load() and loadAsync().
const corpusStatistics = new WeakMap<InternalDocumentIDStore, CorpusStatistics>()

/**
 * Makes BM25 scoring of `zbsearch` use `stats` instead of the database's own statistics; `undefined` restores them.
 * Only the default index component honours it. The object is read at search time, so it can be updated in place.
 */
export function setCorpusStatistics<T extends AnyZBSearch>(zbsearch: T, stats: CorpusStatistics | undefined): void {
  if (stats) {
    corpusStatistics.set(zbsearch.internalDocumentIDStore, stats)
  } else {
    corpusStatistics.delete(zbsearch.internalDocumentIDStore)
  }
}

export function getCorpusStatistics<T extends AnyZBSearch>(zbsearch: T): CorpusStatistics | undefined {
  return corpusStatistics.get(zbsearch.internalDocumentIDStore)
}

function getIndexCorpusStatistics(index: Index): CorpusStatistics | undefined {
  return index.sharedInternalDocumentStore ? corpusStatistics.get(index.sharedInternalDocumentStore) : undefined
}

function getAvgFieldLength(index: Index, prop: string): number {
  const stats = getIndexCorpusStatistics(index)
  return (stats ? stats.avgFieldLength[prop] : index.avgFieldLength[prop]) as number
}

function getFrozenSegments(index: Index, prop: string): FrozenSegment[] | undefined {
  const segments = index.frozen?.[prop]
  return segments !== undefined && segments.length > 0 ? segments : undefined
}

// Tombstones the frozen copy of a document. Returns false if no frozen segment of `prop` holds a live copy of it (the
// document is in the mutable tail, or does not have the property).
function removeFrozenDocument(index: Index, prop: string, internalId: InternalDocumentID): boolean {
  const segments = getFrozenSegments(index, prop)
  if (!segments) {
    return false
  }

  for (let i = 0; i < segments.length; i++) {
    if (tombstoneDocument(segments[i], internalId)) {
      return true
    }
  }
  return false
}

/** Whether a frozen segment of `prop` holds a live copy of the document. */
export function isFrozenDocument(index: Index, prop: string, internalId: InternalDocumentID): boolean {
  const segments = getFrozenSegments(index, prop)
  if (!segments) {
    return false
  }

  for (let i = 0; i < segments.length; i++) {
    if (isLiveDocument(segments[i], internalId)) {
      return true
    }
  }
  return false
}

/**
 * The words of `prop` that the radix tree's `find` returns for `term`, `exact` and `tolerance`, frozen segments
 * included. Without frozen segments, this is the radix tree's own result. With them, each word lists the live
 * postings of the segments (oldest first) and then those of the radix tree (the mutable tail): the same documents,
 * in the same order, as the radix tree would hold if nothing had been frozen. The term frequencies of each word,
 * position by position, go to `tfs` when given (the mutable tail's ones are read from `index.frequencies`).
 */
export function findWords(
  index: Index,
  prop: string,
  tree: RadixTree,
  term: string,
  exact: boolean | undefined,
  tolerance: number | undefined,
  tfs?: Record<string, Float64Array>
): FindResult {
  const segments = getFrozenSegments(index, prop)
  if (!segments) {
    return tree.find({ term, exact, tolerance })
  }

  const tail = tree.find({ term, exact, tolerance })
  const words: string[] = []
  // Word -> pairs of (segment, term ordinal)
  const parts = new Map<string, number[]>()

  for (let s = 0; s < segments.length; s++) {
    const segment = segments[s]
    const ordinals = findOrdinals(segment, term, exact === true, tolerance ?? 0)
    for (let i = 0; i < ordinals.length; i++) {
      const word = segment.terms[ordinals[i]]
      let wordParts = parts.get(word)
      if (!wordParts) {
        wordParts = []
        parts.set(word, wordParts)
        words.push(word)
      }
      wordParts.push(s, ordinals[i])
    }
  }

  for (const word in tail) {
    if (!parts.has(word)) {
      words.push(word)
    }
  }

  const frequencies = index.frequencies[prop]
  const result: FindResult = {}

  for (let w = 0; w < words.length; w++) {
    const word = words[w]
    const wordParts = parts.get(word)
    const tailIds = tail[word]

    let size = tailIds ? tailIds.length : 0
    if (wordParts) {
      for (let i = 0; i < wordParts.length; i += 2) {
        size += segments[wordParts[i]].df[wordParts[i + 1]]
      }
    }

    const ids = new Uint32Array(size)
    const wordTfs = tfs ? new Float64Array(size) : undefined
    let n = 0
    if (wordParts) {
      for (let i = 0; i < wordParts.length; i += 2) {
        n += decodePostings(segments[wordParts[i]], wordParts[i + 1], ids, wordTfs, n)
      }
    }
    if (tailIds) {
      for (let i = 0; i < tailIds.length; i++) {
        const id = tailIds[i]
        ids[n] = id
        if (wordTfs) {
          wordTfs[n] = frequencies?.[id]?.[word] ?? 0
        }
        n++
      }
    }

    // The arrays are only read by index, like the radix tree's postings
    result[word] = (n === size ? ids : ids.subarray(0, n)) as unknown as InternalDocumentID[]
    if (tfs) {
      tfs[word] = n === size ? wordTfs! : wordTfs!.subarray(0, n)
    }
  }

  return result
}

// Term frequency of `term` in each live frozen document of `prop` that has it
function frozenTermFrequencies(index: Index, prop: string, term: string): Map<InternalDocumentID, number> | undefined {
  const segments = getFrozenSegments(index, prop)
  if (!segments) {
    return undefined
  }

  const tfs = new Map<InternalDocumentID, number>()
  for (const segment of segments) {
    const ordinal = termOrdinal(segment, term)
    if (ordinal === -1) {
      continue
    }
    const df = segment.df[ordinal]
    const ids = new Uint32Array(df)
    const frequencies = new Float64Array(df)
    const n = decodePostings(segment, ordinal, ids, frequencies)
    for (let i = 0; i < n; i++) {
      tfs.set(ids[i], frequencies[i])
    }
  }
  return tfs
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
  const fieldLength = index.fieldLengths[prop][internalId]

  if (fieldLength === undefined) {
    // A document without a stored field length never contributed to the average (or was already removed from it)
    index.frequencies[prop][internalId] = undefined
    return
  }

  if (docsCount > 1) {
    index.avgFieldLength[prop] = (index.avgFieldLength[prop] * docsCount - fieldLength) / (docsCount - 1)
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
      fieldLengths: {},
      unstoredValues: {},
      unstoredTerms: {}
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

  const unstored = options?.unstored === true

  if (!isArrayType(schemaType)) {
    insertScalarValue(implementation, index, prop, id, internalId, value, language, tokenizer, docsCount, options)
    if (unstored) {
      keepUnstoredValue(index, prop, internalId, value)
    }
    return
  }

  const elements = value as Array<string | number | boolean>
  const elementsLength = elements.length

  // A string[] value is one field of the document for scoring: its field length is the total number of tokens across
  // all of its elements, the average field length is updated once, and the term frequencies add up across elements.
  const { type, node } = index.indexes[prop]
  if (type === 'Radix') {
    const tokens = tokenizeArrayElements(elements, language, prop, tokenizer)
    insertRadixTokens(index, prop, node as RadixTree, id, internalId, tokens, docsCount)
    if (unstored) {
      keepUnstoredTerms(index, prop, internalId, new Set(tokens))
    }
    return
  }

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

  if (unstored) {
    keepUnstoredValue(index, prop, internalId, value)
  }
}

// Keeps a value that is not in the documents store, when removing it from its tree needs it
function keepUnstoredValue(index: Index, prop: string, internalId: InternalDocumentID, value: SearchableValue): void {
  const type = index.indexes[prop].type
  if (type === 'AVL' || type === 'Flat' || type === 'BKD') {
    index.unstoredValues ??= {}
    const values = (index.unstoredValues[prop] ??= {})
    values[internalId] = value
  }
}

function keepUnstoredTerms(index: Index, prop: string, internalId: InternalDocumentID, terms: Set<string>): void {
  if (terms.size === 0) {
    return
  }

  index.unstoredTerms ??= {}
  const dictionary = (index.unstoredTerms[prop] ??= { terms: [], termIds: new Map(), docs: {} })
  const ids = new Uint32Array(terms.size)
  let i = 0
  for (const term of terms) {
    let termId = dictionary.termIds.get(term)
    if (termId === undefined) {
      termId = dictionary.terms.length
      dictionary.terms.push(term)
      dictionary.termIds.set(term, termId)
    }
    ids[i++] = termId
  }
  dictionary.docs[internalId] = ids
}

/**
 * Removes a document from the index of `prop` when its value is not in the documents store, using what `insert`
 * kept for it (see `Index.unstoredValues` and `Index.unstoredTerms`). Does nothing, and returns false, if the
 * document has no value for the property.
 */
export function removeUnstored(
  implementation: IIndex<Index>,
  index: Index,
  prop: string,
  id: DocumentID,
  internalId: InternalDocumentID,
  schemaType: SearchableType,
  language: string | undefined,
  tokenizer: Tokenizer,
  docsCount: number
): boolean {
  if (isVectorType(schemaType)) {
    index.vectorIndexes[prop]?.node.remove(internalId)
    return true
  }

  const tree = index.indexes[prop]
  if (!tree) {
    return false
  }

  switch (tree.type) {
    case 'Bool': {
      tree.node.true.delete(internalId)
      tree.node.false.delete(internalId)
      return true
    }
    case 'Radix': {
      if (removeFrozenDocument(index, prop, internalId)) {
        implementation.removeDocumentScoreParameters(index, prop, id, docsCount)
        return true
      }

      const frequencies = index.frequencies[prop]?.[internalId]
      const dictionary = index.unstoredTerms?.[prop]
      const termIds = dictionary?.docs[internalId]
      if (!frequencies && !termIds) {
        return false
      }

      const terms = new Set<string>(frequencies ? Object.keys(frequencies) : [])
      if (termIds) {
        for (let i = 0; i < termIds.length; i++) {
          terms.add(dictionary!.terms[termIds[i]])
        }
        delete dictionary!.docs[internalId]
      }

      implementation.removeDocumentScoreParameters(index, prop, id, docsCount)
      for (const term of terms) {
        implementation.removeTokenScoreParameters(index, prop, term)
        tree.node.removeDocumentByWord(term, internalId)
      }
      return true
    }
    default: {
      const values = index.unstoredValues?.[prop]
      const value = values?.[internalId]
      if (value === undefined) {
        return false
      }

      delete values![internalId]
      remove(implementation, index, prop, id, internalId, value, schemaType, language, tokenizer, docsCount)
      return true
    }
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

function tokenizeArrayElements(
  elements: Array<string | number | boolean>,
  language: string | undefined,
  prop: string,
  tokenizer: Tokenizer
): string[] {
  const tokens: string[] = []
  const elementsLength = elements.length
  for (let i = 0; i < elementsLength; i++) {
    const elementTokens = tokenizer.tokenize(elements[i] as string, language, prop)
    const elementTokensLength = elementTokens.length
    for (let j = 0; j < elementTokensLength; j++) {
      tokens.push(elementTokens[j]!)
    }
  }
  return tokens
}

function removeRadixTokens(
  implementation: IIndex<Index>,
  index: Index,
  prop: string,
  node: RadixTree,
  id: DocumentID,
  internalId: InternalDocumentID,
  tokens: string[],
  docsCount: number
): void {
  implementation.removeDocumentScoreParameters(index, prop, id, docsCount)

  if (removeFrozenDocument(index, prop, internalId)) {
    return
  }

  for (const token of tokens) {
    implementation.removeTokenScoreParameters(index, prop, token)
    node.removeDocumentByWord(token, internalId)
  }
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
      // A frozen document is removed by tombstoning it: no need to tokenize its value
      const tokens = isFrozenDocument(index, prop, internalId)
        ? []
        : tokenizer.tokenize(value as string, language, prop)
      removeRadixTokens(implementation, index, prop, node as RadixTree, id, internalId, tokens, docsCount)
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

  // Mirrors `insert`: the score parameters of a string[] value are removed once, for the field as a whole
  const { type, node } = index.indexes[prop]
  if (type === 'Radix') {
    const tokens = isFrozenDocument(index, prop, internalId)
      ? []
      : tokenizeArrayElements(elements, language, prop, tokenizer)
    removeRadixTokens(implementation, index, prop, node as RadixTree, id, internalId, tokens, docsCount)
    return true
  }

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
  const stats = getIndexCorpusStatistics(index)
  if (stats) {
    docsCount = stats.docsCount
  }

  const avgFieldLength = getAvgFieldLength(index, prop)
  const fieldLengths = index.fieldLengths[prop]
  const zbsearchFrequencies = index.frequencies[prop]
  const termOccurrences = getTermDocumentFrequency(index, prop, term)
  // Frozen documents have their term frequencies in the frozen postings
  const frozenFrequencies = frozenTermFrequencies(index, prop, term)

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

    const tf = zbsearchFrequencies?.[internalId]?.[term] ?? frozenFrequencies?.get(internalId) ?? 0

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
  trackMatches = false,
  termFrequencies?: Float64Array
): void {
  const avgFieldLength = getAvgFieldLength(index, prop)
  const fieldLengths = index.fieldLengths[prop]
  const zbsearchFrequencies = index.frequencies[prop]
  // With frozen segments (`termFrequencies` given), `ids` lists every live posting of the term
  const matchingCount =
    termFrequencies && !getIndexCorpusStatistics(index) ? ids.length : getTermDocumentFrequency(index, prop, term)

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

    const tf = termFrequencies ? termFrequencies[i] : (zbsearchFrequencies?.[internalId]?.[term] ?? 0)
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

// Whether `a` ranks before `b`: higher score first, then lower internal id
function ranksBefore(scores: Float64Array, a: InternalDocumentID, b: InternalDocumentID): boolean {
  const sa = scores[a]
  const sb = scores[b]
  return sa > sb || (sa === sb && a < b)
}

// Below this many results, a top-k request is declined: sorting them all is as fast
const TOP_K_MIN_RESULTS = 256

// The `k` best accumulated results (see TopKRequest), without building and sorting a result for every document
function selectTopK(accumulator: ScoreAccumulator, request: TopKRequest): TokenScore[] {
  const { ids, scores } = accumulator
  const n = ids.length
  const k = request.k

  if (n <= TOP_K_MIN_RESULTS || k * 2 >= n) {
    // Few results, or most of them on the page: sorting them all costs no more than selecting the page, so the
    // request is declined and the usual results returned
    return sortByScoreDescending(getAccumulatedScores(accumulator))
  }

  request.selected = true
  request.count = n

  if (k <= 0) {
    return []
  }

  for (let i = 0; i < n; i++) {
    const score = scores[ids[i]]
    if (score !== score) {
      // NaN scores have no consistent order: the page is cut from the same sorts as without a request
      return sortTokenScores(sortByScoreDescending(getAccumulatedScores(accumulator))).slice(0, k)
    }
  }

  // Binary heap of the best `k` ids so far, the one ranking last at the root
  const heap = new Int32Array(k)
  let size = 0
  for (let i = 0; i < n; i++) {
    const id = ids[i]
    if (size < k) {
      // Sift up
      let child = size++
      while (child > 0) {
        const parent = (child - 1) >> 1
        if (!ranksBefore(scores, heap[parent], id)) {
          break
        }
        heap[child] = heap[parent]
        child = parent
      }
      heap[child] = id
    } else if (ranksBefore(scores, id, heap[0])) {
      // Replace the root and sift down
      let parent = 0
      for (;;) {
        let child = 2 * parent + 1
        if (child >= k) {
          break
        }
        if (child + 1 < k && ranksBefore(scores, heap[child], heap[child + 1])) {
          child++
        }
        if (!ranksBefore(scores, id, heap[child])) {
          break
        }
        heap[parent] = heap[child]
        parent = child
      }
      heap[parent] = id
    }
  }

  const best = Array.from(heap)
  best.sort((a, b) => (ranksBefore(scores, a, b) ? -1 : 1))
  const results: TokenScore[] = new Array(k)
  for (let i = 0; i < k; i++) {
    results[i] = [best[i], scores[best[i]]]
  }
  return results
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

// Demotion of a prefix-expanded `word` of `token`: the document frequencies come from the corpus statistics when the
// index has them, and from the radix search result (which holds the postings of each matched word) otherwise.
function expansionDemotion(
  stats: CorpusStatistics | undefined,
  prop: string,
  token: string,
  word: string,
  searchResult: FindResult,
  docsCount: number
): number {
  if (stats) {
    const tokenDf = stats.documentFrequency(prop, token)
    return prefixExpansionDemotion(tokenDf > 0 ? tokenDf : undefined, stats.documentFrequency(prop, word), docsCount)
  }

  return prefixExpansionDemotion(searchResult[token]?.length, searchResult[word]!.length, docsCount)
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
  whereFiltersIDs: Set<InternalDocumentID> | undefined,
  topK?: TopKRequest
): TokenScore[] {
  const stats = getIndexCorpusStatistics(index)
  const candidateIds = new Set<InternalDocumentID>()
  const matchingProperties: string[] = []
  // The radix search results of each matching property, one per token, and their term frequencies (frozen properties)
  const matchingSearchResults: FindResult[][] = []
  const matchingSearchTfs: Array<Array<Record<string, Float64Array> | undefined>> = []

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
    const searchTfs: Array<Record<string, Float64Array> | undefined> = new Array(tokenLength)
    const postingsCounts: number[] = new Array(tokenLength)
    const frozen = getFrozenSegments(index, prop) !== undefined
    let hasEmptyToken = false

    for (let i = 0; i < tokenLength; i++) {
      const tfs = frozen ? {} : undefined
      const searchResult = findWords(index, prop, tree.node as RadixTree, tokens[i], exact, tolerance, tfs)
      searchResults[i] = searchResult
      searchTfs[i] = tfs

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
    matchingSearchTfs.push(searchTfs)

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
    const searchTfs = matchingSearchTfs[p]
    const boostPerProperty = boost[prop] ?? 1
    const tokenLength = tokens.length

    for (let i = 0; i < tokenLength; i++) {
      const token = tokens[i]
      const searchResult = searchResults[i]
      const tfs = searchTfs[i]

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
            (word === token ? 1 : expansionDemotion(stats, prop, token, word, searchResult, docsCount)),
          candidateIds,
          false,
          tfs?.[word]
        )
      }
    }
  }

  if (topK) {
    return selectTopK(accumulator, topK)
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
  prefix = true,
  topK?: TopKRequest
): TokenScore[] {
  const stats = getIndexCorpusStatistics(index)
  if (stats) {
    docsCount = stats.docsCount
  }

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
      whereFiltersIDs,
      topK
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
    const frozen = getFrozenSegments(index, prop) !== undefined
    for (let i = 0; i < tokenLength; i++) {
      const token = tokens[i]
      const tfs = frozen ? ({} as Record<string, Float64Array>) : undefined
      const searchResult = findWords(index, prop, tree.node, token, radixExact, tolerance, tfs)

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
            (word === token ? 1 : expansionDemotion(stats, prop, token, word, searchResult, docsCount)),
          whereFiltersIDs,
          trackKeywordMatches,
          tfs?.[word]
        )
      }
    }

    if (trackKeywordMatches) {
      markFullMatches(accumulator, keywordsCount)
    }
  }

  // Every result is returned: only the best ones are needed
  if (topK && (threshold === 1 || (threshold === 0 && keywordsCount === 1))) {
    return selectTopK(accumulator, topK)
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
  const stats = getIndexCorpusStatistics(index)
  if (stats) {
    docsCount = stats.docsCount
  }

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

    const avgFieldLength = getAvgFieldLength(index, prop)
    const fieldLengths = index.fieldLengths[prop]
    const frequencies = index.frequencies[prop]

    for (let i = 0; i < tokenCount; i++) {
      const { token, exact, tolerance, completion } = queryTokens[i]
      const wholeWordWithTolerance = exact && tolerance > 0
      const tfs = getFrozenSegments(index, prop) ? ({} as Record<string, Float64Array>) : undefined
      const searchResult = findWords(
        index,
        prop,
        tree.node as RadixTree,
        token,
        exact && !wholeWordWithTolerance,
        tolerance,
        tfs
      )
      const words = Object.keys(searchResult)
      const tokenDocumentFrequency = stats
        ? stats.documentFrequency(prop, token) || undefined
        : searchResult[token]?.length

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
          (word === token
            ? 1
            : prefixExpansionDemotion(
                tokenDocumentFrequency,
                stats ? stats.documentFrequency(prop, word) : ids.length,
                docsCount
              ))
        const termOccurrences = getTermDocumentFrequency(index, prop, word)
        const wordTfs = tfs?.[word]

        for (let k = 0; k < ids.length; k++) {
          const internalId = ids[k]
          if (whereFiltersIDs && !whereFiltersIDs.has(internalId)) {
            continue
          }

          const tf = wordTfs ? wordTfs[k] : (frequencies?.[internalId]?.[word] ?? 0)
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

          // Of two words that score the same, the smaller one wins: the choice must not depend on the order the
          // index lists the words in (for a radix tree, the order its nodes were created in)
          const best = match.words[i]
          if (best === undefined || score > match.wordScores[i] || (score === match.wordScores[i] && word < best)) {
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
          const filteredIDsResults = findWords(index, param, node as RadixTree, t, true, 0)
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

export function deserializeIndexEntry(rawIndex: Index['indexes'][string]): Index['indexes'][string] {
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
  const { unstoredValues, unstoredTerms } = deserializeUnstored(raw)
  const frozen = deserializeFrozen(raw)

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
    fieldLengths,
    unstoredValues,
    unstoredTerms,
    ...(frozen ? { frozen } : {})
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
  const { unstoredValues, unstoredTerms } = deserializeUnstored(raw)
  const frozen = deserializeFrozen(raw)

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
    fieldLengths,
    unstoredValues,
    unstoredTerms,
    ...(frozen ? { frozen } : {})
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
    fieldLengths,
    unstoredValues,
    unstoredTerms
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
    fieldLengths,
    unstoredValues: unstoredValues ?? {},
    unstoredTerms: serializeUnstoredTerms(unstoredTerms ?? {}),
    // Only written when there are frozen segments, so that the snapshots of other indexes do not change
    ...(index.frozen && Object.keys(index.frozen).length > 0 ? { frozen: serializeFrozen(index.frozen) } : {})
  } as R
}

function serializeFrozen(frozen: Record<string, FrozenSegment[]>): Record<string, SerializedFrozenSegment[]> {
  const serialized: Record<string, SerializedFrozenSegment[]> = {}
  for (const prop of Object.keys(frozen)) {
    serialized[prop] = frozen[prop].map(serializeFrozenSegment)
  }
  return serialized
}

function deserializeFrozen(raw: unknown): Record<string, FrozenSegment[]> | undefined {
  const rawFrozen = (raw as { frozen?: Record<string, SerializedFrozenSegment[]> }).frozen
  if (!rawFrozen) {
    return undefined
  }

  const frozen: Record<string, FrozenSegment[]> = {}
  for (const prop of Object.keys(rawFrozen)) {
    frozen[prop] = rawFrozen[prop].map(deserializeFrozenSegment)
  }
  return frozen
}

/** Automatic freezes add a segment per property until there are this many, then merge them all into one. */
export const MAX_FROZEN_SEGMENTS = 8

/**
 * Freezes the mutable tail of every string property: its radix tree postings and term frequencies become a frozen
 * segment, and the tail starts over empty. With `merge`, the new segment also takes in every existing segment of
 * the property, leaving one segment without tombstones; otherwise it is added after them, unless that would make
 * more than MAX_FROZEN_SEGMENTS. Scores do not change: frozen postings are read in the order the mutable index
 * held them, with the same term frequencies.
 */
export function freezeIndex(index: Index, merge: boolean): void {
  for (const prop of Object.keys(index.indexes)) {
    const entry = index.indexes[prop]
    if (entry.type !== 'Radix') {
      continue
    }

    const tree = entry.node as RadixTree
    const frequencies = index.frequencies[prop] ?? {}
    const fieldLengths = index.fieldLengths[prop] ?? {}
    const segments = index.frozen?.[prop] ?? []

    // Documents of the tail: every document inserted with the property since the last freeze has an entry in
    // `frequencies` (reset on each freeze), so its keys are the tail, not the whole insertion history. Integer keys
    // are listed in ascending order; sort anyway if they are not, to keep the segment's document order.
    const documents: InternalDocumentID[] = []
    let sorted = true
    for (const key of Object.keys(frequencies)) {
      const id = +key
      if (frequencies[id] !== undefined) {
        if (documents.length > 0 && id < documents[documents.length - 1]) {
          sorted = false
        }
        documents.push(id)
      }
    }
    if (!sorted) {
      documents.sort((a, b) => a - b)
    }

    const hasTail = documents.length > 0 || tree.postings.size > 0
    const needsMerge = segments.length > 1 || segments.some((segment) => segment.deleted > 0)
    if (!hasTail && !(merge && needsMerge)) {
      continue
    }

    const tail = {
      postings: tree.postings,
      tf: (id: InternalDocumentID, term: string) => frequencies[id]?.[term] ?? 0,
      documents
    }

    let next: FrozenSegment[]
    if (merge || segments.length + 1 > MAX_FROZEN_SEGMENTS) {
      next = [mergeSegments(segments, hasTail ? tail : undefined, fieldLengths)]
    } else {
      next = [...segments, mergeSegments([], tail, fieldLengths)]
    }

    index.frozen ??= {}
    index.frozen[prop] = next.filter((segment) => segment.docCount > 0 || segment.terms.length > 0)
    index.indexes[prop] = { type: 'Radix', node: new RadixTree(), isArray: entry.isArray }
    index.frequencies[prop] = {}
    // Frozen documents are removed by tombstoning them: their terms are no longer needed
    if (index.unstoredTerms?.[prop]) {
      delete index.unstoredTerms[prop]
    }
  }
}

function serializeUnstoredTerms(unstoredTerms: Index['unstoredTerms']): Record<string, SerializedUnstoredTerms> {
  const serialized: Record<string, SerializedUnstoredTerms> = {}
  for (const prop of Object.keys(unstoredTerms)) {
    const { terms, docs } = unstoredTerms[prop]
    const serializedDocs: Record<InternalDocumentID, number[]> = {}
    for (const internalId of Object.keys(docs)) {
      serializedDocs[internalId] = Array.from(docs[internalId])
    }
    serialized[prop] = { terms, docs: serializedDocs }
  }
  return serialized
}

// Indexes saved before `store.exclude` existed have no unstored values
function deserializeUnstored(raw: unknown): Pick<Index, 'unstoredValues' | 'unstoredTerms'> {
  const { unstoredValues, unstoredTerms: rawUnstoredTerms } = raw as {
    unstoredValues?: Index['unstoredValues']
    unstoredTerms?: Record<string, SerializedUnstoredTerms>
  }

  const unstoredTerms: Index['unstoredTerms'] = {}
  for (const prop of Object.keys(rawUnstoredTerms ?? {})) {
    const { terms, docs: rawDocs } = rawUnstoredTerms![prop]
    const termIds = new Map<string, number>()
    for (let i = 0; i < terms.length; i++) {
      termIds.set(terms[i], i)
    }
    const docs: Record<InternalDocumentID, Uint32Array> = {}
    for (const internalId of Object.keys(rawDocs)) {
      docs[internalId] = Uint32Array.from(rawDocs[internalId])
    }
    unstoredTerms[prop] = { terms, termIds, docs }
  }

  return { unstoredValues: unstoredValues ?? {}, unstoredTerms }
}

function getTermDocumentFrequency(index: Index, prop: string, term: string): number {
  const stats = getIndexCorpusStatistics(index)
  if (stats) {
    return stats.documentFrequency(prop, term)
  }

  const treeIndex = index.indexes[prop]
  if (treeIndex?.type === 'Radix') {
    let df = (treeIndex.node as RadixTree).getDocumentFrequency(term)
    const segments = getFrozenSegments(index, prop)
    if (segments) {
      for (let i = 0; i < segments.length; i++) {
        const ordinal = termOrdinal(segments[i], term)
        if (ordinal !== -1) {
          df += liveDocumentFrequency(segments[i], ordinal)
        }
      }
    }
    return df
  }

  const stored = index.tokenOccurrences[prop]?.[term]
  return typeof stored === 'number' ? stored : 0
}

export function createIndex(): IIndex<Index> {
  return {
    create,
    insert,
    remove,
    removeUnstored,
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
