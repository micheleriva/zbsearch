import { describe, expect, it } from 'vitest'
import { create, insert, getByID, upsert, upsertMultiple, count, search } from '../src/index.js'

describe('upsert method', () => {
  it('should insert a document when it does not exist', async () => {
    const db = create({
      schema: {
        id: 'string',
        quote: 'string',
        author: 'string'
      } as const
    })

    const docId = await upsert(db, {
      id: 'doc-1',
      quote: "Life is what happens when you're busy making other plans",
      author: 'John Lennon'
    })

    expect(docId).toBe('doc-1')
    expect(count(db)).toBe(1)

    const doc = getByID(db, docId)
    expect(doc).toBeTruthy()
    expect(doc!.quote).toBe("Life is what happens when you're busy making other plans")
    expect(doc!.author).toBe('John Lennon')
  })

  it('should update a document when it already exists', async () => {
    const db = create({
      schema: {
        id: 'string',
        quote: 'string',
        author: 'string'
      } as const
    })

    // First insert a document
    const initialDocId = await insert(db, {
      id: 'doc-1',
      quote: "Life is what happens when you're busy making other plans",
      author: 'John Lennon'
    })

    expect(initialDocId).toBe('doc-1')
    expect(count(db)).toBe(1)

    // Now upsert with the same ID should update
    const upsertedDocId = await upsert(db, {
      id: 'doc-1',
      quote: 'What I cannot create, I do not understand',
      author: 'Richard Feynman'
    })

    expect(upsertedDocId).toBe('doc-1')
    expect(count(db)).toBe(1)

    const doc = getByID(db, upsertedDocId)
    expect(doc).toBeTruthy()
    expect(doc!.quote).toBe('What I cannot create, I do not understand')
    expect(doc!.author).toBe('Richard Feynman')
  })

  it('should work with custom getDocumentIndexId function', async () => {
    const db = create({
      schema: {
        name: 'string',
        email: 'string'
      } as const,
      components: {
        getDocumentIndexId(doc: { email: string }): string {
          return doc.email
        }
      }
    })

    // First upsert (insert)
    const docId1 = await upsert(db, {
      name: 'John Doe',
      email: 'john@example.com'
    })

    expect(docId1).toBe('john@example.com')
    expect(count(db)).toBe(1)

    // Second upsert with same email (update)
    const docId2 = await upsert(db, {
      name: 'John Smith',
      email: 'john@example.com'
    })

    expect(docId2).toBe('john@example.com')
    expect(count(db)).toBe(1)

    const doc = getByID(db, docId2)
    expect(doc).toBeTruthy()
    expect(doc!.name).toBe('John Smith')
    expect(doc!.email).toBe('john@example.com')
  })

  it('should throw an error if document ID is not a string', async () => {
    const db = create({
      schema: {
        name: 'string'
      } as const
    })

    try {
      await upsert(db, {
        id: 123,
        name: 'John'
      })
      expect.fail('Should have thrown an error')
    } catch (e) {
      expect(e.code).toBe('DOCUMENT_ID_MUST_BE_STRING')
    }
  })

  it('should throw an error if document fails schema validation', async () => {
    const db = create({
      schema: {
        id: 'string',
        name: 'string'
      } as const
    })

    try {
      await upsert(db, {
        id: 'test-id',
        name: 123
      } as any)
      expect.fail('Should have thrown an error')
    } catch (e) {
      expect(e.code).toBe('SCHEMA_VALIDATION_FAILURE')
    }
  })

  it('should maintain searchability after upsert', async () => {
    const db = create({
      schema: {
        id: 'string',
        title: 'string',
        content: 'string'
      } as const
    })

    // First upsert (insert)
    await upsert(db, {
      id: 'article-1',
      title: 'JavaScript Basics',
      content: 'Learn the fundamentals of JavaScript programming'
    })

    const searchResult1 = await search(db, {
      term: 'JavaScript'
    })
    expect(searchResult1.count).toBe(1)

    // Second upsert (update)
    await upsert(db, {
      id: 'article-1',
      title: 'Advanced TypeScript',
      content: 'Master advanced TypeScript features and patterns'
    })

    const searchResult2 = await search(db, {
      term: 'JavaScript'
    })
    expect(searchResult2.count).toBe(0)

    const searchResult3 = await search(db, {
      term: 'TypeScript'
    })
    expect(searchResult3.count).toBe(1)
    expect(searchResult3.hits[0].document.title).toBe('Advanced TypeScript')
  })

  it('should work with nested schema', async () => {
    const db = create({
      schema: {
        id: 'string',
        user: {
          name: 'string',
          email: 'string'
        },
        meta: {
          tags: 'string'
        }
      } as const
    })

    // First upsert (insert)
    const docId1 = await upsert(db, {
      id: 'user-1',
      user: {
        name: 'John Doe',
        email: 'john@example.com'
      },
      meta: {
        tags: 'admin, user'
      }
    })

    expect(docId1).toBe('user-1')
    expect(count(db)).toBe(1)

    // Second upsert (update)
    const docId2 = await upsert(db, {
      id: 'user-1',
      user: {
        name: 'John Smith',
        email: 'john.smith@example.com'
      },
      meta: {
        tags: 'moderator, user'
      }
    })

    expect(docId2).toBe('user-1')
    expect(count(db)).toBe(1)

    const doc = getByID(db, docId2)
    expect(doc).toBeTruthy()
    expect(doc!.user.name).toBe('John Smith')
    expect(doc!.user.email).toBe('john.smith@example.com')
    expect(doc!.meta.tags).toBe('moderator, user')
  })
})

