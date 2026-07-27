import type { AnyZBSearch, PartialSchemaDeep, SearchableType, SortType, SortValue, TypedDocument } from '../types.js'
import { isArrayType, isGeoPointType, isVectorType } from '../components.js'
import { isAsyncFunction, sleep } from '../utils.js'
import { runMultipleHook, runSingleHook } from '../components/hooks.js'
import { createError } from '../errors.js'
import { Point } from '../trees/bkd.js'
import { getInternalDocumentId } from '../components/internal-document-id-store.js'

export type InsertOptions = {
  avlRebalanceThreshold?: number
}

export function insert<T extends AnyZBSearch>(
  zbsearch: T,
  doc: PartialSchemaDeep<TypedDocument<T>>,
  language?: string,
  skipHooks?: boolean,
  options?: InsertOptions
): string | Promise<string> {
  const errorProperty = zbsearch.validateSchema(doc, zbsearch.schema)
  if (errorProperty) {
    throw createError('SCHEMA_VALIDATION_FAILURE', errorProperty)
  }

  const asyncNeeded =
    isAsyncFunction(zbsearch.beforeInsert) ||
    isAsyncFunction(zbsearch.afterInsert) ||
    isAsyncFunction(zbsearch.index.beforeInsert) ||
    isAsyncFunction(zbsearch.index.insert) ||
    isAsyncFunction(zbsearch.index.afterInsert)

  if (asyncNeeded) {
    return innerInsertAsync(zbsearch, doc, language, skipHooks, options)
  }

  return innerInsertSync(zbsearch, doc, language, skipHooks, options)
}

const ENUM_TYPE = new Set(['enum', 'enum[]'])
const STRING_NUMBER_TYPE = new Set(['string', 'number'])

async function innerInsertAsync<T extends AnyZBSearch>(
  zbsearch: T,
  doc: PartialSchemaDeep<TypedDocument<T>>,
  language?: string,
  skipHooks?: boolean,
  options?: InsertOptions
): Promise<string> {
  const { index, docs } = zbsearch.data
  const id = zbsearch.getDocumentIndexId(doc)

  if (typeof id !== 'string') {
    throw createError('DOCUMENT_ID_MUST_BE_STRING', typeof id)
  }

  const internalId = getInternalDocumentId(zbsearch.internalDocumentIDStore, id)

  if (!skipHooks) {
    await runSingleHook(zbsearch.beforeInsert, zbsearch, id, doc as TypedDocument<T>)
  }

  if (!zbsearch.documentsStore.store(docs, id, internalId, doc)) {
    throw createError('DOCUMENT_ALREADY_EXISTS', id)
  }

  const docsCount = zbsearch.documentsStore.count(docs)

  const indexableProperties = zbsearch.index.getSearchableProperties(index)
  const indexablePropertiesWithTypes = zbsearch.index.getSearchablePropertiesWithTypes(index)
  const indexableValues = zbsearch.getDocumentProperties(doc, indexableProperties)

  for (const [key, value] of Object.entries(indexableValues)) {
    if (typeof value === 'undefined') continue

    const actualType = typeof value
    const expectedType = indexablePropertiesWithTypes[key]

    validateDocumentProperty(actualType, expectedType, key, value)
  }

  await indexAndSortDocument(zbsearch, id, indexableProperties, indexableValues, docsCount, language, doc, options)

  if (!skipHooks) {
    await runSingleHook(zbsearch.afterInsert, zbsearch, id, doc as TypedDocument<T>)
  }

  return id
}

function getInsertMetadata<T extends AnyZBSearch>(zbsearch: T) {
  let indexableProperties = zbsearch.caches['indexableProperties'] as string[] | undefined
  let indexablePropertiesWithTypes = zbsearch.caches['indexablePropertiesWithTypes'] as
    | Record<string, SearchableType>
    | undefined
  let sortableProperties = zbsearch.caches['sortableProperties'] as string[] | undefined
  let sortablePropertiesWithTypes = zbsearch.caches['sortablePropertiesWithTypes'] as
    | Record<string, SortType>
    | undefined

  if (!indexableProperties) {
    indexableProperties = zbsearch.index.getSearchableProperties(zbsearch.data.index)
    indexablePropertiesWithTypes = zbsearch.index.getSearchablePropertiesWithTypes(zbsearch.data.index)
    sortableProperties = zbsearch.sorter.getSortableProperties(zbsearch.data.sorting)
    sortablePropertiesWithTypes = zbsearch.sorter.getSortablePropertiesWithTypes(zbsearch.data.sorting)

    zbsearch.caches['indexableProperties'] = indexableProperties
    zbsearch.caches['indexablePropertiesWithTypes'] = indexablePropertiesWithTypes
    zbsearch.caches['sortableProperties'] = sortableProperties
    zbsearch.caches['sortablePropertiesWithTypes'] = sortablePropertiesWithTypes
  }

  return {
    indexableProperties,
    indexablePropertiesWithTypes: indexablePropertiesWithTypes!,
    sortableProperties: sortableProperties!,
    sortablePropertiesWithTypes: sortablePropertiesWithTypes!
  }
}

