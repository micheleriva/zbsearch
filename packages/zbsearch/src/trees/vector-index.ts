import { RESERVED_VECTOR_INDEX_KEY } from '../constants.js'
import type {
  IndexesConfig,
  VectorBinarySnapshot,
  VectorIndexConfig,
  VectorIndexContext,
  VectorIndexFactory,
  VectorIndexLike
} from '../types.js'
import { createError } from '../errors.js'
import { VectorIndex } from './vector.js'

function createFactory(
  kind: VectorIndexFactory['kind'],
  create: (ctx: VectorIndexContext) => VectorIndexLike,
  fromJSON: (json: unknown) => VectorIndexLike,
  fromBinarySnapshot?: (snapshot: VectorBinarySnapshot) => VectorIndexLike
): VectorIndexFactory {
  return Object.assign(create, { kind, fromJSON, fromBinarySnapshot })
}

export function createFlatVectorIndexFactory(): VectorIndexFactory {
  return createFactory(
    'flat',
    (ctx) => new VectorIndex(ctx.dim),
    (json) => VectorIndex.fromJSON(json),
    (snapshot) => VectorIndex.fromBinarySnapshot(snapshot)
  )
}

export const defaultFlatVectorIndexFactory = createFlatVectorIndexFactory()

export function resolveVectorIndexFactory(property: string, indexes?: IndexesConfig): VectorIndexFactory {
  if (!indexes) {
    return defaultFlatVectorIndexFactory
  }

  const propertyConfig = property === RESERVED_VECTOR_INDEX_KEY ? undefined : indexes[property]
  if (propertyConfig !== undefined) {
    return resolveVectorIndexConfig(propertyConfig)
  }

  const defaultConfig = indexes[RESERVED_VECTOR_INDEX_KEY]
  if (defaultConfig !== undefined) {
    return resolveVectorIndexConfig(defaultConfig)
  }

  return defaultFlatVectorIndexFactory
}

export function resolveVectorIndexConfig(config: VectorIndexConfig): VectorIndexFactory {
  if (config === 'flat') {
    return defaultFlatVectorIndexFactory
  }

  return config
}

export function deserializeVectorIndex(
  property: string,
  raw: unknown,
  indexes?: IndexesConfig
): ReturnType<VectorIndexFactory> {
  const payload = raw as { kind?: string }
  const kind = payload.kind ?? 'flat'
  const factory = resolveVectorIndexFactory(property, indexes)

  if (kind === 'ivf' && factory.kind !== 'ivf') {
    throw createError('IVF_INDEX_REQUIRES_FACTORY', property, property)
  }

  return factory.fromJSON(raw)
}

/**
 * Restores a vector index from the binary snapshot written by `saveBinary`, through the factory configured for
 * `property`. The snapshot `meta.kind` must match the factory kind.
 */
export function deserializeVectorIndexBinary(
  property: string,
  snapshot: VectorBinarySnapshot,
  indexes?: IndexesConfig
): ReturnType<VectorIndexFactory> {
  const kind = typeof snapshot.meta.kind === 'string' ? snapshot.meta.kind : 'flat'
  const factory = resolveVectorIndexFactory(property, indexes)

  if (kind !== factory.kind) {
    if (kind === 'ivf') {
      throw createError('IVF_INDEX_REQUIRES_FACTORY', property, property)
    }
    throw createError('VECTOR_INDEX_KIND_MISMATCH', property, kind, factory.kind, property)
  }

  if (typeof factory.fromBinarySnapshot !== 'function') {
    throw createError('VECTOR_INDEX_BINARY_UNSUPPORTED', property, factory.kind)
  }

  return factory.fromBinarySnapshot(snapshot)
}
