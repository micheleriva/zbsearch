import type { RawData } from 'zbsearch'
import { radix, postings } from 'zbsearch/trees'

export type SerializedPostings = Record<string, number[]>

/** The slice of ZBSearch's serialized index the static format reads and writes. */
export interface RawStringIndex {
  indexes: Record<string, { type: string; node: radix.RadixNodeJSON; isArray: boolean }>
  frequencies: Record<string, Record<number, Record<string, number> | undefined>>
  avgFieldLength: Record<string, number>
  fieldLengths: Record<string, Record<number, number | undefined>>
}

export interface RawParts {
  index: RawStringIndex
  docs: Record<number, Record<string, unknown>>
  internalIdToId: string[]
}

export function rawParts(raw: RawData): RawParts {
  return {
    index: raw.index as RawStringIndex,
    docs: (raw.docs as { docs: Record<number, Record<string, unknown>> }).docs,
    internalIdToId: (raw.internalDocumentIDStore as { internalIdToId: string[] }).internalIdToId
  }
}

export function decodeRawPostings(encoded: number[]): number[] {
  return postings.decodePostings(encoded)
}
