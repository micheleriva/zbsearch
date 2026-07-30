import t from 'tap'
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

t.test('suggest method', (t) => {
  t.test('should complete a single word and report the elapsed time', (t) => {
    const db = createProductsDB()
    const result = suggest(db, { term: 'head' })

    t.equal(result.count, 1)
    t.strictSame(
      result.suggestions.map(({ suggestion, terms, count }) => ({ suggestion, terms, count })),
      [{ suggestion: 'headphones', terms: ['headphones'], count: 2 }]
    )
    t.ok(result.suggestions[0].score > 0)
    t.ok(result.elapsed.raw > 0)
    t.ok(result.elapsed.formatted)

    t.end()
  })

  t.test('should rank the suggestions by aggregated document relevance', (t) => {
    const db = createProductsDB()
    const result = suggest(db, { term: 'noi' })

    t.strictSame(
      result.suggestions.map(({ suggestion }) => suggestion),
      ['noise', 'noisy']
    )
    t.ok(result.suggestions[0].score > result.suggestions[1].score)
    t.equal(result.suggestions[0].count, 2)
    t.equal(result.suggestions[1].count, 1)

    t.end()
  })

  t.test('should complete the last word of a phrase, keeping the previous ones', (t) => {
    const db = createProductsDB()
    const result = suggest(db, { term: 'noise can' })

    t.strictSame(
      result.suggestions.map(({ suggestion, count }) => ({ suggestion, count })),
      [
        { suggestion: 'noise cancelling', count: 2 },
        { suggestion: 'noise cancellation', count: 1 }
      ]
    )

    t.end()
  })

  t.test('should not suggest words that never appear together in a document', (t) => {
    const db = createProductsDB()
    const result = suggest(db, { term: 'noi shirt' })

    // "noisy" and "shirt" share a document, "noise" and "shirt" do not.
    t.strictSame(
      result.suggestions.map(({ suggestion }) => suggestion),
      ['noisy shirt']
    )

    t.end()
  })

  t.test('should expand only the last word when prefix is "last"', (t) => {
    const db = createProductsDB()

    t.strictSame(
      suggest(db, { term: 'noi cancelling', prefix: 'last' }).suggestions,
      [],
      'the previous words must match a whole indexed word'
    )
    t.strictSame(
      suggest(db, { term: 'noise can', prefix: 'last' }).suggestions.map(({ suggestion }) => suggestion),
      ['noise cancelling', 'noise cancellation']
    )

    t.end()
  })

  t.test('should only match whole indexed words when prefix is false', (t) => {
    const db = createProductsDB()

    t.strictSame(suggest(db, { term: 'head', prefix: false }).suggestions, [])
    t.strictSame(
      suggest(db, { term: 'headphones', prefix: false }).suggestions.map(({ suggestion }) => suggestion),
      ['headphones']
    )

    t.end()
  })

  t.test('should tolerate typos', (t) => {
    const db = createProductsDB()

    t.strictSame(suggest(db, { term: 'hedphones' }).suggestions, [], 'no tolerance, no suggestion')
    t.strictSame(
      suggest(db, { term: 'hedphones', tolerance: 1 }).suggestions.map(({ suggestion }) => suggestion),
      ['headphones']
    )
    t.strictSame(
      suggest(db, { term: 'hedphones', tolerance: 1, prefix: false }).suggestions.map(({ suggestion }) => suggestion),
      ['headphones'],
      'tolerance applies to fully typed words too'
    )

    t.end()
  })

  t.test('should only take the suggestions from the given properties', (t) => {
    const db = createProductsDB()

    t.strictSame(
      suggest(db, { term: 'wire', properties: ['title'] }).suggestions.map(({ suggestion }) => suggestion),
      ['wired']
    )
    t.strictSame(
      suggest(db, { term: 'wire', properties: ['description'] }).suggestions.map(({ suggestion }) => suggestion),
      ['wireless']
    )

    const both = suggest(db, { term: 'wire' })
    t.equal(both.count, 2)

    t.end()
  })

  t.test('should throw on unknown properties', (t) => {
    const db = createProductsDB()

    t.throws(() => suggest(db, { term: 'head', properties: ['unknown'] as never[] }), {
      code: 'UNKNOWN_INDEX'
    })

    t.end()
  })

  t.test('should boost the properties', (t) => {
    const db = createProductsDB()

    const unboosted = suggest(db, { term: 'wire' })
    const boosted = suggest(db, { term: 'wire', boost: { description: 5 } })

    t.strictSame(
      unboosted.suggestions.map(({ suggestion }) => suggestion),
      ['wired', 'wireless']
    )
    t.strictSame(
      boosted.suggestions.map(({ suggestion }) => suggestion),
      ['wireless', 'wired'],
      'boosting the description promotes the word found in it'
    )

    t.end()
  })

  t.test('should only aggregate the documents matching the filters', (t) => {
    const db = createProductsDB()
    const result = suggest(db, { term: 'head', where: { price: { lt: 100 } } })

    t.strictSame(
      result.suggestions.map(({ suggestion, count }) => ({ suggestion, count })),
      [{ suggestion: 'headphones', count: 1 }]
    )

    t.strictSame(suggest(db, { term: 'head', where: { price: { lt: 10 } } }).suggestions, [])

    t.end()
  })

  t.test('should ignore partially matching documents unless a threshold is given', (t) => {
    const db = createProductsDB()

    t.strictSame(suggest(db, { term: 'noise shir' }).suggestions, [])

    const withThreshold = suggest(db, { term: 'noise shir', threshold: 1 })
    t.strictSame(
      withThreshold.suggestions.map(({ suggestion, terms }) => ({ suggestion, terms })).sort(),
      [
        // The documents matching "noise" only keep the unmatched word verbatim, the one matching "shir" only completes it.
        { suggestion: 'noise shir', terms: ['noise', 'shir'] },
        { suggestion: 'noise shirt', terms: ['noise', 'shirt'] }
      ].sort(),
      'the words with no match are kept verbatim'
    )

    t.end()
  })

  t.test('should paginate the suggestions', (t) => {
    const db = createProductsDB()

    const all = suggest(db, { term: 'noi' })
    t.equal(all.count, 2)
    t.equal(all.suggestions.length, 2)

    const first = suggest(db, { term: 'noi', limit: 1 })
    t.equal(first.count, 2, 'count ignores limit and offset')
    t.strictSame(
      first.suggestions.map(({ suggestion }) => suggestion),
      ['noise']
    )

    const second = suggest(db, { term: 'noi', limit: 1, offset: 1 })
    t.strictSame(
      second.suggestions.map(({ suggestion }) => suggestion),
      ['noisy']
    )

    t.strictSame(suggest(db, { term: 'noi', offset: 2 }).suggestions, [])

    t.end()
  })

  t.test('should return no suggestion for an empty or unknown term', (t) => {
    const db = createProductsDB()

    for (const term of ['', '   ', 'zzz']) {
      const result = suggest(db, { term })
      t.equal(result.count, 0, `no suggestion for "${term}"`)
      t.strictSame(result.suggestions, [])
      t.ok(result.elapsed.formatted)
    }

    t.end()
  })

  t.test('should be exposed as autoSuggest too', (t) => {
    const db = createProductsDB()

    t.strictSame(autoSuggest(db, { term: 'head' }).suggestions, suggest(db, { term: 'head' }).suggestions)

    t.end()
  })

  t.test('should score the documents exactly as search does', (t) => {
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

    t.strictSame(
      searchScores.map(([id, score]) => [id, score]).sort(),
      Array.from(matches, ([id, match]) => [id, match.score]).sort(),
      'every expansion of a token contributes to the document score, as in search'
    )

    t.end()
  })

  t.test('should throw when the index component cannot expand a token', (t) => {
    const index = { ...defaultIndex.createIndex() }
    delete index.searchSuggestions

    const db = create({
      schema: { title: 'string' } as const,
      components: { index }
    })

    insertMultiple(db, [{ title: 'Noise cancelling headphones' }])

    t.throws(() => suggest(db, { term: 'head' }), { code: 'SUGGEST_NOT_SUPPORTED' })

    t.end()
  })

  t.end()
})
