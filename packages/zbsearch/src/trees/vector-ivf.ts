import type { InternalDocumentID } from '../components/internal-document-id-store.js'
import type { VectorIndexContext, VectorIndexFactory, VectorIndexLike } from '../types.js'
import { dotProduct, nearestCentroidIndex, normalizeVector } from './vector-math.js'
import { findSimilarVectors, type SimilarVector, type VectorType, type VectorTypeLike } from './vector.js'

export interface IvfOptions {
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

function initializeCentroids(vectors: Float32Array[], nlist: number, dim: number): Float32Array[] {
  const centroids: Float32Array[] = Array.from({ length: nlist }, () => new Float32Array(dim))
  const count = vectors.length

  if (count === 0) {
    return centroids
  }

  centroids[0] = new Float32Array(vectors[Math.floor(Math.random() * count)]!)
  normalizeVector(centroids[0]!, dim)

  const distances = new Float32Array(count)

  for (let c = 1; c < nlist; c++) {
    let distanceSum = 0

    for (let i = 0; i < count; i++) {
      let minDistance = Infinity
      for (let j = 0; j < c; j++) {
        const similarity = dotProduct(vectors[i]!, centroids[j]!, dim)
        const distance = 1 - similarity
        if (distance < minDistance) {
          minDistance = distance
        }
      }
      distances[i] = minDistance
      distanceSum += minDistance
    }

    let threshold = Math.random() * distanceSum
    let chosen = count - 1
    for (let i = 0; i < count; i++) {
      threshold -= distances[i]!
      if (threshold <= 0) {
        chosen = i
        break
      }
    }

    centroids[c] = new Float32Array(vectors[chosen]!)
    normalizeVector(centroids[c]!, dim)
  }

  return centroids
}

function trainCentroids(vectors: Float32Array[], nlist: number, dim: number): Float32Array[] {
  const count = vectors.length
  const centroids = initializeCentroids(vectors, nlist, dim)
  const assignments = new Uint32Array(count)

  for (let iter = 0; iter < 20; iter++) {
    let changed = false

    for (let i = 0; i < count; i++) {
      const cluster = nearestCentroidIndex(vectors[i]!, centroids, dim)
      if (assignments[i] !== cluster) {
        assignments[i] = cluster
        changed = true
      }
    }

    if (!changed) {
      break
    }

    const counts = new Array<number>(nlist).fill(0)
    const sums = Array.from({ length: nlist }, () => new Float32Array(dim))

    for (let i = 0; i < count; i++) {
      const cluster = assignments[i]!
      counts[cluster]!++
      const vector = vectors[i]!
      const sum = sums[cluster]!
      for (let d = 0; d < dim; d++) {
        sum[d] += vector[d]!
      }
    }

    for (let c = 0; c < nlist; c++) {
      if (counts[c] === 0) {
        continue
      }

      const inv = 1 / counts[c]!
      const centroid = centroids[c]!
      const sum = sums[c]!
      for (let d = 0; d < dim; d++) {
        centroid[d] = sum[d]! * inv
      }
      normalizeVector(centroid, dim)
    }
  }

  return centroids
}

function getProbeCentroids(
  queryVector: Float32Array,
  centroids: Float32Array[],
  nprobe: number,
  dim: number
): number[] {
  const scores = centroids.map((centroid, index) => [index, dotProduct(queryVector, centroid, dim)] as const)
  scores.sort((a, b) => b[1] - a[1])
  return scores.slice(0, Math.min(nprobe, scores.length)).map(([index]) => index)
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
    const stored = value instanceof Float32Array ? new Float32Array(value) : new Float32Array(value)
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

  find(
    vector: VectorTypeLike,
    similarity: number,
    whereFiltersIDs: Set<InternalDocumentID> | undefined
  ): SimilarVector[] {
    const queryVector = vector instanceof Float32Array ? new Float32Array(vector) : new Float32Array(vector)
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
  return Object.assign(
    (ctx: VectorIndexContext) => {
      const dim = options.dim ?? ctx.dim
      const nlist = options.nlist ?? 64
      const nprobe = options.nprobe ?? Math.max(1, Math.min(32, Math.floor(nlist / 4)))
      const trainMin = options.trainMin ?? Math.min(nlist, 32)

      return new IVFVectorIndex(dim, nlist, nprobe, trainMin)
    },
    {
      kind: 'ivf' as const,
      fromJSON: IVFVectorIndex.fromJSON
    }
  )
}
