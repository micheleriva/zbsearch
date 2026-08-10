import { describe, expect, it } from 'vitest'
import { RadixTree } from '../src/trees/radix.js'
import { levenshtein } from '../src/components/levenshtein.js'

const phrases = [
  { id: 1, doc: 'the quick, brown fox' },
  { id: 2, doc: 'jumps over the lazy dog' },
  { id: 3, doc: 'just in time!' },
  { id: 4, doc: 'there is something wrong in there' },
  { id: 5, doc: 'this is me' },
  { id: 6, doc: 'thought it was sunday' },
  { id: 7, doc: "let's try this trie" },
  { id: 8, doc: 'primo' },
  { id: 9, doc: 'primate' },
  { id: 10, doc: 'prova' }
]

describe('radix tree', () => {
  it('should correctly find an element by prefix', () => {
    const tree = new RadixTree()
    for (const { doc, id } of phrases) {
      tree.insert(doc, id)
    }
    const result = tree.find({ term: phrases[5].doc.slice(0, 5) })
    expect(result).toStrictEqual({
      [phrases[5].doc]: [phrases[5].id]
    })
  })

  it('should correctly find a complete sentence', () => {
    const tree = new RadixTree()
    for (const { doc, id } of phrases) {
      tree.insert(doc, id)
    }

    for (const phrase of phrases) {
      const result = tree.find({ term: phrase.doc })
      expect(result).toStrictEqual({
        [phrase.doc]: [phrase.id]
      })
    }
  })

  it('exact works correctly', () => {
    const tree = new RadixTree()
    for (const { doc, id } of phrases) {
      tree.insert(doc, id)
    }
    const exactResult = tree.find({ term: phrases[5].doc.slice(0, 5), exact: true })
    expect(exactResult).toStrictEqual({})

    const result = tree.find({ term: phrases[5].doc, exact: true })
    expect(result).toStrictEqual({ [phrases[5].doc]: [phrases[5].id] })
  })

  it('should correctly index phrases into a prefix tree', () => {
    const tree = new RadixTree()

    for (const { doc, id } of phrases) {
      tree.insert(doc, id)
    }

    for (const phrase of phrases) {
      expect(tree.contains(phrase.doc)).toBe(true)
    }

    expect(tree.contains('thought it was saturday')).toBe(false)
  })

  it('should correctly delete a word from the tree', () => {
    const tree = new RadixTree()

    for (const { doc, id } of phrases) {
      tree.insert(doc, id)
    }

    const removedIndex = 0
    const removal = tree.removeWord(phrases[removedIndex].doc)
    expect(removal).toBeTruthy()

    const invalidRemoval = tree.removeWord('xyz')
    expect(invalidRemoval).toBeFalsy()

    for (let i = 0; i < phrases.length; i++) {
      if (i === removedIndex) {
        expect(tree.contains(phrases[removedIndex].doc)).toBeFalsy()
      } else {
        const result = tree.find({ term: phrases[i].doc })
        expect(result).toStrictEqual({
          [phrases[i].doc]: [phrases[i].id]
        })
      }
    }
  })

  it('should correctly delete a id from the tree with exact=true', () => {
    const tree = new RadixTree()

    for (const { doc, id } of phrases) {
      tree.insert(doc, id)
    }

    tree.removeDocumentByWord(phrases[0].doc, phrases[0].id, true)

    const resultFullSearch = tree.find({ term: phrases[0].doc })

    expect(resultFullSearch).toStrictEqual({
      [phrases[0].doc]: []
    })

    const resultHalfSearch = tree.find({ term: 'the' })
    expect(resultHalfSearch).toMatchObject({
      [phrases[0].doc]: []
    })
  })

  it('should correctly delete a id from the tree', () => {
    const tree = new RadixTree()

    for (const { doc, id } of phrases) {
      tree.insert(doc, id)
    }

    tree.removeDocumentByWord(phrases[0].doc, phrases[0].id, false)

    const resultFullSearch = tree.find({ term: phrases[0].doc })
    expect(resultFullSearch).toStrictEqual({
      [phrases[0].doc]: []
    })

    const resultHalfSearch = tree.find({ term: phrases[0].doc.slice(0, 5) })
    expect(resultHalfSearch).toStrictEqual({
      [phrases[0].doc]: []
    })
  })

  //testcase doesnt pass even after PR#580
  const words = [
    { id: 0, word: 'apple' },
    { id: 1, word: 'app' },
    { id: 2, word: 'apply' },
    { id: 3, word: 'apt' },
    { id: 4, word: 'apex' },
    { id: 5, word: 'about' },
    { id: 6, word: 'again' }
  ]
  it('test search with tolerance. should match all with prefix.', () => {
    const tree = new RadixTree()

    for (const { word, id } of words) {
      tree.insert(word, id)
    }
    const result1 = tree.find({ term: 'app' })
    const expected1 = { apple: [0], app: [1], apply: [2] }
    expect(result1).toStrictEqual(expected1)

    const result2 = tree.find({ term: 'app', exact: false, tolerance: 1 })
    const expected2 = { apple: [0], app: [1], apply: [2], apt: [3] }
    expect(result2).toStrictEqual(expected2)

    const result3 = tree.find({ term: 'app', exact: false, tolerance: 2 })
    const expected3 = { apple: [0], app: [1], apply: [2], apt: [3], apex: [4] }
    expect(result3).toStrictEqual(expected3)
  })
})

