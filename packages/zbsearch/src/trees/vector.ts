import type { InternalDocumentID } from '../components/internal-document-id-store.js'
import type { VectorIndexContext, VectorIndexFactory, VectorIndexLike } from '../types.js'
import { dotProduct, normalizeVector } from './vector-math.js'
import { isQuantizedVectorIndexPayload, QuantizedVectorIndex } from './vector-quantized.js'
import {
  resolveQuantizer,
  resolveRescore,
  type QuantizationOptions,
  type VectorBinarySnapshot,
  type VectorQuantizerFactory
} from './vector-quantization.js'

export type Magnitude = number
export type VectorType = Float32Array
export type VectorTypeLike = number[] | VectorType

export type SimilarVector = [number, number]

export const DEFAULT_SIMILARITY = 0.8

export { getMagnitude, normalizeVector, dotProduct } from './vector-math.js'

export class VectorIndex implements VectorIndexLike {
  private vectors: Map<InternalDocumentID, [Magnitude, VectorType]> = new Map()

  constructor(public size: number) {}

  add(internalDocumentId: InternalDocumentID, value: VectorTypeLike) {
    const stored = new Float32Array(value)
    normalizeVector(stored, this.size)
    this.vectors.set(internalDocumentId, [1, stored])
  }

  remove(internalDocumentId: InternalDocumentID) {
    this.vectors.delete(internalDocumentId)
  }

  // The normalized copy of the vector, as the index searches on it
  getVector(internalDocumentId: InternalDocumentID): VectorType | undefined {
    return this.vectors.get(internalDocumentId)?.[1]
  }

  find(
    vector: VectorTypeLike,
    similarity: number,
    whereFiltersIDs: Set<InternalDocumentID> | undefined
  ): SimilarVector[] {
    const queryVector = new Float32Array(vector)
    if (normalizeVector(queryVector, this.size) === 0) {
      return []
    }

    return findSimilarVectors(queryVector, whereFiltersIDs, this.vectors, this.size, similarity)
  }

  public toJSON(): { kind: 'flat'; size: number; vectors: [InternalDocumentID, [Magnitude, number[]]][] } {
    const vectors: [InternalDocumentID, [Magnitude, number[]]][] = []

    for (const [id, [magnitude, vector]] of this.vectors) {
      vectors.push([id, [magnitude, Array.from(vector)]])
    }

    return {
      kind: 'flat',
      size: this.size,
      vectors
    }
  }

  public toBinarySnapshot(): VectorBinarySnapshot {
    const ids = new Uint32Array(this.vectors.size)
    const vectors = new Float32Array(this.vectors.size * this.size)
    let i = 0
    for (const [id, [, vector]] of this.vectors) {
      ids[i] = id
      vectors.set(vector, i * this.size)
      i++
    }

    return { meta: { kind: 'flat', size: this.size, count: ids.length }, arrays: { ids, vectors } }
  }

  public static fromBinarySnapshot(snapshot: VectorBinarySnapshot): VectorIndex | QuantizedVectorIndex {
    if (isQuantizedVectorIndexPayload(snapshot)) {
      return QuantizedVectorIndex.fromBinarySnapshot(snapshot)
    }

    const size = Number(snapshot.meta.size)
    const ids = snapshot.arrays.ids as Uint32Array
    const vectors = snapshot.arrays.vectors as Float32Array
    const index = new VectorIndex(size)
    for (let i = 0; i < ids.length; i++) {
      index.vectors.set(ids[i]!, [1, vectors.slice(i * size, (i + 1) * size)])
    }
    return index
  }

  public static fromJSON(json: unknown): VectorIndex | QuantizedVectorIndex {
    if (isQuantizedVectorIndexPayload(json)) {
      // Built-in quantizers (int8, binary) can be restored without any indexes configuration.
      return QuantizedVectorIndex.fromJSON(json)
    }

    const raw = json as {
      kind?: string
      size: number
      vectors: [InternalDocumentID, [Magnitude, number[]]][]
    }

    const index = new VectorIndex(raw.size)
    for (const [id, [, vector]] of raw.vectors) {
      const stored = new Float32Array(vector)
      normalizeVector(stored, raw.size)
      index.vectors.set(id, [1, stored])
    }

    return index
  }
}

export type FlatOptions = QuantizationOptions

/**
 * Flat (exhaustive) vector index. Every query is compared with every stored vector.
 *
 * With `quantization: 'int8' | 'binary'` (or a quantizer from a plugin) vectors are stored as compact codes in one
 * contiguous buffer instead of one Float32Array per vector.
 */
export function flat(options: FlatOptions = {}): VectorIndexFactory {
  const quantizer = resolveQuantizer(options.quantization)
  const rescorer = resolveRescore(options.rescore)
  const factories = quantizerFactories(quantizer)

  if (!quantizer) {
    if (rescorer) {
      throw new Error('The rescore option requires a quantization other than "none".')
    }

    return Object.assign((ctx: VectorIndexContext) => new VectorIndex(ctx.dim), {
      kind: 'flat' as const,
      fromJSON: VectorIndex.fromJSON,
      fromBinarySnapshot: VectorIndex.fromBinarySnapshot
    })
  }

  return Object.assign(
    (ctx: VectorIndexContext) =>
      new QuantizedVectorIndex({
        dim: ctx.dim,
        quantizer: quantizer.create(ctx.dim),
        rescorer: rescorer?.create(ctx.dim),
        oversample: options.oversample,
        rescoreMargin: options.rescoreMargin
      }),
    {
      kind: 'flat' as const,
      fromJSON: (json: unknown): VectorIndexLike =>
        isQuantizedVectorIndexPayload(json)
          ? QuantizedVectorIndex.fromJSON(json, factories)
          : VectorIndex.fromJSON(json),
      fromBinarySnapshot: (snapshot: VectorBinarySnapshot): VectorIndexLike =>
        isQuantizedVectorIndexPayload(snapshot)
          ? QuantizedVectorIndex.fromBinarySnapshot(snapshot, factories)
          : VectorIndex.fromBinarySnapshot(snapshot)
    }
  )
}

export function quantizerFactories(
  quantizer: VectorQuantizerFactory | undefined
): Record<string, VectorQuantizerFactory | undefined> {
  return quantizer ? { [quantizer.kind]: quantizer } : {}
}

// @todo: Write plugins for Node and Browsers to use parallel computation for this function
export function findSimilarVectors(
  targetVector: Float32Array,
  keys: Set<InternalDocumentID> | undefined,
  vectors: Map<InternalDocumentID, [Magnitude, VectorType]>,
  length: number,
  threshold: number
): SimilarVector[] {
  const similarVectors: SimilarVector[] = []

  if (keys) {
    for (const vectorId of keys) {
      const entry = vectors.get(vectorId)
      if (!entry) {
        continue
      }

      const score = dotProduct(targetVector, entry[1], length)
      if (score >= threshold) {
        similarVectors.push([vectorId, score])
      }
    }

    return similarVectors
  }

  for (const [vectorId, [, vector]] of vectors) {
    const score = dotProduct(targetVector, vector, length)
    if (score >= threshold) {
      similarVectors.push([vectorId, score])
    }
  }

  return similarVectors
}
