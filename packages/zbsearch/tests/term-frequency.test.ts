import { describe, expect, it } from 'vitest'
import { create, insertMultiple, search, suggest } from '../src/index.js'

const docs = [
  { id: 'rep', text: 'apple apple apple banana cherry' },
  { id: 'one', text: 'apple banana cherry' },
  { id: 'x', text: 'grape melon kiwi' }
]

describe('term frequency', () => {
  it('ranks a document higher the more often it repeats the query term', async () => {
    const db = create({ schema: { text: 'string' } as const })
    await insertMultiple(db, docs)

    const { hits } = search(db, { term: 'apple' })

    expect(hits.map((h) => h.id)).toStrictEqual(['rep', 'one'])
    expect(hits[0].score).toBeGreaterThan(hits[1].score)
  })

  it('counts every token towards the field length', async () => {
    const db = create({ schema: { text: 'string' } as const })
    await insertMultiple(db, docs)

    expect(db.data.index.fieldLengths.text[1]).toBe(5)
    expect(db.data.index.fieldLengths.text[2]).toBe(3)
    expect(db.data.index.frequencies.text[1]).toStrictEqual({ apple: 3, banana: 1, cherry: 1 })
  })

  it('allowDuplicates: false restores one-occurrence-per-document scoring', async () => {
    const db = create({
      schema: { text: 'string' } as const,
      components: { tokenizer: { allowDuplicates: false } }
    })
    await insertMultiple(db, docs)

    const { hits } = search(db, { term: 'apple' })

    expect(hits).toHaveLength(2)
    expect(hits[0].score).toBe(hits[1].score)
    expect(db.data.index.fieldLengths.text[1]).toBe(3)
  })

  it('a repeated query term is scored once', async () => {
    const db = create({ schema: { text: 'string' } as const })
    await insertMultiple(db, docs)

    const once = search(db, { term: 'apple' })
    const twice = search(db, { term: 'apple apple' })

    expect(twice.hits.map((h) => [h.id, h.score])).toStrictEqual(once.hits.map((h) => [h.id, h.score]))

    // The threshold logic counts distinct keywords, so a repeated term still behaves as a single-term query.
    const strict = search(db, { term: 'apple apple', threshold: 0 })
    expect(strict.count).toBe(2)
  })

  it('suggest ignores repeated query terms', async () => {
    const db = create({ schema: { text: 'string' } as const })
    await insertMultiple(db, docs)

    const once = suggest(db, { term: 'app' })
    const twice = suggest(db, { term: 'app app' })

    expect(twice.suggestions.map((s) => s.suggestion)).toStrictEqual(once.suggestions.map((s) => s.suggestion))
    expect(twice.suggestions[0].suggestion).toBe('apple')
  })
})
