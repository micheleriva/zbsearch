import { radix } from 'zbsearch/trees'
import { decodeJSON, encodeJSON } from './varint.js'

type RadixTree = InstanceType<typeof radix.RadixTree>
type RadixNode = InstanceType<typeof radix.RadixNode>
type RadixNodeJSON = radix.RadixNodeJSON

export type DictionaryNodeJSON = RadixNodeJSON

/**
 * A trie node stripped for the wire: [edgeLabel, isEndOfWord, children].
 * Full words and node keys are redundant (rebuilt from the path), and
 * postings ship separately in shards.
 */
export type CompactNode = [string, 0 | 1, CompactNode[]]

export interface DictionaryPayload {
  props: Record<string, CompactNode>
}

export function toCompactNode(node: RadixNodeJSON): CompactNode {
  return [node.s, node.e ? 1 : 0, (node.c ?? []).map(([, child]) => toCompactNode(child))]
}

export function encodeDictionary(props: Record<string, RadixNodeJSON>): Uint8Array {
  const payload: DictionaryPayload = { props: {} }

  for (const prop of Object.keys(props)) {
    payload.props[prop] = toCompactNode(props[prop])
  }

  return encodeJSON(payload)
}

function buildNode(compact: CompactNode, parentWord: string): RadixNode {
  const [subWord, end, children] = compact
  const node = new radix.RadixNode(subWord[0] ?? '', subWord, end === 1)
  node.w = parentWord + subWord

  for (const child of children) {
    const childNode = buildNode(child, node.w)
    node.c.set(childNode.k, childNode)
  }

  return node
}

export function buildDictionaryTree(compact: CompactNode): RadixTree {
  const tree = new radix.RadixTree()
  const [, end, children] = compact
  tree.e = end === 1

  for (const child of children) {
    const childNode = buildNode(child, '')
    tree.c.set(childNode.k, childNode)
  }

  return tree
}

export function decodeDictionary(bytes: Uint8Array): Record<string, RadixTree> {
  const payload = decodeJSON<DictionaryPayload>(bytes)
  const tries: Record<string, RadixTree> = {}

  for (const prop of Object.keys(payload.props)) {
    tries[prop] = buildDictionaryTree(payload.props[prop])
  }

  return tries
}
