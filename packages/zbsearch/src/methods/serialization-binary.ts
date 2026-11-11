// Binary, streaming snapshot format.
//
// Layout of a snapshot (all integers little-endian):
//
//   file header (16 bytes)  "ZBSB" | u16 format version | u16 reserved | u32 segment size | u32 CRC32 of bytes 0-11
//   segment*                u32 payload length | u32 sequence number | u32 CRC32 (of bytes 0-7 + payload) | payload
//
// The payloads, concatenated, form a stream of records. Each record is a varint byte length followed by a tag
// byte and its body; a record may span segments, so every segment except the last has exactly `segmentSize`
// payload bytes. Records are processed in order, and the whole stream shares one dictionary of object keys.
//
//   META, then the sections internal ids, index, documents, sorting, pinning, then END (record count).
//
// Built-in components get dedicated encodings (delta + varint postings and term frequencies, raw typed arrays
// for vectors, sort values that refer back to the stored documents). Custom components are written through
// their `save()` output with a generic tagged encoding that splits large objects and arrays into records.

import type { AnyZBSearch, SnapshotTypedArray, SortType, StoreSettings, VectorBinarySnapshot } from '../types.js'
import { resolveStoreConfig } from '../components/store.js'
import { createError } from '../errors.js'
import { getNested, yieldToEventLoop } from '../utils.js'
import {
  deserializeIndexEntry,
  load as builtinIndexLoad,
  save as builtinIndexSave,
  type Index,
  type UnstoredTerms
} from '../components/index.js'
import {
  ensureIsSorted,
  ensureOrderedDocsAreDeleted,
  load as builtinSorterLoad,
  save as builtinSorterSave,
  type Sorter
} from '../components/sorter.js'
import { save as builtinDocumentsSave } from '../components/documents-store.js'
import type { InternalDocumentID } from '../components/internal-document-id-store.js'
import { RadixNode, RadixTree } from '../trees/radix.js'
import { deserializeVectorIndex, deserializeVectorIndexBinary } from '../trees/vector-index.js'
import {
  ByteReader,
  ByteWriter,
  crc32,
  createTypedArray,
  decodeValue,
  encodeValue,
  estimateJsonLength,
  fillTypedArray,
  invalid,
  isIndexKey,
  isPlainContainer,
  KeyDictionary,
  readKey,
  setProperty,
  typedArrayBytes,
  typedArrayCode,
  writeKey
} from './binary-codec.js'

export const BINARY_SNAPSHOT_VERSION = 1
export const DEFAULT_SEGMENT_SIZE = 1024 * 1024

const MIN_SEGMENT_SIZE = 1024
const MAX_SEGMENT_SIZE = 256 * 1024 * 1024
const MAGIC = [0x5a, 0x42, 0x53, 0x42] // "ZBSB"
const FILE_HEADER_SIZE = 16
const SEGMENT_HEADER_SIZE = 12
const MAX_BATCH_BYTES = 64 * 1024
const YIELD_INTERVAL_MS = 10

// Record tags
const R_META = 1
const R_END = 2
const G_VALUE = 10
const G_ARRAY = 11
const G_OBJECT = 12
const G_ITEMS = 13
const G_ENTRIES = 14
const G_KEY = 15
const G_CLOSE = 16
const I_META = 20
const I_RADIX = 21
const I_RADIX_EXTRA = 22
const I_RADIX_END = 23
const I_FREQUENCIES = 24
const I_FIELD_LENGTHS = 25
const I_MAP_END = 26
const I_VECTOR = 27
const I_VECTOR_CHUNK = 28
const I_VECTOR_JSON = 29
const I_UNSTORED_VALUES = 30
const I_UNSTORED_TERMS = 31
const S_META = 40
const S_ORDERED = 41
const S_DOCS = 42
const S_END = 43

export interface SaveBinaryOptions {
  /**
   * Payload bytes per segment (default 1 MiB, at least 1 KiB). Every yielded segment but the last has exactly
   * this payload size, plus a 12-byte header (the first one is also prefixed by the 16-byte file header).
   */
  segmentSize?: number
}

export interface LoadBinaryOptions {
  /** Verify the CRC32 of every segment (default `true`). */
  verifyChecksums?: boolean
}

export type BinarySnapshotChunk = Uint8Array | ArrayBuffer | ArrayBufferView

export type BinarySnapshotSource =
  | AsyncIterable<BinarySnapshotChunk>
  | Iterable<BinarySnapshotChunk>
  | Uint8Array
  | ArrayBuffer
  | ReadableStream<BinarySnapshotChunk>

type RecordReader<T> = Generator<void, T, Uint8Array>
type SegmentWriter = Generator<Uint8Array, void, undefined>

interface SnapshotMeta {
  language: string
  index: 'builtin' | 'custom'
  sorter: 'builtin' | 'custom'
  docRefs: boolean
  // The store configuration (see StoreConfig), absent when the database had none.
  store?: StoreSettings
}

// ---------------------------------------------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------------------------------------------

class SnapshotWriter {
  readonly dict = new KeyDictionary()
  readonly batchBytes: number
  records = 0

  private readonly rec = new ByteWriter(16 * 1024)
  private readonly prefix = new ByteWriter(16)
  private readonly ready: Uint8Array[] = []
  private segment: Uint8Array
  private segmentPos = SEGMENT_HEADER_SIZE
  private sequence = 0

  constructor(readonly segmentSize: number) {
    this.batchBytes = Math.min(MAX_BATCH_BYTES, segmentSize)
    this.segment = new Uint8Array(SEGMENT_HEADER_SIZE + segmentSize)
  }

  /** Values estimated larger than this are split into several records. */
  get bigLimit(): number {
    return this.segmentSize
  }

  begin(tag: number): ByteWriter {
    this.rec.reset()
    this.rec.u8(tag)
    return this.rec
  }

  *commit(extra?: Uint8Array): SegmentWriter {
    const body = this.rec.bytes()
    this.prefix.reset()
    this.prefix.uvar(body.length + (extra ? extra.length : 0))
    this.push(this.prefix.bytes())
    this.push(body)
    if (extra) {
      this.push(extra)
    }
    this.records++
    this.rec.shrink(4 * MAX_BATCH_BYTES, 16 * 1024)
    yield* this.drain()
  }

  *finish(): SegmentWriter {
    this.flush()
    yield* this.drain()
  }

  private *drain(): SegmentWriter {
    while (this.ready.length > 0) {
      yield this.ready.shift()!
    }
  }

  private push(bytes: Uint8Array): void {
    let offset = 0
    while (offset < bytes.length) {
      const room = this.segment.length - this.segmentPos
      const n = Math.min(room, bytes.length - offset)
      this.segment.set(bytes.subarray(offset, offset + n), this.segmentPos)
      this.segmentPos += n
      offset += n
      if (this.segmentPos === this.segment.length) {
        this.flush()
      }
    }
  }

