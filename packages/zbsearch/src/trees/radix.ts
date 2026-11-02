/* eslint-disable @typescript-eslint/no-this-alias */
import { syncBoundedLevenshtein } from '../components/levenshtein.js'
import { InternalDocumentID } from '../components/internal-document-id-store.js'
import {
  clearPostings,
  collectLegacyNodePostings,
  createPostingsMap,
  deserializePostingsMap,
  getDocumentFrequency,
  PostingsMap,
  serializePostingsMap,
  SerializedPostings
} from './postings.js'

interface FindParams {
  term: string
  exact?: boolean
  tolerance?: number
}

export type FindResult = Record<string, InternalDocumentID[]>

export type RadixNodeJSON = {
  w: string
  s: string
  e: boolean
  k: string
  c: [string, RadixNodeJSON][]
  postings?: SerializedPostings
  d?: InternalDocumentID[]
}

const EMPTY_POSTINGS: InternalDocumentID[] = []

// Reusable buffers for the trie-walking Levenshtein search (grown on demand, never shrunk).
let levenshteinRows = new Int32Array(256)
let levenshteinTermCodes = new Int32Array(32)
const levenshteinAsciiMasks = new Int32Array(128)
// Longest term the bit-parallel search handles: one bit per term prefix (length + 1 bits) in an int32.
const MAX_BIT_PARALLEL_TERM_LENGTH = 30
// Highest tolerance the bit-parallel search handles (it keeps one mask per error count).
const MAX_BIT_PARALLEL_TOLERANCE = 30

export class RadixNode {
  // Node key
  public k: string
  // Node subword
  public s: string
  // Node children
  public c: Map<string, RadixNode> = new Map()
  // Node end
  public e: boolean
  // Node word
  public w = ''
  // Cached postings list for this word (same array as in the tree PostingsMap)
  public d?: InternalDocumentID[]

  constructor(key: string, subWord: string, end: boolean) {
    this.k = key
    this.s = subWord
    this.e = end
  }

  public updateParent(parent: RadixNode): void {
    this.w = parent.w + this.s
  }

  protected addDocumentToPostings(postings: PostingsMap, docID: InternalDocumentID): void {
    let list = this.d
    if (list) {
      list.push(docID)
      return
    }

    list = postings.get(this.w)
    if (!list) {
      list = [docID]
      postings.set(this.w, list)
      this.d = list
      return
    }

    list.push(docID)
    this.d = list
  }

  protected removeDocumentFromPostings(postings: PostingsMap, docID: InternalDocumentID): boolean {
    const list = this.d ?? postings.get(this.w)
    if (!list) {
      return false
    }

    let index = list.indexOf(docID)
    if (index === -1) {
      return false
    }

    // A document may have been posted under the same word more than once (an index built by an
    // earlier version of plugin-qps did so for a word repeated across sentences). Removing the
    // document from the word means removing every one of its postings.
    do {
      list.splice(index, 1)
      index = list.indexOf(docID, index)
    } while (index !== -1)

    if (list.length === 0) {
      postings.delete(this.w)
      this.d = undefined
    } else {
      this.d = list
    }
    return true
  }

  protected getDocumentsFromPostings(postings: PostingsMap): InternalDocumentID[] {
    if (this.d) {
      return this.d
    }

    const list = postings.get(this.w)
    if (!list) {
      return EMPTY_POSTINGS
    }

    this.d = list
    return list
  }

  protected hasDocumentsInPostings(postings: PostingsMap): boolean {
    if (this.d) {
      return this.d.length > 0
    }
    const list = postings.get(this.w)
    return list !== undefined && list.length > 0
  }

  public findAllWords(
    output: FindResult,
    term: string,
    postings: PostingsMap,
    exact?: boolean,
    tolerance?: number
  ): FindResult {
    const stack: RadixNode[] = [this]
    while (stack.length > 0) {
      const node = stack.pop()!

      if (node.e) {
        const { w } = node

        if (exact && w !== term) {
          continue
        }

        if (tolerance) {
          const difference = Math.abs(term.length - w.length)

          if (difference > tolerance || !syncBoundedLevenshtein(term, w, tolerance).isBounded) {
            continue
          }
        }

        output[w] = node.getDocumentsFromPostings(postings).slice()
      }

      const children = node.c
      if (children.size > 0) {
        for (const child of children.values()) {
          stack.push(child)
        }
      }
    }
    return output
  }

