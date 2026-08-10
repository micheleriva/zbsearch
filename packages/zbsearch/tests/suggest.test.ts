import { describe, expect, it } from 'vitest'
import { index as defaultIndex } from '../src/components.js'
import { autoSuggest, count, create, insertMultiple, suggest } from '../src/index.js'

function createProductsDB() {
  const db = create({
    schema: {
      title: 'string',
      description: 'string',
      price: 'number'
    } as const
  })

  insertMultiple(db, [
    { title: 'Noise cancelling headphones', description: 'Wireless over-ear headphones', price: 299 },
    { title: 'Noise cancelling earbuds', description: 'In-ear active noise cancellation', price: 199 },
    { title: 'Wired headphones', description: 'Cheap headphones for the office', price: 30 },
    { title: 'Noisy blue t-shirt', description: 'A very loud shirt', price: 20 }
  ])

  return db
}

describe('suggest method', () => {
  it('should complete a single word and report the elapsed time', () => {
    const db = createProductsDB()
    const result = suggest(db, { term: 'head' })

    expect(result.count).toBe(1)
    expect(result.suggestions.map(({ suggestion, terms, count }) => ({ suggestion, terms, count }))).toStrictEqual([
      { suggestion: 'headphones', terms: ['headphones'], count: 2 }
    ])
    expect(result.suggestions[0].score > 0).toBeTruthy()
    expect(result.elapsed.raw > 0).toBeTruthy()
    expect(result.elapsed.formatted).toBeTruthy()
  })

  it('should rank the suggestions by aggregated document relevance', () => {
    const db = createProductsDB()
    const result = suggest(db, { term: 'noi' })

    expect(result.suggestions.map(({ suggestion }) => suggestion)).toStrictEqual(['noise', 'noisy'])
    expect(result.suggestions[0].score > result.suggestions[1].score).toBeTruthy()
    expect(result.suggestions[0].count).toBe(2)
    expect(result.suggestions[1].count).toBe(1)
  })

  it('should complete the last word of a phrase, keeping the previous ones', () => {
    const db = createProductsDB()
    const result = suggest(db, { term: 'noise can' })

    expect(result.suggestions.map(({ suggestion, count }) => ({ suggestion, count }))).toStrictEqual([
      { suggestion: 'noise cancelling', count: 2 },
      { suggestion: 'noise cancellation', count: 1 }
    ])
  })

  it('should not suggest words that never appear together in a document', () => {
    const db = createProductsDB()
    const result = suggest(db, { term: 'noi shirt' })

    // "noisy" and "shirt" share a document, "noise" and "shirt" do not.
    expect(result.suggestions.map(({ suggestion }) => suggestion)).toStrictEqual(['noisy shirt'])
  })

  it('should expand only the last word when prefix is "last"', () => {
    const db = createProductsDB()

    expect(
      suggest(db, { term: 'noi cancelling', prefix: 'last' }).suggestions,
      'the previous words must match a whole indexed word'
    ).toStrictEqual([])
    expect(
      suggest(db, { term: 'noise can', prefix: 'last' }).suggestions.map(({ suggestion }) => suggestion)
    ).toStrictEqual(['noise cancelling', 'noise cancellation'])
  })

  it('should only match whole indexed words when prefix is false', () => {
    const db = createProductsDB()

    expect(suggest(db, { term: 'head', prefix: false }).suggestions).toStrictEqual([])
    expect(
      suggest(db, { term: 'headphones', prefix: false }).suggestions.map(({ suggestion }) => suggestion)
    ).toStrictEqual(['headphones'])
  })

  it('should tolerate typos', () => {
    const db = createProductsDB()

    expect(suggest(db, { term: 'hedphones' }).suggestions, 'no tolerance, no suggestion').toStrictEqual([])
    expect(
      suggest(db, { term: 'hedphones', tolerance: 1 }).suggestions.map(({ suggestion }) => suggestion)
    ).toStrictEqual(['headphones'])
    expect(
      suggest(db, { term: 'hedphones', tolerance: 1, prefix: false }).suggestions.map(({ suggestion }) => suggestion),
      'tolerance applies to fully typed words too'
    ).toStrictEqual(['headphones'])
  })

  it('should keep the context words whole when a tolerance is combined with prefix', () => {
    const db = create({ schema: { title: 'string' } as const })

    insertMultiple(db, [{ title: 'cancel policy' }, { title: 'cancellation policy' }])

    expect(
      suggest(db, { term: 'cancel poli', prefix: 'last', tolerance: 1 }).suggestions.map(
        ({ suggestion }) => suggestion
      ),
      'a tolerance must not turn a context word into a prefix expansion'
    ).toStrictEqual(['cancel policy'])
    expect(
      suggest(db, { term: 'cancel poli', prefix: 'last' }).suggestions.map(({ suggestion }) => suggestion),
      'same suggestions as without the tolerance'
    ).toStrictEqual(['cancel policy'])
    expect(
      suggest(db, { term: 'cancel poli', prefix: true, tolerance: 1 }).suggestions.map(({ suggestion }) => suggestion),
      'prefix true still expands the context words'
    ).toStrictEqual(['cancel policy', 'cancellation policy'])
    expect(
      suggest(db, { term: 'cancl poli', prefix: 'last', tolerance: 1 }).suggestions.map(({ suggestion }) => suggestion),
      'a whole context word within the tolerated distance still matches'
    ).toStrictEqual(['cancel policy'])
  })

  it('should only take the suggestions from the given properties', () => {
    const db = createProductsDB()

    expect(
      suggest(db, { term: 'wire', properties: ['title'] }).suggestions.map(({ suggestion }) => suggestion)
    ).toStrictEqual(['wired'])
    expect(
      suggest(db, { term: 'wire', properties: ['description'] }).suggestions.map(({ suggestion }) => suggestion)
    ).toStrictEqual(['wireless'])

    const both = suggest(db, { term: 'wire' })
    expect(both.count).toBe(2)
  })

  it('should throw on unknown properties', () => {
    const db = createProductsDB()

    expect(() => suggest(db, { term: 'head', properties: ['unknown'] as never[] })).toThrow(
      expect.objectContaining({
        code: 'UNKNOWN_INDEX'
      })
    )
  })

  it('should boost the properties', () => {
    const db = createProductsDB()

    const unboosted = suggest(db, { term: 'wire' })
    const boosted = suggest(db, { term: 'wire', boost: { description: 5 } })

    expect(unboosted.suggestions.map(({ suggestion }) => suggestion)).toStrictEqual(['wired', 'wireless'])
    expect(
      boosted.suggestions.map(({ suggestion }) => suggestion),
      'boosting the description promotes the word found in it'
    ).toStrictEqual(['wireless', 'wired'])
  })

  it('should only aggregate the documents matching the filters', () => {
    const db = createProductsDB()
    const result = suggest(db, { term: 'head', where: { price: { lt: 100 } } })

    expect(result.suggestions.map(({ suggestion, count }) => ({ suggestion, count }))).toStrictEqual([
      { suggestion: 'headphones', count: 1 }
    ])

    expect(suggest(db, { term: 'head', where: { price: { lt: 10 } } }).suggestions).toStrictEqual([])
  })

  it('should ignore partially matching documents unless a threshold is given', () => {
    const db = createProductsDB()

    expect(suggest(db, { term: 'noise shir' }).suggestions).toStrictEqual([])

    const withThreshold = suggest(db, { term: 'noise shir', threshold: 1 })
    expect(
      withThreshold.suggestions.map(({ suggestion, terms }) => ({ suggestion, terms })).sort(),
      'the words with no match are kept verbatim'
    ).toStrictEqual(
      [
        // The documents matching "noise" only keep the unmatched word verbatim, the one matching "shir" only completes it.
        { suggestion: 'noise shir', terms: ['noise', 'shir'] },
        { suggestion: 'noise shirt', terms: ['noise', 'shirt'] }
      ].sort()
    )
  })

  it('should paginate the suggestions', () => {
    const db = createProductsDB()

    const all = suggest(db, { term: 'noi' })
    expect(all.count).toBe(2)
    expect(all.suggestions.length).toBe(2)

    const first = suggest(db, { term: 'noi', limit: 1 })
    expect(first.count, 'count ignores limit and offset').toBe(2)
    expect(first.suggestions.map(({ suggestion }) => suggestion)).toStrictEqual(['noise'])

    const second = suggest(db, { term: 'noi', limit: 1, offset: 1 })
    expect(second.suggestions.map(({ suggestion }) => suggestion)).toStrictEqual(['noisy'])

    expect(suggest(db, { term: 'noi', offset: 2 }).suggestions).toStrictEqual([])
  })

  it('should return no suggestion for an empty or unknown term', () => {
    const db = createProductsDB()

    for (const term of ['', '   ', 'zzz']) {
      const result = suggest(db, { term })
      expect(result.count, `no suggestion for "${term}"`).toBe(0)
      expect(result.suggestions).toStrictEqual([])
      expect(result.elapsed.formatted).toBeTruthy()
    }
  })

  it('should be exposed as autoSuggest too', () => {
    const db = createProductsDB()

    expect(autoSuggest(db, { term: 'head' }).suggestions).toStrictEqual(suggest(db, { term: 'head' }).suggestions)
  })

  it('should score the documents exactly as search does', () => {
    const db = create({ schema: { title: 'string', description: 'string' } as const })

    insertMultiple(db, [
      { title: 'cancel cancelling cancellation cancelled', description: 'cancel policy' },
      { title: 'noise cancelling headphones', description: 'wireless' },
      { title: 'unrelated', description: 'nothing here' }
    ])

    const relevance = { k: 1.2, b: 0.75, d: 0.5 }
    const properties = ['title', 'description']
    const docsCount = count(db)

    const searchScores = defaultIndex.search(
      db.data.index,
      'can',
      db.tokenizer,
      undefined,
      properties,
      false,
      0,
      {},
      relevance,
      docsCount,
      undefined,
      1,
      true
    )

    const matches = defaultIndex.searchSuggestions(
      db.data.index,
      [{ token: 'can', exact: false, tolerance: 0, completion: true }],
      properties,
      {},
      relevance,
      docsCount,
      undefined
    )

    expect(
      searchScores.map(([id, score]) => [id, score]).sort(),
      'every expansion of a token contributes to the document score, as in search'
    ).toStrictEqual(Array.from(matches, ([id, match]) => [id, match.score]).sort())
  })

  it('should throw when the index component cannot expand a token', () => {
    const { supportsSuggestions: _supportsSuggestions, ...index } = defaultIndex.createIndex()

    const db = create({
      schema: { title: 'string' } as const,
      components: { index }
    })

    insertMultiple(db, [{ title: 'Noise cancelling headphones' }])

    expect(
      index.searchSuggestions,
      'the default component declares the capability instead of the implementation'
    ).toBeFalsy()
    expect(() => suggest(db, { term: 'head' })).toThrow(expect.objectContaining({ code: 'SUGGEST_NOT_SUPPORTED' }))
  })

  it('should let an index component provide its own expansion', () => {
    let calls = 0
    const index = {
      ...defaultIndex.createIndex(),
      searchSuggestions() {
        calls++
        return new Map([[1, { words: ['custom'], wordScores: [3], matchedTokens: 1, score: 3 }]])
      }
    }

    const db = create({
      schema: { title: 'string' } as const,
      components: { index }
    })

    insertMultiple(db, [{ title: 'Noise cancelling headphones' }])

    expect(
      suggest(db, { term: 'head' }).suggestions,
      'the component implementation wins over the default one'
    ).toStrictEqual([{ suggestion: 'custom', terms: ['custom'], score: 3, count: 1 }])
    expect(calls).toBe(1)
  })
})
