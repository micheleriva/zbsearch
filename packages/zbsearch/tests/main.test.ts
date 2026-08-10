import { describe, expect, it } from 'vitest'
import { create, insert, search } from '../src/index.js'
import { SUPPORTED_LANGUAGES } from '../src/components/tokenizer/languages.js'

describe('language', () => {
  it('should throw an error if the desired language is not supported', async () => {
    await expect(() =>
      create({
        schema: {} as const,
        language: 'latin'
      })
    ).toThrow(expect.objectContaining({ code: 'LANGUAGE_NOT_SUPPORTED' }))
  })

  it('should throw an error if the desired language is not supported during insertion', async () => {
    const db = await create({
      schema: { foo: 'string' }
    })

    await expect(() =>
      insert(
        db,
        // @ts-expect-error - error case
        { foo: 'bar' },
        'latin'
      )
    ).toThrow(expect.objectContaining({ code: 'LANGUAGE_NOT_SUPPORTED' }))
  })

  it('should not throw if if the language is supported', async () => {
    try {
      create({
        schema: {},
        language: 'portuguese'
      })
    } catch (e) {
      expect.fail()
    }
  })

  it('should not throw if if the language is supported', async () => {
    try {
      create({
        schema: {},
        language: 'slovenian'
      })
    } catch (e) {
      expect.fail()
    }
  })

  it('should not throw if if the language is supported', async () => {
    try {
      create({
        schema: {},
        language: 'bulgarian'
      })
    } catch (e) {
      expect.fail()
    }
  })
})

/*
t.test('custom tokenizer configuration', async (t) => {
  t.test('tokenizerFn', async (t) => {
    const db = await create({
      schema: {
        txt: 'string'
      } as const,
      components: {
        tokenizer: {
          tokenize(text: string) {
            console.log(text)
            return text.split(',')
          },
          language: 'english',
          normalizationCache: new Map()
        }
      }
    })

    await insert(db, {
      txt: 'hello, world! How are you?'
    })

    const searchResult = await search(db, {
      term: ' world! How are you?',
      exact: true
    })

    const searchResult2 = await search(db, {
      term: 'How are you?',
      exact: true
    })

    t.same(searchResult.count, 1)
    t.same(searchResult2.count, 0)
  })
})
  */

it('should access own properties exclusively', async () => {
  const db = await create({
    schema: {
      txt: 'string'
    } as const
  })

  await insert(db, {
    txt: 'constructor'
  })

  await search(db, {
    term: 'constructor',
    tolerance: 1
  })

  expect(1).toEqual(1)
})

it('should search numbers in supported languages', async () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const db = await create({
      schema: {
        number: 'string'
      } as const,
      components: {
        tokenizer: { language: language, stemming: false }
      }
    })

    await insert(db, {
      number: '123'
    })

    const searchResult = await search(db, {
      term: '123'
    })

    expect(searchResult.count, `Language: ${language}`).toEqual(1)
  }
})

//  Tests for https://github.com/oramasearch/orama/issues/230
it('should correctly search accented words in Italian', async () => {
  const db = await create({
    schema: {
      description: 'string'
    } as const,
    components: {
      tokenizer: { language: 'italian', stemming: false }
    }
  })

  await insert(db, {
    description: 'Il mio nome è Josè'
  })

  const searchResult = await search(db, {
    term: 'jose'
  })
  expect(searchResult.count).toBe(1)
})

//  Tests for https://github.com/oramasearch/orama/issues/230
it('should correctly search accented words in English', async () => {
  const db = await create({
    schema: {
      description: 'string'
    } as const,
    components: {
      tokenizer: { language: 'english', stemming: false }
    }
  })

  await insert(db, {
    description: 'My name is Josè'
  })

  const searchResult = await search(db, {
    term: 'jose'
  })
  expect(searchResult.count).toBe(1)
})

//  Tests for https://github.com/oramasearch/orama/issues/230
it('should correctly search accented words in Dutch', async () => {
  const db = await create({
    schema: {
      description: 'string'
    } as const,
    components: {
      tokenizer: { language: 'dutch', stemming: false }
    }
  })

  await insert(db, {
    description: 'Mein Name ist Josè'
  })

  const searchResult = await search(db, {
    term: 'jose'
  })
  expect(searchResult.count).toBe(1)
})

it('should correctly search accented words in Slovenian', async () => {
  const db = await create({
    schema: {
      description: 'string'
    } as const,
    components: {
      tokenizer: { language: 'slovenian', stemming: false }
    }
  })

  await insert(db, {
    description: 'ščisti se pešec čez križišče'
  })

  await insert(db, {
    description: 'na vrhu hriba je križ'
  })

  await insert(db, {
    description: 'okroglo križišče je krožišče'
  })

  const searchResult = await search(db, {
    term: 'križišče'
  })
  expect(searchResult.count).toBe(2)
})

it('should correctly search words in Bulgarian', async () => {
  const db = await create({
    schema: {
      description: 'string'
    } as const,
    components: {
      tokenizer: { language: 'bulgarian', stemming: false }
    }
  })

  await insert(db, {
    // text in the same vain as the quick brown fox, including all cyrillic letters
    description: 'Жълтата дюля беше щастлива, че пухът, който цъфна, замръзна като гьон'
  })

  await insert(db, {
    description: 'Пингвините са нелетящи птици, обитаващи Южното полукълбо'
  })

  await insert(db, {
    description: 'Гръдните мускули на пингвините са много по-мощни от тези на летящите им родственици'
  })

  // 'пингвин' is a fragment of the indexed 'пингвините', so opt into prefix expansion.
  const firstSearchResult = await search(db, {
    term: 'пингвин',
    prefix: true
  })
  expect(firstSearchResult.count).toBe(2)

  // 'жълта' is a fragment of the indexed 'жълтата', so opt into prefix expansion.
  const secondSearchResult = await search(db, {
    term: 'жълта',
    prefix: true
  })
  expect(secondSearchResult.count).toBe(1)
})
