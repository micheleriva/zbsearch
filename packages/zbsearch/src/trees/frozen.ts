// Frozen segments: an immutable, columnar layout of the postings of one string property (issue #87).
//
// A segment holds, for a set of documents, every term of the property and, for each term, the documents that contain
// it and how many times. Instead of a radix tree node, a JS array and a per-document `{ term: frequency }` object per
// posting, it keeps:
//
// - `terms`: the terms, sorted (by UTF-16 code units, as `<` compares strings), so that a prefix is a contiguous range
//   and an exact term a binary search;
// - `df`: the number of postings of each term;
// - `offsets` / `data`: the postings of term `t` are the bytes `data[offsets[t]..offsets[t + 1])`, encoded as
//
//     flags byte
//     block directory   per block of up to FROZEN_BLOCK_SIZE postings: last document id (as a delta from the
//                       previous block's), byte length of the block, highest term frequency, shortest field length
//     blocks            per block: the document ids as varint deltas (zig-zag deltas when the term is flagged
//                       F_UNSORTED), then the term frequencies as varints (float64 when flagged F_FLOAT_TFS)
//
//   The postings keep the order they had in the mutable index they were frozen from: ascending document ids, except
//   for documents that were updated (re-inserted with the same id) before freezing, which come last.
// - `docs`: a bitset of the documents of the segment, and `tombstones`, the bitset of those removed since.
//
// Documents removed after freezing are only marked in `tombstones` (their postings stay until the segment is merged
// into a new one); everything that reads postings skips them.

import { InternalDocumentID } from '../components/internal-document-id-store.js'

export const FROZEN_BLOCK_SIZE = 128

/** The postings of the term are not in ascending document id order: the ids are zig-zag deltas. */
export const F_UNSORTED = 1
/** The term frequencies are not all integers in [0, 2^32): they are stored as float64. */
export const F_FLOAT_TFS = 2
/** Some field lengths are not finite non-negative numbers: the block bounds cannot be trusted. */
export const F_NO_BOUNDS = 4

export interface FrozenSegment {
  /** The terms of the segment, sorted. */
  terms: string[]
  /** Number of postings of each term (including the tombstoned ones). */
  df: Uint32Array
  /** Byte offset of the postings of each term in `data`, plus the end of the last one. */
  offsets: Uint32Array
  /** The encoded postings of every term. */
  data: Uint8Array
  /** Bitset of the documents of the segment. */
  docs: Uint32Array
  /** Number of documents of the segment (including the tombstoned ones). */
  docCount: number
  /** Bitset of the documents removed since the segment was built, allocated on the first removal. */
  tombstones: Uint32Array | undefined
  /** Number of documents in `tombstones`. */
  deleted: number
  /** Number of tombstoned postings per term, computed on demand while `deleted` has not changed. */
  deadCounts?: Map<number, number>
  deadCountsDeleted?: number
}

export type SerializedFrozenSegment = {
  terms: string[]
  df: string
  offsets: string
  data: string
  docs: string
  docCount: number
  tombstones: string | null
  deleted: number
}

// ---------------------------------------------------------------------------------------------------------------
// Bitsets
// ---------------------------------------------------------------------------------------------------------------

export function hasBit(bits: Uint32Array | undefined, id: number): boolean {
  if (!bits) {
    return false
  }
  const word = id >>> 5
  return word < bits.length && (bits[word] & (1 << (id & 31))) !== 0
}

function setBit(bits: Uint32Array, id: number): void {
  bits[id >>> 5] |= 1 << (id & 31)
}

/** Whether the segment holds a live (not tombstoned) copy of document `id`. */
export function isLiveDocument(segment: FrozenSegment, id: InternalDocumentID): boolean {
  return hasBit(segment.docs, id) && !hasBit(segment.tombstones, id)
}

