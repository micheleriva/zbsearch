import { InternalDocumentID } from '../components/internal-document-id-store.js'

export type PostingsMap = Map<string, InternalDocumentID[]>

export function createPostingsMap(): PostingsMap {
  return new Map()
}

export function getPostings(postings: PostingsMap, word: string): InternalDocumentID[] {
  return postings.get(word) ?? []
}

export function addPosting(postings: PostingsMap, word: string, docId: InternalDocumentID): void {
  let list = postings.get(word)
  if (!list) {
    list = []
    postings.set(word, list)
  }
  if (!list.includes(docId)) {
    list.push(docId)
  }
}

export function appendPosting(postings: PostingsMap, word: string, docId: InternalDocumentID): void {
  let list = postings.get(word)
  if (!list) {
    list = [docId]
    postings.set(word, list)
    return
  }
  list.push(docId)
}

export function removePosting(postings: PostingsMap, word: string, docId: InternalDocumentID): boolean {
  const list = postings.get(word)
  if (!list) {
    return false
  }
  const index = list.indexOf(docId)
  if (index === -1) {
    return false
  }
  list.splice(index, 1)
  if (list.length === 0) {
    postings.delete(word)
  }
  return true
}

export function clearPostings(postings: PostingsMap, word: string): void {
  postings.delete(word)
}

export function getDocumentFrequency(postings: PostingsMap, word: string): number {
  return postings.get(word)?.length ?? 0
}

/** Delta-encode sorted doc IDs for compact storage. */
export function encodePostings(ids: InternalDocumentID[]): number[] {
  if (ids.length === 0) {
    return []
  }
  const sorted = [...ids].sort((a, b) => a - b)
  const out: number[] = [sorted[0]!]
  for (let i = 1; i < sorted.length; i++) {
    out.push(sorted[i]! - sorted[i - 1]!)
  }
  return out
}

export function decodePostings(encoded: number[]): InternalDocumentID[] {
  if (encoded.length === 0) {
    return []
  }
  const out: InternalDocumentID[] = [encoded[0]!]
  for (let i = 1; i < encoded.length; i++) {
    out.push(out[i - 1]! + encoded[i]!)
  }
  return out
}

export type SerializedPostings = Record<string, number[]>

export function serializePostingsMap(postings: PostingsMap): SerializedPostings {
  const out: SerializedPostings = {}
  for (const [word, ids] of postings) {
    if (ids.length > 0) {
      out[word] = encodePostings(ids)
    }
  }
  return out
}

export function deserializePostingsMap(data: SerializedPostings | undefined): PostingsMap {
  const postings = createPostingsMap()
  if (!data) {
    return postings
  }
  for (const word of Object.keys(data)) {
    const ids = decodePostings(data[word]!)
    if (ids.length > 0) {
      postings.set(word, ids)
    }
  }
  return postings
}

/** Collect doc IDs stored on legacy radix nodes (`d` arrays). */
export function collectLegacyNodePostings(
  nodeJson: { w?: string; e?: boolean; d?: InternalDocumentID[]; c?: [string, unknown][] },
  postings: PostingsMap
): void {
  if (nodeJson.e && nodeJson.w !== undefined) {
    const ids = nodeJson.d ?? []
    if (ids.length > 0) {
      postings.set(nodeJson.w, [...ids])
    }
  }
  const children = nodeJson.c ?? []
  for (let i = 0; i < children.length; i++) {
    collectLegacyNodePostings(children[i]![1] as typeof nodeJson, postings)
  }
}
