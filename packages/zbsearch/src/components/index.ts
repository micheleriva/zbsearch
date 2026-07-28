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
  Tokenizer,
  TokenScore,
  WhereCondition
} from '../types.js'
import { convertDistanceToMeters, setDifference, setIntersection, setUnion } from '../utils.js'
import { BM25 } from './algorithms.js'
import { getInnerType, getVectorSize, isArrayType, isVectorType } from './defaults.js'
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
  const invLength = tokenLength > 0 ? 1 / tokenLength : 0

  for (let i = 0; i < tokenLength; i++) {
    const token = tokens[i]!
    if (Object.hasOwn(frequencies, token)) {
      frequencies[token] += invLength
    } else {
      frequencies[token] = invLength
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
      const tokens = tokenizer.tokenize(value as string, language, prop, false)
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

function collectFindResultIds(searchResult: FindResult): Set<InternalDocumentID> {
  const ids = new Set<InternalDocumentID>()

  for (const word in searchResult) {
    const docIds = searchResult[word]
    for (let i = 0; i < docIds.length; i++) {
      ids.add(docIds[i])
    }
  }

  return ids
}

function filterIdsToCandidates(ids: InternalDocumentID[], candidates: Set<InternalDocumentID>): InternalDocumentID[] {
  const filtered: InternalDocumentID[] = []

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    if (candidates.has(id)) {
      filtered.push(id)
    }
  }

  return filtered
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
  const findCache = new Map<string, FindResult>()
  const candidateIds = new Set<InternalDocumentID>()
  const matchingProperties: string[] = []

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

    let propertyIntersection: Set<InternalDocumentID> | undefined
    const tokenLength = tokens.length

    for (let i = 0; i < tokenLength; i++) {
      const token = tokens[i]
      const cacheKey = `${prop}\0${token}`
      let searchResult = findCache.get(cacheKey)

      if (!searchResult) {
        searchResult = (tree.node as RadixTree).find({ term: token, exact, tolerance })
        findCache.set(cacheKey, searchResult)
      }

      if (!Object.keys(searchResult).length) {
        propertyIntersection = undefined
        break
      }

      const tokenIds = collectFindResultIds(searchResult)
      propertyIntersection =
        propertyIntersection === undefined ? tokenIds : setIntersection(propertyIntersection, tokenIds)

      if (!propertyIntersection.size) {
        break
      }
    }

    if (!propertyIntersection || !propertyIntersection.size) {
      continue
    }

    matchingProperties.push(prop)

    for (const id of propertyIntersection) {
      if (!whereFiltersIDs || whereFiltersIDs.has(id)) {
        candidateIds.add(id)
      }
    }
  }

  if (!candidateIds.size) {
    return []
  }

  const resultsMap = new Map<number, number>()

  for (const prop of matchingProperties) {
    const tree = index.indexes[prop]
    if (tree.type !== 'Radix') {
      continue
    }

    const boostPerProperty = boost[prop] ?? 1
    const tokenLength = tokens.length

    for (let i = 0; i < tokenLength; i++) {
      const token = tokens[i]
      const cacheKey = `${prop}\0${token}`
      const searchResult = findCache.get(cacheKey)!

      const words = Object.keys(searchResult)
      for (let j = 0; j < words.length; j++) {
        const word = words[j]
        const filteredIds = filterIdsToCandidates(searchResult[word], candidateIds)

        if (filteredIds.length > 0) {
          calculateResultScores(
            index,
            prop,
            word,
            filteredIds,
            docsCount,
            relevance,
            resultsMap,
            boostPerProperty,
            whereFiltersIDs
          )
        }
      }
    }
  }

  return Array.from(resultsMap.entries())
    .map(([id, score]): TokenScore => [id, score])
    .sort((a, b) => b[1] - a[1])
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
  threshold = 0
): TokenScore[] {
  const tokens = tokenizer.tokenize(term, language)
  const keywordsCount = tokens.length || 1

  if (!tokens.length && !term) {
    tokens.push('')
  }

  if (!threshold && tokens.length > 1) {
    return searchThresholdZero(
      index,
      tokens,
      propertiesToSearch,
      exact,
      tolerance,
      boost,
      relevance,
      docsCount,
      whereFiltersIDs
    )
  }

  // Track keyword matches per document and property
  const keywordMatchesMap = new Map<InternalDocumentID, Map<string, number>>()
  // Track which tokens were found in the search
  const tokenFoundMap = new Map<string, boolean>()
  const resultsMap = new Map<number, number>()

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

    // Process each token in the search term
    const tokenLength = tokens.length
    for (let i = 0; i < tokenLength; i++) {
      const token = tokens[i]
      const searchResult = tree.node.find({ term: token, exact, tolerance })

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
        calculateResultScores(
          index,
          prop,
          word,
          ids,
          docsCount,
          relevance,
          resultsMap,
          boostPerProperty,
          whereFiltersIDs,
          keywordMatchesMap
        )
      }
    }
  }

  // Convert to array and sort by score
  const results = Array.from(resultsMap.entries())
    .map(([id, score]): TokenScore => [id, score])
    .sort((a, b) => b[1] - a[1])

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
    const fullMatches = results.filter(([id]) => {
      const propertyMatches = keywordMatchesMap.get(id)
      if (!propertyMatches) return false

      // Check if any property has all keywords
      return Array.from(propertyMatches.values()).some((matches) => matches === keywordsCount)
    })

    return fullMatches
  }

  // Find documents that have all keywords in at least one property
  const fullMatches = results.filter(([id]) => {
    const propertyMatches = keywordMatchesMap.get(id)
    if (!propertyMatches) return false

    // Check if any property has all keywords
    return Array.from(propertyMatches.values()).some((matches) => matches === keywordsCount)
  })

  // If we have full matches and threshold < 1, return full matches plus a percentage of partial matches
  if (fullMatches.length > 0) {
    const remainingResults = results.filter(([id]) => !fullMatches.some(([fid]) => fid === id))
    const additionalResults = Math.ceil(remainingResults.length * threshold)
    return [...fullMatches, ...remainingResults.slice(0, additionalResults)]
  }

  // If no full matches, return all results
  return results
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

    const results = orFilters.map((filter) => searchByWhereClause(index, tokenizer, filter, language))
    // Use reduce to union all sets
    return results.reduce((acc, set) => setUnion(acc, set), new Set<InternalDocumentID>())
  }

  if ('not' in filters && filters.not) {
    const notFilter = filters.not
    // Get all document IDs from the internal document store
    const allDocs = new Set<InternalDocumentID>()

    // Get all document IDs from the internal document store
    const docsStore = index.sharedInternalDocumentStore
    for (let i = 1; i <= docsStore.internalIdToId.length; i++) {
      allDocs.add(i)
    }

    const notResult = searchByWhereClause(index, tokenizer, notFilter, language)
    return setDifference(allDocs, notResult)
  }

  // Handle regular property filters (existing logic)
  const filterKeys = Object.keys(filters)

  const filtersMap: Record<string, Set<InternalDocumentID>> = filterKeys.reduce(
    (acc, key) => ({
      [key]: new Set(),
      ...acc
    }),
    {}
  )

  for (const param of filterKeys) {
    const operation = filters[param]!

    if (typeof index.indexes[param] === 'undefined') {
      throw createError('UNKNOWN_FILTER_PROPERTY', param)
    }

    const { node, type, isArray } = index.indexes[param]

    if (type === 'Bool') {
      const idx = node
      const filteredIDs = operation ? idx.true : idx.false
      filtersMap[param] = setUnion(filtersMap[param], filteredIDs)
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
        filtersMap[param] = addGeoResult(filtersMap[param], ids)
      } else {
        const {
          coordinates,
          inside = true,
          highPrecision = false
        } = operation[reqOperation] as GeosearchPolygonOperator['polygon']
        const ids = node.searchByPolygon(coordinates as BKDGeoPoint[], inside, undefined, highPrecision)
        filtersMap[param] = addGeoResult(filtersMap[param], ids)
      }

      continue
    }

    if (type === 'Radix' && (typeof operation === 'string' || Array.isArray(operation))) {
      for (const raw of [operation].flat()) {
        const term = tokenizer.tokenize(raw, language, param)
        for (const t of term) {
          const filteredIDsResults = node.find({ term: t, exact: true })
          filtersMap[param] = addFindResult(filtersMap[param], filteredIDsResults)
        }
      }

      continue
    }

    const operationKeys = Object.keys(operation)

    if (operationKeys.length > 1) {
      throw createError('INVALID_FILTER_OPERATION', operationKeys.length)
    }

    if (type === 'Flat') {
      const results = new Set(
        isArray
          ? node.filterArr(operation as EnumArrComparisonOperator)
          : node.filter(operation as EnumComparisonOperator)
      )

      filtersMap[param] = setUnion(filtersMap[param], results)

      continue
    }

    if (type === 'AVL') {
      const operationOpt = operationKeys[0] as keyof ComparisonOperator
      const operationValue = (operation as ComparisonOperator)[operationOpt]
      let filteredIDs: Set<InternalDocumentID>

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

      filtersMap[param] = setUnion(filtersMap[param], filteredIDs)
    }
  }

  // AND operation: calculate the intersection between all the IDs in filterMap
  return setIntersection(...Object.values(filtersMap))
}

