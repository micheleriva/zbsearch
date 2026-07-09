export function getMagnitude(vector: Float32Array, vectorLength: number): number {
  let magnitude = 0
  for (let i = 0; i < vectorLength; i++) {
    magnitude += vector[i] * vector[i]
  }
  return Math.sqrt(magnitude)
}

export function normalizeVector(vector: Float32Array, vectorLength: number): number {
  let magnitudeSq = 0
  for (let i = 0; i < vectorLength; i++) {
    magnitudeSq += vector[i] * vector[i]
  }

  const magnitude = Math.sqrt(magnitudeSq)
  if (magnitude === 0) {
    return 0
  }

  const invMagnitude = 1 / magnitude
  for (let i = 0; i < vectorLength; i++) {
    vector[i] *= invMagnitude
  }

  return magnitude
}

export function dotProduct(targetVector: Float32Array, vector: Float32Array, length: number): number {
  let sum = 0
  let i = 0
  const limit = length - 3

  for (; i < limit; i += 4) {
    sum +=
      targetVector[i]! * vector[i]! +
      targetVector[i + 1]! * vector[i + 1]! +
      targetVector[i + 2]! * vector[i + 2]! +
      targetVector[i + 3]! * vector[i + 3]!
  }

  for (; i < length; i++) {
    sum += targetVector[i]! * vector[i]!
  }

  return sum > 1 ? 1 : sum < -1 ? -1 : sum
}

export function nearestCentroidIndex(vector: Float32Array, centroids: Float32Array[], length: number): number {
  let bestIndex = 0
  let bestScore = -Infinity

  for (let i = 0; i < centroids.length; i++) {
    const score = dotProduct(vector, centroids[i]!, length)
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }

  return bestIndex
}
