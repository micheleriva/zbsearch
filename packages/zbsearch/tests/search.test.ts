import { describe, expect, it } from 'vitest'
import { stopwords as englishStopwords } from '@zbsearch/stopwords/english'
import { create, getByID, insert, insertMultiple, search } from '../src/index.js'

describe('search method', () => {
  it('with a multilingual index', async () => {
    const db = create({
      schema: { text: 'string' },
      language: 'multilingual'
    })

    insert(db, { text: 'The quick brown fox jumps over the lazy dog' })
    insert(db, { text: 'Съешь же ещё этих мягких французских булок' })
    insert(db, { text: '日本語のテキストを検索する' })
    insert(db, { text: "Un café crème et deux croissants, s'il vous plaît" })

    expect((await search(db, { term: 'fox' })).count, 'finds English text').toBe(1)
    expect((await search(db, { term: 'мягких' })).count, 'finds Cyrillic text').toBe(1)
    expect((await search(db, { term: 'СЪЕШЬ' })).count, 'is case-insensitive across scripts').toBe(1)
    expect((await search(db, { term: 'cafe' })).count, 'folds diacritics').toBe(1)
    expect((await search(db, { term: 'テキスト' })).count, 'finds CJK text').toBe(1)
    // '日本' is a prefix of an indexed CJK token, so opt into prefix expansion.
    expect((await search(db, { term: '日本', prefix: true })).count, 'prefix-matches CJK text').toBe(1)
    expect((await search(db, { term: 'nonexistent' })).count, 'returns nothing for absent terms').toBe(0)
  })

  describe('with term', () => {
    const [db, id1, id2, id3, id4] = createSimpleDB()

    it('should return all the document on empty string', async () => {
      const result = await search(db, {
        term: ''
      })

      expect(result.elapsed).toBeTruthy()
      expect(result.elapsed.raw).toBeTruthy()
      expect(result.elapsed.formatted).toBeTruthy()

      for (const id of [id1, id2, id3, id4]) {
        const doc = getByID(db, id as string)
        expect(result.hits.find((d) => d.id === id)).toStrictEqual({
          id,
          score: 0,
          document: doc
        })
      }
    })

    it('should return all the document if params is an empty object', async () => {
      const result = await search(db, {})

      for (const id of [id1, id2, id3, id4]) {
        const doc = getByID(db, id as string)
        expect(result.hits.find((d) => d.id === id)).toStrictEqual({
          id,
          score: 0,
          document: doc
        })
      }
    })

    it('should filter the result based on "term" value', async () => {
      const { hits: allDocs } = await search(db, {})
      const docIdsShouldNotMatch = allDocs.filter((d) => !/coffee/.test(d.document.name as string)).map((d) => d.id)
      const docIdsShouldMatch = allDocs.filter((d) => /coffee/.test(d.document.name as string)).map((d) => d.id)

      const result = await search(db, {
        term: 'coffee'
      })

      const matchedIds = result.hits.map((d) => d.id)
      expect(new Set(docIdsShouldMatch)).toStrictEqual(new Set(matchedIds))
      expect(docIdsShouldNotMatch.find((id) => matchedIds.includes(id))).toBeFalsy()
    })

    it('should filter the result based on "term" value # 2', async () => {
      const db = create({
        schema: {
          quote: 'string',
          author: 'string'
        } as const,
        components: {
          tokenizer: {
            stemming: true,
            stopWords: englishStopwords
          }
        }
      })

      await insert(db, { quote: 'the quick, brown fox jumps over the lazy dog. What a fox!', author: 'John Doe' })
      await insert(db, { quote: 'Foxes are nice animals. But I prefer having a dog.', author: 'John Doe' })
      await insert(db, { quote: 'I like dogs. They are the best.', author: 'Jane Doe' })
      await insert(db, { quote: 'I like cats. They are the best.', author: 'Jane Doe' })

      // Exact search - now case-sensitive
      const result1 = await search(db, { term: 'fox', exact: true })
      const result2 = await search(db, { term: 'dog', exact: true })

      // Only lowercase "fox" matches, not "Foxes"
      expect(result1.count).toBe(1)
      // "dog" appears in lowercase in 2 documents
      expect(result2.count).toBe(2)

      // Prefix search
      const result3 = await search(db, { term: 'fox', exact: false })
      const result4 = await search(db, { term: 'dog', exact: false })

      expect(result3.count).toBe(2)
      expect(result4.count).toBe(3)

      // Typo-tolerant search
      const result5 = await search(db, { term: 'fx', tolerance: 1 })
      const result6 = await search(db, { term: 'dg', tolerance: 2 })

      expect(result5.count).toBe(2)
      expect(result6.count).toBe(4)

      // Long string search (Tests for https://github.com/oramasearch/orama/issues/159 )
      const result7 = await search(db, { term: 'They are the best' })
      const result8 = await search(db, { term: 'Foxes are nice animals' })

      expect(result7.count).toBe(2)
      expect(result8.count).toBe(2)
    })

    it('should apply term only on indexed fields', async () => {
      const db = create({
        schema: {
          quote: 'string',
          author: 'string'
        } as const
      })

      insert(db, {
        quote: 'I like dogs. They are the best.',
        author: 'Jane Doe',
        nested: { unindexedNestedField: 'unindexedNestedValue' }
      })

      insert(db, {
        quote: 'I like cats. They are the best.',
        author: 'Jane Doe',
        unindexedField: 'unindexedValue'
      })

      const result1 = await search(db, { term: 'unindexedNestedValue' })
      const result2 = await search(db, { term: 'unindexedValue' })

      expect(result1.count).toBe(0)
      expect(result2.count).toBe(0)
    })

    it('should throw an error when searching in non-existing indices', async () => {
      const db = create({ schema: { foo: 'string', baz: 'string' } as const })

      expect(() =>
        search(db, {
          term: 'foo',
          properties: ['bar'] as unknown as ('foo' | 'baz')[]
        })
      ).toThrow(
        expect.objectContaining({
          code: 'UNKNOWN_INDEX'
        })
      )
    })

    it('should return empty array if term is removed by tokenizer', async () => {
      const [db] = createSimpleDB()

      await insert(db, {
        name: 'Allowed',
        rating: 5,
        price: 900,
        meta: {
          sales: 100
        }
      })
      const result = await search(db, {
        term: 'all'
      })

      expect(result.count).toBe(0)
    })
  })

  describe('with exact', () => {
    it('should exact match', async () => {
      const db = create({
        schema: {
          author: 'string',
          quote: 'string'
        } as const
      })

      const id = await insert(db, {
        quote: 'Be yourself; everyone else is already taken.',
        author: 'Oscar Wilde'
      })

      const partialSearch = await search(db, {
        term: 'alr',
        exact: true
      })

      expect(partialSearch.count).toBe(0)
      expect(partialSearch.hits).toStrictEqual([])

      const exactSearch = await search(db, {
        term: 'already',
        exact: true
      })

      expect(exactSearch.count).toBe(1)
      expect(exactSearch.hits.map((d) => d.id)).toStrictEqual([id])
    })
  })

  describe('with tollerate', () => {
    it("shouldn't tolerate typos if set to 0", async () => {
      const db = create({
        schema: {
          quote: 'string',
          author: 'string'
        } as const
      })

      await insert(db, {
        quote:
          'Absolutely captivating creatures, seahorses seem like a product of myth and imagination rather than of nature.',
        author: 'Sara A. Lourie'
      })

      const searchResult = await search(db, {
        term: 'seahrse',
        tolerance: 0
      })

      expect(searchResult.count).toBe(0)
    })

    it('should tolerate typos', async () => {
      const db = create({
        schema: {
          quote: 'string',
          author: 'string'
        } as const
      })

      const id1 = await insert(db, {
        quote:
          'Absolutely captivating creatures, seahorses seem like a product of myth and imagination rather than of nature.',
        author: 'Sara A. Lourie'
      })

      const id2 = await insert(db, {
        quote: 'Seahorses look mythical, like dragons, but these magnificent shy creatures are real.',
        author: 'Jennifer Keats Curtis'
      })

      const tolerantSearch = await search(db, {
        term: 'seahrse',
        tolerance: 2
      })

      expect(tolerantSearch.count).toBe(2)
      expect(new Set(tolerantSearch.hits.map((d) => d.id))).toStrictEqual(new Set([id1, id2]))

      const moreTolerantSearch = await search(db, {
        term: 'sahrse',
        tolerance: 5
      })

      expect(moreTolerantSearch.count).toBe(2)
      expect(new Set(tolerantSearch.hits.map((d) => d.id))).toStrictEqual(new Set([id1, id2]))
    })

    it('should correctly match with tolerance. even if prefix doesnt match.', async () => {
      const db = create({
        schema: {
          name: 'string'
        } as const,
        components: {
          tokenizer: {
            stemming: true,
            stopWords: englishStopwords
          }
        }
      })

      await insert(db, { name: 'Dhris' })
      const result1 = await search(db, { term: 'Chris', tolerance: 1 })
      const result2 = await search(db, { term: 'Cgris', tolerance: 1 })
      const result3 = await search(db, { term: 'Cgris', tolerance: 2 })
      expect(result1.count).toBe(1)
      expect(result2.count).toBe(0)
      expect(result3.count).toBe(1)

      await insert(db, { name: 'Chris ' })
      await insert(db, { name: 'Craig' })
      await insert(db, { name: 'Chxy' }) //create h node in radix tree.
      await insert(db, { name: 'Crxy' }) //create r node in radix tree.

      //issue 480 says following will not match because the prefix "Cr" exists so prefix Ch is not searched.
      const result4 = await search(db, { term: 'Cris', tolerance: 1 })
      expect(result4.count).toBe(1)

      //should match "Craig" even if prefix "Ca" exists.
      const result5 = await search(db, { term: 'Caig', tolerance: 1 })
      expect(result5.count).toBe(1)
    })

    //issue#544
    //bug both words apple and apply arent matching even after PR#580
    it('match exact prefix , along with tolerance', async () => {
      // Creating the database
      const db = create({
        schema: {
          word: 'string'
        } as const,
        components: {
          tokenizer: {
            stemming: true,
            stopWords: englishStopwords
          }
        }
      })

      await insert(db, { word: 'apt' })
      await insert(db, { word: 'apple' })
      await insert(db, { word: 'app' })
      await insert(db, { word: 'apply' })
      await insert(db, { word: 'about' })
      await insert(db, { word: 'again' })

      // Searching for 'app' with a tolerance of 1
      const result = await search(db, { term: 'app', tolerance: 1 })

      //apt,app,apple,apply should match.
      expect(result.count, 'Should match 4 words for "app" with tolerance 1').toBe(4)
    })
  })

  describe('with pagination', () => {
    describe('should correctly paginate results', async () => {
      const db = create({
        schema: {
          animal: 'string'
        } as const
      })

      const id1 = await insert(db, { id: '0', animal: 'Quick brown fox' })
      await insert(db, { id: '1', animal: 'Lazy dog' })
      await insert(db, { id: '2', animal: 'Jumping penguin' })
      const id4 = await insert(db, { id: '3', animal: 'Fast chicken' })
      const id5 = await insert(db, { id: '4', animal: 'Fabolous ducks' })
      const id6 = await insert(db, { id: '5', animal: 'Fantastic horse' })

      const cases = [
        { limit: 1, offset: 0, expectedIds: [id4] },
        { limit: 1, offset: 1, expectedIds: [id5] },
        { limit: 1, offset: 2, expectedIds: [id6] },
        { limit: 2, offset: 2, expectedIds: [id6, id1] },
        { limit: 0, offset: 0, expectedIds: [] },
        { limit: 1, offset: 100000, expectedIds: [] }
      ]
      for (const c of cases) {
        const { limit, offset, expectedIds } = c
        const name = `limit: ${limit}, offset: ${offset}`
        it(name, async () => {
          // 'f' is a fragment of the indexed words, so opt into prefix expansion.
          const result = await search(db, { term: 'f', limit, offset, prefix: true })
          const actualIds = result.hits.map((d) => d.id)

          expect(result.count).toBe(4)
          expect(actualIds).toStrictEqual(expectedIds)
        })
      }
    })
  })

  it('should correctly search without term', async () => {
    const db = create({
      schema: {
        quote: 'string',
        author: 'string'
      } as const,
      components: {
        tokenizer: {
          stopWords: englishStopwords,
          stemming: true
        }
      }
    })

    const docs = [
      { id: '0', quote: 'the quick, brown fox jumps over the lazy dog. What a fox!', author: 'John Doe' },
      { id: '1', quote: 'Foxes are nice animals. But I prefer having a dog.', author: 'John Doe' },
      { id: '2', quote: 'I like dogs. They are the best.', author: 'Jane Doe' }
    ]

    await insert(db, docs[0])
    await insert(db, docs[1])
    await insert(db, docs[2])

    // Exact search
    const result1 = await search(db, { exact: false })
    const result2 = await search(db, { exact: true })

    expect(result1.count).toBe(3)
    expect(result2.count).toBe(3)
    expect(result1.hits.sort((a, b) => a.id.localeCompare(b.id)).map((h) => h.document)).toStrictEqual(docs)
    expect(result1.hits.sort((a, b) => a.id.localeCompare(b.id)).map((h) => h.document)).toStrictEqual(docs)
  })

  it('should correctly search for data returning doc including with unindexed keys', async () => {
    const db = create({
      schema: {
        quote: 'string',
        author: 'string'
      } as const,
      components: {
        tokenizer: { language: 'english', stemming: false, stopWords: englishStopwords }
      }
    })

    const documentWithUnindexedField = {
      quote: 'I like cats. They are the best.',
      author: 'Jane Doe',
      unindexedField: 'unindexedValue'
    }
    const documentWithNestedUnindexedField = {
      quote: 'Foxes are nice animals. But I prefer having a dog.',
      author: 'John Doe',
      nested: { unindexedNestedField: 'unindexedNestedValue' }
    }

    await insert(db, documentWithNestedUnindexedField)
    await insert(db, documentWithUnindexedField)

    const result1 = await search(db, { term: 'They are the best' })
    const result2 = await search(db, { term: 'Foxes are nice animals' })

    expect(result1.count).toBe(1)
    expect(result2.count).toBe(1)
    expect(result1.hits[0].document).toEqual(documentWithUnindexedField)
    expect(result2.hits[0].document).toEqual(documentWithNestedUnindexedField)
  })

  it('should throw an error when searching in non-existing indices', async () => {
    const db = create({ schema: { foo: 'string', baz: 'string' } })

    expect(() =>
      search(db, {
        term: 'foo',
        properties: ['bar'] as unknown as ('foo' | 'baz')[]
      })
    ).toThrow(
      expect.objectContaining({
        code: 'UNKNOWN_INDEX'
      })
    )
  })

  it('should support nested properties', async () => {
    const db = create({
      schema: {
        quote: 'string',
        author: {
          name: 'string',
          surname: 'string'
        }
      } as const
    })

    await insert(db, {
      quote: 'Harry Potter, the boy who lived, come to die. Avada kedavra.',
      author: {
        name: 'Tom',
        surname: 'Riddle'
      }
    })

    await insert(db, {
      quote: 'I am Homer Simpson.',
      author: {
        name: 'Homer',
        surname: 'Simpson'
      }
    })

    const resultAuthorSurname = await search(db, {
      term: 'Riddle',
      properties: ['author.surname']
    })

    const resultAuthorName = await search(db, {
      term: 'Riddle',
      properties: ['author.name']
    })

    const resultSimpsonQuote = await search(db, {
      term: 'Homer',
      properties: ['quote']
    })

    const resultSimpsonAuthorName = await search(db, {
      term: 'Homer',
      properties: ['author.name']
    })

    expect(resultSimpsonAuthorName.count).toBe(1)
    expect(resultSimpsonQuote.count).toBe(1)
    expect(resultAuthorSurname.count).toBe(1)
    expect(resultAuthorName.count).toBe(0)
  })

  it('should support multiple nested properties', async () => {
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
        }
      } as const
    })

    await insert(db, {
      quote: 'Be yourself; everyone else is already taken.',
      author: {
        name: 'Oscar',
        surname: 'Wild'
      },
      tag: {
        name: 'inspirational',
        description: 'Inspirational quotes'
      }
    })

    await insert(db, {
      quote: 'So many books, so little time.',
      author: {
        name: 'Frank',
        surname: 'Zappa'
      },
      tag: {
        name: 'books',
        description: 'Quotes about books'
      }
    })

    await insert(db, {
      quote: 'A room without books is like a body without a soul.',
      author: {
        name: 'Marcus',
        surname: 'Tullius Cicero'
      },
      tag: {
        name: 'books',
        description: 'Quotes about books'
      }
    })

    const resultAuthor = await search(db, {
      term: 'Oscar'
    })

    const resultTag = await search(db, {
      term: 'books'
    })

    const resultQuotes = await search(db, {
      term: 'quotes'
    })

    expect(resultAuthor.count).toBe(1)
    expect(resultTag.count).toBe(2)
    expect(resultQuotes.count).toBe(3)
  })

  describe('with afterSearchHook', () => {
    it('should run afterSearch hook', async () => {
      let called = 0
      const db = create({
        schema: {
          animal: 'string'
        } as const,
        plugins: [
          {
            name: 'after-search-hook',
            afterSearch: () => {
              called++
            }
          }
        ]
      })

      await insertMultiple(db, [
        { id: '0', animal: 'Quick brown fox' },
        { id: '1', animal: 'Lazy dog' },
        { id: '2', animal: 'Jumping penguin' },
        { id: '3', animal: 'Fast chicken' },
        { id: '4', animal: 'Fabolous ducks' },
        { id: '5', animal: 'Fantastic horse' }
      ])

      await search(db, { term: 'f' })

      expect(called).toBe(1)
    })
  })

  it('should return all the documents that contains the property on empty search', async () => {
    const db = create({
      schema: {
        animal: 'string'
      } as const
    })

    await insertMultiple(db, [{ animal: 'foo' }, {}, {}, {}, {}, {}])

    const result = await search(db, {
      term: '',
      properties: ['animal']
    })

    expect(result.count).toBe(1)
  })

  it('with geosearch', async () => {
    const db = create({
      schema: {
        id: 'string',
        name: 'string',
        location: 'geopoint'
      } as const
    })

    await insert(db, { id: '1', name: 'Duomo di Milano', location: { lat: 9.1916185, lon: 45.4641833 } })
    await insert(db, { id: '2', name: 'Piazza Duomo (Milano)', location: { lat: 9.1897839, lon: 45.464236 } })
    await insert(db, { id: '3', name: 'Piazzetta Reale', location: { lat: 9.1908889, lon: 45.4633179 } })
    await insert(db, { id: '4', name: 'Duomo M1/M3', location: { lat: 9.1868877, lon: 45.4641707 } })

    const r1 = await search(db, {
      term: 'Duomo',
      where: {
        location: {
          radius: {
            coordinates: { lat: 9.1852139, lon: 45.4642677 },
            value: 1,
            unit: 'km'
          }
        }
      }
    })

    expect(r1.count).toBe(3)
    expect(r1.hits.map((h) => h.id).sort()).toStrictEqual(['1', '2', '4'])

    const r2 = await search(db, {
      term: 'Duomo',
      where: {
        location: {
          polygon: {
            coordinates: [
              { lat: 9.1885737, lon: 45.4648233 },
              { lat: 9.1885528, lon: 45.4636546 },
              { lat: 9.1928014, lon: 45.4636546 },
              { lat: 9.1927755, lon: 45.4648084 },
              { lat: 9.1885737, lon: 45.4648233 }
            ]
          }
        }
      }
    })

    expect(r2.count).toBe(2)
    expect(r2.hits.map((h) => h.id).sort()).toStrictEqual(['1', '2'])
  })

  it('with custom tokenizer', async () => {
    const normalizationCache = new Map([['english:foo:dogs', 'Dogs']])

    const db = create({
      schema: {
        quote: 'string',
        author: 'string'
      } as const,
      components: {
        tokenizer: {
          language: 'english',
          normalizationCache,
          tokenize: (raw: string) => {
            return raw.split(' ').filter((word) => word.toLowerCase().startsWith('b'))
          }
        }
      }
    })

    expect(db.tokenizer.normalizationCache.get('english:foo:dogs')).toBe('Dogs')

    await insert(db, { quote: 'the quick, brown fox jumps over the lazy dog. What a fox!', author: 'John Doe' })
    await insert(db, { quote: 'foxes are nice animals. But I prefer having a dog.', author: 'John Doe' })
    await insert(db, { quote: 'I like dogs. They are the best.', author: 'Jane Doe' })
    await insert(db, { quote: 'I like cats. They are the best.', author: 'Jane Doe' })

    const result1 = await search(db, { term: 'foxes', exact: true })
    const result2 = await search(db, { term: 'cats', exact: true })
    const result3 = await search(db, { term: 'brown', exact: true })

    expect(result1.count).toBe(0)
    expect(result2.count).toBe(0)
    expect(result3.count).toBe(1)
  })
})