  public insertWithPostings(word: string, docId: InternalDocumentID, postings: PostingsMap): void {
    let node: RadixNode = this
    let i = 0
    const wordLength = word.length

    while (i < wordLength) {
      const currentCharacter = word[i]!
      const childNode = node.c.get(currentCharacter)

      if (childNode) {
        const edgeLabel = childNode.s
        const edgeLabelLength = edgeLabel.length
        let j = 0

        while (j < edgeLabelLength && i + j < wordLength && edgeLabel.charCodeAt(j) === word.charCodeAt(i + j)) {
          j++
        }

        if (j === edgeLabelLength) {
          node = childNode
          i += j
          if (i === wordLength) {
            if (!childNode.e) {
              childNode.e = true
            }
            childNode.addDocumentToPostings(postings, docId)
            return
          }
          continue
        }

        const commonPrefix = edgeLabel.slice(0, j)
        const newEdgeLabel = edgeLabel.slice(j)
        const newWordLabel = word.slice(i + j)

        const inbetweenNode = new RadixNode(commonPrefix[0]!, commonPrefix, false)
        inbetweenNode.w = node.w + commonPrefix
        node.c.set(commonPrefix[0]!, inbetweenNode)

        childNode.s = newEdgeLabel
        childNode.k = newEdgeLabel[0]!
        inbetweenNode.c.set(newEdgeLabel[0]!, childNode)
        childNode.w = inbetweenNode.w + newEdgeLabel

        if (newWordLabel) {
          const newNode = new RadixNode(newWordLabel[0]!, newWordLabel, true)
          newNode.w = inbetweenNode.w + newWordLabel
          inbetweenNode.c.set(newWordLabel[0]!, newNode)
          newNode.addDocumentToPostings(postings, docId)
        } else {
          inbetweenNode.e = true
          inbetweenNode.addDocumentToPostings(postings, docId)
        }
        return
      } else {
        const suffix = word.slice(i)
        const newNode = new RadixNode(currentCharacter, suffix, true)
        newNode.w = node.w + suffix
        node.c.set(currentCharacter, newNode)
        newNode.addDocumentToPostings(postings, docId)
        return
      }
    }

    if (!node.e) {
      node.e = true
    }
    node.addDocumentToPostings(postings, docId)
  }

