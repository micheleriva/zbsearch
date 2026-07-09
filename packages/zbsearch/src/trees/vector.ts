import type { InternalDocumentID } from '../components/internal-document-id-store.js'
import type { VectorIndexContext, VectorIndexFactory, VectorIndexLike } from '../types.js'
import { dotProduct, getMagnitude, normalizeVector } from './vector-math.js'

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
    const stored = value instanceof Float32Array ? new Float32Array(value) : new Float32Array(value)
    normalizeVector(stored, this.size)
    this.vectors.set(internalDocumentId, [1, stored])
  }

  remove(internalDocumentId: InternalDocumentID) {
    this.vectors.delete(internalDocumentId)
  }

  find(
    vector: VectorTypeLike,
    similarity: number,
    whereFiltersIDs: Set<InternalDocumentID> | undefined
  ): SimilarVector[] {
    const queryVector = vector instanceof Float32Array ? new Float32Array(vector) : new Float32Array(vector)
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

  public static fromJSON(json: unknown): VectorIndex {
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

export function flat(): VectorIndexFactory {
  return Object.assign((ctx: VectorIndexContext) => new VectorIndex(ctx.dim), {
    kind: 'flat' as const,
    fromJSON: VectorIndex.fromJSON
  })
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
