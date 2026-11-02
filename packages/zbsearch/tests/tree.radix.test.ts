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

  it('removes every posting of a document from a word', () => {
    const tree = new RadixTree()
    tree.insert('apple', 1)
    tree.insert('apple', 2)
    tree.insert('apple', 1)
    expect(tree.find({ term: 'apple' })).toStrictEqual({ apple: [1, 2, 1] })

    tree.removeDocumentByWord('apple', 1, true)
    expect(tree.find({ term: 'apple' })).toStrictEqual({ apple: [2] })

    tree.removeDocumentByWord('apple', 2, true)
    expect(tree.find({ term: 'apple' })).toStrictEqual({ apple: [] })
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

describe('find with tolerance on randomized vocabularies', () => {
  // Small deterministic PRNG so failures are reproducible
  function createRandom(seed: number) {
    return () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
  }

  function randomWord(random: () => number, alphabet: string, maxLength: number) {
    let word = ''
    const length = 1 + Math.floor(random() * maxLength)
    for (let i = 0; i < length; i++) {
      word += alphabet[Math.floor(random() * alphabet.length)]
    }
    return word
  }

  function mutate(random: () => number, word: string, alphabet: string) {
    let result = word
    const edits = Math.floor(random() * 3)
    for (let i = 0; i < edits; i++) {
      const position = Math.floor(random() * (result.length + 1))
      const character = alphabet[Math.floor(random() * alphabet.length)]
      const operation = random()
      if (operation < 0.33) {
        result = result.slice(0, position) + character + result.slice(position)
      } else if (operation < 0.66) {
        result = result.slice(0, position) + result.slice(position + 1)
      } else {
        result = result.slice(0, position) + character + result.slice(position + 1)
      }
    }
    return result
  }

  function bruteForce(words: string[], term: string, tolerance: number) {
    const expected: Record<string, number[]> = {}
    for (let id = 0; id < words.length; id++) {
      const word = words[id]
      if (levenshtein(term, word) <= tolerance || word.startsWith(term)) {
        ;(expected[word] ??= []).push(id)
      }
    }
    return expected
  }

  // The last case uses words and terms longer than 30 characters (the row-based fallback)
  const cases: Array<[string, string, number]> = [
    ['ascii', 'abcde', 8],
    ['non-ascii', 'aéb日ç', 7],
    ['long words', 'ab', 40]
  ]

  for (const [name, alphabet, maxLength] of cases) {
    it(`should match brute-force Levenshtein distance plus the prefix rule (${name})`, () => {
      const random = createRandom(maxLength * 31 + alphabet.length)
      const words: string[] = []
      for (let i = 0; i < 400; i++) {
        words.push(randomWord(random, alphabet, maxLength))
      }

      const tree = new RadixTree()
      for (let id = 0; id < words.length; id++) {
        tree.insert(words[id], id)
      }

      for (let i = 0; i < 300; i++) {
        const source = words[Math.floor(random() * words.length)]
        const term =
          random() < 0.2 ? source.slice(0, 1 + Math.floor(random() * source.length)) : mutate(random, source, alphabet)
        if (!term) {
          continue
        }
        const tolerance = 1 + Math.floor(random() * 4)
        expect(tree.find({ term, tolerance }), `term "${term}" with tolerance ${tolerance}`).toStrictEqual(
          bruteForce(words, term, tolerance)
        )
      }
    })
  }

  it('should handle a tolerance as large as the term', () => {
    const tree = new RadixTree()
    const words = ['a', 'ab', 'abc', 'b', 'xyz', 'xyzw']
    words.forEach((word, id) => tree.insert(word, id))

    expect(tree.find({ term: 'ab', tolerance: 2 })).toStrictEqual({ a: [0], ab: [1], abc: [2], b: [3] })
    expect(Object.keys(tree.find({ term: 'ab', tolerance: 10 })).sort()).toStrictEqual([...words].sort())
  })
})

describe('postings fast paths', () => {
  it('should keep exact lookups and re-insertions consistent with the tree', () => {
    const tree = new RadixTree()
    tree.insert('apple', 1)
    tree.insert('apple', 2)
    tree.insert('applet', 3)

    const found = tree.find({ term: 'apple', exact: true })
    expect(found).toStrictEqual({ apple: [1, 2] })

    // The returned list is a copy: mutating it does not affect the tree
    found.apple.push(99)
    expect(tree.find({ term: 'apple', exact: true })).toStrictEqual({ apple: [1, 2] })

    // An end node whose postings were all removed is still reported, with no documents
    tree.removeDocumentByWord('apple', 1)
    tree.removeDocumentByWord('apple', 2)
    expect(tree.find({ term: 'apple', exact: true })).toStrictEqual({ apple: [] })
    expect(tree.find({ term: 'appl', exact: true })).toStrictEqual({})

    tree.insert('apple', 4)
    expect(tree.find({ term: 'apple', exact: true })).toStrictEqual({ apple: [4] })
    expect(tree.find({ term: 'app' })).toStrictEqual({ apple: [4], applet: [3] })

    tree.removeWord('apple')
    expect(tree.find({ term: 'apple', exact: true })).toStrictEqual({})
    tree.insert('apple', 5)
    expect(tree.find({ term: 'apple', exact: true })).toStrictEqual({ apple: [5] })

    const restored = RadixTree.fromJSON(JSON.parse(JSON.stringify(tree.toJSON())))
    restored.insert('apple', 6)
    restored.insert('applet', 7)
    expect(restored.find({ term: 'appl' })).toStrictEqual({ apple: [5, 6], applet: [3, 7] })
    expect(restored.find({ term: 'apple', exact: true })).toStrictEqual({ apple: [5, 6] })
  })
})
