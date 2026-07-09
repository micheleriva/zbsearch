import type { AnyZBSearch, PartialSchemaDeep, TypedDocument } from '../types.js'
import { runMultipleHook, runSingleHook } from '../components/hooks.js'
import { createError } from '../errors.js'
import { innerInsertMultiple, insert } from './insert.js'
import { remove, removeMultiple } from './remove.js'
import { isAsyncFunction } from '../utils.js'

export function update<T extends AnyZBSearch>(
  zbsearch: T,
  id: string,
  doc: PartialSchemaDeep<TypedDocument<T>>,
  language?: string,
  skipHooks?: boolean
): Promise<string> | string {
  const asyncNeeded =
    isAsyncFunction(zbsearch.afterInsert) ||
    isAsyncFunction(zbsearch.beforeInsert) ||
    isAsyncFunction(zbsearch.afterRemove) ||
    isAsyncFunction(zbsearch.beforeRemove) ||
    isAsyncFunction(zbsearch.beforeUpdate) ||
    isAsyncFunction(zbsearch.afterUpdate)

  if (asyncNeeded) {
    return updateAsync(zbsearch, id, doc, language, skipHooks)
  }

  return updateSync(zbsearch, id, doc, language, skipHooks)
}

async function updateAsync<T extends AnyZBSearch>(
  zbsearch: T,
  id: string,
  doc: PartialSchemaDeep<TypedDocument<T>>,
  language?: string,
  skipHooks?: boolean
): Promise<string> {
  if (!skipHooks && zbsearch.beforeUpdate) {
    await runSingleHook(zbsearch.beforeUpdate, zbsearch, id)
  }

  await remove(zbsearch, id, language, skipHooks)
  const newId = await insert(zbsearch, doc, language, skipHooks)

  if (!skipHooks && zbsearch.afterUpdate) {
    await runSingleHook(zbsearch.afterUpdate, zbsearch, newId)
  }

  return newId
}

function updateSync<T extends AnyZBSearch>(
  zbsearch: T,
  id: string,
  doc: PartialSchemaDeep<TypedDocument<T>>,
  language?: string,
  skipHooks?: boolean
): string {
  if (!skipHooks && zbsearch.beforeUpdate) {
    runSingleHook(zbsearch.beforeUpdate, zbsearch, id)
  }

  remove(zbsearch, id, language, skipHooks)
  const newId = insert(zbsearch, doc, language, skipHooks) as string

  if (!skipHooks && zbsearch.afterUpdate) {
    runSingleHook(zbsearch.afterUpdate, zbsearch, newId)
  }

  return newId
}

export function updateMultiple<T extends AnyZBSearch>(
  zbsearch: T,
  ids: string[],
  docs: PartialSchemaDeep<TypedDocument<T>>[],
  batchSize?: number,
  language?: string,
  skipHooks?: boolean
): Promise<string[]> | string[] {
  const asyncNeeded =
    isAsyncFunction(zbsearch.afterInsert) ||
    isAsyncFunction(zbsearch.beforeInsert) ||
    isAsyncFunction(zbsearch.afterRemove) ||
    isAsyncFunction(zbsearch.beforeRemove) ||
    isAsyncFunction(zbsearch.beforeUpdate) ||
    isAsyncFunction(zbsearch.afterUpdate) ||
    isAsyncFunction(zbsearch.beforeUpdateMultiple) ||
    isAsyncFunction(zbsearch.afterUpdateMultiple) ||
    isAsyncFunction(zbsearch.beforeRemoveMultiple) ||
    isAsyncFunction(zbsearch.afterRemoveMultiple) ||
    isAsyncFunction(zbsearch.beforeInsertMultiple) ||
    isAsyncFunction(zbsearch.afterInsertMultiple)

  if (asyncNeeded) {
    return updateMultipleAsync(zbsearch, ids, docs, batchSize, language, skipHooks)
  }

  return updateMultipleSync(zbsearch, ids, docs, batchSize, language, skipHooks)
}

async function updateMultipleAsync<T extends AnyZBSearch>(
  zbsearch: T,
  ids: string[],
  docs: PartialSchemaDeep<TypedDocument<T>>[],
  batchSize?: number,
  language?: string,
  skipHooks?: boolean
): Promise<string[]> {
  if (!skipHooks) {
    await runMultipleHook(zbsearch.beforeUpdateMultiple, zbsearch, ids)
  }

  const docsLength = docs.length
  for (let i = 0; i < docsLength; i++) {
    const errorProperty = zbsearch.validateSchema(docs[i], zbsearch.schema)
    if (errorProperty) {
      throw createError('SCHEMA_VALIDATION_FAILURE', errorProperty)
    }
  }

  await removeMultiple(zbsearch, ids, batchSize, language, skipHooks)
  const newIds = await innerInsertMultiple(zbsearch, docs, batchSize, language, skipHooks)

  if (!skipHooks) {
    await runMultipleHook(zbsearch.afterUpdateMultiple, zbsearch, newIds)
  }

  return newIds
}

function updateMultipleSync<T extends AnyZBSearch>(
  zbsearch: T,
  ids: string[],
  docs: PartialSchemaDeep<TypedDocument<T>>[],
  batchSize?: number,
  language?: string,
  skipHooks?: boolean
): string[] {
  if (!skipHooks) {
    runMultipleHook(zbsearch.beforeUpdateMultiple, zbsearch, ids)
  }

  const docsLength = docs.length
  for (let i = 0; i < docsLength; i++) {
    const errorProperty = zbsearch.validateSchema(docs[i], zbsearch.schema)
    if (errorProperty) {
      throw createError('SCHEMA_VALIDATION_FAILURE', errorProperty)
    }
  }

  removeMultiple(zbsearch, ids, batchSize, language, skipHooks)
  const newIds = innerInsertMultiple(zbsearch, docs, batchSize, language, skipHooks) as string[]

  if (!skipHooks) {
    runMultipleHook(zbsearch.afterUpdateMultiple, zbsearch, newIds)
  }

  return newIds
}
