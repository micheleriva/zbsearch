import { RESERVED_VECTOR_INDEX_KEY } from '../constants.js'
import type { AnyDocument, AnySchema, AnyZBSearch, SearchableType } from '../types.js'
import { getNested } from '../utils.js'
import { addSearchablePropertyToIndex, type Index } from './index.js'
import { addSortablePropertyToSorter, type Sorter } from './sorter.js'

function inferTypeFromValue(value: unknown): SearchableType | undefined {
  switch (typeof value) {
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return undefined
    }

    const innerType = inferTypeFromValue(value[0])
    if (innerType === 'string' || innerType === 'number' || innerType === 'boolean') {
      return `${innerType}[]` as SearchableType
    }

    return undefined
  }

  // getDocumentProperties already treats any object with numeric lat/lon as
  // a geopoint value, so inferring `geopoint` is the only consistent choice.
  if (typeof value === 'object' && value !== null) {
    const point = value as { lat?: unknown; lon?: unknown }
    if (typeof point.lat === 'number' && typeof point.lon === 'number') {
      return 'geopoint'
    }
  }

  return undefined
}

function flattenDocument(doc: AnyDocument, prefix: string, leaves: Array<[string, unknown]>): void {
  for (const [key, value] of Object.entries(doc)) {
    if (key === 'id' || key === RESERVED_VECTOR_INDEX_KEY) {
      continue
    }

    if (value === null || typeof value === 'undefined') {
      continue
    }

    const path = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'object' && !Array.isArray(value)) {
      if (typeof (value as AnyDocument).lat === 'number' && typeof (value as AnyDocument).lon === 'number') {
        leaves.push([path, value])
        continue
      }

      flattenDocument(value as AnyDocument, path, leaves)
      continue
    }

    leaves.push([path, value])
  }
}

function setNestedSchemaProperty(schema: AnySchema, path: string, type: SearchableType): void {
  const tokens = path.split('.')
  const lastToken = tokens[tokens.length - 1]!

  let current = schema
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i]!
    const next = current[token]
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      current[token] = {}
    }
    current = current[token] as AnySchema
  }

  current[lastToken] = type
}

/**
 * Infers schema types for document properties that are not yet known to the
 * index, registering the corresponding index and sorter structures on the fly.
 *
 * Vectors and enums are never inferred: vectors must be declared in the
 * schema (e.g. `vector[512]`), and enums are only reachable through an
 * explicit schema. Objects with numeric `lat`/`lon` are inferred as
 * `geopoint`, mirroring how getDocumentProperties treats them.
 *
 * Returns `true` when at least one new property was registered.
 */
export function inferSchemaFromDocument<T extends AnyZBSearch>(zbsearch: T, doc: AnyDocument): boolean {
  if (!zbsearch.inferSchema) {
    return false
  }

  const leaves: Array<[string, unknown]> = []
  flattenDocument(doc, '', leaves)

  const index = zbsearch.data.index as Index
  const sorter = zbsearch.data.sorting as Sorter
  const knownProperties = zbsearch.index.getSearchablePropertiesWithTypes(index)

  let changed = false

  for (const [path, value] of leaves) {
    const knownType = knownProperties[path]
    if (knownType) {
      // The index already knows this property (e.g. after load()): make sure
      // the runtime schema reflects its type so validateSchema keeps
      // enforcing it.
      if (getNested(zbsearch.schema as object, path) !== knownType) {
        setNestedSchemaProperty(zbsearch.schema as AnySchema, path, knownType)
      }
      continue
    }

    const type = inferTypeFromValue(value)
    if (!type) {
      continue
    }

    addSearchablePropertyToIndex(zbsearch, index, path, type)
    addSortablePropertyToSorter(sorter, path, type)
    setNestedSchemaProperty(zbsearch.schema as AnySchema, path, type)

    knownProperties[path] = type
    changed = true
  }

  if (changed) {
    zbsearch.caches = {}
  }

  return changed
}
