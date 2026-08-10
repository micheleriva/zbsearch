import { expect, it } from 'vitest'
import { create, insert, Tokenizer } from 'zbsearch'
import {
  afterInsert,
  loadWithHighlight,
  ZBSearchWithHighlight,
  saveWithHighlight,
  searchWithHighlight
} from '../src/index.js'

it('it should store the position of tokens', async () => {
  const db = create({
    schema: {
      text: 'string'
    } as const,
    plugins: [
      {
        name: 'highlight',
        afterInsert
      }
    ]
  })

  const id = await insert(db, { text: 'hello world' })

  expect((db as ZBSearchWithHighlight<typeof db>).data.positions[id]).toEqual({
    text: { hello: [{ start: 0, length: 5 }], world: [{ start: 6, length: 5 }] }
  })
})

it('it should manage nested schemas', async () => {
  const schema = {
    other: {
      text: 'string'
    }
  } as const

  const db = create({ schema, plugins: [{ name: 'highlight', afterInsert }] })

  const id = await insert(db, { other: { text: 'hello world' } })

  expect((db as ZBSearchWithHighlight<typeof db>).data.positions[id]).toEqual({
    'other.text': { hello: [{ start: 0, length: 5 }], world: [{ start: 6, length: 5 }] }
  })
})

it("it shouldn't stem tokens", async () => {
  const schema = {
    text: 'string'
  } as const

  const db = create({
    schema,
    plugins: [
      {
        name: 'highlight',
        afterInsert
      }
    ],
    components: { tokenizer: { stemming: false } }
  })

  const id = await insert(db, { text: 'hello personalization' })

  expect((db as ZBSearchWithHighlight<typeof db>).data.positions[id]).toEqual({
    text: { hello: [{ start: 0, length: 5 }], personalization: [{ start: 6, length: 15 }] }
  })
})

it('should retrieve positions', async () => {
  const schema = {
    text: 'string'
  } as const

  const db = await create({ schema, plugins: [{ name: 'highlight', afterInsert }] })

  await insert(db, { text: 'hello world' })

  const results = await searchWithHighlight(db, { term: 'hello' })
  expect(results.hits[0].positions).toEqual({ text: { hello: [{ start: 0, length: 5 }] } })
})

it('should retrieve positions also with typo, if tolerance is used', async () => {
  const schema = {
    title: 'string',
    summary: 'string',
    id: 'string',
    slug: 'string'
  } as const

  const db = create({ schema, plugins: [{ name: 'highlight', afterInsert }] })

  await insert(db, {
    title: 'Introduction to React',
    summary:
      'React is a popular JavaScript library for building user interfaces, primarily for single-page applications. By utilizing a component-based architecture, it allows developers to build reusable UI components and manage the state of an application seamlessly. This introduction covers its core philosophies, JSX, and the virtual DOM.',
    id: '1a2b3c',
    slug: 'introduction-to-react'
  })

  const results = await searchWithHighlight(db, { term: 'reat', tolerance: 1 })

  expect(results.hits[0].positions).toEqual({
    title: { react: [{ start: 16, length: 5 }] },
    summary: { react: [{ start: 0, length: 5 }] },
    id: {},
    slug: {}
  })
})

it('should work with texts containing constructor and __proto__ properties', async () => {
  const schema = {
    text: 'string'
  } as const

  const db = create({ schema, plugins: [{ name: 'highlight', afterInsert }] })

  await insert(db, { text: 'constructor __proto__' })

  const results = await searchWithHighlight(db, { term: 'constructor' })

  expect(results.hits[0].positions).toEqual({
    text: { constructor: [{ start: 0, length: 11 }] }
  })
})

it('should correctly save and load data with positions', async () => {
  const schema = {
    text: 'string'
  } as const

  const originalDB = create({ schema, plugins: [{ name: 'highlight', afterInsert }] })

  const id = await insert(originalDB, { text: 'hello world' })

  const DBData = saveWithHighlight(originalDB)

  const newDB = create({ schema, plugins: [{ name: 'highlight', afterInsert }] })

  loadWithHighlight(newDB, DBData)

  expect((newDB as ZBSearchWithHighlight<typeof newDB>).data.positions[id]).toEqual({
    text: { hello: [{ start: 0, length: 5 }], world: [{ start: 6, length: 5 }] }
  })
})

// A minimal word-granularity CJK tokenizer, equivalent to @zbsearch/tokenizers/mandarin.
// CJK text has no word spaces, so a whole run is matched as a single word by the
// position indexer and the tokenizer splits it into several tokens.
function createCjkTokenizer(): Tokenizer {
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
  return {
    language: 'mandarin',
    normalizationCache: new Map(),
    tokenize(input: string): string[] {
      if (typeof input !== 'string') return [input]
      const tokens: string[] = []
      for (const segment of segmenter.segment(input)) {
        if (segment.isWordLike) tokens.push(segment.segment)
      }
      return tokens
    }
  }
}

it('it should record a position for every token of a multi-token word (CJK)', async () => {
  const tokenizer = createCjkTokenizer()
  const db = create({
    schema: { text: 'string' } as const,
    components: { tokenizer },
    plugins: [{ name: 'highlight', afterInsert }]
  })

  const text = '我喜欢编程'
  const expected = new Set(tokenizer.tokenize(text))
  expect(expected.size > 1, 'the tokenizer splits the run into multiple tokens').toBeTruthy()

  const id = await insert(db, { text })
  const recorded = (db as ZBSearchWithHighlight<typeof db>).data.positions[id].text

  expect(new Set(Object.keys(recorded)), 'every token has a recorded position').toEqual(expected)

  // a token other than the first one is found by search and can be highlighted
  const lastToken = [...expected][expected.size - 1]
  const results = await searchWithHighlight(db, { term: lastToken })
  expect(results.hits.length > 0, 'search finds the document').toBeTruthy()
  expect(Array.isArray(results.hits[0].positions.text[lastToken]), 'a non-leading token is highlightable').toBeTruthy()
})