  private flush(): void {
    const payloadLength = this.segmentPos - SEGMENT_HEADER_SIZE
    if (payloadLength === 0) {
      return
    }

    const full = this.segmentPos === this.segment.length
    const segment = full ? this.segment : this.segment.slice(0, this.segmentPos)
    const view = new DataView(segment.buffer, segment.byteOffset, SEGMENT_HEADER_SIZE)
    view.setUint32(0, payloadLength, true)
    view.setUint32(4, this.sequence, true)
    view.setUint32(8, crc32(segment.subarray(SEGMENT_HEADER_SIZE), crc32(segment.subarray(0, 8))), true)

    this.ready.push(segment)
    this.sequence++
    if (full) {
      this.segment = new Uint8Array(SEGMENT_HEADER_SIZE + this.segmentSize)
    }
    this.segmentPos = SEGMENT_HEADER_SIZE
  }
}

function fileHeader(segmentSize: number): Uint8Array {
  const header = new Uint8Array(FILE_HEADER_SIZE)
  header.set(MAGIC)
  const view = new DataView(header.buffer)
  view.setUint16(4, BINARY_SNAPSHOT_VERSION, true)
  view.setUint32(8, segmentSize, true)
  view.setUint32(12, crc32(header.subarray(0, 12)), true)
  return header
}

function isSkipped(value: unknown): boolean {
  const type = typeof value
  return type === 'undefined' || type === 'function' || type === 'symbol'
}

function isBig(w: SnapshotWriter, value: unknown): boolean {
  return isPlainContainer(value) && estimateJsonLength(value, w.bigLimit) > w.bigLimit
}

/** Writes any JSON-like value, splitting large objects and arrays into bounded records. */
function* writeGeneric(w: SnapshotWriter, value: unknown): SegmentWriter {
  if (!isBig(w, value)) {
    encodeValue(w.begin(G_VALUE), w.dict, value)
    yield* w.commit()
    return
  }

  let batch: ByteWriter | undefined

  if (Array.isArray(value)) {
    w.begin(G_ARRAY)
    yield* w.commit()

    for (let i = 0; i < value.length; i++) {
      const item = isSkipped(value[i]) ? null : value[i]
      if (isBig(w, item)) {
        if (batch) {
          batch = undefined
          yield* w.commit()
        }
        yield* writeGeneric(w, item)
        continue
      }

      batch ??= w.begin(G_ITEMS)
      encodeValue(batch, w.dict, item)
      if (batch.pos >= w.batchBytes) {
        batch = undefined
        yield* w.commit()
      }
    }
  } else {
    const object = value as Record<string, unknown>
    w.begin(G_OBJECT)
    yield* w.commit()

    for (const key of Object.keys(object)) {
      const item = object[key]
      if (isSkipped(item)) {
        continue
      }

      if (isBig(w, item)) {
        if (batch) {
          batch = undefined
          yield* w.commit()
        }
        writeKey(w.begin(G_KEY), w.dict, key)
        yield* w.commit()
        yield* writeGeneric(w, item)
        continue
      }

      batch ??= w.begin(G_ENTRIES)
      writeKey(batch, w.dict, key)
      encodeValue(batch, w.dict, item)
      if (batch.pos >= w.batchBytes) {
        batch = undefined
        yield* w.commit()
      }
    }
  }

  if (batch) {
    yield* w.commit()
  }

  w.begin(G_CLOSE)
  yield* w.commit()
}

/** Numbers stored per document: small non-negative integers as varints, anything else tagged. */
function writeNumber(w: ByteWriter, dict: KeyDictionary, value: unknown): void {
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 0 && value <= 0x3fffffff) {
      w.uvar(value * 2)
      return
    }
    w.uvar(1)
    w.f64(value)
    return
  }

  w.uvar(3)
  encodeValue(w, dict, value)
}

function readNumber(r: ByteReader, dict: KeyDictionary): unknown {
  const header = r.uvar()
  if (header % 2 === 0) {
    return header / 2
  }
  if (header === 1) {
    return r.f64()
  }
  if (header === 3) {
    return decodeValue(r, dict)
  }
  throw invalid('unknown number encoding')
}

function zigzag(value: number): number {
  return value >= 0 ? value * 2 : -value * 2 - 1
}

function unzigzag(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2
}

/** Keys of maps indexed by internal document id: delta-coded when they are integers. */
class DocumentKeyCoder {
  private previous = 0

  write(w: ByteWriter, key: string): void {
    if (isIndexKey(key)) {
      const id = +key
      w.uvar(zigzag(id - this.previous) * 2)
      this.previous = id
      return
    }

    w.uvar(1)
    w.str(key)
  }

  read(r: ByteReader): string {
    const header = r.uvar()
    if (header % 2 === 1) {
      return r.str()
    }

    this.previous += unzigzag(header / 2)
    return String(this.previous)
  }
}

function* writeDocumentMap(
  w: SnapshotWriter,
  tag: number,
  map: Record<string, unknown>,
  writeEntry: (rec: ByteWriter, value: unknown) => void
): SegmentWriter {
  const keys = new DocumentKeyCoder()
  let rec = w.begin(tag)

  for (const key in map) {
    const value = map[key]
    if (value === undefined || !Object.hasOwn(map, key)) {
      continue
    }

    keys.write(rec, key)
    writeEntry(rec, value)

    if (rec.pos >= w.batchBytes) {
      yield* w.commit()
      rec = w.begin(tag)
    }
  }

  yield* w.commit()
  w.begin(I_MAP_END)
  yield* w.commit()
}

function writePostings(rec: ByteWriter, dict: KeyDictionary, list: InternalDocumentID[]): void {
  const length = list.length
  const sorted = new Uint32Array(length)

  for (let i = 0; i < length; i++) {
    const id = list[i]
    if (id !== id >>> 0) {
      rec.uvar(length * 2 + 1)
      encodeValue(rec, dict, list)
      return
    }
    sorted[i] = id
  }

  sorted.sort()
  rec.uvar(length * 2)
  let previous = 0
  for (let i = 0; i < length; i++) {
    rec.uvar(sorted[i] - previous)
    previous = sorted[i]
  }
}

function readPostings(r: ByteReader, dict: KeyDictionary): InternalDocumentID[] {
  const header = r.uvar()
  if (header % 2 === 1) {
    return decodeValue(r, dict) as InternalDocumentID[]
  }

  const length = header / 2
  if (length > r.end - r.pos) {
    throw invalid('postings list exceeds the record size')
  }

  const ids = new Array<number>(length)
  let previous = 0
  for (let i = 0; i < length; i++) {
    previous += r.uvar()
    ids[i] = previous
  }
  return ids
}

