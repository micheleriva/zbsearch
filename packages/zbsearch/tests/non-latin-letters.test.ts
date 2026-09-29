import { describe, expect, it } from 'vitest'
import { createTokenizer } from '../src/components/tokenizer/index.js'
import { create, insert, search } from '../src/index.js'

describe('letters outside the language alphabet', () => {
  it('are kept inside words by the English splitter', () => {
    const tokenizer = createTokenizer({ language: 'english' })

    expect(tokenizer.tokenize('β-blockers reduce mortality')).toStrictEqual(['β-blockers', 'reduce', 'mortality'])
    expect(tokenizer.tokenize('the Ω symbol and 東京')).toStrictEqual(['the', 'ω', 'symbol', 'and', '東京'])
  })

  it('are kept by the other language splitters too', () => {
    expect(createTokenizer({ language: 'italian' }).tokenize('i β-bloccanti')).toStrictEqual(['i', 'β-bloccanti'])
    // German does not treat `-` as a word character, so the hyphen still splits; the Greek letters survive.
    expect(createTokenizer({ language: 'german' }).tokenize('αβ-Strahlung')).toStrictEqual(['αβ', 'strahlung'])
    expect(createTokenizer({ language: 'russian' }).tokenize('β-блокаторы')).toStrictEqual(['β', 'блокаторы'])
  })

  it('still split on punctuation, symbols and whitespace', () => {
    const tokenizer = createTokenizer({ language: 'english' })

    expect(tokenizer.tokenize('café → bar; 3×4 = 12!')).toStrictEqual(['cafe', 'bar', '3', '4', '12'])
  })

  it('are searchable', async () => {
    const db = create({ schema: { text: 'string' } as const })
    await insert(db, { text: 'β-blockers reduce mortality' })
    await insert(db, { text: 'aspirin reduces fever' })

    expect(search(db, { term: 'β-blockers' }).count).toBe(1)
    expect(search(db, { term: 'mortality' }).count).toBe(1)
    expect(search(db, { term: 'blockers' }).count).toBe(0)
  })
})

describe('hyphens and apostrophes at the edges of a token', () => {
  it('are trimmed while the ones inside a word are kept', () => {
    const tokenizer = createTokenizer({ language: 'english' })

    expect(tokenizer.tokenize("foo -bar 'quoted' rock- -- t-shirt it's")).toStrictEqual([
      'foo',
      'bar',
      'quoted',
      'rock',
      't-shirt',
      "it's"
    ])
  })

  it('are trimmed from tokenizeSkipProperties values too, so full-text search still finds them', async () => {
    const db = create({
      schema: { tag: 'string' } as const,
      components: { tokenizer: { tokenizeSkipProperties: ['tag'] } }
    })
    await insert(db, { tag: '-foo' })
    await insert(db, { tag: "'foo bar'" })

    // The value is still kept whole (no split on the space), only its edges are trimmed.
    expect(db.tokenizer.tokenize("'foo bar'", 'english', 'tag')).toStrictEqual(['foo bar'])
    expect(db.tokenizer.tokenize('--', 'english', 'tag')).toStrictEqual([])

    // The query goes through the tokenizer without the property name and becomes `foo`.
    expect(search(db, { term: '-foo', properties: ['tag'] }).count).toBe(2)
    expect(search(db, { term: '-foo', properties: ['tag'], prefix: false }).count).toBe(1)
    // Filters tokenize both sides with the property name, so they keep working as before.
    expect(search(db, { where: { tag: '-foo' } }).count).toBe(1)
    expect(search(db, { where: { tag: "'foo bar'" } }).count).toBe(1)
  })

  it('cannot leak a leading hyphen into the index', async () => {
    const db = create({ schema: { text: 'string' } as const })
    await insert(db, { text: 'temperatures of -5 degrees, 😀-blockers' })

    expect(search(db, { term: '5' }).count).toBe(1)
    expect(search(db, { term: 'blockers' }).count).toBe(1)
  })
})