function innerInsertSync<T extends AnyZBSearch>(
  zbsearch: T,
  doc: PartialSchemaDeep<TypedDocument<T>>,
  language?: string,
  skipHooks?: boolean,
  options?: InsertOptions
): string {
  const { index, docs } = zbsearch.data
  const id = zbsearch.getDocumentIndexId(doc)

  if (typeof id !== 'string') {
    throw createError('DOCUMENT_ID_MUST_BE_STRING', typeof id)
  }

  const internalId = getInternalDocumentId(zbsearch.internalDocumentIDStore, id)

  if (!skipHooks && zbsearch.beforeInsert?.length) {
    runSingleHook(zbsearch.beforeInsert, zbsearch, id, doc as TypedDocument<T>)
  }

  if (!zbsearch.documentsStore.store(docs, id, internalId, doc)) {
    throw createError('DOCUMENT_ALREADY_EXISTS', id)
  }

  const docsCount = zbsearch.documentsStore.count(docs)

  const {
    indexableProperties,
    indexablePropertiesWithTypes,
    sortableProperties,
    sortablePropertiesWithTypes
  } = getInsertMetadata(zbsearch)
  const indexableValues = zbsearch.getDocumentProperties(doc, indexableProperties)

  for (const [key, value] of Object.entries(indexableValues)) {
    if (typeof value === 'undefined') continue

    const actualType = typeof value
    const expectedType = indexablePropertiesWithTypes[key]

    validateDocumentProperty(actualType, expectedType, key, value)
  }

  indexAndSortDocumentSync(
    zbsearch,
    id,
    indexableProperties,
    indexableValues,
    docsCount,
    language,
    doc,
    options,
    indexablePropertiesWithTypes,
    sortableProperties,
    sortablePropertiesWithTypes
  )

  if (!skipHooks && zbsearch.afterInsert?.length) {
    runSingleHook(zbsearch.afterInsert, zbsearch, id, doc as TypedDocument<T>)
  }

  return id
}

function validateDocumentProperty(actualType: string, expectedType: string, key: string, value: any) {
  if (
    isGeoPointType(expectedType) &&
    typeof value === 'object' &&
    typeof (value as Point).lon === 'number' &&
    typeof (value as Point).lat === 'number'
  ) {
    return
  }

  if (isVectorType(expectedType) && Array.isArray(value)) return
  if (isArrayType(expectedType) && Array.isArray(value)) return
  if (ENUM_TYPE.has(expectedType) && STRING_NUMBER_TYPE.has(actualType)) return

  if (actualType !== expectedType) {
    throw createError('INVALID_DOCUMENT_PROPERTY', key, expectedType, actualType)
  }
}

async function indexAndSortDocument<T extends AnyZBSearch>(
  zbsearch: T,
  id: string,
  indexableProperties: string[],
  indexableValues: any,
  docsCount: number,
  language: string | undefined,
  doc: PartialSchemaDeep<TypedDocument<T>>,
  options?: InsertOptions
) {
  for (const prop of indexableProperties) {
    const value = indexableValues[prop]
    if (typeof value === 'undefined') continue

    const expectedType = zbsearch.index.getSearchablePropertiesWithTypes(zbsearch.data.index)[prop]

    await zbsearch.index.beforeInsert?.(
      zbsearch.data.index,
      prop,
      id,
      value,
      expectedType,
      language,
      zbsearch.tokenizer,
      docsCount
    )
    const internalId = zbsearch.internalDocumentIDStore.idToInternalId.get(id)
    await zbsearch.index.insert(
      zbsearch.index,
      zbsearch.data.index,
      prop,
      id,
      internalId!,
      value,
      expectedType,
      language,
      zbsearch.tokenizer,
      docsCount,
      options
    )
    await zbsearch.index.afterInsert?.(
      zbsearch.data.index,
      prop,
      id,
      value,
      expectedType,
      language,
      zbsearch.tokenizer,
      docsCount
    )
  }

  const sortableProperties = zbsearch.sorter.getSortableProperties(zbsearch.data.sorting)
  const sortableValues = zbsearch.getDocumentProperties(doc, sortableProperties)

  for (const prop of sortableProperties) {
    const value = sortableValues[prop] as SortValue
    if (typeof value === 'undefined') continue

    const expectedType = zbsearch.sorter.getSortablePropertiesWithTypes(zbsearch.data.sorting)[prop]

    zbsearch.sorter.insert(zbsearch.data.sorting, prop, id, value, expectedType, language)
  }
}