/**
 * Pre-order walk of the radix tree. Each node carries its edge label, flags, child count and the postings of
 * its word; the words of end / posted nodes, in walk order, also form the term dictionary that the term
 * frequencies of the same property refer to.
 */
function* writeRadix(w: SnapshotWriter, tree: RadixTree, terms: Map<string, number>): SegmentWriter {
  const postings = tree.postings
  const nodes: RadixNode[] = [tree]
  const mapKeys: string[] = [tree.k]
  let posted = 0
  let count = 0
  let rec = w.begin(I_RADIX)

  while (nodes.length > 0) {
    const node = nodes.pop()!
    const mapKey = mapKeys.pop()!
    const list = postings.get(node.w)
    const root = count === 0
    const simple = !root && mapKey === node.k && node.s.length > 0 && node.k === node.s[0]

    rec.u8((node.e ? 1 : 0) | (list ? 2 : 0) | (simple ? 4 : 0))
    rec.str(node.s)
    if (root) {
      rec.str(node.k)
      rec.str(node.w)
    } else if (!simple) {
      rec.str(mapKey)
      rec.str(node.k)
    }
    rec.uvar(node.c.size)

    if (list) {
      posted++
      writePostings(rec, w.dict, list)
    }

    if (node.e || list) {
      terms.set(node.w, terms.size)
    }

    if (node.c.size > 0) {
      const children = Array.from(node.c)
      for (let i = children.length - 1; i >= 0; i--) {
        mapKeys.push(children[i][0])
        nodes.push(children[i][1])
      }
    }

    count++
    if (rec.pos >= w.batchBytes) {
      yield* w.commit()
      rec = w.begin(I_RADIX)
    }
  }

  yield* w.commit()

  if (posted !== postings.size) {
    // Postings whose word has no node (not produced by the built-in index, kept for fidelity).
    const reached = new Set<string>()
    const stack: RadixNode[] = [tree]
    while (stack.length > 0) {
      const node = stack.pop()!
      reached.add(node.w)
      for (const child of node.c.values()) {
        stack.push(child)
      }
    }

    for (const [word, list] of postings) {
      if (!reached.has(word)) {
        const extra = w.begin(I_RADIX_EXTRA)
        extra.str(word)
        writePostings(extra, w.dict, list)
        yield* w.commit()
      }
    }
  }

  w.begin(I_RADIX_END).uvar(count)
  yield* w.commit()
}

function writeFrequency(rec: ByteWriter, dict: KeyDictionary, terms: Map<string, number>, value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    rec.uvar(0)
    encodeValue(rec, dict, value)
    return
  }

  const frequencies = value as Record<string, unknown>
  let count = 0
  for (const token in frequencies) {
    if (frequencies[token] !== undefined) {
      count++
    }
  }

  rec.uvar(count + 1)
  for (const token in frequencies) {
    const frequency = frequencies[token]
    if (frequency === undefined) {
      continue
    }

    const term = terms.get(token)
    if (term === undefined) {
      rec.uvar(0)
      rec.str(token)
      terms.set(token, terms.size)
    } else {
      rec.uvar(term + 1)
    }
    writeNumber(rec, dict, frequency)
  }
}

function* writeVectorIndex(w: SnapshotWriter, node: Index['vectorIndexes'][string]['node']): SegmentWriter {
  if (typeof node.toBinarySnapshot !== 'function') {
    w.begin(I_VECTOR_JSON)
    yield* w.commit()
    yield* writeGeneric(w, node.toJSON())
    return
  }

  const snapshot = node.toBinarySnapshot()
  const names = Object.keys(snapshot.arrays)
  const descriptors = names.map((name) => {
    const array = snapshot.arrays[name]
    const code = typedArrayCode(array)
    if (code === 0) {
      throw new TypeError(`Vector index array "${name}" is not a supported typed array`)
    }
    return [name, code, array.length]
  })

  encodeValue(w.begin(I_VECTOR), w.dict, { meta: snapshot.meta, arrays: descriptors })
  yield* w.commit()

  for (const name of names) {
    const array = snapshot.arrays[name]
    const perChunk = Math.max(1, Math.floor(w.segmentSize / array.BYTES_PER_ELEMENT))
    for (let start = 0; start < array.length; start += perChunk) {
      w.begin(I_VECTOR_CHUNK)
      yield* w.commit(typedArrayBytes(array, start, Math.min(array.length, start + perChunk)))
    }
  }
}

function* writeBuiltinIndex(w: SnapshotWriter, index: Index): SegmentWriter {
  const trees = Object.keys(index.indexes)
  const vectors = Object.keys(index.vectorIndexes)
  const frequencies = Object.keys(index.frequencies)
  const fieldLengths = Object.keys(index.fieldLengths)
  const unstoredValues = Object.keys(index.unstoredValues ?? {})
  const unstoredTerms = Object.keys(index.unstoredTerms ?? {})

  encodeValue(w.begin(I_META), w.dict, {
    searchableProperties: index.searchableProperties,
    searchablePropertiesWithTypes: index.searchablePropertiesWithTypes,
    avgFieldLength: index.avgFieldLength,
    trees: trees.map((prop) => [prop, index.indexes[prop].type, index.indexes[prop].isArray]),
    vectors,
    frequencies,
    fieldLengths,
    unstoredValues,
    unstoredTerms
  })
  yield* w.commit()

  const termDictionaries = new Map<string, Map<string, number>>()
  for (const prop of trees) {
    const { type, node } = index.indexes[prop]
    if (type === 'Radix') {
      const terms = new Map<string, number>()
      yield* writeRadix(w, node as RadixTree, terms)
      termDictionaries.set(prop, terms)
    } else {
      yield* writeGeneric(w, node.toJSON())
    }
  }

  for (const prop of frequencies) {
    const terms = termDictionaries.get(prop) ?? new Map<string, number>()
    yield* writeDocumentMap(w, I_FREQUENCIES, index.frequencies[prop] ?? {}, (rec, value) =>
      writeFrequency(rec, w.dict, terms, value)
    )
  }

  for (const prop of fieldLengths) {
    yield* writeDocumentMap(w, I_FIELD_LENGTHS, index.fieldLengths[prop] ?? {}, (rec, value) =>
      writeNumber(rec, w.dict, value)
    )
  }

  // Values of the properties left out of the documents store, needed to remove them from the index.
  for (const prop of unstoredValues) {
    yield* writeDocumentMap(w, I_UNSTORED_VALUES, index.unstoredValues[prop] ?? {}, (rec, value) =>
      encodeValue(rec, w.dict, value)
    )
  }

  // Term dictionaries and per-document term ids (Uint32Array, stored as raw typed arrays) of unstored string[].
  for (const prop of unstoredTerms) {
    const { terms, docs } = index.unstoredTerms[prop]
    yield* writeGeneric(w, terms)
    yield* writeDocumentMap(w, I_UNSTORED_TERMS, docs, (rec, value) => encodeValue(rec, w.dict, value))
  }

  for (const prop of vectors) {
    yield* writeVectorIndex(w, index.vectorIndexes[prop].node)
  }
}

