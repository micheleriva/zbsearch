import { describe, expect, it } from 'vitest'
import { create, insert, save, load, search } from '../src/index.js'

describe('Plugin embeddings serialization', () => {
  it('should persist embeddings added by beforeInsert hook', async () => {
    function mockEmbeddingsPlugin() {
      return {
        name: 'mock-embeddings-plugin',

        async beforeInsert(_db, _id, doc) {
          const mockEmbedding = new Array(5).fill(0).map((_, i) => Math.sin(i / 2 + doc.title.length / 10))

          doc.embedding = mockEmbedding
        }
      }
    }

    const db = create({
      schema: {
        title: 'string',
        embedding: 'vector[5]'
      },
      plugins: [mockEmbeddingsPlugin()]
    })

    await insert(db, {
      title: 'Test document'
    })

    const searchResults = await search(db, {
      term: '',
      prefix: true, // empty-term match-all now requires opting into prefix expansion
      properties: ['title'],
      includeVectors: true
    })

    expect(searchResults.count === 1, 'document inserted').toBeTruthy()
    expect(searchResults.hits[0].document.embedding, 'document has embedding').toBeTruthy()
    expect(Array.isArray(searchResults.hits[0].document.embedding), 'embedding is array').toBeTruthy()
    expect(searchResults.hits[0].document.embedding.length === 5, 'embedding has correct size').toBeTruthy()

    const serialized = save(db)

    expect(serialized.index.vectorIndexes, 'vector indexes present in serialized data').toBeTruthy()
    expect(serialized.index.vectorIndexes.embedding, 'embedding vector index present').toBeTruthy()
    expect(serialized.index.vectorIndexes.embedding.vectors.length === 1, 'one vector in index').toBeTruthy()

    const newDb = create({
      schema: {
        title: 'string',
        embedding: 'vector[5]'
      }
    })

    load(newDb, serialized)

    const restoredResults = await search(newDb, {
      term: '',
      prefix: true, // empty-term match-all now requires opting into prefix expansion
      properties: ['title'],
      includeVectors: true
    })

    expect(restoredResults.count === 1, 'document restored').toBeTruthy()
    expect(restoredResults.hits[0].document.embedding, 'restored document has embedding').toBeTruthy()
    expect(restoredResults.hits[0].document.embedding, 'embedding values preserved after restoration').toEqual(
      searchResults.hits[0].document.embedding
    )

    const vectorSearchResults = await search(newDb, {
      mode: 'vector',
      vector: {
        property: 'embedding',
        value: searchResults.hits[0].document.embedding
      }
    })

    expect(vectorSearchResults.count === 1, 'vector search works after restoration').toBeTruthy()
    expect(vectorSearchResults.hits[0].score === 1, 'perfect similarity match').toBeTruthy()
  })

  it('should work with multiple documents and embeddings', async () => {
    function mockEmbeddingsPlugin() {
      return {
        name: 'mock-embeddings-plugin',

        async beforeInsert(_db, _id, doc) {
          const seed = doc.title.length
          const mockEmbedding = new Array(3).fill(0).map((_, i) => (seed + i) / 10)

          doc.embedding = mockEmbedding
        }
      }
    }

    const db = await create({
      schema: {
        title: 'string',
        embedding: 'vector[3]'
      },
      plugins: [mockEmbeddingsPlugin()]
    })

    await insert(db, { title: 'Doc A' })
    await insert(db, { title: 'Doc B' })

    const allDocs = await search(db, {
      term: '',
      prefix: true, // empty-term match-all now requires opting into prefix expansion
      properties: ['title'],
      includeVectors: true
    })

    expect(allDocs.count === 2, 'both documents inserted').toBeTruthy()

    const originalEmbeddings = new Map()
    for (const hit of allDocs.hits) {
      expect(hit.document.embedding, `original document "${hit.document.title}" has embedding`).toBeTruthy()
      expect(hit.document.embedding.length === 3, 'embedding has correct size').toBeTruthy()
      originalEmbeddings.set(hit.document.title, [...hit.document.embedding]) // Copy array
    }

    const serialized = save(db)

    expect(serialized.index.vectorIndexes.embedding, 'vector index serialized').toBeTruthy()
    expect(serialized.index.vectorIndexes.embedding.vectors.length === 2, 'both vectors in index').toBeTruthy()

    expect(serialized.docs, 'documents serialized').toBeTruthy()
    expect(Object.keys(serialized.docs).length > 0, 'serialized documents exist').toBeTruthy()

    const newDb = create({
      schema: {
        title: 'string',
        embedding: 'vector[3]'
      }
    })
    load(newDb, serialized)

    const restoredDocs = await search(newDb, {
      term: '',
      prefix: true, // empty-term match-all now requires opting into prefix expansion
      properties: ['title'],
      includeVectors: true
    })

    expect(restoredDocs.count === 2, 'both documents restored').toBeTruthy()

    const documentsToTest = [] as any[]
    for (let i = 0; i < restoredDocs.hits.length; i++) {
      const hit = restoredDocs.hits[i]
      const originalEmbedding = originalEmbeddings.get(hit.document.title)

      if (!hit.document.embedding) {
        expect.fail(`Document "${hit.document.title}" missing embedding after restoration`)
        continue
      }

      expect(hit.document.embedding, `restored document "${hit.document.title}" has embedding`).toBeTruthy()

      if (originalEmbedding && hit.document.embedding) {
        expect(hit.document.embedding, `embedding preserved for "${hit.document.title}"`).toEqual(originalEmbedding)

        documentsToTest.push({
          title: hit.document.title,
          embedding: [...hit.document.embedding]
        })
      }
    }

    for (const docInfo of documentsToTest) {
      const vectorResults = await search(newDb, {
        mode: 'vector',
        vector: {
          property: 'embedding',
          value: docInfo.embedding
        }
      })

      expect(vectorResults.count >= 1, `vector search works for "${docInfo.title}"`).toBeTruthy()
    }
  })
})