it('fix-544', async () => {
  const db = create({
    schema: {
      name: 'string'
    } as const,
    components: {
      tokenizer: {
        stemming: true,
        stopWords: englishStopwords
      }
    }
  })

  await insert(db, { name: 'Christopher' })
  let result

  // 'Chris' is a prefix of the indexed (stemmed) 'Christopher', so opt into
  // prefix expansion: exact matching is now the default and would not match.
  result = await search(db, { term: 'Chris', tolerance: 0, prefix: true })
  expect(result.count).toBe(1)

  result = await search(db, { term: 'Chris', tolerance: 1 })
  expect(result.count).toBe(1)

  result = await search(db, { term: 'Chris', tolerance: 2 })
  expect(result.count).toBe(1)
})

it('fix-601', async () => {
  const db = create({
    schema: {
      name: 'string'
    } as const
  })

  Object.prototype['examplePrototypeFunction'] = () => {}

  await insert(db, { name: 'John Doe' })
  const result = await search(db, { term: 'John Doe' })

  expect(result.count).toBe(1)
})

describe('full-text search with vector properties', () => {
  it("shouldn't return vectors unless explicitly specified", async () => {
    const db = create({
      schema: {
        text: 'string',
        embeddings: {
          first: 'vector[2]',
          second: 'vector[2]'
        }
      } as const
    })

    await insert(db, {
      text: 'foo',
      embeddings: {
        first: [1, 2],
        second: [3, 4]
      }
    })

    await insert(db, {
      text: 'bar',
      embeddings: {
        first: [5, 6],
        second: [7, 8]
      }
    })

    const result2 = await search(db, {
      term: 'foo'
    })

    expect(result2.hits.map((hit) => hit.document.embeddings)).toStrictEqual([{ first: null, second: null }])
  })
})

function createSimpleDB() {
  let i = 0
  const db = create({
    schema: {
      name: 'string',
      rating: 'number',
      price: 'number',
      meta: {
        sales: 'number'
      }
    } as const,
    components: {
      tokenizer: {
        stopWords: englishStopwords
      },
      getDocumentIndexId(): string {
        return `__${++i}`
      }
    }
  })

  const id1 = insert(db, {
    name: 'super coffee maker',
    rating: 5,
    price: 900,
    meta: {
      sales: 100
    }
  })

  const id2 = insert(db, {
    name: 'washing machine',
    rating: 5,
    price: 900,
    meta: {
      sales: 100
    }
  })

  const id3 = insert(db, {
    name: 'coffee maker',
    rating: 3,
    price: 30,
    meta: {
      sales: 25
    }
  })

  const id4 = insert(db, {
    name: 'coffee maker deluxe',
    rating: 5,
    price: 45,
    meta: {
      sales: 25
    }
  })

  return [db, id1, id2, id3, id4] as const
}