function sortValueFromDocument(doc: unknown, prop: string): unknown {
  if (typeof doc !== 'object' || doc === null) {
    return undefined
  }

  return prop.includes('.') ? getNested(doc, prop) : (doc as Record<string, unknown>)[prop]
}

function* writeBuiltinSorter(
  w: SnapshotWriter,
  sorter: Sorter,
  docs: Record<string, unknown> | undefined
): SegmentWriter {
  if (!sorter.enabled) {
    encodeValue(w.begin(S_META), w.dict, { enabled: false })
    yield* w.commit()
    return
  }

  ensureOrderedDocsAreDeleted(sorter)
  ensureIsSorted(sorter)

  const props = Object.keys(sorter.sorts)
  const modes = props.map((prop) => {
    const { docs: positions, orderedDocs } = sorter.sorts[prop]
    if (positions.size !== orderedDocs.length) {
      return 1
    }
    for (let i = 0; i < orderedDocs.length; i++) {
      if (positions.get(orderedDocs[i][0]) !== i) {
        return 1
      }
    }
    return 0
  })

  encodeValue(w.begin(S_META), w.dict, {
    enabled: true,
    language: sorter.language,
    sortableProperties: sorter.sortableProperties,
    sortablePropertiesWithTypes: sorter.sortablePropertiesWithTypes,
    isSorted: sorter.isSorted,
    unsortableProperties: sorter.unsortableProperties ?? [],
    props: props.map((prop, i) => [prop, sorter.sorts[prop].type, modes[i]])
  })
  yield* w.commit()

  for (let p = 0; p < props.length; p++) {
    const prop = props[p]
    const { orderedDocs, docs: positions } = sorter.sorts[prop]
    let rec = w.begin(S_ORDERED)
    let previous = 0

    for (let i = 0; i < orderedDocs.length; i++) {
      const [id, value] = orderedDocs[i]
      rec.svar(id - previous)
      previous = id

      if (docs && value !== undefined && sortValueFromDocument(docs[id], prop) === value) {
        rec.u8(0)
      } else {
        rec.u8(1)
        encodeValue(rec, w.dict, value)
      }

      if (rec.pos >= w.batchBytes) {
        yield* w.commit()
        rec = w.begin(S_ORDERED)
      }
    }
    yield* w.commit()
    w.begin(S_END)
    yield* w.commit()

    if (modes[p] === 1) {
      rec = w.begin(S_DOCS)
      previous = 0
      for (const [id, position] of positions) {
        rec.svar(id - previous)
        previous = id
        writeNumber(rec, w.dict, position)
        if (rec.pos >= w.batchBytes) {
          yield* w.commit()
          rec = w.begin(S_DOCS)
        }
      }
      yield* w.commit()
      w.begin(S_END)
      yield* w.commit()
    }
  }
}

interface SnapshotPlan {
  meta: SnapshotMeta
  idStore: unknown
  index: unknown
  docs: unknown
  sorting: unknown
  pinning: unknown
}

function isBuiltinIndex(db: AnyZBSearch): boolean {
  return db.index.save === builtinIndexSave && db.index.load === builtinIndexLoad
}

function isBuiltinSorter(db: AnyZBSearch): boolean {
  return db.sorter.save === builtinSorterSave && db.sorter.load === builtinSorterLoad
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | undefined)?.then === 'function'
}

function planSnapshot(db: AnyZBSearch): SnapshotPlan {
  const builtinIndex = isBuiltinIndex(db)
  const builtinSorter = isBuiltinSorter(db)

  return {
    meta: {
      language: db.tokenizer.language,
      index: builtinIndex ? 'builtin' : 'custom',
      sorter: builtinSorter ? 'builtin' : 'custom',
      docRefs: builtinSorter && db.documentsStore.save === builtinDocumentsSave,
      ...(db.store ? { store: db.store } : {})
    },
    idStore: db.internalDocumentIDStore.save(db.internalDocumentIDStore),
    index: builtinIndex ? undefined : db.index.save(db.data.index),
    docs: db.documentsStore.save(db.data.docs),
    sorting: builtinSorter ? undefined : db.sorter.save(db.data.sorting),
    pinning: db.pinning.save(db.data.pinning)
  }
}

const PLAN_PARTS = ['idStore', 'index', 'docs', 'sorting', 'pinning'] as const

function* writeSnapshot(db: AnyZBSearch, plan: SnapshotPlan, w: SnapshotWriter): SegmentWriter {
  encodeValue(w.begin(R_META), w.dict, plan.meta)
  yield* w.commit()

  yield* writeGeneric(w, plan.idStore)

  if (plan.meta.index === 'builtin') {
    yield* writeBuiltinIndex(w, db.data.index as Index)
  } else {
    yield* writeGeneric(w, plan.index)
  }

  yield* writeGeneric(w, plan.docs)

  if (plan.meta.sorter === 'builtin') {
    const docs = plan.meta.docRefs ? (db.data.docs.docs as Record<string, unknown>) : undefined
    yield* writeBuiltinSorter(w, db.data.sorting as Sorter, docs)
  } else {
    yield* writeGeneric(w, plan.sorting)
  }

  yield* writeGeneric(w, plan.pinning)

  w.begin(R_END).uvar(w.records)
  yield* w.commit()
  yield* w.finish()
}

function resolveSegmentSize(options?: SaveBinaryOptions): number {
  const segmentSize = options?.segmentSize ?? DEFAULT_SEGMENT_SIZE
  if (!Number.isInteger(segmentSize) || segmentSize < MIN_SEGMENT_SIZE || segmentSize > MAX_SEGMENT_SIZE) {
    throw new TypeError(
      `segmentSize must be an integer between ${MIN_SEGMENT_SIZE} and ${MAX_SEGMENT_SIZE}, got "${segmentSize}"`
    )
  }
  return segmentSize
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  const out = new Uint8Array(first.length + second.length)
  out.set(first)
  out.set(second, first.length)
  return out
}

/**
 * Serializes the database into a binary snapshot, as a stream of `Uint8Array` segments. Write each segment
 * out (to a file, IndexedDB, OPFS, object storage...) as it arrives: only about one segment is held in memory
 * at a time, plus the transient typed arrays of each vector index while it is written. The generator yields to
 * the event loop between segments.
 *
 * Do not modify the database until the iteration completes, or the snapshot may be inconsistent.
 */
