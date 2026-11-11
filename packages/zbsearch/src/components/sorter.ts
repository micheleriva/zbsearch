import { createError } from '../errors.js'
import {
  AnySorterStore,
  AnyZBSearch,
  ISorter,
  SearchableType,
  SorterConfig,
  SorterParams,
  SortType,
  SortValue
} from '../types.js'
import { safeArrayPush, yieldToEventLoop } from '../utils.js'
import { isVectorType } from './defaults.js'
import {
  DocumentID,
  getInternalDocumentId,
  InternalDocumentID,
  InternalDocumentIDStore
} from './internal-document-id-store.js'
import { getLocale } from './tokenizer/languages.js'

interface PropertySort<K> {
  docs: Map<InternalDocumentID, number>
  orderedDocs: [InternalDocumentID, K][]
  orderedDocsToRemove: Map<InternalDocumentID, boolean>
  type: SortType
}

type SerializablePropertySort<K> = Omit<PropertySort<K>, 'orderedDocsToRemove' | 'docs'> & {
  docs: Record<string, number>
}

export interface Sorter extends AnySorterStore {
  sharedInternalDocumentStore: InternalDocumentIDStore
  isSorted: boolean
  language: string
  enabled: boolean
  sortableProperties: string[]
  sortablePropertiesWithTypes: Record<string, SortType>
  sorts: Record<string, PropertySort<number | string | boolean>>
  unsortableProperties: string[]
}

export function addSortablePropertyToSorter(sorter: Sorter, path: string, type: SearchableType): void {
  if (!sorter.enabled || (sorter.unsortableProperties ?? []).includes(path)) {
    return
  }

  switch (type) {
    case 'boolean':
    case 'number':
    case 'string':
      sorter.sortableProperties.push(path)
      sorter.sortablePropertiesWithTypes[path] = type
      sorter.sorts[path] = {
        docs: new Map(),
        orderedDocsToRemove: new Map(),
        orderedDocs: [],
        type: type
      }
      break
    default:
      // We don't allow to sort by arrays, enums, geopoints, or vectors
      return
  }
}

function innerCreate<T extends AnyZBSearch>(
  zbsearch: T,
  sharedInternalDocumentStore: InternalDocumentIDStore,
  schema: T['schema'],
  sortableDeniedProperties: string[],
  prefix: string
): Sorter {
  const sorter: Sorter = {
    language: zbsearch.tokenizer.language,
    sharedInternalDocumentStore,
    enabled: true,
    isSorted: true,
    sortableProperties: [],
    sortablePropertiesWithTypes: {},
    sorts: {},
    unsortableProperties: sortableDeniedProperties
  }

  for (const [prop, type] of Object.entries<SearchableType>(schema)) {
    const path = `${prefix}${prefix ? '.' : ''}${prop}`

    if (sortableDeniedProperties.includes(path)) {
      continue
    }

    if (typeof type === 'object' && !Array.isArray(type)) {
      // Nested
      const ret = innerCreate(zbsearch, sharedInternalDocumentStore, type, sortableDeniedProperties, path)
      safeArrayPush(sorter.sortableProperties, ret.sortableProperties)
      sorter.sorts = {
        ...sorter.sorts,
        ...ret.sorts
      }
      sorter.sortablePropertiesWithTypes = {
        ...sorter.sortablePropertiesWithTypes,
        ...ret.sortablePropertiesWithTypes
      }
      continue
    }

    if (isVectorType(type)) {
      continue
    }

    switch (type) {
      case 'boolean':
      case 'number':
      case 'string':
        addSortablePropertyToSorter(sorter, path, type)
        break
      case 'geopoint':
      case 'enum':
        // We don't allow to sort by enums or geopoints
        continue
      case 'enum[]':
      case 'boolean[]':
      case 'number[]':
      case 'string[]':
        // We don't allow to sort by arrays
        continue
      default:
        throw createError('INVALID_SORT_SCHEMA_TYPE', Array.isArray(type) ? 'array' : type, path)
    }
  }

  return sorter
}

