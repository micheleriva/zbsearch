import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DocumentsStore } from '../src/components/documents-store.js'
import { Index } from '../src/components/index.js'
import { getInternalDocumentId } from '../src/components/internal-document-id-store.js'
import { AnyDocument, count, create, insert, insertMultiple, search } from '../src/index.js'
import { BKDTree } from '../src/trees/bkd.js'

const dataset = JSON.parse(readFileSync(new URL('./datasets/events.json', import.meta.url), 'utf-8')) as DataSet

describe('insert method', async () => {
  it('should correctly insert and retrieve data', async () => {
    const db = await create({
      schema: {
        example: 'string'
      } as const
    })

    const ex1Insert = await insert(db, { example: 'The quick, brown, fox' })
    const ex1Search = await search(db, {
      term: 'quick',
      properties: ['example']
    })
    expect(ex1Insert).toBeTruthy()
    expect(ex1Search.count).toBe(1)
    expect(typeof ex1Search.elapsed.raw).toBe('number')
    expect(ex1Search.hits[0].document.example).toBe('The quick, brown, fox')
  })

  it('should be able to insert documens with non-searchable fields', async () => {
    const db = create({
      schema: {
        quote: 'string',
        author: 'string',
        isFavorite: 'boolean',
        rating: 'number'
      } as const
    })

    await insert(db, {
      quote: 'Be yourself; everyone else is already taken.',
      author: 'Oscar Wilde',
      isFavorite: false,
      rating: 4
    })

    await insert(db, {
      quote: 'So many books, so little time.',
      author: 'Frank Zappa',
      isFavorite: true,
      rating: 5
    })

    const searchResult = await search(db, {
      term: 'frank'
    })

    expect(searchResult.count).toBe(1)
    expect(searchResult.hits[0].document.author).toBe('Frank Zappa')
  })

  it("should use the 'id' field found in the document as index id", async () => {
    const db = create({
      schema: {
        id: 'string',
        name: 'string'
      } as const
    })

    const i1 = await insert(db, {
      id: 'john-01',
      name: 'John'
    })

    const i2 = await insert(db, {
      id: 'doe-02',
      name: 'Doe'
    })

    expect(i1).toBe('john-01')
    expect(i2).toBe('doe-02')
  })

  it("should use the custom 'id' function passed in the configuration object", async () => {
    const db = create({
      schema: {
        id: 'string',
        name: 'string'
      } as const,
      components: {
        getDocumentIndexId(doc: { name: string }): string {
          return `${doc.name.toLowerCase()}-foo-bar-baz`
        }
      }
    })

    const i1 = await insert(db, {
      id: 'john-01',
      name: 'John'
    })

    const i2 = await insert(db, {
      id: 'doe-02',
      name: 'Doe'
    })

    expect(i1).toBe('john-foo-bar-baz')
    expect(i2).toBe('doe-foo-bar-baz')
  })

  it("should throw an error if the 'id' field is not a string", async () => {
    const db = create({
      schema: {
        name: 'string'
      } as const
    })

    try {
      insert(db, {
        id: 123,
        name: 'John'
      })
    } catch (e) {
      expect(e.code).toBe('DOCUMENT_ID_MUST_BE_STRING')
    }
  })

  it("should throw an error if the 'id' field is already taken", async () => {
    const db = create({
      schema: {
        id: 'string',
        name: 'string'
      } as const
    })

    await insert(db, {
      id: 'john-01',
      name: 'John'
    })

    try {
      insert(db, {
        id: 'john-01',
        name: 'John'
      })
    } catch (e) {
      expect(e.code).toBe('DOCUMENT_ALREADY_EXISTS')
    }
  })

  it('should use the ID field as index id even if not specified in the schema', async () => {
    const db = create({
      schema: {
        name: 'string'
      } as const
    })

    const i1 = await insert(db, {
      id: 'john-01',
      name: 'John'
    })

    expect(i1).toBe('john-01')
  })

  it('should allow doc with missing schema keys to be inserted without indexing those keys', async () => {
    const db = create({
      schema: {
        quote: 'string',
        author: 'string'
      } as const
    })
    await insert(db, {
      quote: 'hello, world!',
      author: 'author should be singular'
    })

    expect(Object.keys(db.data.docs.docs).length).toBe(1)

    const docWithExtraKey = {
      quote: 'hello, world!',
      author: '3',
      foo: { bar: 10 }
    }

    const insertedInfo = await insert(db, docWithExtraKey)

    expect(insertedInfo).toBeTruthy()
    expect(Object.keys(db.data.docs.docs).length).toBe(2)

    expect('foo' in db.data.docs.docs[getInternalDocumentId(db.internalDocumentIDStore, insertedInfo)]!).toBeTruthy()
    expect(docWithExtraKey.foo).toEqual(
      db.data.docs.docs[getInternalDocumentId(db.internalDocumentIDStore, insertedInfo)]!.foo
    )
    expect('foo' in (db.data.index as unknown as Index).indexes).toBeFalsy()
  })

  it('should allow doc with missing schema keys to be inserted without indexing those keys - nested schema version', async () => {
    const db = create({
      schema: {
        quote: 'string',
        author: {
          name: 'string',
          surname: 'string'
        },
        tag: {
          name: 'string',
          description: 'string'
        },
        isFavorite: 'boolean',
        rating: 'number'
      } as const
    })
    const nestedExtraKeyDoc = {
      quote: 'So many books, so little time.',
      author: {
        name: 'Frank',
        surname: 'Zappa'
      },
      tag: {
        name: 'books',
        description: 'Quotes about books',
        unexpectedNestedProperty: 'amazing'
      },
      isFavorite: false,
      rating: 5,
      unexpectedProperty: 'wow'
    }
    const insertedInfo = await insert(db, nestedExtraKeyDoc)

    expect(insertedInfo).toBeTruthy()
    expect(Object.keys((db.data.docs as DocumentsStore).docs).length).toBe(1)

    expect(nestedExtraKeyDoc.unexpectedProperty).toEqual(
      (db.data.docs as DocumentsStore).docs[getInternalDocumentId(db.internalDocumentIDStore, insertedInfo)]!
        .unexpectedProperty
    )

    expect(nestedExtraKeyDoc.tag.unexpectedNestedProperty).toEqual(
      (
        (db.data.docs as DocumentsStore).docs[getInternalDocumentId(db.internalDocumentIDStore, insertedInfo)]!
          .tag as unknown as Record<string, string>
      ).unexpectedNestedProperty
    )

    expect('unexpectedProperty' in (db.data.index as Index).indexes).toBeFalsy()
    expect('tag.unexpectedProperty' in (db.data.index as Index).indexes).toBeFalsy()
  })

  describe('should validate', async () => {
    it('the properties are not mandatory', async () => {
      const db = create({
        schema: {
          id: 'string',
          name: 'string',
          inner: {
            name: 'string'
          }
        } as const
      })

      // not throwing
      insert(db, {})
      insert(db, { id: 'foo' })
      insert(db, { name: 'bar' })
      insert(db, { inner: {} })

      expect(count(db)).toBe(4)
    })

    it('invalid document', async () => {
      const db = create({
        schema: {
          string: 'string',
          number: 'number',
          boolean: 'boolean',
          inner: {
            string: 'string',
            number: 'number',
            boolean: 'boolean'
          }
        } as const
      })

      const invalidDocuments: Array<object> = [
        { string: null },
        { string: 42 },
        { string: true },
        { string: false },
        { string: {} },
        { string: [] },
        { number: null },
        { number: '' },
        { number: true },
        { number: false },
        { number: {} },
        { number: [] },
        { boolean: null },
        { boolean: 42 },
        { boolean: '' },
        { boolean: {} },
        { boolean: [] }
      ]
      invalidDocuments.push(...invalidDocuments.map((d) => ({ inner: { ...d } })))
      for (const doc of invalidDocuments) {
        try {
          insert(db, doc)
        } catch (e) {
          expect(e.code).toBe('SCHEMA_VALIDATION_FAILURE')
        }
      }
    })
  })

  it('should insert Geopoints', async () => {
    const db = create({
      schema: {
        name: 'string',
        location: 'geopoint'
      } as const
    })

    expect(
      insert(db, {
        name: 't1',
        location: {
          lat: 45.5771622,
          lon: 9.261266
        }
      })
    ).toBeTruthy()
    const index = db.data.index.indexes.location.node as BKDTree
    expect(index.root?.point.lat).toBe(45.5771622)
    expect(index.root?.point.lon).toBe(9.261266)
  })
})