export async function* saveBinary<T extends AnyZBSearch>(
  db: T,
  options?: SaveBinaryOptions
): AsyncGenerator<Uint8Array, void, undefined> {
  const segmentSize = resolveSegmentSize(options)
  const plan = planSnapshot(db)
  for (const part of PLAN_PARTS) {
    if (isThenable(plan[part])) {
      plan[part] = await plan[part]
    }
  }

  let header: Uint8Array | undefined = fileHeader(segmentSize)
  for (const segment of writeSnapshot(db, plan, new SnapshotWriter(segmentSize))) {
    if (header) {
      yield concat(header, segment)
      header = undefined
    } else {
      yield segment
    }
    await yieldToEventLoop()
  }
}

/**
 * Synchronous variant of {@link saveBinary} that returns the whole snapshot as a single `Uint8Array`.
 * Prefer `saveBinary` for large indexes: this one blocks and holds the full snapshot in memory.
 */
export function saveBinarySync<T extends AnyZBSearch>(db: T, options?: SaveBinaryOptions): Uint8Array {
  const segmentSize = resolveSegmentSize(options)
  const plan = planSnapshot(db)
  for (const part of PLAN_PARTS) {
    if (isThenable(plan[part])) {
      throw createError('BINARY_SNAPSHOT_ASYNC_COMPONENT', part)
    }
  }

  const parts: Uint8Array[] = [fileHeader(segmentSize)]
  let length = FILE_HEADER_SIZE
  for (const segment of writeSnapshot(db, plan, new SnapshotWriter(segmentSize))) {
    parts.push(segment)
    length += segment.length
  }

  const out = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Whether `bytes` starts like a binary snapshot (checks the magic number only). */
export function isBinarySnapshot(bytes: Uint8Array | ArrayBuffer): boolean {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return view.length >= 4 && MAGIC.every((byte, i) => view[i] === byte)
}

// ---------------------------------------------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------------------------------------------

class ChunkQueue {
  private readonly chunks: Uint8Array[] = []
  private offset = 0
  available = 0

  push(chunk: Uint8Array): void {
    if (chunk.length > 0) {
      this.chunks.push(chunk)
      this.available += chunk.length
    }
  }

  peek(n: number): Uint8Array {
    const out = new Uint8Array(n)
    let filled = 0
    let offset = this.offset
    for (let i = 0; filled < n; i++) {
      const chunk = this.chunks[i]
      const take = Math.min(chunk.length - offset, n - filled)
      out.set(chunk.subarray(offset, offset + take), filled)
      filled += take
      offset = 0
    }
    return out
  }

  /** Byte at `index` past the read position, or -1. */
  byteAt(index: number): number {
    let offset = this.offset + index
    for (const chunk of this.chunks) {
      if (offset < chunk.length) {
        return chunk[offset]
      }
      offset -= chunk.length
    }
    return -1
  }

  take(n: number): Uint8Array {
    const first = this.chunks[0]
    if (first.length - this.offset >= n) {
      const out = first.subarray(this.offset, this.offset + n)
      this.advance(n)
      return out
    }

    const out = new Uint8Array(n)
    let filled = 0
    while (filled < n) {
      const chunk = this.chunks[0]
      const take = Math.min(chunk.length - this.offset, n - filled)
      out.set(chunk.subarray(this.offset, this.offset + take), filled)
      filled += take
      this.advance(take)
    }
    return out
  }

  private advance(n: number): void {
    this.offset += n
    this.available -= n
    if (this.offset === this.chunks[0].length) {
      this.chunks.shift()
      this.offset = 0
    }
  }
}

class SnapshotReader {
  records = 0
  private readonly raw = new ChunkQueue()
  private readonly payloads = new ChunkQueue()
  private headerRead = false
  private sequence = 0

  constructor(private readonly verify: boolean) {}

  feed(chunk: Uint8Array): void {
    this.raw.push(chunk)
  }

  /** The next complete record, or undefined when more input is needed. */
  nextRecord(): Uint8Array | undefined {
    if (!this.headerRead) {
      if (!this.readFileHeader()) {
        return undefined
      }
      this.headerRead = true
    }

    for (;;) {
      const length = this.peekLength()
      if (length !== undefined && this.payloads.available >= length[0] + length[1]) {
        this.payloads.take(length[1])
        const record = this.payloads.take(length[0])
        if (record.length === 0) {
          throw invalid('empty record')
        }
        this.records++
        return record
      }

      if (!this.readSegment()) {
        return undefined
      }
    }
  }

  get empty(): boolean {
    return this.raw.available === 0 && this.payloads.available === 0
  }

  private peekLength(): [length: number, prefix: number] | undefined {
    let value = 0
    let multiplier = 1
    for (let i = 0; i < 8; i++) {
      const byte = this.payloads.byteAt(i)
      if (byte === -1) {
        return undefined
      }
      value += (byte & 127) * multiplier
      if (byte < 128) {
        return [value, i + 1]
      }
      multiplier *= 128
    }
    throw invalid('record length is too long')
  }

  private readFileHeader(): boolean {
    if (this.raw.available < FILE_HEADER_SIZE) {
      return false
    }

    const header = this.raw.take(FILE_HEADER_SIZE)
    if (!isBinarySnapshot(header)) {
      throw invalid('not a ZBSearch binary snapshot (bad magic number)')
    }

    const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
    if (this.verify && crc32(header.subarray(0, 12)) !== view.getUint32(12, true)) {
      throw createError('BINARY_SNAPSHOT_CHECKSUM_MISMATCH', 'the file header')
    }

    const version = view.getUint16(4, true)
    if (version !== BINARY_SNAPSHOT_VERSION) {
      throw createError('UNSUPPORTED_BINARY_SNAPSHOT_VERSION', version, BINARY_SNAPSHOT_VERSION)
    }

    return true
  }

  private readSegment(): boolean {
    if (this.raw.available < SEGMENT_HEADER_SIZE) {
      return false
    }

    const header = this.raw.peek(SEGMENT_HEADER_SIZE)
    const view = new DataView(header.buffer)
    const length = view.getUint32(0, true)
    if (length > MAX_SEGMENT_SIZE) {
      throw createError('BINARY_SNAPSHOT_CHECKSUM_MISMATCH', `segment ${this.sequence} (invalid length)`)
    }
    if (this.raw.available < SEGMENT_HEADER_SIZE + length) {
      return false
    }

    this.raw.take(SEGMENT_HEADER_SIZE)
    const payload = this.raw.take(length)

    if (this.verify && crc32(payload, crc32(header.subarray(0, 8))) !== view.getUint32(8, true)) {
      throw createError('BINARY_SNAPSHOT_CHECKSUM_MISMATCH', `segment ${this.sequence}`)
    }

    const sequence = view.getUint32(4, true)
    if (sequence !== this.sequence) {
      throw invalid(`found segment ${sequence} where segment ${this.sequence} was expected`)
    }

    this.sequence++
    this.payloads.push(payload)
    return true
  }
}

function recordReader(record: Uint8Array, expected: number, what: string): ByteReader {
  if (record[0] !== expected) {
    throw invalid(`unexpected record ${record[0]} while reading ${what}`)
  }
  return new ByteReader(record, 1)
}

function* readGeneric(dict: KeyDictionary): RecordReader<unknown> {
  let record = yield
  const tag = record[0]
  if (tag === G_VALUE) {
    return decodeValue(new ByteReader(record, 1), dict)
  }
  if (tag !== G_ARRAY && tag !== G_OBJECT) {
    throw invalid(`unexpected record ${tag} while reading a value`)
  }

  const root: unknown[] | Record<string, unknown> = tag === G_ARRAY ? [] : {}
  const stack: Array<unknown[] | Record<string, unknown>> = [root]
  let pendingKey: string | undefined

  const attach = (value: unknown) => {
    const top = stack[stack.length - 1]
    if (Array.isArray(top)) {
      top.push(value)
      return
    }
    if (pendingKey === undefined) {
      throw invalid('object value without a key')
    }
    setProperty(top, pendingKey, value)
    pendingKey = undefined
  }

  for (;;) {
    record = yield
    const r = new ByteReader(record, 1)
    const top = stack[stack.length - 1]

    switch (record[0]) {
      case G_ITEMS:
        if (!Array.isArray(top)) {
          throw invalid('array items outside of an array')
        }
        while (!r.done) {
          top.push(decodeValue(r, dict))
        }
        break
      case G_ENTRIES:
        if (Array.isArray(top)) {
          throw invalid('object entries outside of an object')
        }
        while (!r.done) {
          const key = readKey(r, dict)
          setProperty(top, key, decodeValue(r, dict))
        }
        break
      case G_KEY:
        pendingKey = readKey(r, dict)
        break
      case G_VALUE:
        attach(decodeValue(r, dict))
        break
      case G_ARRAY:
      case G_OBJECT: {
        const container = record[0] === G_ARRAY ? [] : {}
        attach(container)
        stack.push(container)
        break
      }
      case G_CLOSE:
        stack.pop()
        if (stack.length === 0) {
          return root
        }
        break
      default:
        throw invalid(`unexpected record ${record[0]} while reading a value`)
    }
  }
}

function* readDocumentMap(
  tag: number,
  readEntry: (r: ByteReader) => unknown
): RecordReader<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  const keys = new DocumentKeyCoder()

  for (;;) {
    const record: Uint8Array = yield
    if (record[0] === I_MAP_END) {
      return out
    }

    const r = recordReader(record, tag, 'a document map')
    while (!r.done) {
      const key = keys.read(r)
      setProperty(out, key, readEntry(r))
    }
  }
}