describe('upsertMultiple method', () => {
  it('should insert multiple documents when they do not exist', async () => {
    const db = create({
      schema: {
        id: 'string',
        quote: 'string',
        author: 'string'
      } as const
    })

    const docIds = await upsertMultiple(db, [
      {
        id: 'doc-1',
        quote: "Life is what happens when you're busy making other plans",
        author: 'John Lennon'
      },
      {
        id: 'doc-2',
        quote: 'What I cannot create, I do not understand',
        author: 'Richard Feynman'
      }
    ])

    expect(docIds.length).toBe(2)
    expect(count(db)).toBe(2)

    const doc1 = getByID(db, 'doc-1')
    const doc2 = getByID(db, 'doc-2')
    expect(doc1).toBeTruthy()
    expect(doc2).toBeTruthy()
    expect(doc1!.author).toBe('John Lennon')
    expect(doc2!.author).toBe('Richard Feynman')
  })

  it('should update multiple documents when they already exist', async () => {
    const db = create({
      schema: {
        id: 'string',
        quote: 'string',
        author: 'string'
      } as const
    })

    // First insert some documents
    await insert(db, {
      id: 'doc-1',
      quote: "Life is what happens when you're busy making other plans",
      author: 'John Lennon'
    })

    await insert(db, {
      id: 'doc-2',
      quote: 'What I cannot create, I do not understand',
      author: 'Richard Feynman'
    })

    expect(count(db)).toBe(2)

    // Now upsert with the same IDs should update
    const docIds = await upsertMultiple(db, [
      {
        id: 'doc-1',
        quote: 'He who is brave is free',
        author: 'Seneca'
      },
      {
        id: 'doc-2',
        quote: 'You must be the change you wish to see in the world',
        author: 'Mahatma Gandhi'
      }
    ])

    expect(docIds.length).toBe(2)
    expect(count(db)).toBe(2)

    const doc1 = getByID(db, 'doc-1')
    const doc2 = getByID(db, 'doc-2')
    expect(doc1).toBeTruthy()
    expect(doc2).toBeTruthy()
    expect(doc1!.author).toBe('Seneca')
    expect(doc2!.author).toBe('Mahatma Gandhi')
  })

  it('should handle mixed insert and update operations', async () => {
    const db = create({
      schema: {
        id: 'string',
        quote: 'string',
        author: 'string'
      } as const
    })

    // First insert one document
    await insert(db, {
      id: 'doc-1',
      quote: "Life is what happens when you're busy making other plans",
      author: 'John Lennon'
    })

    expect(count(db)).toBe(1)

    // Now upsert with one existing and one new document
    const docIds = await upsertMultiple(db, [
      {
        id: 'doc-1', // This should update
        quote: 'He who is brave is free',
        author: 'Seneca'
      },
      {
        id: 'doc-2', // This should insert
        quote: 'You must be the change you wish to see in the world',
        author: 'Mahatma Gandhi'
      }
    ])

    expect(docIds.length).toBe(2)
    expect(count(db)).toBe(2)

    const doc1 = getByID(db, 'doc-1')
    const doc2 = getByID(db, 'doc-2')
    expect(doc1).toBeTruthy()
    expect(doc2).toBeTruthy()
    expect(doc1!.author).toBe('Seneca')
    expect(doc2!.author).toBe('Mahatma Gandhi')
  })

  it('should throw an error if any document fails schema validation', async () => {
    const db = create({
      schema: {
        id: 'string',
        quote: 'string'
      } as const
    })

    try {
      await upsertMultiple(db, [
        {
          id: 'doc-1',
          quote: 'Valid quote'
        },
        {
          id: 'doc-2',
          quote: 123 // Invalid type
        }
      ] as any)
      expect.fail('Should have thrown an error')
    } catch (e) {
      expect(e.code).toBe('SCHEMA_VALIDATION_FAILURE')
    }

    // Should not have inserted any documents
    expect(count(db)).toBe(0)
  })

  it('should throw an error if any document ID is not a string', async () => {
    const db = create({
      schema: {
        quote: 'string'
      } as const
    })

    try {
      await upsertMultiple(db, [
        {
          id: 'doc-1',
          quote: 'Valid quote'
        },
        {
          id: 123, // Invalid ID type
          quote: 'Another quote'
        }
      ] as any)
      expect.fail('Should have thrown an error')
    } catch (e) {
      expect(e.code).toBe('DOCUMENT_ID_MUST_BE_STRING')
    }

    // Should not have inserted any documents
    expect(count(db)).toBe(0)
  })

  it('should work with custom getDocumentIndexId function', async () => {
    const db = create({
      schema: {
        name: 'string',
        email: 'string'
      } as const,
      components: {
        getDocumentIndexId(doc: { email: string }): string {
          return doc.email
        }
      }
    })

    // First upsert (mixed insert/update)
    const docIds1 = await upsertMultiple(db, [
      {
        name: 'John Doe',
        email: 'john@example.com'
      },
      {
        name: 'Jane Smith',
        email: 'jane@example.com'
      }
    ])

    expect(docIds1.length).toBe(2)
    expect(count(db)).toBe(2)

    // Second upsert with same emails (update)
    const docIds2 = await upsertMultiple(db, [
      {
        name: 'John Updated',
        email: 'john@example.com'
      },
      {
        name: 'Jane Updated',
        email: 'jane@example.com'
      }
    ])

    expect(docIds2.length).toBe(2)
    expect(count(db)).toBe(2)

    const doc1 = getByID(db, 'john@example.com')
    const doc2 = getByID(db, 'jane@example.com')
    expect(doc1).toBeTruthy()
    expect(doc2).toBeTruthy()
    expect(doc1!.name).toBe('John Updated')
    expect(doc2!.name).toBe('Jane Updated')
  })

  it('should maintain searchability after upsertMultiple', async () => {
    const db = create({
      schema: {
        id: 'string',
        title: 'string',
        content: 'string'
      } as const
    })

    // First upsert (insert)
    await upsertMultiple(db, [
      {
        id: 'article-1',
        title: 'JavaScript Basics',
        content: 'Learn the fundamentals of JavaScript programming'
      },
      {
        id: 'article-2',
        title: 'Python Basics',
        content: 'Learn the fundamentals of Python programming'
      }
    ])

    const searchResult1 = await search(db, {
      term: 'JavaScript'
    })
    expect(searchResult1.count).toBe(1)

    const searchResult2 = await search(db, {
      term: 'Python'
    })
    expect(searchResult2.count).toBe(1)

    // Second upsert (update)
    await upsertMultiple(db, [
      {
        id: 'article-1',
        title: 'Advanced TypeScript',
        content: 'Master advanced TypeScript features and patterns'
      },
      {
        id: 'article-2',
        title: 'Advanced Rust',
        content: 'Master advanced Rust features and patterns'
      }
    ])

    const searchResult3 = await search(db, {
      term: 'JavaScript'
    })
    expect(searchResult3.count).toBe(0)

    const searchResult4 = await search(db, {
      term: 'Python'
    })
    expect(searchResult4.count).toBe(0)

    const searchResult5 = await search(db, {
      term: 'TypeScript'
    })
    expect(searchResult5.count).toBe(1)

    const searchResult6 = await search(db, {
      term: 'Rust'
    })
    expect(searchResult6.count).toBe(1)
  })

  it('should work with batch size parameter', async () => {
    const db = create({
      schema: {
        id: 'string',
        quote: 'string',
        author: 'string'
      } as const
    })

    const documents: { id: string; quote: string; author: string }[] = []
    for (let i = 0; i < 10; i++) {
      documents.push({
        id: `doc-${i}`,
        quote: `Quote ${i}`,
        author: `Author ${i}`
      })
    }

    const docIds = await upsertMultiple(db, documents, 3) // Batch size of 3

    expect(docIds.length).toBe(10)
    expect(count(db)).toBe(10)

    for (let i = 0; i < 10; i++) {
      const doc = getByID(db, `doc-${i}`)
      expect(doc).toBeTruthy()
      expect(doc!.author).toBe(`Author ${i}`)
    }
  })

  it('should work with empty array', async () => {
    const db = create({
      schema: {
        id: 'string',
        quote: 'string'
      } as const
    })

    const docIds = await upsertMultiple(db, [])

    expect(docIds.length).toBe(0)
    expect(count(db)).toBe(0)
  })
})