describe('insert short prefixes, as in #327 and #328', async () => {
  it('example 1', async () => {
    const db = await create({
      schema: {
        id: 'string',
        abbrv: 'string',
        type: 'string'
      } as const
    })

    await insertMultiple(db, [
      {
        id: '1',
        abbrv: 'RDGE',
        type: 'Ridge'
      },
      {
        id: '2',
        abbrv: 'RD',
        type: 'Road'
      }
    ])

    const exactResults = await search(db, {
      term: 'RD',
      exact: true
    })

    const prefixResults = await search(db, {
      term: 'RD',
      prefix: true
    })

    expect(exactResults.count).toEqual(1)
    expect(exactResults.hits[0].id).toEqual('2')
    expect(exactResults.hits[0].document.abbrv).toEqual('RD')

    expect(prefixResults.count).toEqual(2)
    expect(prefixResults.hits[0].id).toEqual('2')
    expect(prefixResults.hits[0].document.abbrv).toEqual('RD')
    expect(prefixResults.hits[1].id).toEqual('1')
    expect(prefixResults.hits[1].document.abbrv).toEqual('RDGE')
  })

  it('example 2', async () => {
    const db = await create({
      schema: {
        id: 'string',
        quote: 'string'
      } as const
    })

    await insertMultiple(db, [
      { id: '1', quote: 'AB' },
      { id: '2', quote: 'ABCDEF' },
      { id: '3', quote: 'CDEF' },
      { id: '4', quote: 'AB' }
    ])

    const exactResults = await search(db, {
      term: 'AB',
      exact: true
    })

    expect(exactResults.count).toEqual(2)
    expect(exactResults.hits[0].id).toEqual('1')
    expect(exactResults.hits[0].document.quote).toEqual('AB')
    expect(exactResults.hits[1].id).toEqual('4')
    expect(exactResults.hits[1].document.quote).toEqual('AB')
  })
})