function* readRadix(dict: KeyDictionary, terms: string[]): RecordReader<RadixTree> {
  const tree = new RadixTree()
  const postings = tree.postings
  const parents: RadixNode[] = []
  const remaining: number[] = []
  let count = 0

  for (;;) {
    const record: Uint8Array = yield
    const tag = record[0]

    if (tag === I_RADIX_END) {
      const expected = new ByteReader(record, 1).uvar()
      if (expected !== count || parents.length > 0) {
        throw invalid('radix tree is incomplete')
      }
      return tree
    }

    if (tag === I_RADIX_EXTRA) {
      const r = new ByteReader(record, 1)
      const word = r.str()
      postings.set(word, readPostings(r, dict))
      continue
    }

    const r = recordReader(record, I_RADIX, 'a radix tree')
    while (!r.done) {
      const flags = r.u8()
      const s = r.str()
      const end = (flags & 1) === 1
      let node: RadixNode

      if (count === 0) {
        node = tree
        tree.s = s
        tree.k = r.str()
        tree.w = r.str()
        tree.e = end
      } else {
        const parent = parents[parents.length - 1]
        if (!parent) {
          throw invalid('radix node without a parent')
        }

        let mapKey: string
        let k: string
        if (flags & 4) {
          mapKey = k = s[0]
        } else {
          mapKey = r.str()
          k = r.str()
        }

        node = new RadixNode(k, s, end)
        node.w = parent.w + s
        parent.c.set(mapKey, node)
        remaining[remaining.length - 1]--
      }

      const children = r.uvar()

      if (flags & 2) {
        const ids = readPostings(r, dict)
        postings.set(node.w, ids)
        if (end) {
          node.d = ids
        }
      }

      if (end || flags & 2) {
        terms.push(node.w)
      }

      count++
      if (children > 0) {
        parents.push(node)
        remaining.push(children)
      }
      while (remaining.length > 0 && remaining[remaining.length - 1] === 0) {
        parents.pop()
        remaining.pop()
      }
    }
  }
}

function readFrequency(r: ByteReader, dict: KeyDictionary, terms: string[]): unknown {
  const header = r.uvar()
  if (header === 0) {
    return decodeValue(r, dict)
  }

  const out: Record<string, unknown> = {}
  for (let i = 1; i < header; i++) {
    const ref = r.uvar()
    let token: string
    if (ref === 0) {
      token = r.str()
      terms.push(token)
    } else {
      token = terms[ref - 1]
      if (token === undefined) {
        throw invalid('unknown term reference')
      }
    }
    setProperty(out, token, readNumber(r, dict))
  }
  return out
}

function* readVectorIndex(
  dict: KeyDictionary,
  property: string,
  db: AnyZBSearch
): RecordReader<Index['vectorIndexes'][string]['node']> {
  const record: Uint8Array = yield

  if (record[0] === I_VECTOR_JSON) {
    const raw = yield* readGeneric(dict)
    return deserializeVectorIndex(property, raw, db.indexes)
  }

  const header = decodeValue(recordReader(record, I_VECTOR, 'a vector index'), dict) as {
    meta: Record<string, unknown>
    arrays: [string, number, number][]
  }

  const arrays: Record<string, SnapshotTypedArray> = {}
  for (const [name, code, length] of header.arrays) {
    const array = createTypedArray(code, length)
    let filled = 0
    while (filled < length) {
      const chunk: Uint8Array = yield
      const bytes = recordReader(chunk, I_VECTOR_CHUNK, 'vector data').raw(chunk.length - 1)
      fillTypedArray(array, filled, bytes)
      filled += bytes.length / array.BYTES_PER_ELEMENT
    }
    arrays[name] = array as SnapshotTypedArray
  }

  const snapshot: VectorBinarySnapshot = { meta: header.meta, arrays }
  return deserializeVectorIndexBinary(property, snapshot, db.indexes)
}

