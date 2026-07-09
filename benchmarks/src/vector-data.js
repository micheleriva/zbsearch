export const VECTOR_DIMENSIONS = 128
export const DOCUMENT_COUNT = 2000

function randomVector(dimensions) {
  const vector = new Array(dimensions)
  for (let i = 0; i < dimensions; i++) {
    vector[i] = Math.random()
  }
  return vector
}

export function generateVectorDocuments(count = DOCUMENT_COUNT, dimensions = VECTOR_DIMENSIONS) {
  const documents = new Array(count)
  const genres = ['Adventure', 'RPG', 'Shooter', 'Puzzle', 'Sports', 'Racing', 'Strategy', 'Simulation']

  for (let i = 0; i < count; i++) {
    documents[i] = {
      title: `Document ${i}`,
      category: genres[i % genres.length],
      rating: (i % 50) / 10,
      embedding: randomVector(dimensions)
    }
  }

  return documents
}

export function createQueryVector(dimensions = VECTOR_DIMENSIONS) {
  return randomVector(dimensions)
}