export function getSearchableProperties(index: Index): string[] {
  return index.searchableProperties
}

export function getSearchablePropertiesWithTypes(index: Index): Record<string, SearchableType> {
  return index.searchablePropertiesWithTypes
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
    const { node, type, isArray } = rawIndexes[prop]

    switch (type) {
      case 'Radix':
        indexes[prop] = {
          type: 'Radix',
          node: RadixTree.fromJSON(node as unknown as RadixNodeJSON),
          isArray
        }
        break
      case 'Flat':
        indexes[prop] = {
          type: 'Flat',
          node: FlatTree.fromJSON(node),
          isArray
        }
        break
      case 'AVL':
        indexes[prop] = {
          type: 'AVL',
          node: AVLTree.fromJSON(node),
          isArray
        }
        break
      case 'BKD':
        indexes[prop] = {
          type: 'BKD',
          node: BKDTree.fromJSON(node),
          isArray
        }
        break
      case 'Bool':
        indexes[prop] = {
          type: 'Bool',
          node: BoolNode.fromJSON(node),
          isArray
        }
        break
      default:
        indexes[prop] = rawIndexes[prop]
    }
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

export function save<R = unknown>(index: Index): R {
  const {
    indexes,
    vectorIndexes,
    searchableProperties,
    searchablePropertiesWithTypes,
    frequencies,
    tokenOccurrences,
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
    searchByWhereClause,
    getSearchableProperties,
    getSearchablePropertiesWithTypes,
    load,
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