interface IndexMeta {
  searchableProperties: string[]
  searchablePropertiesWithTypes: Index['searchablePropertiesWithTypes']
  avgFieldLength: Record<string, number>
  trees: [string, Index['indexes'][string]['type'], boolean][]
  vectors: string[]
  frequencies: string[]
  fieldLengths: string[]
  unstoredValues?: string[]
  unstoredTerms?: string[]
}

function* readBuiltinIndex(dict: KeyDictionary, db: AnyZBSearch): RecordReader<Index> {
  const meta = decodeValue(recordReader(yield, I_META, 'the index'), dict) as IndexMeta

  const indexes: Index['indexes'] = {}
  const termDictionaries = new Map<string, string[]>()
  for (const [prop, type, isArray] of meta.trees) {
    if (type === 'Radix') {
      const terms: string[] = []
      indexes[prop] = { type: 'Radix', node: yield* readRadix(dict, terms), isArray }
      termDictionaries.set(prop, terms)
    } else {
      const node = yield* readGeneric(dict)
      indexes[prop] = deserializeIndexEntry({ type, node, isArray } as Index['indexes'][string])
    }
  }

  const frequencies: Index['frequencies'] = {}
  for (const prop of meta.frequencies) {
    const terms = termDictionaries.get(prop) ?? []
    frequencies[prop] = (yield* readDocumentMap(I_FREQUENCIES, (r) =>
      readFrequency(r, dict, terms)
    )) as Index['frequencies'][string]
  }

  const fieldLengths: Index['fieldLengths'] = {}
  for (const prop of meta.fieldLengths) {
    fieldLengths[prop] = (yield* readDocumentMap(I_FIELD_LENGTHS, (r) =>
      readNumber(r, dict)
    )) as Index['fieldLengths'][string]
  }

  const unstoredValues: Index['unstoredValues'] = {}
  for (const prop of meta.unstoredValues ?? []) {
    unstoredValues[prop] = (yield* readDocumentMap(I_UNSTORED_VALUES, (r) =>
      decodeValue(r, dict)
    )) as Index['unstoredValues'][string]
  }

  const unstoredTerms: Index['unstoredTerms'] = {}
  for (const prop of meta.unstoredTerms ?? []) {
    const terms = (yield* readGeneric(dict)) as string[]
    const docs = (yield* readDocumentMap(I_UNSTORED_TERMS, (r) => decodeValue(r, dict))) as UnstoredTerms['docs']
    const termIds = new Map<string, number>()
    for (let i = 0; i < terms.length; i++) {
      termIds.set(terms[i], i)
    }
    unstoredTerms[prop] = { terms, termIds, docs }
  }

  const vectorIndexes: Index['vectorIndexes'] = {}
  for (const prop of meta.vectors) {
    vectorIndexes[prop] = { type: 'Vector', isArray: false, node: yield* readVectorIndex(dict, prop, db) }
  }

  return {
    sharedInternalDocumentStore: db.internalDocumentIDStore,
    indexes,
    vectorIndexes,
    searchableProperties: meta.searchableProperties,
    searchablePropertiesWithTypes: meta.searchablePropertiesWithTypes,
    frequencies,
    tokenOccurrences: {},
    avgFieldLength: meta.avgFieldLength,
    fieldLengths,
    unstoredValues,
    unstoredTerms
  }
}

interface SorterMeta {
  enabled: boolean
  language: string
  sortableProperties: string[]
  sortablePropertiesWithTypes: Record<string, SortType>
  isSorted: boolean
  unsortableProperties: string[]
  props: [string, SortType, number][]
}

function* readBuiltinSorter(
  dict: KeyDictionary,
  db: AnyZBSearch,
  docs: Record<string, unknown> | undefined
): RecordReader<Sorter> {
  const meta = decodeValue(recordReader(yield, S_META, 'the sorter'), dict) as SorterMeta
  if (!meta.enabled) {
    return { enabled: false } as unknown as Sorter
  }

  const sorts: Sorter['sorts'] = {}
  for (const [prop, type, mode] of meta.props) {
    const orderedDocs: [InternalDocumentID, string | number | boolean][] = []
    let previous = 0

    for (;;) {
      const record: Uint8Array = yield
      if (record[0] === S_END) {
        break
      }

      const r = recordReader(record, S_ORDERED, 'the sorter')
      while (!r.done) {
        const id = previous + r.svar()
        previous = id
        const value = r.u8() === 0 ? sortValueFromDocument(docs?.[id], prop) : decodeValue(r, dict)
        orderedDocs.push([id, value as string | number | boolean])
      }
    }

    const positions = new Map<InternalDocumentID, number>()
    if (mode === 0) {
      for (let i = 0; i < orderedDocs.length; i++) {
        positions.set(orderedDocs[i][0], i)
      }
    } else {
      previous = 0
      for (;;) {
        const record: Uint8Array = yield
        if (record[0] === S_END) {
          break
        }

        const r = recordReader(record, S_DOCS, 'the sorter')
        while (!r.done) {
          const id = previous + r.svar()
          previous = id
          positions.set(id, readNumber(r, dict) as number)
        }
      }
    }

    sorts[prop] = { docs: positions, orderedDocs, orderedDocsToRemove: new Map(), type }
  }

  return {
    sharedInternalDocumentStore: db.internalDocumentIDStore,
    language: meta.language,
    sortableProperties: meta.sortableProperties,
    sortablePropertiesWithTypes: meta.sortablePropertiesWithTypes,
    sorts,
    enabled: true,
    isSorted: meta.isSorted,
    unsortableProperties: meta.unsortableProperties
  }
}

interface LoadedSnapshot {
  meta: SnapshotMeta
  idStore: unknown
  index: unknown
  docs: unknown
  sorting: unknown
  pinning: unknown
}

function* readSnapshot(db: AnyZBSearch, reader: SnapshotReader): RecordReader<LoadedSnapshot> {
  const dict = new KeyDictionary()
  const meta = decodeValue(recordReader(yield, R_META, 'the snapshot header'), dict) as SnapshotMeta
  if (typeof meta !== 'object' || meta === null || typeof meta.index !== 'string') {
    throw invalid('missing snapshot metadata')
  }

  if (meta.index === 'builtin' && !isBuiltinIndex(db)) {
    throw createError('BINARY_SNAPSHOT_COMPONENT_MISMATCH', 'index', 'index')
  }
  if (meta.sorter === 'builtin' && !isBuiltinSorter(db)) {
    throw createError('BINARY_SNAPSHOT_COMPONENT_MISMATCH', 'sorting', 'sorter')
  }

  const idStore = yield* readGeneric(dict)
  const index = meta.index === 'builtin' ? yield* readBuiltinIndex(dict, db) : yield* readGeneric(dict)
  const docs = yield* readGeneric(dict)
  const documents = meta.docRefs ? ((docs as { docs?: Record<string, unknown> })?.docs ?? {}) : undefined
  const sorting = meta.sorter === 'builtin' ? yield* readBuiltinSorter(dict, db, documents) : yield* readGeneric(dict)
  const pinning = yield* readGeneric(dict)

  const end = recordReader(yield, R_END, 'the end of the snapshot').uvar()
  if (end !== reader.records - 1) {
    throw invalid('record count mismatch')
  }

  return { meta, idStore, index, docs, sorting, pinning }
}

function toBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) {
    return chunk
  }
  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk)
  }
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  }
  throw new TypeError('Binary snapshot chunks must be Uint8Array, ArrayBuffer or ArrayBufferView instances')
}

function truncated() {
  return invalid('the snapshot is truncated')
}

function trailing() {
  return invalid('unexpected data after the end of the snapshot')
}

async function applySnapshotAsync(db: AnyZBSearch, loaded: LoadedSnapshot): Promise<void> {
  const store = db.internalDocumentIDStore
  store.load(db, loaded.idStore)

  if (loaded.meta.index === 'builtin') {
    db.data.index = loaded.index as Index
  } else {
    db.data.index = db.index.loadAsync
      ? await db.index.loadAsync(store, loaded.index, db.indexes)
      : db.index.load(store, loaded.index, db.indexes)
  }

  db.data.docs = db.documentsStore.load(store, loaded.docs)

  if (loaded.meta.sorter === 'builtin') {
    db.data.sorting = loaded.sorting as Sorter
  } else {
    db.data.sorting = db.sorter.loadAsync
      ? await db.sorter.loadAsync(store, loaded.sorting)
      : db.sorter.load(store, loaded.sorting)
  }

  db.data.pinning = db.pinning.load(store, loaded.pinning)
  db.tokenizer.language = loaded.meta.language as typeof db.tokenizer.language
  applyStoreSettings(db, loaded.meta)
}

// As in `load`: the saved store configuration wins over the one given to `create`, snapshots without one keep the
// configuration of the target database, and every cache is cleared.
function applyStoreSettings(db: AnyZBSearch, meta: SnapshotMeta): void {
  if (meta.store) {
    db.store = resolveStoreConfig(meta.store)
  }
  db.caches = {}
}

function applySnapshot(db: AnyZBSearch, loaded: LoadedSnapshot): void {
  const store = db.internalDocumentIDStore
  store.load(db, loaded.idStore)
  db.data.index = loaded.meta.index === 'builtin' ? (loaded.index as Index) : db.index.load(store, loaded.index, db.indexes)
  db.data.docs = db.documentsStore.load(store, loaded.docs)
  db.data.sorting =
    loaded.meta.sorter === 'builtin' ? (loaded.sorting as Sorter) : db.sorter.load(store, loaded.sorting)
  db.data.pinning = db.pinning.load(store, loaded.pinning)
  db.tokenizer.language = loaded.meta.language as typeof db.tokenizer.language
  applyStoreSettings(db, loaded.meta)
}

function sourceIterator(
  source: BinarySnapshotSource
): Iterator<BinarySnapshotChunk> | AsyncIterator<BinarySnapshotChunk> {
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    return [source][Symbol.iterator]()
  }

  const asyncIterable = source as AsyncIterable<BinarySnapshotChunk>
  if (typeof asyncIterable[Symbol.asyncIterator] === 'function') {
    return asyncIterable[Symbol.asyncIterator]()
  }

  const iterable = source as Iterable<BinarySnapshotChunk>
  if (typeof iterable[Symbol.iterator] === 'function') {
    return iterable[Symbol.iterator]()
  }

  const stream = source as ReadableStream<BinarySnapshotChunk>
  if (typeof stream.getReader === 'function') {
    const reader = stream.getReader()
    return {
      next: () => reader.read() as Promise<IteratorResult<BinarySnapshotChunk>>,
      return: async () => {
        reader.releaseLock()
        return { done: true, value: undefined }
      }
    }
  }

  throw new TypeError('loadBinary expects a Uint8Array, an ArrayBuffer, a ReadableStream or an (async) iterable')
}

/**
 * Restores a snapshot written by {@link saveBinary} (or {@link saveBinarySync}) into `db`. `source` can be the
 * whole snapshot or any sequence of byte chunks, split anywhere (for instance a file read stream). Checksums
 * and the format version are verified as the data arrives, and the database is only modified once the whole
 * snapshot has been read and verified. Yields to the event loop regularly, so it does not block the thread.
 */
export async function loadBinary<T extends AnyZBSearch>(
  db: T,
  source: BinarySnapshotSource,
  options?: LoadBinaryOptions
): Promise<void> {
  const reader = new SnapshotReader(options?.verifyChecksums !== false)
  const iterator = sourceIterator(source)
  const parser = readSnapshot(db, reader)
  let lastYield = Date.now()
  let completed = false

  try {
    let step = parser.next()
    while (!step.done) {
      let record = reader.nextRecord()
      while (record === undefined) {
        const next = await iterator.next()
        if (next.done) {
          completed = true
          throw truncated()
        }
        reader.feed(toBytes(next.value))
        record = reader.nextRecord()
      }

      step = parser.next(record)

      if (Date.now() - lastYield >= YIELD_INTERVAL_MS) {
        await yieldToEventLoop()
        lastYield = Date.now()
      }
    }

    if (!reader.empty) {
      throw trailing()
    }

    for (;;) {
      const next = await iterator.next()
      if (next.done) {
        completed = true
        break
      }
      if (toBytes(next.value).length > 0) {
        throw trailing()
      }
    }

    await yieldToEventLoop()
    await applySnapshotAsync(db, step.value)
  } finally {
    if (!completed) {
      await iterator.return?.()
    }
  }
}

/**
 * Synchronous variant of {@link loadBinary}, for a snapshot that is already in memory.
 */
export function loadBinarySync<T extends AnyZBSearch>(
  db: T,
  source: Uint8Array | ArrayBuffer | Iterable<BinarySnapshotChunk>,
  options?: LoadBinaryOptions
): void {
  const reader = new SnapshotReader(options?.verifyChecksums !== false)
  const iterator = sourceIterator(source) as Iterator<BinarySnapshotChunk>
  const parser = readSnapshot(db, reader)

  let step = parser.next()
  while (!step.done) {
    let record = reader.nextRecord()
    while (record === undefined) {
      const next = iterator.next()
      if (next.done) {
        throw truncated()
      }
      reader.feed(toBytes(next.value))
      record = reader.nextRecord()
    }
    step = parser.next(record)
  }

  if (!reader.empty) {
    throw trailing()
  }
  for (let next = iterator.next(); !next.done; next = iterator.next()) {
    if (toBytes(next.value).length > 0) {
      throw trailing()
    }
  }

  applySnapshot(db, step.value)
}
