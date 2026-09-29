import { ByteReader, ByteWriter } from './varint.js'

export interface TermPostingEntry {
  docId: number
  /** Raw in-document occurrence count, exactly as the engine's frequency map stores it. */
  tf: number
  /** Exact token count of the field, so BM25 scores match the monolithic index bit for bit. */
  fieldLen: number
}

export interface PropPostings {
  /** Position of the property in the manifest's `props` array. */
  prop: number
  entries: TermPostingEntry[]
}

export interface TermPostings {
  term: string
  byProp: PropPostings[]
}

function writeTerm(writer: ByteWriter, term: TermPostings): void {
  writer.writeString(term.term)
  writer.writeVarint(term.byProp.length)

  for (const { prop, entries } of term.byProp) {
    writer.writeVarint(prop)
    writer.writeVarint(entries.length)

    let previousDocId = 0
    for (const { docId, tf, fieldLen } of entries) {
      writer.writeVarint(docId - previousDocId)
      writer.writeVarint(tf)
      writer.writeVarint(fieldLen)
      previousDocId = docId
    }
  }
}

export function encodeShard(terms: TermPostings[]): Uint8Array {
  const writer = new ByteWriter()
  writer.writeVarint(terms.length)

  for (const term of terms) {
    writeTerm(writer, term)
  }

  return writer.toUint8Array()
}

export function decodeShard(bytes: Uint8Array): TermPostings[] {
  const reader = new ByteReader(bytes)
  const termCount = reader.readVarint()
  const terms: TermPostings[] = new Array(termCount)

  for (let i = 0; i < termCount; i++) {
    const term = reader.readString()
    const propCount = reader.readVarint()
    const byProp: PropPostings[] = new Array(propCount)

    for (let j = 0; j < propCount; j++) {
      const prop = reader.readVarint()
      const entryCount = reader.readVarint()
      const entries: TermPostingEntry[] = new Array(entryCount)

      let docId = 0
      for (let k = 0; k < entryCount; k++) {
        docId += reader.readVarint()
        const tf = reader.readVarint()
        const fieldLen = reader.readVarint()
        entries[k] = { docId, tf, fieldLen }
      }

      byProp[j] = { prop, entries }
    }

    terms[i] = { term, byProp }
  }

  return terms
}

/** Encoded size of a single term entry, used by the shard planner. */
export function encodedTermSize(term: TermPostings): number {
  const writer = new ByteWriter()
  writeTerm(writer, term)
  return writer.length
}
