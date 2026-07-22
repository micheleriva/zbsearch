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

    const index = list.indexOf(docID)
    if (index === -1) {
      return false
    }

    list.splice(index, 1)
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

        const docIDs = node.getDocumentsFromPostings(postings)
        if (docIDs.length > 0) {
          output[w] = [...docIDs]
        } else {
          output[w] = []
        }
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

    const initialRow = new Array<number>(termLength + 1)

    for (let i = 0; i <= termLength; i++) {
      initialRow[i] = i
    }

    const stack: Array<{ node: RadixNode; row: number[] }> = [{ node: this, row: initialRow }]

    while (stack.length > 0) {
      const { node, row } = stack.pop()!

      if (node.e && row[termLength] <= tolerance) {
        const docIDs = node.getDocumentsFromPostings(postings)
        output[node.w] = docIDs.length > 0 ? [...docIDs] : []
      }

      for (const child of node.c.values()) {
        const label = child.s
        let currentRow = row
        let pruned = false
        let prefixMatched = false

        for (let charIndex = 0; charIndex < label.length; charIndex++) {
          const charCode = label.charCodeAt(charIndex)
          const nextRow = new Array<number>(termLength + 1)

          nextRow[0] = currentRow[0] + 1

          let rowMin = nextRow[0]

          for (let i = 1; i <= termLength; i++) {
            const value =
              term.charCodeAt(i - 1) === charCode
                ? currentRow[i - 1]
                : Math.min(currentRow[i] + 1, nextRow[i - 1] + 1, currentRow[i - 1] + 1)

            nextRow[i] = value

            if (value < rowMin) {
              rowMin = value
            }
          }

          currentRow = nextRow

          if (!nextRow[termLength]) {
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
          stack.push({ node: child, row: currentRow })
        }
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
    this.insertWithPostings(word, docId, this.postings)
  }

  public find(params: FindParams): FindResult {
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
