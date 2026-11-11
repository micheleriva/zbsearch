import type { InternalDocumentID } from '../components/internal-document-id-store.js'
import type { VectorIndexContext, VectorIndexFactory, VectorIndexLike } from '../types.js'
import { getProbeCentroids, trainCentroids } from './vector-kmeans.js'
import { nearestCentroidIndex, normalizeVector } from './vector-math.js'
import {
  findSimilarVectors,
  quantizerFactories,
  type SimilarVector,
  type VectorType,
  type VectorTypeLike
} from './vector.js'
import { isQuantizedVectorIndexPayload, QuantizedVectorIndex } from './vector-quantized.js'
import {
  resolveQuantizer,
  resolveRescore,
  type QuantizationOptions,
  type VectorBinarySnapshot
} from './vector-quantization.js'

export interface IvfOptions extends QuantizationOptions {
  dim?: number
  nlist?: number
  nprobe?: number
  trainMin?: number
}

interface IvfJSON {
  kind: 'ivf'
  size: number
  nlist: number
  nprobe: number
  trainMin: number
  trained: boolean
  centroids: number[][]
  lists: InternalDocumentID[][]
  vectors: [InternalDocumentID, number[]][]
}

function removeFromList(list: InternalDocumentID[], id: InternalDocumentID) {
  const index = list.indexOf(id)
  if (index === -1) {
    return
  }

  const lastIndex = list.length - 1
  if (index !== lastIndex) {
    list[index] = list[lastIndex]!
  }
  list.pop()
}

export class IVFVectorIndex implements VectorIndexLike {
  private vectors = new Map<InternalDocumentID, VectorType>()
  private lists: InternalDocumentID[][] = []
  private idToCluster = new Map<InternalDocumentID, number>()
  private centroids: Float32Array[] = []
  private trained = false

  constructor(
    public readonly size: number,
    public readonly nlist: number,
    public readonly nprobe: number,
    public readonly trainMin: number
  ) {
    this.lists = Array.from({ length: nlist }, () => [])
  }

  add(internalDocumentId: InternalDocumentID, value: VectorTypeLike) {
    const stored = new Float32Array(value)
    normalizeVector(stored, this.size)

    const previousCluster = this.idToCluster.get(internalDocumentId)
    if (previousCluster !== undefined) {
      removeFromList(this.lists[previousCluster]!, internalDocumentId)
    }

    this.vectors.set(internalDocumentId, stored)

    if (!this.trained) {
      if (this.vectors.size >= this.trainMin) {
        this.train()
      }
      return
    }

    const cluster = nearestCentroidIndex(stored, this.centroids, this.size)
    this.idToCluster.set(internalDocumentId, cluster)
    this.lists[cluster]!.push(internalDocumentId)
  }

  remove(internalDocumentId: InternalDocumentID) {
    const cluster = this.idToCluster.get(internalDocumentId)
    if (cluster !== undefined) {
      removeFromList(this.lists[cluster]!, internalDocumentId)
      this.idToCluster.delete(internalDocumentId)
    }

    this.vectors.delete(internalDocumentId)
  }

  // The normalized copy of the vector, as the index searches on it
  getVector(internalDocumentId: InternalDocumentID): VectorType | undefined {
    return this.vectors.get(internalDocumentId)
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

    if (!this.trained) {
      const bruteForceVectors = new Map<InternalDocumentID, [1, VectorType]>()
      for (const [id, stored] of this.vectors) {
        bruteForceVectors.set(id, [1, stored])
      }
      return findSimilarVectors(queryVector, whereFiltersIDs, bruteForceVectors, this.size, similarity)
    }

    const probeCentroids = getProbeCentroids(queryVector, this.centroids, this.nprobe, this.size)
    const candidateIds = new Set<InternalDocumentID>()

    for (const cluster of probeCentroids) {
      const list = this.lists[cluster]!
      for (let i = 0; i < list.length; i++) {
        const id = list[i]!
        if (!whereFiltersIDs || whereFiltersIDs.has(id)) {
          candidateIds.add(id)
        }
      }
    }

    const candidateVectors = new Map<InternalDocumentID, [1, VectorType]>()
    for (const id of candidateIds) {
      const stored = this.vectors.get(id)
      if (stored) {
        candidateVectors.set(id, [1, stored])
      }
    }

    return findSimilarVectors(queryVector, undefined, candidateVectors, this.size, similarity)
  }

  private train() {
    const entries = Array.from(this.vectors.entries())
    const vectors = entries.map(([, vector]) => vector)
    this.centroids = trainCentroids(vectors, this.nlist, this.size)

    for (let i = 0; i < this.nlist; i++) {
      this.lists[i] = []
    }
    this.idToCluster.clear()

    for (const [id, vector] of entries) {
      const cluster = nearestCentroidIndex(vector, this.centroids, this.size)
      this.idToCluster.set(id, cluster)
      this.lists[cluster]!.push(id)
    }

    this.trained = true
  }

