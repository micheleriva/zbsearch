/* eslint-disable @typescript-eslint/no-this-alias */
import { syncBoundedLevenshtein } from '../components/levenshtein.js'
import { InternalDocumentID } from '../components/internal-document-id-store.js'
import {
  appendPosting,
  clearPostings,
  collectLegacyNodePostings,
  createPostingsMap,
  deserializePostingsMap,
  getDocumentFrequency,
  getPostings,
  PostingsMap,
  removePosting,
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

  constructor(key: string, subWord: string, end: boolean) {
    this.k = key
    this.s = subWord
    this.e = end
  }

  public updateParent(parent: RadixNode): void {
    this.w = parent.w + this.s
  }

  protected addDocumentToPostings(postings: PostingsMap, docID: InternalDocumentID): void {
    appendPosting(postings, this.w, docID)
  }

  protected removeDocumentFromPostings(postings: PostingsMap, docID: InternalDocumentID): boolean {
    return removePosting(postings, this.w, docID)
  }

  protected getDocumentsFromPostings(postings: PostingsMap): InternalDocumentID[] {
    return getPostings(postings, this.w)
  }

  protected hasDocumentsInPostings(postings: PostingsMap): boolean {
    return getPostings(postings, this.w).length > 0
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
      const currentCharacter = word[i]
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

        const inbetweenNode = new RadixNode(commonPrefix[0], commonPrefix, false)
        node.c.set(commonPrefix[0], inbetweenNode)
        inbetweenNode.updateParent(node)

        childNode.s = newEdgeLabel
        childNode.k = newEdgeLabel[0]
        inbetweenNode.c.set(newEdgeLabel[0], childNode)
        childNode.updateParent(inbetweenNode)

        if (newWordLabel) {
          const newNode = new RadixNode(newWordLabel[0], newWordLabel, true)
          inbetweenNode.c.set(newWordLabel[0], newNode)
          newNode.updateParent(inbetweenNode)
          newNode.addDocumentToPostings(postings, docId)
        } else {
          inbetweenNode.e = true
          inbetweenNode.updateParent(node)
          inbetweenNode.addDocumentToPostings(postings, docId)
        }
        return
      } else {
        const newNode = new RadixNode(currentCharacter, word.slice(i), true)
        node.c.set(currentCharacter, newNode)
        newNode.updateParent(node)
        newNode.addDocumentToPostings(postings, docId)
        return
      }
    }

    if (!node.e) {
      node.e = true
    }
    node.addDocumentToPostings(postings, docId)
  }

  private _findLevenshtein(
    term: string,
    index: number,
    tolerance: number,
    originalTolerance: number,
    output: FindResult,
    postings: PostingsMap
  ) {
    const stack: Array<{ node: RadixNode; index: number; tolerance: number }> = [{ node: this, index, tolerance }]

    while (stack.length > 0) {
      const { node, index, tolerance } = stack.pop()!

      if (node.w.startsWith(term)) {
        node.findAllWords(output, term, postings, false, 0)
        continue
      }

      if (tolerance < 0) {
        continue
      }

      if (node.e) {
        const { w } = node
        if (w && syncBoundedLevenshtein(term, w, originalTolerance).isBounded) {
          const docIDs = node.getDocumentsFromPostings(postings)
          if (docIDs.length > 0) {
            if (Object.hasOwn(output, w)) {
              const existing = output[w]
              for (const docID of docIDs) {
                if (!existing.includes(docID)) {
                  existing.push(docID)
                }
              }
            } else {
              output[w] = [...docIDs]
            }
          } else {
            output[w] = []
          }
        }
      }

      if (index >= term.length) {
        continue
      }

      const currentChar = term[index]
      const children = node.c

      const matchingChild = children.get(currentChar)
      if (matchingChild) {
        stack.push({ node: matchingChild, index: index + 1, tolerance })
      }

      stack.push({ node: node, index: index + 1, tolerance: tolerance - 1 })

      for (const [character, childNode] of children) {
        stack.push({ node: childNode, index: index, tolerance: tolerance - 1 })

        if (character !== currentChar) {
          stack.push({ node: childNode, index: index + 1, tolerance: tolerance - 1 })
        }
      }
    }
  }

  public findWithPostings(params: FindParams, postings: PostingsMap): FindResult {
    const { term, exact, tolerance } = params
    if (tolerance && !exact) {
      const output: FindResult = {}
      this._findLevenshtein(term, 0, tolerance, tolerance, output, postings)
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

    return tree
  }
}