function indexAndSortDocumentSync<T extends AnyZBSearch>(
  zbsearch: T,
  id: string,
  indexableProperties: string[],
  indexableValues: any,
  docsCount: number,
  language: string | undefined,
  doc: PartialSchemaDeep<TypedDocument<T>>,
  options?: InsertOptions,
  cachedIndexTypes?: Record<string, SearchableType>,
  cachedSortableProperties?: string[],
  cachedSortableTypes?: Record<string, SortType>
) {
  const indexTypes =
    cachedIndexTypes ?? zbsearch.index.getSearchablePropertiesWithTypes(zbsearch.data.index)
  const internalDocumentId = getInternalDocumentId(zbsearch.internalDocumentIDStore, id)

  for (const prop of indexableProperties) {
    const value = indexableValues[prop]
    if (typeof value === 'undefined') continue

    const expectedType = indexTypes[prop]

    zbsearch.index.beforeInsert?.(
      zbsearch.data.index,
      prop,
      id,
      value,
      expectedType,
      language,
      zbsearch.tokenizer,
      docsCount
    )
    zbsearch.index.insert(
      zbsearch.index,
      zbsearch.data.index,
      prop,
      id,
      internalDocumentId,
      value,
      expectedType,
      language,
      zbsearch.tokenizer,
      docsCount,
      options
    )
    zbsearch.index.afterInsert?.(
      zbsearch.data.index,
      prop,
      id,
      value,
      expectedType,
      language,
      zbsearch.tokenizer,
      docsCount
    )
  }

  const sortableProperties =
    cachedSortableProperties ?? zbsearch.sorter.getSortableProperties(zbsearch.data.sorting)
  const sortableTypes =
    cachedSortableTypes ?? zbsearch.sorter.getSortablePropertiesWithTypes(zbsearch.data.sorting)
  const sortableValues = zbsearch.getDocumentProperties(doc, sortableProperties)

  for (const prop of sortableProperties) {
    const value = sortableValues[prop] as SortValue
    if (typeof value === 'undefined') continue

    const expectedType = sortableTypes[prop]

    zbsearch.sorter.insert(zbsearch.data.sorting, prop, id, value, expectedType, language)
  }
}

export function insertMultiple<T extends AnyZBSearch>(
  zbsearch: T,
  docs: PartialSchemaDeep<TypedDocument<T>>[],
  batchSize?: number,
  language?: string,
  skipHooks?: boolean,
  timeout?: number
): Promise<string[]> | string[] {
  const asyncNeeded =
    isAsyncFunction(zbsearch.afterInsertMultiple) ||
    isAsyncFunction(zbsearch.beforeInsertMultiple) ||
    isAsyncFunction(zbsearch.index.beforeInsert) ||
    isAsyncFunction(zbsearch.index.insert) ||
    isAsyncFunction(zbsearch.index.afterInsert)

  if (asyncNeeded) {
    return innerInsertMultipleAsync(zbsearch, docs, batchSize, language, skipHooks, timeout)
  }

  return innerInsertMultipleSync(zbsearch, docs, batchSize, language, skipHooks, timeout)
}

async function innerInsertMultipleAsync<T extends AnyZBSearch>(
  zbsearch: T,
  docs: PartialSchemaDeep<TypedDocument<T>>[],
  batchSize: number = 1000,
  language?: string,
  skipHooks?: boolean,
  timeout: number = 0
): Promise<string[]> {
  const ids: string[] = []

  const processNextBatch = async (startIndex: number): Promise<number> => {
    const endIndex = Math.min(startIndex + batchSize, docs.length)
    const batch = docs.slice(startIndex, endIndex)

    for (const doc of batch) {
      const options = { avlRebalanceThreshold: batch.length }
      const id = await insert(zbsearch, doc, language, skipHooks, options)
      ids.push(id)
    }

    return endIndex
  }

  const processAllBatches = async (): Promise<void> => {
    let currentIndex = 0

    while (currentIndex < docs.length) {
      const startTime = Date.now()
      currentIndex = await processNextBatch(currentIndex)

      if (timeout > 0) {
        const elapsedTime = Date.now() - startTime
        const waitTime = timeout - elapsedTime
        if (waitTime > 0) {
          sleep(waitTime)
        }
      }
    }
  }

  await processAllBatches()

  if (!skipHooks) {
    await runMultipleHook(zbsearch.afterInsertMultiple, zbsearch, docs as TypedDocument<T>[])
  }

  return ids
}