function create<T extends AnyZBSearch>(
  zbsearch: T,
  sharedInternalDocumentStore: InternalDocumentIDStore,
  schema: T['schema'],
  config?: SorterConfig
): Sorter {
  const isSortEnabled = config?.enabled !== false
  if (!isSortEnabled) {
    return {
      disabled: true
    } as unknown as Sorter
  }
  return innerCreate(zbsearch, sharedInternalDocumentStore, schema, (config || {}).unsortableProperties || [], '')
}

function insert(sorter: Sorter, prop: string, id: DocumentID, value: SortValue): void {
  if (!sorter.enabled) {
    return
  }

  sorter.isSorted = false

  const internalId = getInternalDocumentId(sorter.sharedInternalDocumentStore, id)
  const s = sorter.sorts[prop]

  // This happen during a document updating
  // Because we re-use the same internalId
  // We need to clean-up the data structure before re-inserting
  // to avoid duplicates in the orderedDocs array
  // See: https://github.com/oramasearch/orama/issues/629
  if (s.orderedDocsToRemove.has(internalId)) {
    ensureOrderedDocsAreDeletedByProperty(sorter, prop)
  }

  s.docs.set(internalId, s.orderedDocs.length)
  s.orderedDocs.push([internalId, value])
}

export function ensureIsSorted(sorter: Sorter): void {
  if (sorter.isSorted || !sorter.enabled) {
    return
  }

  const properties = Object.keys(sorter.sorts)
  for (const prop of properties) {
    ensurePropertyIsSorted(sorter, prop)
  }

  sorter.isSorted = true
}

function numberSort(value: [InternalDocumentID, SortValue], d: [InternalDocumentID, SortValue]): number {
  return (value[1] as number) - (d[1] as number)
}

function booleanSort(value: [InternalDocumentID, SortValue], d: [InternalDocumentID, SortValue]): number {
  return (d[1] as boolean) ? -1 : 1
}

function ensurePropertyIsSorted(sorter: Sorter, prop: string): void {
  const s = sorter.sorts[prop]

  let predicate: (value: [InternalDocumentID, SortValue], d: [InternalDocumentID, SortValue]) => number
  switch (s.type) {
    case 'string': {
      // localeCompare(other, locale) is specified as comparing with a new Intl.Collator(locale): build it once
      // instead of on every comparison.
      const locale = getLocale(sorter.language)
      const compare =
        typeof Intl === 'undefined'
          ? (a: string, b: string) => a.localeCompare(b, locale)
          : new Intl.Collator(locale).compare
      predicate = (value, d) => compare(value[1] as string, d[1] as string)
      break
    }
    case 'number':
      predicate = numberSort.bind(null)
      break
    case 'boolean':
      predicate = booleanSort.bind(null)
      break
  }

  s.orderedDocs.sort(predicate)

  // Increment position for the greather documents
  const orderedDocsLength = s.orderedDocs.length
  for (let i = 0; i < orderedDocsLength; i++) {
    const docId = s.orderedDocs[i][0]
    s.docs.set(docId, i)
  }
}

export function ensureOrderedDocsAreDeleted(sorter: Sorter): void {
  const properties = Object.keys(sorter.sorts)
  for (const prop of properties) {
    ensureOrderedDocsAreDeletedByProperty(sorter, prop)
  }
}

function ensureOrderedDocsAreDeletedByProperty(sorter: Sorter, prop: string): void {
  const s = sorter.sorts[prop]

  if (!s.orderedDocsToRemove.size) return

  s.orderedDocs = s.orderedDocs.filter((doc) => !s.orderedDocsToRemove.has(doc[0]))
  s.orderedDocsToRemove.clear()
}

function remove(sorter: Sorter, prop: string, id: DocumentID) {
  if (!sorter.enabled) {
    return
  }
  const s = sorter.sorts[prop] as PropertySort<SortValue>
  const internalId = getInternalDocumentId(sorter.sharedInternalDocumentStore, id)

  const index = s.docs.get(internalId)

  if (!index) return

  s.docs.delete(internalId)
  s.orderedDocsToRemove.set(internalId, true)
}