  toJSON(): IvfJSON {
    const vectors: [InternalDocumentID, number[]][] = []
    for (const [id, vector] of this.vectors) {
      vectors.push([id, Array.from(vector)])
    }

    return {
      kind: 'ivf',
      size: this.size,
      nlist: this.nlist,
      nprobe: this.nprobe,
      trainMin: this.trainMin,
      trained: this.trained,
      centroids: this.centroids.map((centroid) => Array.from(centroid)),
      lists: this.lists.map((list) => [...list]),
      vectors
    }
  }

  toBinarySnapshot(): VectorBinarySnapshot {
    const ids = new Uint32Array(this.vectors.size)
    const vectors = new Float32Array(this.vectors.size * this.size)
    const clusters = new Int32Array(this.vectors.size)
    let i = 0
    for (const [id, vector] of this.vectors) {
      ids[i] = id
      vectors.set(vector, i * this.size)
      clusters[i] = this.idToCluster.get(id) ?? -1
      i++
    }

    const centroids = new Float32Array(this.centroids.length * this.size)
    this.centroids.forEach((centroid, index) => centroids.set(centroid, index * this.size))

    return {
      meta: {
        kind: 'ivf',
        size: this.size,
        nlist: this.nlist,
        nprobe: this.nprobe,
        trainMin: this.trainMin,
        trained: this.trained,
        count: ids.length
      },
      arrays: { ids, vectors, clusters, centroids }
    }
  }

  static fromBinarySnapshot(snapshot: VectorBinarySnapshot): IVFVectorIndex {
    const meta = snapshot.meta as { size: number; nlist: number; nprobe: number; trainMin: number; trained: boolean }
    const { ids, vectors, clusters, centroids } = snapshot.arrays as {
      ids: Uint32Array
      vectors: Float32Array
      clusters: Int32Array
      centroids: Float32Array
    }
    const size = meta.size
    const index = new IVFVectorIndex(size, meta.nlist, meta.nprobe, meta.trainMin)
    index.trained = meta.trained
    for (let c = 0; c < centroids.length / size; c++) {
      index.centroids.push(centroids.slice(c * size, (c + 1) * size))
    }
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!
      index.vectors.set(id, vectors.slice(i * size, (i + 1) * size))
      const cluster = clusters[i]!
      if (cluster >= 0) {
        index.idToCluster.set(id, cluster)
        index.lists[cluster]!.push(id)
      }
    }
    return index
  }

  static fromJSON(json: unknown): IVFVectorIndex {
    const raw = json as IvfJSON
    const index = new IVFVectorIndex(raw.size, raw.nlist, raw.nprobe, raw.trainMin)
    index.trained = raw.trained
    index.centroids = raw.centroids.map((centroid) => {
      const stored = new Float32Array(centroid)
      normalizeVector(stored, raw.size)
      return stored
    })
    index.lists = raw.lists.map((list) => [...list])

    for (const [id, vector] of raw.vectors) {
      const stored = new Float32Array(vector)
      normalizeVector(stored, raw.size)
      index.vectors.set(id, stored)
      if (raw.trained && index.centroids.length > 0) {
        index.idToCluster.set(id, nearestCentroidIndex(stored, index.centroids, raw.size))
      }
    }

    return index
  }
}

export function ivf(options: IvfOptions = {}): VectorIndexFactory {
  const quantizer = resolveQuantizer(options.quantization)
  const rescorer = resolveRescore(options.rescore)
  const factories = quantizerFactories(quantizer)

  if (rescorer && !quantizer) {
    throw new Error('The rescore option requires a quantization other than "none".')
  }

  const fromJSON = (json: unknown): VectorIndexLike =>
    isQuantizedVectorIndexPayload(json) ? QuantizedVectorIndex.fromJSON(json, factories) : IVFVectorIndex.fromJSON(json)

  const fromBinarySnapshot = (snapshot: VectorBinarySnapshot): VectorIndexLike =>
    isQuantizedVectorIndexPayload(snapshot)
      ? QuantizedVectorIndex.fromBinarySnapshot(snapshot, factories)
      : IVFVectorIndex.fromBinarySnapshot(snapshot)

  return Object.assign(
    (ctx: VectorIndexContext): VectorIndexLike => {
      const dim = options.dim ?? ctx.dim
      const nlist = options.nlist ?? 64
      const nprobe = options.nprobe ?? Math.max(1, Math.min(32, Math.floor(nlist / 4)))
      const trainMin = options.trainMin ?? Math.min(nlist, 32)

      if (!quantizer) {
        return new IVFVectorIndex(dim, nlist, nprobe, trainMin)
      }

      return new QuantizedVectorIndex({
        dim,
        quantizer: quantizer.create(dim),
        rescorer: rescorer?.create(dim),
        oversample: options.oversample,
        rescoreMargin: options.rescoreMargin,
        ivf: { nlist, nprobe, trainMin }
      })
    },
    {
      kind: 'ivf' as const,
      fromJSON,
      fromBinarySnapshot
    }
  )
}