function innerInsertMultipleSync<T extends AnyZBSearch>(
  zbsearch: T,
  docs: PartialSchemaDeep<TypedDocument<T>>[],
  batchSize: number = 1000,
  language?: string,
  skipHooks?: boolean,
  timeout: number = 0
): string[] {
  const ids: string[] = []
  let i = 0

  function processNextBatch(): boolean {
    const batch = docs.slice(i * batchSize, (i + 1) * batchSize)
    if (batch.length === 0) return false

    const {
      indexableProperties,
      indexablePropertiesWithTypes,
      sortableProperties,
      sortablePropertiesWithTypes
    } = getInsertMetadata(zbsearch)
    const batchOptions = { avlRebalanceThreshold: batch.length }
    const { docs: docsStore } = zbsearch.data

    for (const doc of batch) {
      const errorProperty = zbsearch.validateSchema(doc, zbsearch.schema)
      if (errorProperty) {
        throw createError('SCHEMA_VALIDATION_FAILURE', errorProperty)
      }

      const id = zbsearch.getDocumentIndexId(doc)

      if (typeof id !== 'string') {
        throw createError('DOCUMENT_ID_MUST_BE_STRING', typeof id)
      }

      const internalId = getInternalDocumentId(zbsearch.internalDocumentIDStore, id)

      if (!skipHooks && zbsearch.beforeInsert?.length) {
        runSingleHook(zbsearch.beforeInsert, zbsearch, id, doc as TypedDocument<T>)
      }

      if (!zbsearch.documentsStore.store(docsStore, id, internalId, doc)) {
        throw createError('DOCUMENT_ALREADY_EXISTS', id)
      }

      const docsCount = zbsearch.documentsStore.count(docsStore)
      const indexableValues = zbsearch.getDocumentProperties(doc, indexableProperties)

      indexAndSortDocumentSync(
        zbsearch,
        id,
        indexableProperties,
        indexableValues,
        docsCount,
        language,
        doc,
        batchOptions,
        indexablePropertiesWithTypes,
        sortableProperties,
        sortablePropertiesWithTypes
      )

      if (!skipHooks && zbsearch.afterInsert?.length) {
        runSingleHook(zbsearch.afterInsert, zbsearch, id, doc as TypedDocument<T>)
      }

      ids.push(id)
    }

    i++
    return true
  }

  function processAllBatches() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const startTime = Date.now()
      const hasMoreBatches = processNextBatch()
      if (!hasMoreBatches) break

      if (timeout > 0) {
        const elapsedTime = Date.now() - startTime
        const waitTime = timeout - elapsedTime
        if (waitTime > 0) {
          sleep(waitTime)
        }
      }
    }
  }

  processAllBatches()

  if (!skipHooks && zbsearch.afterInsertMultiple?.length) {
    runMultipleHook(zbsearch.afterInsertMultiple, zbsearch, docs as TypedDocument<T>[])
  }

  return ids
}

export function innerInsertMultiple<T extends AnyZBSearch>(
  zbsearch: T,
  docs: PartialSchemaDeep<TypedDocument<T>>[],
  batchSize?: number,
  language?: string,
  skipHooks?: boolean,
  timeout?: number
): Promise<string[]> | string[] {
  const asyncNeeded =
    isAsyncFunction(zbsearch.beforeInsert) ||
    isAsyncFunction(zbsearch.afterInsert) ||
    isAsyncFunction(zbsearch.index.beforeInsert) ||
    isAsyncFunction(zbsearch.index.insert) ||
    isAsyncFunction(zbsearch.index.afterInsert)

  if (asyncNeeded) {
    return innerInsertMultipleAsync(zbsearch, docs, batchSize, language, skipHooks, timeout)
  }

  return innerInsertMultipleSync(zbsearch, docs, batchSize, language, skipHooks, timeout)
}