  private _findLevenshtein(term: string, tolerance: number, output: FindResult, postings: PostingsMap) {
    const termLength = term.length

    if (!termLength) {
      this.findAllWords(output, term, postings, false, 0)
      return
    }

    if (
      termLength <= MAX_BIT_PARALLEL_TERM_LENGTH &&
      tolerance > 0 &&
      tolerance <= MAX_BIT_PARALLEL_TOLERANCE &&
      (tolerance | 0) === tolerance
    ) {
      this._findLevenshteinBitParallel(term, tolerance, output, postings)
      return
    }

    // Rows live in one reusable typed buffer: slots 0 and 1 are ping-pong scratch rows, slot 2 holds the
    // row of the node being expanded and slots 3+ hold the rows of the nodes waiting on the stack.
    const width = termLength + 1
    if (levenshteinTermCodes.length < termLength) {
      levenshteinTermCodes = new Int32Array(termLength * 2)
    }
    const termCodes = levenshteinTermCodes
    for (let i = 0; i < termLength; i++) {
      termCodes[i] = term.charCodeAt(i)
    }

    let rows = levenshteinRows
    if (rows.length < width * 4) {
      rows = levenshteinRows = new Int32Array(width * 8)
    }

    const scratchA = 0
    const scratchB = width
    const parentOffset = width * 2

    for (let i = 0; i <= termLength; i++) {
      rows[parentOffset + width + i] = i
    }

    const stack: RadixNode[] = [this]

    while (stack.length > 0) {
      const node = stack.pop()!
      const nodeOffset = (3 + stack.length) * width
      for (let i = 0; i <= termLength; i++) {
        rows[parentOffset + i] = rows[nodeOffset + i]
      }

      if (node.e && rows[parentOffset + termLength] <= tolerance) {
        output[node.w] = node.getDocumentsFromPostings(postings).slice()
      }

      for (const child of node.c.values()) {
        const label = child.s
        const labelLength = label.length
        let previous = parentOffset
        let current = scratchA
        let pruned = false
        let prefixMatched = false

        for (let charIndex = 0; charIndex < labelLength; charIndex++) {
          const charCode = label.charCodeAt(charIndex)

          let diagonal = rows[previous]
          let left = diagonal + 1
          rows[current] = left
          let rowMin = left

          for (let i = 1; i <= termLength; i++) {
            const up = rows[previous + i]
            let value: number
            if (termCodes[i - 1] === charCode) {
              value = diagonal
            } else {
              value = up < diagonal ? up : diagonal
              if (left < value) {
                value = left
              }
              value++
            }

            rows[current + i] = value
            left = value
            diagonal = up

            if (value < rowMin) {
              rowMin = value
            }
          }

          previous = current
          current = current === scratchA ? scratchB : scratchA

          if (!left) {
            prefixMatched = true
            break
          }

          if (rowMin > tolerance) {
            pruned = true
            break
          }
        }

        if (prefixMatched) {
          child.findAllWords(output, term, postings, false, 0)
        } else if (!pruned) {
          const childOffset = (3 + stack.length) * width
          if (childOffset + width > rows.length) {
            const grown = new Int32Array(rows.length * 2)
            grown.set(rows)
            rows = levenshteinRows = grown
          }
          for (let i = 0; i <= termLength; i++) {
            rows[childOffset + i] = rows[previous + i]
          }
          stack.push(child)
        }
      }
    }
  }

  // Same walk and same output (words and order) as the row-based search in `_findLevenshtein`, but the
  // Levenshtein state of a trie path is kept as one bitmask per error count (Wu-Manber): bit `i` of mask `k`
  // is set when the first `i` term characters are within `k` edits of the path. A step costs O(tolerance)
  // instead of O(term length), and the first character of an edge is read from its child map key, so
  // edges pruned on their first character never load the child node.
  private _findLevenshteinBitParallel(term: string, tolerance: number, output: FindResult, postings: PostingsMap) {
    const termLength = term.length
    const asciiMasks = levenshteinAsciiMasks
    const otherCodes: number[] = []
    const otherMasks: number[] = []

    for (let i = 0; i < termLength; i++) {
      const code = term.charCodeAt(i)
      const bit = 1 << (i + 1)
      if (code < 128) {
        asciiMasks[code] |= bit
      } else {
        const index = otherCodes.indexOf(code)
        if (index === -1) {
          otherCodes.push(code)
          otherMasks.push(bit)
        } else {
          otherMasks[index] |= bit
        }
      }
    }

    // Slots 0 and 1 are ping-pong scratch states, slot 2 holds the state of the node being expanded and
    // slots 3+ hold the states of the nodes waiting on the stack.
    const width = tolerance + 1
    const allBits = (1 << (termLength + 1)) - 1
    const endBit = 1 << termLength

    let states = levenshteinRows
    if (states.length < width * 4) {
      states = levenshteinRows = new Int32Array(width * 8)
    }

    const scratchA = 0
    const scratchB = width
    const parentOffset = width * 2

    for (let k = 0; k <= tolerance; k++) {
      states[parentOffset + width + k] = k < termLength ? (1 << (k + 1)) - 1 : allBits
    }

    const stack: RadixNode[] = [this]

    while (stack.length > 0) {
      const node = stack.pop()!
      const nodeOffset = (3 + stack.length) * width
      for (let k = 0; k <= tolerance; k++) {
        states[parentOffset + k] = states[nodeOffset + k]
      }

      if (node.e && states[parentOffset + tolerance] & endBit) {
        output[node.w] = node.getDocumentsFromPostings(postings).slice()
      }

      const children = node.c
      for (const key of children.keys()) {
        let child: RadixNode | undefined
        let label = key
        let labelLength = 1
        let previous = parentOffset
        let current = scratchA
        let pruned = false
        let prefixMatched = false

        for (let charIndex = 0; charIndex < labelLength; charIndex++) {
          const charCode = label.charCodeAt(charIndex)
          let charMask = 0
          if (charCode < 128) {
            charMask = asciiMasks[charCode]
          } else {
            const index = otherCodes.indexOf(charCode)
            if (index !== -1) {
              charMask = otherMasks[index]
            }
          }

          let above = states[previous]
          let next = (above << 1) & charMask
          states[current] = next

          for (let k = 1; k <= tolerance; k++) {
            const old = states[previous + k]
            next = (((old << 1) & charMask) | above | (above << 1) | (next << 1)) & allBits
            states[current + k] = next
            above = old
          }

          previous = current
          current = current === scratchA ? scratchB : scratchA

          if (states[previous] & endBit) {
            prefixMatched = true
            break
          }

          if (!next) {
            pruned = true
            break
          }

          if (child === undefined) {
            child = children.get(key)!
            label = child.s
            labelLength = label.length
          }
        }

        if (child === undefined) {
          if (pruned) {
            continue
          }
          child = children.get(key)!
        }

        if (prefixMatched) {
          child.findAllWords(output, term, postings, false, 0)
        } else if (!pruned) {
          const childOffset = (3 + stack.length) * width
          if (childOffset + width > states.length) {
            const grown = new Int32Array(states.length * 2)
            grown.set(states)
            states = levenshteinRows = grown
          }
          for (let k = 0; k <= tolerance; k++) {
            states[childOffset + k] = states[previous + k]
          }
          stack.push(child)
        }
      }
    }

    for (let i = 0; i < termLength; i++) {
      const code = term.charCodeAt(i)
      if (code < 128) {
        asciiMasks[code] = 0
      }
    }
  }

