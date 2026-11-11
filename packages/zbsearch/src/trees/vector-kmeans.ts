import { dotProduct, nearestCentroidIndex, normalizeVector } from './vector-math.js'

function initializeCentroids(vectors: Float32Array[], nlist: number, dim: number): Float32Array[] {
  const centroids: Float32Array[] = Array.from({ length: nlist }, () => new Float32Array(dim))
  const count = vectors.length

  if (count === 0) {
    return centroids
  }

  centroids[0] = new Float32Array(vectors[Math.floor(Math.random() * count)]!)
  normalizeVector(centroids[0]!, dim)

  // distances[i] is the distance from vector i to its nearest chosen centroid. It is updated with the newest
  // centroid only, so k-means++ seeding costs O(count * nlist) dot products instead of O(count * nlist²).
  const distances = new Float32Array(count).fill(Infinity)

  for (let c = 1; c < nlist; c++) {
    let distanceSum = 0
    const newest = centroids[c - 1]!

    for (let i = 0; i < count; i++) {
      const distance = 1 - dotProduct(vectors[i]!, newest, dim)
      if (distance < distances[i]!) {
        distances[i] = distance
      }
      distanceSum += distances[i]!
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

export function trainCentroids(vectors: Float32Array[], nlist: number, dim: number): Float32Array[] {
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

export function getProbeCentroids(
  queryVector: Float32Array,
  centroids: Float32Array[],
  nprobe: number,
  dim: number
): number[] {
  const scores = centroids.map((centroid, index) => [index, dotProduct(queryVector, centroid, dim)] as const)
  scores.sort((a, b) => b[1] - a[1])
  return scores.slice(0, Math.min(nprobe, scores.length)).map(([index]) => index)
}