describe('upsert with hooks', () => {
  it('should call upsert hooks when inserting', async () => {
    let beforeUpsertCalled = false
    let afterUpsertCalled = false

    const db = create({
      schema: {
        id: 'string',
        quote: 'string'
      } as const,
      plugins: [
        {
          name: 'test-plugin',
          beforeUpsert: () => {
            beforeUpsertCalled = true
          },
          afterUpsert: () => {
            afterUpsertCalled = true
          }
        }
      ]
    })

    await upsert(db, {
      id: 'doc-1',
      quote: 'Test quote'
    })

    expect(beforeUpsertCalled).toBeTruthy()
    expect(afterUpsertCalled).toBeTruthy()
  })

  it('should call upsert hooks when updating', async () => {
    let beforeUpsertCalled = false
    let afterUpsertCalled = false

    const db = create({
      schema: {
        id: 'string',
        quote: 'string'
      } as const,
      plugins: [
        {
          name: 'test-plugin',
          beforeUpsert: () => {
            beforeUpsertCalled = true
          },
          afterUpsert: () => {
            afterUpsertCalled = true
          }
        }
      ]
    })

    // First insert
    await insert(db, {
      id: 'doc-1',
      quote: 'Original quote'
    })

    // Reset flags
    beforeUpsertCalled = false
    afterUpsertCalled = false

    // Now upsert (update)
    await upsert(db, {
      id: 'doc-1',
      quote: 'Updated quote'
    })

    expect(beforeUpsertCalled).toBeTruthy()
    expect(afterUpsertCalled).toBeTruthy()
  })

  it('should call upsertMultiple hooks', async () => {
    let beforeUpsertMultipleCalled = false
    let afterUpsertMultipleCalled = false

    const db = create({
      schema: {
        id: 'string',
        quote: 'string'
      } as const,
      plugins: [
        {
          name: 'test-plugin',
          beforeUpsertMultiple: () => {
            beforeUpsertMultipleCalled = true
          },
          afterUpsertMultiple: () => {
            afterUpsertMultipleCalled = true
          }
        }
      ]
    })

    await upsertMultiple(db, [
      {
        id: 'doc-1',
        quote: 'Test quote 1'
      },
      {
        id: 'doc-2',
        quote: 'Test quote 2'
      }
    ])

    expect(beforeUpsertMultipleCalled).toBeTruthy()
    expect(afterUpsertMultipleCalled).toBeTruthy()
  })
})
