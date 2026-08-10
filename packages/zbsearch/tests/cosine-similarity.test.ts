import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIMILARITY,
  findSimilarVectors,
  getMagnitude,
  Magnitude,
  normalizeVector,
  VectorType
} from '../src/trees/vector.js'
import { InternalDocumentID } from '../src/components/internal-document-id-store.js'

function toF32(vector: number[]): Float32Array {
  return new Float32Array(vector)
}

describe('cosine similarity', () => {
  describe('getMagnitude', () => {
    it('should return the magnitude of a vector', async () => {
      {
        const vector = toF32([1, 0, 0, 0, 0, 0, 0, 0, 0, 0])
        const magnitude = getMagnitude(vector, vector.length)

        expect(magnitude).toBe(1)
      }

      {
        const vector = toF32([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
        const magnitude = getMagnitude(vector, vector.length)

        expect(magnitude).toBe(Math.sqrt(10))
      }

      {
        const vector = toF32([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
        const magnitude = getMagnitude(vector, vector.length)

        expect(magnitude).toBe(Math.sqrt(385))
      }
    })
  })

  describe('findSimilarVectors', () => {
    it('should return the most similar vectors', async () => {
      const targetVector = toF32([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
      normalizeVector(targetVector, targetVector.length)

      const vector2 = toF32([0, 1, 1, 1, 1, 1, 1, 1, 1, 1])
      normalizeVector(vector2, vector2.length)

      const vector3 = toF32([0, 0, 1, 1, 1, 1, 1, 1, 1, 1])
      normalizeVector(vector3, vector3.length)

      const vectors = new Map<InternalDocumentID, [Magnitude, VectorType]>([
        [1, [1, toF32([1, 0, 0, 0, 0, 0, 0, 0, 0, 0])]],
        [2, [1, vector2]],
        [3, [1, vector3]]
      ])

      const similarVectors = findSimilarVectors(
        targetVector,
        new Set(vectors.keys()),
        vectors,
        targetVector.length,
        DEFAULT_SIMILARITY
      )

      expect(similarVectors.length).toEqual(2)
      expect(similarVectors[0][0]).toEqual(2)
      expect(similarVectors[1][0]).toEqual(3)
    })
  })
})
