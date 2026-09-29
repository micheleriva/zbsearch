import { AnyIndexStore, AnyZBSearch, SearchableType, Tokenizer } from 'zbsearch'
import { avl, bkd, flat, bool, vector } from 'zbsearch/trees'
import { getVectorSize, internalDocumentIDStore, isVectorType } from 'zbsearch/components'

type InternalDocumentID = internalDocumentIDStore.InternalDocumentID

export type TreeType = 'AVL' | 'Radix' | 'Bool' | 'Flat' | 'BKD'
export type TTree<T = TreeType, N = unknown> = {
  type: T
  node: N
  isArray: boolean
}
export type Tree =
  // We don't store strings inside a tree
  // | TTree<'Radix', radix.RadixNode>
  | TTree<'Position', PositionsStorage>
  | TTree<'AVL', avl.AVLTree<number, InternalDocumentID[]>>
  | TTree<'Bool', bool.BoolNode>
  | TTree<'Flat', flat.FlatTree>
  | TTree<'BKD', bkd.BKDTree>

const MAX_POSITION = 15
export type PositionStorage = Record<string, number[]>
// 15 `PositionStorage`s
export type PositionsStorage = [
  PositionStorage,
  PositionStorage,
  PositionStorage,
  PositionStorage,
  PositionStorage,
  PositionStorage,
  PositionStorage,
  PositionStorage,
  PositionStorage,
  PositionStorage,
  PositionStorage,
  PositionStorage,
  PositionStorage,
  PositionStorage,
  PositionStorage
]

export interface PT15IndexStore extends AnyIndexStore {
  indexes: Record<string, Tree>
  searchableProperties: string[]
  searchablePropertiesWithTypes: Record<string, SearchableType>
}

function create_obj() {
  // object with empty prototype to cheap objects
  return Object.create(null)
}

export function recursiveCreate<T extends AnyZBSearch>(
  indexDatastore: PT15IndexStore,
  schema: T['schema'],
  prefix: string
) {
  for (const [prop, type] of Object.entries<SearchableType>(schema)) {
    const path = `${prefix}${prefix ? '.' : ''}${prop}`

    if (typeof type === 'object' && !Array.isArray(type)) {
      // Nested
      recursiveCreate(indexDatastore, type, path)
      continue
    }

    if (isVectorType(type)) {
      indexDatastore.searchableProperties.push(path)
      indexDatastore.searchablePropertiesWithTypes[path] = type
      indexDatastore.vectorIndexes[path] = {
        type: 'Vector',
        node: new vector.VectorIndex(getVectorSize(type)),
        isArray: false
      }
    } else {
      const isArray = /\[/.test(type as string)
      switch (type) {
        case 'boolean':
        case 'boolean[]':
          indexDatastore.indexes[path] = { type: 'Bool', node: new bool.BoolNode(), isArray }
          break
        case 'number':
        case 'number[]':
          indexDatastore.indexes[path] = {
            type: 'AVL',
            node: new avl.AVLTree<number, InternalDocumentID[]>(0, []),
            isArray
          }
          break
        case 'string':
        case 'string[]':
          indexDatastore.indexes[path] = {
            type: 'Position',
            node: [
              create_obj(),
              create_obj(),
              create_obj(),
              create_obj(),
              create_obj(),
              create_obj(),
              create_obj(),
              create_obj(),
              create_obj(),
              create_obj(),
              create_obj(),
              create_obj(),
              create_obj(),
              create_obj(),
              create_obj()
            ],
            isArray
          }
          break
        case 'enum':
        case 'enum[]':
          indexDatastore.indexes[path] = { type: 'Flat', node: new flat.FlatTree(), isArray }
          break
        case 'geopoint':
          indexDatastore.indexes[path] = { type: 'BKD', node: new bkd.BKDTree(), isArray }
          break
        default:
          throw new Error('INVALID_SCHEMA_TYPE: ' + path)
      }

      indexDatastore.searchableProperties.push(path)
      indexDatastore.searchablePropertiesWithTypes[path] = type
    }
  }
}

export function insertString(
  value: string,
  positionsStorage: PositionsStorage,
  prop: string,
  internalId: InternalDocumentID,
  language: string | undefined,
  tokenizer: Tokenizer
) {
  const tokens = uniqueTokens(tokenizer.tokenize(value, language, prop))
  const tokensLength = tokens.length
  for (let i = 0; i < tokensLength; i++) {
    const token = tokens[i]
    const position = MAX_POSITION - get_position(i, tokensLength) - 1

    const positionStorage = positionsStorage[position]

    const tokenLength = token.length
    for (let j = tokenLength; j > 0; j--) {
      const tokenPart = token.slice(0, j)
      positionStorage[tokenPart] = positionStorage[tokenPart] || []
      positionStorage[tokenPart].push(internalId)
    }
  }
}

export function get_position(n: number, totalLength: number) {
  if (totalLength < MAX_POSITION) {
    return n
  }
  // Scale
  return Math.floor((n * MAX_POSITION) / totalLength)
}

export function searchString(
  tokenizer: Tokenizer,
  term: string,
  positionsStorage: PositionsStorage,
  boostPerProp: number,
  whereFiltersIDs: Set<InternalDocumentID> | undefined
) {
  const tokens = uniqueTokens(tokenizer.tokenize(term))

  const ret: Map<number, number> = new Map()
  for (const token of tokens) {
    for (let i = 0; i < MAX_POSITION; i++) {
      const positionStorage = positionsStorage[i]
      if (positionStorage[token]) {
        const a = positionStorage[token]
        const aLength = a.length

        for (let j = 0; j < aLength; j++) {
          if (whereFiltersIDs && !whereFiltersIDs.has(a[j])) {
            continue
          }

          const id = a[j]
          if (ret.has(id)) {
            ret.set(id, ret.get(id)! + i * boostPerProp)
          } else {
            ret.set(id, i * boostPerProp)
          }
        }
      }
    }
  }

  return ret
}

export function removeString(
  value: string,
  positionsStorage: PositionsStorage,
  prop: string,
  internalId: InternalDocumentID,
  tokenizer: Tokenizer,
  language: string | undefined
) {
  // Every bucket is scanned instead of recomputing the bucket from the token's index. An index
  // saved when the tokenizer kept duplicates placed a repeated token in several buckets and scaled
  // the positions over the longer token list, so the bucket a token lands in today is not
  // necessarily the one it was stored in.
  const tokens = uniqueTokens(tokenizer.tokenize(value, language, prop))
  for (const token of tokens) {
    const tokenLength = token.length
    for (let j = tokenLength; j > 0; j--) {
      const tokenPart = token.slice(0, j)
      for (let position = 0; position < MAX_POSITION; position++) {
        const a = positionsStorage[position][tokenPart]
        if (!a) {
          continue
        }
        let index = a.indexOf(internalId)
        while (index !== -1) {
          a.splice(index, 1)
          index = a.indexOf(internalId, index)
        }
      }
    }
  }
}

// PT15 scores by token position, not term frequency, so it works on each distinct token once
// regardless of the tokenizer's `allowDuplicates` setting.
export function uniqueTokens(tokens: string[]): string[] {
  return tokens.length > 1 ? Array.from(new Set(tokens)) : tokens
}