// Up to this many documents, sortBy packs each document's sort position and its index in the input into one exactly
// representable double (position * 2^21 + index < 2^52), so that a native numeric sort of a Float64Array replaces the
// comparator sort that looked up both positions on every comparison.
const PACKED_SORT_INDEX_FACTOR = 2 ** 21
const MAX_PACKED_SORT_LENGTH = PACKED_SORT_INDEX_FACTOR

// Same order as the stable comparator sort in sortBy: indexed documents by position (ascending, or descending), with
// equal positions in input order, followed by the unindexed documents in input order.
function sortByPackedPositions(
  sorter: Sorter,
  s: PropertySort<SortValue>,
  docIds: [DocumentID, number][],
  isDesc: boolean
): [DocumentID, number][] {
  const docIdsLength = docIds.length
  const keys = new Float64Array(docIdsLength)
  const unindexed: [DocumentID, number][] = []
  let indexedCount = 0

  for (let i = 0; i < docIdsLength; i++) {
    const position = s.docs.get(getInternalDocumentId(sorter.sharedInternalDocumentStore, docIds[i][0]))

    if (position === undefined) {
      unindexed.push(docIds[i])
    } else {
      keys[indexedCount++] = (isDesc ? -position : position) * PACKED_SORT_INDEX_FACTOR + i
    }
  }

  const sortedKeys = keys.subarray(0, indexedCount).sort()
  const sorted: [DocumentID, number][] = new Array(docIdsLength)

  for (let i = 0; i < indexedCount; i++) {
    const key = sortedKeys[i]
    // The index is the (non-negative) remainder of the key modulo the factor
    sorted[i] = docIds[key - Math.floor(key / PACKED_SORT_INDEX_FACTOR) * PACKED_SORT_INDEX_FACTOR]
  }

  const unindexedLength = unindexed.length
  for (let i = 0; i < unindexedLength; i++) {
    sorted[indexedCount + i] = unindexed[i]
  }

  for (let i = 0; i < docIdsLength; i++) {
    docIds[i] = sorted[i]
  }

  return docIds
}

function sortBy<T extends AnyZBSearch>(
  sorter: Sorter,
  docIds: [DocumentID, number][],
  by: SorterParams<T>
): [DocumentID, number][] {
  if (!sorter.enabled) {
    throw createError('SORT_DISABLED')
  }

  const property = by.property
  const isDesc = by.order === 'DESC'

  const s = sorter.sorts[property]
  if (!s) {
    throw createError('UNABLE_TO_SORT_ON_UNKNOWN_FIELD', property, sorter.sortableProperties.join(', '))
  }

  ensureOrderedDocsAreDeletedByProperty(sorter, property)
  ensureIsSorted(sorter)

  const docIdsLength = docIds.length
  if (docIdsLength <= MAX_PACKED_SORT_LENGTH) {
    return sortByPackedPositions(sorter, s, docIds, isDesc)
  }

  docIds.sort((a, b) => {
    // This sort algorithm works leveraging on
    // that s.docs is a map of docId -> position
    // If a document is not indexed, it will be not present in the map
    const indexOfA = s.docs.get(getInternalDocumentId(sorter.sharedInternalDocumentStore, a[0]))
    const indexOfB = s.docs.get(getInternalDocumentId(sorter.sharedInternalDocumentStore, b[0]))
    const isAIndexed = typeof indexOfA !== 'undefined'
    const isBIndexed = typeof indexOfB !== 'undefined'

    if (!isAIndexed && !isBIndexed) {
      return 0
    }
    // unindexed documents are always at the end
    if (!isAIndexed) {
      return 1
    }
    if (!isBIndexed) {
      return -1
    }

    return isDesc ? indexOfB - indexOfA : indexOfA - indexOfB
  })

  return docIds
}

function getSortableProperties(sorter: Sorter): string[] {
  if (!sorter.enabled) {
    return []
  }

  return sorter.sortableProperties
}