describe('test from trie for compatibility', () => {
  it('should correctly index phrases into a prefix tree', () => {
    const tree = new RadixTree()

    for (const { doc, id } of phrases) {
      tree.insert(doc, id)
    }

    for (const phrase of phrases) {
      expect(tree.contains(phrase.doc)).toBeTruthy()
    }
  })

  it('should correctly find an element by prefix', () => {
    const tree = new RadixTree()

    for (const { doc, id } of phrases) {
      tree.insert(doc, id)
    }

    expect(tree.find({ term: phrases[5].doc.slice(0, 5) })).toStrictEqual({ [phrases[5].doc]: [phrases[5].id] })
    expect(tree.find({ term: 'th' })).toStrictEqual({
      [phrases[0].doc]: [phrases[0].id],
      [phrases[3].doc]: [phrases[3].id],
      [phrases[4].doc]: [phrases[4].id],
      [phrases[5].doc]: [phrases[5].id]
    })
  })

  it('should correctly delete a word from the trie', () => {
    const tree = new RadixTree()

    for (const { doc, id } of phrases) {
      tree.insert(doc, id)
    }

    tree.removeWord(phrases[0].doc)

    expect(tree.contains(phrases[0].doc)).toBeFalsy()
    expect(tree.find({ term: phrases[0].doc })).toStrictEqual({})
  })
})

describe('find with tolerance on compressed edges', () => {
  it('should not miss genuine matches hidden behind compressed edges', () => {
    const tree = new RadixTree()
    tree.insert('boosting', 1)
    tree.insert('boasting', 2)
    tree.insert('boats', 3)

    // lev("boosting", "boasting") is 1, but the paths diverge right before a
    // multi-character edge: "bo" + "osting" vs "bo" + "a" + "sting".
    expect(tree.find({ term: 'boosting', tolerance: 1 })).toStrictEqual({ boosting: [1], boasting: [2] })
    expect(tree.find({ term: 'boasting', tolerance: 1 })).toStrictEqual({ boasting: [2], boosting: [1] })

    tree.insert('reinforcements', 4)
    expect(tree.find({ term: 'renforcements', tolerance: 1 })).toStrictEqual({ reinforcements: [4] })
  })

  it('should match brute-force Levenshtein distance plus the prefix rule', () => {
    const words = [
      'boosting',
      'boasting',
      'boats',
      'reinforcements',
      'altered',
      'altars',
      'moelleux',
      'moelleuse',
      'moelle',
      'scroll',
      'scrolled',
      'apple',
      'apply',
      'app',
      'apt',
      'apex',
      'about',
      'again',
      'hello',
      'help',
      'held',
      'yellow',
      'yelp',
      'world',
      'word',
      'words',
      'sword',
      'chris',
      'christopher',
      'cris',
      'craig'
    ]

    const tree = new RadixTree()
    for (let id = 0; id < words.length; id++) {
      tree.insert(words[id], id)
    }

    const queries: Array<[string, number]> = [
      ['boosting', 1],
      ['boosting', 2],
      ['boasting', 1],
      ['renforcements', 1],
      ['altvred', 1],
      ['moelleux', 1],
      ['moelleux', 2],
      ['scrol', 1],
      ['app', 1],
      ['app', 2],
      ['helo', 1],
      ['yelo', 2],
      ['word', 1],
      ['swrd', 2],
      ['christopher', 1],
      ['xylo', 2]
    ]
    for (const [term, tolerance] of queries) {
      const expected: Record<string, number[]> = {}
      for (let id = 0; id < words.length; id++) {
        const w = words[id]
        if (levenshtein(term, w) <= tolerance || w.startsWith(term)) {
          expected[w] = [id]
        }
      }
      expect(tree.find({ term, tolerance }), `term "${term}" with tolerance ${tolerance}`).toStrictEqual(expected)
    }
  })
})
