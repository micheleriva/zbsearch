import { createError } from '../errors.js'
import type { AnyDocument, AnySchema, AnyZBSearch, Result, StoreConfig, StoreSettings } from '../types.js'
import { isVectorType } from './defaults.js'
import { getInternalDocumentId } from './internal-document-id-store.js'
import { cloneWithValueAtPath, copyDocument, placeholderProperty } from '../utils.js'

// The settings of a database that was not built by `create` (or that predates `store`): everything is stored.
const LEGACY_STORE_SETTINGS: StoreSettings = { exclude: [], vectors: true }

const STORE_CACHE_KEY = 'store'

type PathTree = { [key: string]: PathTree | true }

/**
 * What the store settings mean for the current schema, computed once and kept in `zbsearch.caches` (which schema
 * inference and `load` clear).
 */
export interface StoreLayout {
  // Searchable properties left out of the documents store because `store.exclude` names them
  excluded: Set<string>
  // Searchable properties whose values the documents store does not keep: `excluded` plus, unless
  // `store.vectors` is set, every vector property
  unstored: Set<string>
  // The paths to drop from a document before storing it, as a tree of keys, or undefined if there are none
  omit: PathTree | undefined
}

export function resolveStoreConfig(config: StoreConfig | undefined): StoreSettings {
  if (config === undefined || config === null) {
    return { exclude: [], vectors: false }
  }

  if (typeof config !== 'object' || Array.isArray(config)) {
    throw createError('INVALID_STORE_CONFIG', 'expected an object')
  }

  const { exclude = [], vectors = false } = config

  if (!Array.isArray(exclude) || exclude.some((path) => typeof path !== 'string' || path.length === 0)) {
    throw createError('INVALID_STORE_CONFIG', '"exclude" must be an array of non-empty property paths')
  }

  if (typeof vectors !== 'boolean') {
    throw createError('INVALID_STORE_CONFIG', '"vectors" must be a boolean')
  }

  return { exclude: Array.from(new Set(exclude)), vectors }
}

export function getStoreSettings<T extends AnyZBSearch>(zbsearch: T): StoreSettings {
  return zbsearch.store ?? LEGACY_STORE_SETTINGS
}

function isUnderPath(prop: string, path: string): boolean {
  return prop === path || prop.startsWith(`${path}.`)
}

/**
 * Whether `store.exclude` leaves `prop` out of the documents store.
 */
export function isExcludedFromStore(settings: StoreSettings | undefined, prop: string): boolean {
  return settings !== undefined && settings.exclude.some((path) => isUnderPath(prop, path))
}

/**
 * Throws if `settings` leaves a searchable, non-vector property of `indexData` out of the documents store while the
 * index component cannot remove such values (it has no `removeUnstored`): removing those documents would leave
 * their entries in the index. `create` and schema inference run the same check; this one covers loaded snapshots,
 * whose store settings and inferred properties can differ from the ones given to `create`.
 */
export function assertUnstoredPropertiesRemovable<T extends AnyZBSearch>(
  zbsearch: T,
  indexData: unknown,
  settings: StoreSettings | undefined,
  previousIdStore: unknown
): void {
  if (zbsearch.index.removeUnstored || settings === undefined || settings.exclude.length === 0) {
    return
  }
  const types = zbsearch.index.getSearchablePropertiesWithTypes(indexData as T['data']['index'])
  for (const [prop, type] of Object.entries(types)) {
    if (!isVectorType(type) && isExcludedFromStore(settings, prop)) {
      // The loaders replace the ID store before loading the index (the index needs it): put it back, so a refused
      // snapshot leaves the database as it was.
      zbsearch.internalDocumentIDStore.load(zbsearch, previousIdStore)
      throw createError('UNSTORED_PROPERTIES_NOT_SUPPORTED', prop)
    }
  }
}

/**
 * The `string` properties of `schema` that `store.exclude` leaves out of the documents store. They are not sortable:
 * the sorter keeps its own copy of every sortable value, which would keep the excluded text in memory.
 */
export function getExcludedStringProperties(settings: StoreSettings, schema: AnySchema, prefix = ''): string[] {
  const properties: string[] = []
  if (settings.exclude.length === 0) {
    return properties
  }

  for (const [key, type] of Object.entries(schema)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof type === 'object' && type !== null && !Array.isArray(type)) {
      properties.push(...getExcludedStringProperties(settings, type as AnySchema, path))
    } else if (type === 'string' && isExcludedFromStore(settings, path)) {
      properties.push(path)
    }
  }

  return properties
}

function addPath(tree: PathTree, path: string): void {
  const keys = path.split('.')
  let node = tree
  for (let i = 0; i < keys.length - 1; i++) {
    const child = node[keys[i]]
    if (child === true) {
      // An ancestor is already omitted
      return
    }
    node = node[keys[i]] = child ?? {}
  }
  node[keys[keys.length - 1]] = true
}

export function getStoreLayout<T extends AnyZBSearch>(zbsearch: T): StoreLayout {
  const cached = zbsearch.caches[STORE_CACHE_KEY] as StoreLayout | undefined
  if (cached) {
    return cached
  }

  const settings = getStoreSettings(zbsearch)
  const properties = zbsearch.index.getSearchableProperties(zbsearch.data.index)
  const types = zbsearch.index.getSearchablePropertiesWithTypes(zbsearch.data.index)

  const excluded = new Set<string>()
  const unstored = new Set<string>()
  const omitted: string[] = [...settings.exclude]

  for (const prop of properties) {
    if (isExcludedFromStore(settings, prop)) {
      excluded.add(prop)
      unstored.add(prop)
    } else if (!settings.vectors && isVectorType(types[prop])) {
      unstored.add(prop)
      omitted.push(prop)
    }
  }

  let omit: PathTree | undefined
  if (omitted.length > 0) {
    omit = {}
    // Shorter paths first, so that a path also omitted by one of its ancestors is skipped
    for (const path of omitted.sort((a, b) => a.length - b.length)) {
      addPath(omit, path)
    }
  }

  const layout: StoreLayout = { excluded, unstored, omit }
  zbsearch.caches[STORE_CACHE_KEY] = layout

  return layout
}