function getSortablePropertiesWithTypes(sorter: Sorter): Record<string, SortType> {
  if (!sorter.enabled) {
    return {}
  }

  return sorter.sortablePropertiesWithTypes
}

export function load<R = unknown>(sharedInternalDocumentStore: InternalDocumentIDStore, raw: R): Sorter {
  const rawDocument = raw as Omit<Sorter, 'sorts'> & {
    sorts: Record<string, SerializablePropertySort<string | number | boolean>>
  }
  if (!rawDocument.enabled) {
    return {
      enabled: false
    } as unknown as Sorter
  }

  const sorts = Object.keys(rawDocument.sorts).reduce(
    (acc, prop) => {
      const { docs, orderedDocs, type } = rawDocument.sorts[prop]

      acc[prop] = {
        docs: new Map(Object.entries(docs).map(([k, v]) => [+k, v])),
        orderedDocsToRemove: new Map(),
        orderedDocs,
        type
      }

      return acc
    },
    {} as Record<string, PropertySort<string | number | boolean>>
  )

  return {
    sharedInternalDocumentStore,
    language: rawDocument.language,
    sortableProperties: rawDocument.sortableProperties,
    sortablePropertiesWithTypes: rawDocument.sortablePropertiesWithTypes,
    sorts,
    enabled: true,
    isSorted: rawDocument.isSorted,
    unsortableProperties: rawDocument.unsortableProperties ?? []
  }
}

export async function loadAsync<R = unknown>(
  sharedInternalDocumentStore: InternalDocumentIDStore,
  raw: R
): Promise<Sorter> {
  const rawDocument = raw as Omit<Sorter, 'sorts'> & {
    sorts: Record<string, SerializablePropertySort<string | number | boolean>>
  }
  if (!rawDocument.enabled) {
    return {
      enabled: false
    } as unknown as Sorter
  }

  const sorts = {} as Record<string, PropertySort<string | number | boolean>>
  const props = Object.keys(rawDocument.sorts)

  for (let i = 0; i < props.length; i++) {
    const prop = props[i]
    const { docs, orderedDocs, type } = rawDocument.sorts[prop]

    sorts[prop] = {
      docs: new Map(Object.entries(docs).map(([k, v]) => [+k, v])),
      orderedDocsToRemove: new Map(),
      orderedDocs,
      type
    }

    if (i < props.length - 1) {
      await yieldToEventLoop()
    }
  }

  return {
    sharedInternalDocumentStore,
    language: rawDocument.language,
    sortableProperties: rawDocument.sortableProperties,
    sortablePropertiesWithTypes: rawDocument.sortablePropertiesWithTypes,
    sorts,
    enabled: true,
    isSorted: rawDocument.isSorted,
    unsortableProperties: rawDocument.unsortableProperties ?? []
  }
}

export function save<R = unknown>(sorter: Sorter): R {
  if (!sorter.enabled) {
    return {
      enabled: false
    } as unknown as R
  }

  ensureOrderedDocsAreDeleted(sorter)
  ensureIsSorted(sorter)

  const sorts = Object.keys(sorter.sorts).reduce(
    (acc, prop) => {
      const { docs, orderedDocs, type } = sorter.sorts[prop]

      acc[prop] = {
        docs: Object.fromEntries(docs.entries()),
        orderedDocs,
        type
      }

      return acc
    },
    {} as Record<string, SerializablePropertySort<string | number | boolean>>
  )

  return {
    language: sorter.language,
    sortableProperties: sorter.sortableProperties,
    sortablePropertiesWithTypes: sorter.sortablePropertiesWithTypes,
    sorts,
    enabled: sorter.enabled,
    isSorted: sorter.isSorted,
    unsortableProperties: sorter.unsortableProperties ?? []
  } as R
}

export function createSorter(): ISorter<Sorter> {
  return {
    create,
    insert,
    remove,
    save,
    load,
    loadAsync,
    sortBy,
    getSortableProperties,
    getSortablePropertiesWithTypes
  }
}