  public findWithPostings(params: FindParams, postings: PostingsMap): FindResult {
    const { term, exact, tolerance } = params
    if (tolerance && !exact) {
      const output: FindResult = {}
      this._findLevenshtein(term, tolerance, output, postings)
      return output
    }

    let node: RadixNode = this
    let i = 0
    const termLength = term.length

    while (i < termLength) {
      const character = term[i]
      const childNode = node.c.get(character)

      if (childNode) {
        const edgeLabel = childNode.s
        const edgeLabelLength = edgeLabel.length
        let j = 0

        while (j < edgeLabelLength && i + j < termLength && edgeLabel.charCodeAt(j) === term.charCodeAt(i + j)) {
          j++
        }

        if (j === edgeLabelLength) {
          node = childNode
          i += j
        } else if (i + j === termLength) {
          if (j === termLength - i) {
            if (exact) {
              return {}
            }
            const output: FindResult = {}
            childNode.findAllWords(output, term, postings, exact, tolerance)
            return output
          }
          return {}
        } else {
          return {}
        }
      } else {
        return {}
      }
    }

    const output: FindResult = {}
    node.findAllWords(output, term, postings, exact, tolerance)
    return output
  }

  public contains(term: string): boolean {
    let node: RadixNode = this
    let i = 0
    const termLength = term.length

    while (i < termLength) {
      const character = term[i]
      const childNode = node.c.get(character)

      if (childNode) {
        const edgeLabel = childNode.s
        const edgeLabelLength = edgeLabel.length
        let j = 0

        while (j < edgeLabelLength && i + j < termLength && edgeLabel.charCodeAt(j) === term.charCodeAt(i + j)) {
          j++
        }

        if (j < edgeLabelLength) {
          return false
        }

        i += edgeLabelLength
        node = childNode
      } else {
        return false
      }
    }
    return true
  }