function isPlainObject(value: unknown): value is AnyDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Returns `doc` without the paths of `tree`. A document that changes is copied as `cloneWithDataProperty` copies it:
// its prototype and the own properties that are kept (non-enumerable ones and accessors included) are preserved.
// A path the document inherits (e.g. a getter of its class) is hidden on the copy by a placeholder own property.
// The copy of a class instance with getters or methods reads them from the instance, which it keeps referenced
// (see `copyDocument`).
function omitTree(doc: AnyDocument, tree: PathTree): AnyDocument {
  let descriptors: PropertyDescriptorMap | undefined

  for (const key of Object.keys(tree)) {
    const own = Object.hasOwn(doc, key)
    if (!own && !(key in doc)) {
      continue
    }

    const subtree = tree[key]
    if (subtree === true) {
      descriptors ??= Object.getOwnPropertyDescriptors(doc)
      if (own) {
        delete descriptors[key]
      } else {
        descriptors[key] = placeholderProperty(undefined)
      }
      continue
    }

    const child = doc[key]
    if (!isPlainObject(child)) {
      continue
    }

    const omittedChild = omitTree(child, subtree)
    if (omittedChild !== child) {
      descriptors ??= Object.getOwnPropertyDescriptors(doc)
      descriptors[key] = own
        ? {
            value: omittedChild,
            writable: true,
            enumerable: descriptors[key]?.enumerable ?? true,
            configurable: true
          }
        : placeholderProperty(omittedChild)
    }
  }

  return descriptors ? copyDocument(doc, descriptors) : doc
}

/**
 * Returns the document the documents store keeps: the document itself when nothing has to be left out, otherwise a
 * copy without the unstored properties (the objects on the way to them are copied, keeping their prototype and their
 * other own properties; the inserted document is never modified).
 */
export function getStoredDocument<T extends AnyZBSearch>(zbsearch: T, doc: AnyDocument): AnyDocument {
  const { omit } = getStoreLayout(zbsearch)
  return omit ? omitTree(doc, omit) : doc
}

/**
 * Throws if the documents store does not keep `prop`: facets, groups and `distinctOn` read the stored documents.
 * That is the case of any path `store.exclude` covers, searchable or not (`distinctOn` takes any path), and of vector
 * properties unless `store.vectors` is set.
 */
export function assertPropertyIsStored<T extends AnyZBSearch>(zbsearch: T, prop: string, usage: string): void {
  if (isExcludedFromStore(getStoreSettings(zbsearch), prop)) {
    throw createError('PROPERTY_NOT_STORED', prop, usage)
  }
  if (getStoreLayout(zbsearch).unstored.has(prop)) {
    throw createError('VECTOR_NOT_STORED', prop, usage)
  }
}

function getAtPath(doc: AnyDocument, keys: string[]): unknown {
  let value: unknown = doc
  for (const key of keys) {
    if (!isPlainObject(value)) {
      return undefined
    }
    value = value[key]
  }
  return value
}

/**
 * Sets the vectors of the search hits: with `includeVectors`, the vectors that are not in the documents store are
 * rebuilt from the vector index (normalized, as the index holds them); otherwise the vector properties in
 * `vectorProperties` are set to `null`. The stored documents are never modified: hits that change get a copy that
 * keeps the document's prototype and own properties (see `cloneWithValueAtPath`).
 */
export function setHitsVectors<T extends AnyZBSearch>(
  zbsearch: T,
  hits: Result<unknown>[],
  includeVectors: boolean,
  vectorProperties: string[]
): void {
  const vectorIndexes = zbsearch.data.index.vectorIndexes

  if (includeVectors) {
    const { unstored } = getStoreLayout(zbsearch)
    const properties = Object.keys(vectorIndexes).filter((prop) => unstored.has(prop))
    if (properties.length === 0) {
      return
    }

    const paths = properties.map((prop) => prop.split('.'))
    for (const hit of hits) {
      let doc = hit.document as AnyDocument
      if (doc == null) {
        continue
      }
      let internalId: number | undefined

      for (let i = 0; i < properties.length; i++) {
        if (getAtPath(doc, paths[i]) !== undefined) {
          // Stored before the property was unstored, e.g. in a snapshot of an older version
          continue
        }
        internalId ??= getInternalDocumentId(zbsearch.internalDocumentIDStore, hit.id)
        const vector = vectorIndexes[properties[i]].node.getVector?.(internalId)
        if (vector) {
          doc = cloneWithValueAtPath(doc, paths[i], Array.from(vector))
        }
      }

      hit.document = doc
    }
    return
  }

  if (vectorProperties.length === 0) {
    return
  }

  const paths = vectorProperties.map((prop) => prop.split('.'))
  for (const hit of hits) {
    let doc = hit.document as AnyDocument
    if (doc == null) {
      continue
    }
    for (const keys of paths) {
      doc = cloneWithValueAtPath(doc, keys, null)
    }
    hit.document = doc
  }
}