describe('insertMultiple method', async () => {
  it("should use the custom 'id' function passed in the configuration object", async () => {
    const db = create({
      schema: {
        id: 'string',
        name: 'string'
      } as const,
      components: {
        getDocumentIndexId(doc: { id: string; name: string }): string {
          return `${doc.name.toLowerCase()}-${doc.id}`
        }
      }
    })

    const ids = await insertMultiple(db, [
      { id: '01', name: 'John' },
      { id: '02', name: 'Doe' }
    ])

    expect(ids).toStrictEqual(['john-01', 'doe-02'])
  })

  it("should use the 'id' field as index id if found in the document", async () => {
    const db = create({
      schema: {
        name: 'string'
      } as const
    })

    const ids = await insertMultiple(db, [
      { name: 'John' },
      {
        id: '02',
        name: 'Doe'
      }
    ])

    expect(ids.includes('02')).toBeTruthy()
  })

  it('should support batch insert of documents', async () => {
    const db = create({
      schema: {
        date: 'string',
        description: 'string',
        lang: 'string',
        category1: 'string',
        category2: 'string',
        granularity: 'string'
      } as const
    })

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const docs = (dataset as DataSet).result.events.slice(0, 2000)
    const wrongSchemaDocs: WrongDataEvent[] = docs.map((doc) => ({
      ...doc,
      date: +new Date()
    }))

    insertMultiple(db, docs)
    expect(Object.keys((db.data.docs as DocumentsStore).docs).length).toBe(2000)

    try {
      insertMultiple(db, wrongSchemaDocs as unknown as DataEvent[])
    } catch (e) {
      expect(e.code).toBe('SCHEMA_VALIDATION_FAILURE')
    }
  })

  it('should support `timeout` parameter', async () => {
    const db = create({
      schema: {
        description: 'string'
      } as const
    })

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const docs = (dataset as DataSet).result.events.slice(0, 10)

    const batchSize = 1
    const timeout = 50

    const before = Date.now()
    insertMultiple(db, docs, batchSize, undefined, false, timeout)
    const after = Date.now()

    expect(count(db)).toBe(docs.length)
    const batchNumber = Math.ceil(docs.length / batchSize)
    const expectedTime = (batchNumber - 1) * timeout
    expect(after - before >= expectedTime).toBe(true)
  })

  it('should correctly rebalance AVL tree once the threshold is reached', async () => {
    const db = await create({
      schema: {
        id: 'string',
        name: 'string',
        number: 'number'
      } as const
    })

    function getRandomNumberExcept(n: number): number {
      const exceptions = [25, 250]

      if (exceptions.includes(n)) {
        return n
      }

      let random = Math.floor(Math.random() * 1000)

      while (exceptions.includes(random) || random === n) {
        random = Math.floor(Math.random() * 1000)
      }

      return random
    }

    const docs = Array.from({ length: 1000 }, (_, i) => ({
      id: i.toString(),
      name: `name-${i}`,
      number: getRandomNumberExcept(i)
    }))

    await insertMultiple(db, docs, 200)

    const results25 = await search(db, {
      term: 'name-25',
      where: {
        number: {
          eq: 25
        }
      }
    })

    const results250 = await search(db, {
      term: 'name',
      prefix: true,
      where: {
        number: {
          eq: 250
        }
      }
    })

    expect(results25.count).toBe(1)
    expect(results25.hits[0].document.id).toBe('25')

    expect(results250.count).toBe(1)
    expect(results250.hits[0].document.id).toBe('250')
  })
})

it("insert shouldn't use tokenizer cache", async () => {
  const db = await create({
    schema: {
      name: 'string'
    } as const
  })

  await insert(db, {
    name: 'The quick brown fox jumps over the lazy dog'
  })

  // Empty map
  expect(db.tokenizer.normalizationCache).toStrictEqual(new Map())
})

interface BaseDataEvent extends AnyDocument {
  description: string
  lang: string
  category1: string
  category2: string
  granularity: string
}

interface DataEvent extends BaseDataEvent {
  date: string
}

interface WrongDataEvent extends BaseDataEvent {
  date: number
}

interface DataSet {
  result: { events: DataEvent[] }
}
