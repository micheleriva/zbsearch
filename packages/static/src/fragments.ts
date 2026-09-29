import { decodeJSON, encodeJSON } from './varint.js'

export type FragmentDocs = Record<number, unknown>

export const DEFAULT_FRAGMENT_GROUP_SIZE = 16

export function fragmentIndexFor(internalId: number, groupSize: number): number {
  return Math.floor((internalId - 1) / groupSize)
}

export function encodeFragment(docs: FragmentDocs): Uint8Array {
  return encodeJSON({ docs })
}

export function decodeFragment(bytes: Uint8Array): FragmentDocs {
  return decodeJSON<{ docs: FragmentDocs }>(bytes).docs
}
