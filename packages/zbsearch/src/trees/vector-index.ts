import { RESERVED_VECTOR_INDEX_KEY } from '../constants.js'
import type { IndexesConfig, VectorIndexConfig, VectorIndexContext, VectorIndexFactory } from '../types.js'
import { createError } from '../errors.js'
import { VectorIndex } from './vector.js'

function createFactory(
  kind: VectorIndexFactory['kind'],
  create: (ctx: VectorIndexContext) => VectorIndex,
  fromJSON: (json: unknown) => VectorIndex
): VectorIndexFactory {
  return Object.assign(create, { kind, fromJSON })
}

export function createFlatVectorIndexFactory(): VectorIndexFactory {
  return createFactory('flat', (ctx) => new VectorIndex(ctx.dim), (json) => VectorIndex.fromJSON(json))
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