  public removeWordWithPostings(term: string, postings: PostingsMap): boolean {
    if (!term) {
      return false
    }

    let node: RadixNode = this
    const termLength = term.length
    const stack: { parent: RadixNode; character: string }[] = []
    for (let i = 0; i < termLength; i++) {
      const character = term[i]
      if (node.c.has(character)) {
        const childNode = node.c.get(character)!
        stack.push({ parent: node, character })
        i += childNode.s.length - 1
        node = childNode
      } else {
        return false
      }
    }

    clearPostings(postings, node.w)
    node.d = undefined
    node.e = false

    while (stack.length > 0 && node.c.size === 0 && !node.e && !node.hasDocumentsInPostings(postings)) {
      const { parent, character } = stack.pop()!
      parent.c.delete(character)
      node = parent
    }

    return true
  }

  public removeDocumentByWordWithPostings(
    term: string,
    docID: InternalDocumentID,
    postings: PostingsMap,
    exact = true
  ): boolean {
    if (!term) {
      return true
    }

    let node: RadixNode = this
    const termLength = term.length
    for (let i = 0; i < termLength; i++) {
      const character = term[i]
      if (node.c.has(character)) {
        const childNode = node.c.get(character)!
        i += childNode.s.length - 1
        node = childNode

        if (exact && node.w !== term) {
          // Do nothing if the exact condition is not met.
        } else {
          node.removeDocumentFromPostings(postings, docID)
        }
      } else {
        return false
      }
    }
    return true
  }

  protected toNodeJSON(): RadixNodeJSON {
    return {
      w: this.w,
      s: this.s,
      e: this.e,
      k: this.k,
      c: Array.from(this.c.entries()).map(([key, node]) => [key, node.toNodeJSON()])
    }
  }

  public static fromNodeJSON(json: RadixNodeJSON): RadixNode {
    const node = new RadixNode(json.k, json.s, json.e)
    node.w = json.w
    node.c = new Map(json.c?.map(([key, nodeJson]) => [key, RadixNode.fromNodeJSON(nodeJson)]) || [])
    return node
  }
}

export class RadixTree extends RadixNode {
  public postings: PostingsMap = createPostingsMap()

  constructor() {
    super('', '', false)
  }

  public insert(word: string, docId: InternalDocumentID): void {
    // Every posted word already has its end node in the tree (postings entries are created by, and
    // removed together with, the node they belong to), so a known word skips the tree walk entirely.
    const list = this.postings.get(word)
    if (list !== undefined) {
      list.push(docId)
      return
    }
    this.insertWithPostings(word, docId, this.postings)
  }

  public find(params: FindParams): FindResult {
    if (params.exact) {
      // A posted word always has its end node in the tree, so an exact lookup of a known word can skip the
      // tree walk. Unknown words (and end nodes left without postings) still go through the tree.
      const list = this.postings.get(params.term)
      if (list !== undefined) {
        const output: FindResult = {}
        output[params.term] = list.slice()
        return output
      }
    }
    return this.findWithPostings(params, this.postings)
  }

  public removeWord(term: string): boolean {
    return this.removeWordWithPostings(term, this.postings)
  }

  public removeDocumentByWord(term: string, docID: InternalDocumentID, exact = true): boolean {
    return this.removeDocumentByWordWithPostings(term, docID, this.postings, exact)
  }

  public getDocumentFrequency(term: string): number {
    return getDocumentFrequency(this.postings, term)
  }

  public toJSON(): RadixNodeJSON {
    return {
      ...this.toNodeJSON(),
      postings: serializePostingsMap(this.postings)
    }
  }

  public static fromJSON(json: RadixNodeJSON): RadixTree {
    const tree = new RadixTree()
    tree.w = json.w
    tree.s = json.s
    tree.e = json.e
    tree.k = json.k
    tree.c = new Map(json.c?.map(([key, nodeJson]) => [key, RadixNode.fromNodeJSON(nodeJson)]) || [])

    if (json.postings) {
      tree.postings = deserializePostingsMap(json.postings)
    } else {
      collectLegacyNodePostings(json, tree.postings)
    }

    hydrateNodePostings(tree, tree.postings)
    return tree
  }
}

function hydrateNodePostings(node: RadixNode, postings: PostingsMap): void {
  if (node.e) {
    const list = postings.get(node.w)
    if (list) {
      node.d = list
    }
  }

  for (const child of node.c.values()) {
    hydrateNodePostings(child, postings)
  }
}