/** Marks the copy of document `id` in the segment as removed. Returns false if the segment had no live copy. */
export function tombstoneDocument(segment: FrozenSegment, id: InternalDocumentID): boolean {
  if (!isLiveDocument(segment, id)) {
    return false
  }

  segment.tombstones ??= new Uint32Array(segment.docs.length)
  setBit(segment.tombstones, id)
  segment.deleted++
  return true
}

/** Calls `fn` with the id of every live document of the segment, in ascending order. */
export function forEachLiveDocument(segment: FrozenSegment, fn: (id: InternalDocumentID) => void): void {
  const { docs, tombstones } = segment
  for (let word = 0; word < docs.length; word++) {
    let bits = docs[word]
    if (tombstones) {
      bits &= ~tombstones[word]
    }
    while (bits !== 0) {
      const bit = 31 - Math.clz32(bits & -bits)
      fn(word * 32 + bit)
      bits &= bits - 1
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------------------------------------------

class Bytes {
  buf: Uint8Array
  pos = 0

  constructor(capacity = 1024) {
    this.buf = new Uint8Array(capacity)
  }

  ensure(n: number): void {
    const needed = this.pos + n
    if (needed <= this.buf.length) {
      return
    }
    let capacity = this.buf.length * 2
    while (capacity < needed) {
      capacity *= 2
    }
    const next = new Uint8Array(capacity)
    next.set(this.buf.subarray(0, this.pos))
    this.buf = next
  }

  // Unsigned varint of an integer in [0, 2^53)
  uvar(value: number): void {
    this.ensure(8)
    const buf = this.buf
    let pos = this.pos
    if (value < 0x80000000) {
      while (value > 127) {
        buf[pos++] = (value & 127) | 128
        value >>>= 7
      }
    } else {
      while (value > 127) {
        buf[pos++] = (value % 128) | 128
        value = Math.floor(value / 128)
      }
    }
    buf[pos++] = value
    this.pos = pos
  }

  f64(value: number): void {
    this.ensure(8)
    f64Scratch[0] = value
    this.buf.set(f64Bytes, this.pos)
    this.pos += 8
  }

  raw(bytes: Uint8Array): void {
    this.ensure(bytes.length)
    this.buf.set(bytes, this.pos)
    this.pos += bytes.length
  }
}

const f64Scratch = new Float64Array(1)
const f64Bytes = new Uint8Array(f64Scratch.buffer)

function zigzag(value: number): number {
  return value >= 0 ? value * 2 : -value * 2 - 1
}

function unzigzag(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2
}

function isIntegerTf(tf: number): boolean {
  return tf >= 0 && tf < 0x100000000 && Math.floor(tf) === tf
}

/** Builds a segment from terms added in sorted order. */
export class FrozenSegmentBuilder {
  private readonly terms: string[] = []
  private df: number[] = []
  private offsets: number[] = []
  private readonly out = new Bytes(64 * 1024)
  private readonly block = new Bytes(4096)
  private readonly docIds: number[] = []
  private maxId = 0

  constructor(private readonly fieldLengths: Record<number, number | undefined>) {}

  /** Adds `term` with the `count` postings `ids[0..count)` and their term frequencies. */
  addTerm(term: string, ids: ArrayLike<number>, tfs: ArrayLike<number>, count: number): void {
    if (count === 0) {
      return
    }

    let flags = 0
    let previous = -1
    for (let i = 0; i < count; i++) {
      const id = ids[i]
      if (id <= previous) {
        flags |= F_UNSORTED
      }
      previous = id
      if (id > this.maxId) {
        this.maxId = id
      }
      if (!isIntegerTf(tfs[i])) {
        flags |= F_FLOAT_TFS
      }
      const length = this.fieldLengths[id]
      if (typeof length !== 'number' || !(length >= 0) || length === Infinity) {
        flags |= F_NO_BOUNDS
      }
    }

    const out = this.out
    this.terms.push(term)
    this.df.push(count)
    this.offsets.push(out.pos)
    out.ensure(1)
    out.buf[out.pos++] = flags

    const unsorted = (flags & F_UNSORTED) !== 0
    const floatTfs = (flags & F_FLOAT_TFS) !== 0
    const noBounds = (flags & F_NO_BOUNDS) !== 0
    const block = this.block
    block.pos = 0

    // Directory first (it needs the byte length of each block), then the blocks
    const blocks = Math.ceil(count / FROZEN_BLOCK_SIZE)
    const blockEnds: number[] = new Array(blocks)
    let previousId = 0
    let previousLast = 0
    for (let b = 0; b < blocks; b++) {
      const start = b * FROZEN_BLOCK_SIZE
      const end = Math.min(count, start + FROZEN_BLOCK_SIZE)
      let maxTf = 0
      let minLength = 0xffffffff
      for (let i = start; i < end; i++) {
        const id = ids[i]
        block.uvar(unsorted ? zigzag(id - previousId) : id - previousId)
        previousId = id
        if (!floatTfs && tfs[i] > maxTf) {
          maxTf = tfs[i]
        }
        if (!noBounds) {
          const length = this.fieldLengths[id] as number
          if (length < minLength) {
            minLength = Math.floor(length)
          }
        }
      }
      for (let i = start; i < end; i++) {
        if (floatTfs) {
          block.f64(tfs[i])
        } else {
          block.uvar(tfs[i])
        }
      }
      blockEnds[b] = block.pos

      const last = ids[end - 1]
      out.uvar(unsorted ? 0 : last - previousLast)
      previousLast = last
      out.uvar(block.pos - (b === 0 ? 0 : blockEnds[b - 1]))
      out.uvar(maxTf)
      out.uvar(noBounds ? 0 : Math.min(minLength, 0xffffffff))
    }
    out.raw(block.buf.subarray(0, block.pos))
  }

  /** Adds a document of the segment (one that has the property, whether or not it has any term). */
  addDocument(id: InternalDocumentID): void {
    this.docIds.push(id)
    if (id > this.maxId) {
      this.maxId = id
    }
  }

  finish(): FrozenSegment {
    const docs = new Uint32Array((this.maxId >>> 5) + 1)
    let docCount = 0
    for (const id of this.docIds) {
      if (!hasBit(docs, id)) {
        setBit(docs, id)
        docCount++
      }
    }

    const offsets = new Uint32Array(this.terms.length + 1)
    for (let i = 0; i < this.offsets.length; i++) {
      offsets[i] = this.offsets[i]
    }
    offsets[this.terms.length] = this.out.pos

    const segment: FrozenSegment = {
      terms: this.terms,
      df: Uint32Array.from(this.df),
      offsets,
      data: this.out.buf.slice(0, this.out.pos),
      docs,
      docCount,
      tombstones: undefined,
      deleted: 0
    }
    this.df = []
    this.offsets = []
    return segment
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------------------------------

/** Number of blocks of a term with `df` postings. */
export function blockCount(df: number): number {
  return Math.ceil(df / FROZEN_BLOCK_SIZE)
}

/**
 * Decodes the postings of term `ordinal` into `ids` / `tfs` from position `at`, skipping the tombstoned documents
 * unless `includeDead`. Returns the number of postings written.
 */
export function decodePostings(
  segment: FrozenSegment,
  ordinal: number,
  ids: Uint32Array | number[],
  tfs: Float64Array | undefined,
  at = 0,
  includeDead = false
): number {
  const data = segment.data
  const df = segment.df[ordinal]
  let pos = segment.offsets[ordinal]
  const flags = data[pos++]
  const unsorted = (flags & F_UNSORTED) !== 0
  const floatTfs = (flags & F_FLOAT_TFS) !== 0
  const tombstones = includeDead ? undefined : segment.tombstones
  const blocks = blockCount(df)

  // Skip the directory
  for (let i = 0; i < blocks * 4; i++) {
    while (data[pos++] & 128) {
      // continuation byte
    }
  }

  let written = at
  let previousId = 0
  for (let b = 0; b < blocks; b++) {
    const start = b * FROZEN_BLOCK_SIZE
    const n = Math.min(df, start + FROZEN_BLOCK_SIZE) - start
    const first = written
    let keepAll = true

    for (let i = 0; i < n; i++) {
      let value = data[pos++]
      if (value & 128) {
        value &= 127
        let shift = 7
        let byte: number
        do {
          byte = data[pos++]
          value += (byte & 127) * 2 ** shift
          shift += 7
        } while (byte & 128)
      }
      const id = unsorted ? previousId + unzigzag(value) : previousId + value
      previousId = id
      ids[written + i] = id
      if (tombstones && hasBit(tombstones, id)) {
        keepAll = false
      }
    }

    if (tfs) {
      for (let i = 0; i < n; i++) {
        if (floatTfs) {
          for (let j = 0; j < 8; j++) {
            f64Bytes[j] = data[pos++]
          }
          tfs[written + i] = f64Scratch[0]
        } else {
          let value = data[pos++]
          if (value & 128) {
            value &= 127
            let shift = 7
            let byte: number
            do {
              byte = data[pos++]
              value += (byte & 127) * 2 ** shift
              shift += 7
            } while (byte & 128)
          }
          tfs[written + i] = value
        }
      }
    } else {
      // Skip the frequencies
      if (floatTfs) {
        pos += 8 * n
      } else {
        for (let i = 0; i < n; i++) {
          while (data[pos++] & 128) {
            // continuation byte
          }
        }
      }
    }

    if (keepAll) {
      written += n
    } else {
      // Compact the block, dropping the tombstoned documents
      let kept = first
      for (let i = first; i < first + n; i++) {
        const id = ids[i]
        if (!hasBit(tombstones, id)) {
          ids[kept] = id
          if (tfs) {
            tfs[kept] = tfs[i]
          }
          kept++
        }
      }
      written = kept
    }
  }

  return written - at
}

/** The number of live postings of term `ordinal`. */
export function liveDocumentFrequency(segment: FrozenSegment, ordinal: number): number {
  const df = segment.df[ordinal]
  if (!segment.deleted) {
    return df
  }

  if (segment.deadCountsDeleted !== segment.deleted || !segment.deadCounts) {
    segment.deadCounts = new Map()
    segment.deadCountsDeleted = segment.deleted
  }

  let dead = segment.deadCounts.get(ordinal)
  if (dead === undefined) {
    const ids = decodeScratch(df)
    decodePostings(segment, ordinal, ids, undefined, 0, true)
    dead = 0
    for (let i = 0; i < df; i++) {
      if (hasBit(segment.tombstones, ids[i])) {
        dead++
      }
    }
    segment.deadCounts.set(ordinal, dead)
  }

  return df - dead
}

let scratchIds = new Uint32Array(1024)

function decodeScratch(size: number): Uint32Array {
  if (scratchIds.length < size) {
    scratchIds = new Uint32Array(Math.max(size, scratchIds.length * 2))
  }
  return scratchIds
}

/** Live postings of term `ordinal`, as new arrays. */
export function getPostings(segment: FrozenSegment, ordinal: number): { ids: Uint32Array; tfs: Float64Array } {
  const df = segment.df[ordinal]
  const ids = new Uint32Array(df)
  const tfs = new Float64Array(df)
  const n = decodePostings(segment, ordinal, ids, tfs)
  return n === df ? { ids, tfs } : { ids: ids.subarray(0, n), tfs: tfs.subarray(0, n) }
}

// ---------------------------------------------------------------------------------------------------------------
// Term dictionary
// ---------------------------------------------------------------------------------------------------------------

/** Index of the first term >= `term`. */
function lowerBound(terms: string[], term: string, from = 0): number {
  let low = from
  let high = terms.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (terms[mid] < term) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

/** Index of the first term from `from` on that is greater than every term starting with `prefix`. */
function prefixEnd(terms: string[], prefix: string, from: number): number {
  let low = from
  let high = terms.length
  while (low < high) {
    const mid = (low + high) >>> 1
    const t = terms[mid]
    if (t < prefix || t.startsWith(prefix)) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

/** Ordinal of `term`, or -1. */
export function termOrdinal(segment: FrozenSegment, term: string): number {
  const i = lowerBound(segment.terms, term)
  return i < segment.terms.length && segment.terms[i] === term ? i : -1
}

let levenshteinRows = new Int32Array(1024)

/**
 * Ordinals of the terms that the radix tree's `find({ term, exact, tolerance })` returns for the same set of words:
 * `term` itself when `exact`; the words within `tolerance` edits of `term`, plus every word that starts with `term`,
 * when `tolerance` is set; every word that starts with `term` otherwise.
 */
export function findOrdinals(segment: FrozenSegment, term: string, exact: boolean, tolerance: number): number[] {
  const terms = segment.terms
  const out: number[] = []

  if (tolerance && !exact) {
    findWithinTolerance(terms, term, tolerance, out)
    return out
  }

  if (exact) {
    const ordinal = termOrdinal(segment, term)
    if (ordinal !== -1) {
      out.push(ordinal)
    }
    return out
  }

  const start = lowerBound(terms, term)
  const end = prefixEnd(terms, term, start)
  for (let i = start; i < end; i++) {
    out.push(i)
  }
  return out
}

// A depth-first walk of the (implicit) trie of the sorted terms, keeping one Levenshtein row per depth: consecutive
// terms share the rows of their common prefix, and a prefix whose row has no cell within the tolerance skips every
// term that starts with it. A prefix equal to `term` takes every term that starts with it, as the radix tree does.
function findWithinTolerance(terms: string[], term: string, tolerance: number, out: number[]): void {
  const termLength = term.length
  const n = terms.length

  if (!termLength) {
    for (let i = 0; i < n; i++) {
      out.push(i)
    }
    return
  }

  const width = termLength + 1
  let rows = levenshteinRows
  for (let i = 0; i <= termLength; i++) {
    rows[i] = i
  }

  let previous = ''
  // Rows are valid for the prefixes of `previous` up to this length
  let valid = 0
  let i = 0

  while (i < n) {
    const word = terms[i]
    const wordLength = word.length
    let common = 0
    const limit = Math.min(valid, wordLength, previous.length)
    while (common < limit && word.charCodeAt(common) === previous.charCodeAt(common)) {
      common++
    }

    if ((wordLength + 1) * width > rows.length) {
      const grown = new Int32Array(Math.max(rows.length * 2, (wordLength + 1) * width))
      grown.set(rows)
      rows = levenshteinRows = grown
    }

    let skipTo = -1
    let depth = common
    for (; depth < wordLength; depth++) {
      const code = word.charCodeAt(depth)
      const above = depth * width
      const current = above + width
      let diagonal = rows[above]
      let left = diagonal + 1
      rows[current] = left
      let rowMin = left

      for (let j = 1; j <= termLength; j++) {
        const up = rows[above + j]
        let value: number
        if (term.charCodeAt(j - 1) === code) {
          value = diagonal
        } else {
          value = up < diagonal ? up : diagonal
          if (left < value) {
            value = left
          }
          value++
        }
        rows[current + j] = value
        left = value
        diagonal = up
        if (value < rowMin) {
          rowMin = value
        }
      }

      if (!left) {
        // The prefix of length depth + 1 is `term`: take every word that starts with it
        const prefix = word.slice(0, depth + 1)
        const end = prefixEnd(terms, prefix, i)
        for (let k = i; k < end; k++) {
          out.push(k)
        }
        skipTo = end
        break
      }

      if (rowMin > tolerance) {
        // No word that starts with this prefix can be within the tolerance
        skipTo = prefixEnd(terms, word.slice(0, depth + 1), i)
        break
      }
    }

    previous = word
    if (skipTo !== -1) {
      valid = depth
      i = skipTo
      continue
    }

    valid = wordLength
    if (rows[wordLength * width + termLength] <= tolerance) {
      out.push(i)
    }
    i++
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------------------------------------------

/** The mutable part of a property, merged after the segments. */
export interface MutablePostings {
  /** Term -> document ids, in posting order. */
  postings: Map<string, ArrayLike<number>>
  /** Term frequency of `term` in document `id`. */
  tf(id: InternalDocumentID, term: string): number
  /** Documents that have the property. */
  documents: Iterable<InternalDocumentID>
}

/**
 * Builds one segment with the live postings of `segments` (in order) followed by those of `mutable`. Documents
 * keep the posting order they had: a document that is both tombstoned in a segment and present later (it was
 * updated) moves to its later position, as it would in the mutable index.
 */
export function mergeSegments(
  segments: FrozenSegment[],
  mutable: MutablePostings | undefined,
  fieldLengths: Record<number, number | undefined>
): FrozenSegment {
  const builder = new FrozenSegmentBuilder(fieldLengths)
  const mutableTerms = mutable ? Array.from(mutable.postings.keys()).sort() : []
  const cursors = new Int32Array(segments.length)

  let ids = new Uint32Array(1024)
  let tfs = new Float64Array(1024)
  let m = 0

  for (;;) {
    // The smallest term among the cursors
    let term: string | undefined
    for (let s = 0; s < segments.length; s++) {
      const t = segments[s].terms[cursors[s]]
      if (t !== undefined && (term === undefined || t < term)) {
        term = t
      }
    }
    if (m < mutableTerms.length && (term === undefined || mutableTerms[m] < term)) {
      term = mutableTerms[m]
    }
    if (term === undefined) {
      break
    }

    let size = 0
    for (let s = 0; s < segments.length; s++) {
      const segment = segments[s]
      if (segment.terms[cursors[s]] === term) {
        size += segment.df[cursors[s]]
      }
    }
    const mutableIds = m < mutableTerms.length && mutableTerms[m] === term ? mutable!.postings.get(term)! : undefined
    size += mutableIds ? mutableIds.length : 0

    if (ids.length < size) {
      ids = new Uint32Array(size * 2)
      tfs = new Float64Array(size * 2)
    }

    let count = 0
    for (let s = 0; s < segments.length; s++) {
      const segment = segments[s]
      if (segment.terms[cursors[s]] === term) {
        count += decodePostings(segment, cursors[s], ids, tfs, count)
        cursors[s]++
      }
    }
    if (mutableIds) {
      for (let i = 0; i < mutableIds.length; i++) {
        ids[count] = mutableIds[i]
        tfs[count] = mutable!.tf(mutableIds[i], term)
        count++
      }
      m++
    }

    builder.addTerm(term, ids, tfs, count)
  }

  for (const segment of segments) {
    forEachLiveDocument(segment, (id) => builder.addDocument(id))
  }
  if (mutable) {
    for (const id of mutable.documents) {
      builder.addDocument(id)
    }
  }

  return builder.finish()
}

// ---------------------------------------------------------------------------------------------------------------
// Serialization (JSON snapshots)
// ---------------------------------------------------------------------------------------------------------------

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
let base64Codes: Int16Array | undefined

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  const CHUNK = 3 * 4096
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(bytes.length, start + CHUNK)
    let s = ''
    let i = start
    for (; i + 2 < end; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
      s += BASE64[n >>> 18] + BASE64[(n >>> 12) & 63] + BASE64[(n >>> 6) & 63] + BASE64[n & 63]
    }
    if (i < end) {
      const n = (bytes[i] << 16) | (i + 1 < end ? bytes[i + 1] << 8 : 0)
      s += BASE64[n >>> 18] + BASE64[(n >>> 12) & 63] + (i + 1 < end ? BASE64[(n >>> 6) & 63] : '=') + '='
    }
    parts.push(s)
  }
  return parts.join('')
}

export function base64ToBytes(text: string): Uint8Array {
  if (!base64Codes) {
    base64Codes = new Int16Array(128).fill(-1)
    for (let i = 0; i < BASE64.length; i++) {
      base64Codes[BASE64.charCodeAt(i)] = i
    }
  }
  const codes = base64Codes
  let length = text.length
  while (length > 0 && text.charCodeAt(length - 1) === 61) {
    length--
  }
  const out = new Uint8Array(Math.floor((length * 3) / 4))
  let pos = 0
  let buffer = 0
  let bits = 0
  for (let i = 0; i < length; i++) {
    const code = text.charCodeAt(i)
    const value = code < 128 ? codes[code] : -1
    if (value < 0) {
      throw new Error('Invalid base64 in a frozen segment')
    }
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[pos++] = (buffer >>> bits) & 0xff
    }
  }
  return out
}

function uint32ToBase64(array: Uint32Array): string {
  const bytes = new Uint8Array(array.length * 4)
  for (let i = 0; i < array.length; i++) {
    const v = array[i]
    bytes[i * 4] = v & 0xff
    bytes[i * 4 + 1] = (v >>> 8) & 0xff
    bytes[i * 4 + 2] = (v >>> 16) & 0xff
    bytes[i * 4 + 3] = v >>> 24
  }
  return bytesToBase64(bytes)
}

function base64ToUint32(text: string): Uint32Array {
  const bytes = base64ToBytes(text)
  const array = new Uint32Array(bytes.length >>> 2)
  for (let i = 0; i < array.length; i++) {
    array[i] = (bytes[i * 4] | (bytes[i * 4 + 1] << 8) | (bytes[i * 4 + 2] << 16) | (bytes[i * 4 + 3] << 24)) >>> 0
  }
  return array
}

export function serializeFrozenSegment(segment: FrozenSegment): SerializedFrozenSegment {
  return {
    terms: segment.terms,
    df: uint32ToBase64(segment.df),
    offsets: uint32ToBase64(segment.offsets),
    data: bytesToBase64(segment.data),
    docs: uint32ToBase64(segment.docs),
    docCount: segment.docCount,
    tombstones: segment.tombstones ? uint32ToBase64(segment.tombstones) : null,
    deleted: segment.deleted
  }
}

export function deserializeFrozenSegment(raw: SerializedFrozenSegment): FrozenSegment {
  return validateFrozenSegment({
    terms: raw.terms,
    df: base64ToUint32(raw.df),
    offsets: base64ToUint32(raw.offsets),
    data: base64ToBytes(raw.data),
    docs: base64ToUint32(raw.docs),
    docCount: raw.docCount,
    tombstones: raw.tombstones ? base64ToUint32(raw.tombstones) : undefined,
    deleted: raw.deleted
  })
}

/** Checks the consistency of the arrays of a segment read from a snapshot. */
export function validateFrozenSegment(segment: FrozenSegment): FrozenSegment {
  const { terms, df, offsets, data, docs, tombstones } = segment
  const valid =
    Array.isArray(terms) &&
    df.length === terms.length &&
    offsets.length === terms.length + 1 &&
    offsets[terms.length] === data.length &&
    (!tombstones || tombstones.length === docs.length) &&
    Number.isSafeInteger(segment.docCount) &&
    Number.isSafeInteger(segment.deleted)

  if (!valid) {
    throw new Error('Invalid frozen segment')
  }

  for (let i = 0; i < terms.length; i++) {
    if (typeof terms[i] !== 'string' || offsets[i] > offsets[i + 1] || (i > 0 && !(terms[i - 1] < terms[i]))) {
      throw new Error('Invalid frozen segment')
    }
  }

  return segment
}
