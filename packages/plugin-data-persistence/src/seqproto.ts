import type { Ser, Des } from 'seqproto'
import type { RawData, AnyZBSearch } from 'zbsearch'
import { save } from 'zbsearch'
import { createSer, createDes } from 'seqproto'

// Format history:
// 1 - generic encoding of the saved data.
// 2 - schema-aware encoding. Broken: a fixed 16 MiB buffer, document values written as strings (vectors threw),
//     numbers as float32, and number, boolean, geopoint and vector indexes as well as sorting dropped.
// 3 - the current format: an exact encoding of everything `save` returns, in a buffer that grows as needed.
//     Versions 1 and 2 can still be read.
const FORMAT_VERSION = 3
const INITIAL_BUFFER_SIZE = 1024 * 1024
// seqproto addresses its buffer as 32-bit words with a 32-bit index.
const MAX_BUFFER_SIZE = 2 ** 32 - 4

const Tag = {
  Null: 0,
  Undefined: 1,
  String: 2,
  Number: 3,
  True: 4,
  False: 5,
  Array: 6,
  Object: 7,
  NumberArray: 8,
  Uint32: 9
} as const

const float64 = new Float64Array(1)
const float64Words = new Uint32Array(float64.buffer)

type JSONLike = null | string | number | boolean | undefined | JSONLike[] | { [k: string]: JSONLike }

function deserializeStringArray(des: Des): string[] {
  const len = des.deserializeUInt32()
  const arr = new Array<string>(len)
  for (let i = 0; i < len; i++) {
    arr[i] = des.deserializeString()
  }
  return arr
}

function deserializeNumberArray(des: Des): number[] {
  const len = des.deserializeUInt32()
  const arr = new Array<number>(len)
  for (let i = 0; i < len; i++) {
    arr[i] = des.deserializeNumber()
  }
  return arr
}

function deserializeRadixStructure(des: Des): any {
  const w = des.deserializeString()
  const s = des.deserializeString()
  const e = des.deserializeBoolean()
  const k = des.deserializeString()

  const childrenLen = des.deserializeUInt32()
  const c = new Array(childrenLen)
  for (let i = 0; i < childrenLen; i++) {
    const key = des.deserializeString()
    const child = deserializeRadixStructure(des)
    c[i] = [key, child]
  }

  return { w: w || '', s: s || '', e, k: k || '', c }
}

function deserializeRadixPostings(des: Des): Record<string, number[]> {
  const termCount = des.deserializeUInt32()
  const postings: Record<string, number[]> = {}
  for (let i = 0; i < termCount; i++) {
    const term = des.deserializeString()
    const encodedLen = des.deserializeUInt32()
    const encoded = new Array<number>(encodedLen)
    for (let j = 0; j < encodedLen; j++) {
      encoded[j] = des.deserializeNumber()
    }
    postings[term] = encoded
  }
  return postings
}

function deserializeIndexNode(des: Des): any {
  const nodeType = des.deserializeUInt32()

  if (nodeType === 1) {
    // Legacy radix node with inline doc IDs
    const w = des.deserializeString()
    const s = des.deserializeString()
    const e = des.deserializeBoolean()
    const k = des.deserializeString()
    const d = deserializeNumberArray(des)

    const childrenLen = des.deserializeUInt32()
    const c = []
    for (let i = 0; i < childrenLen; i++) {
      const key = des.deserializeString()
      const child = deserializeIndexNode(des)
      c.push([key, child])
    }

    return { w: w || '', s: s || '', e, k: k || '', d, c }
  }

  if (nodeType === 3) {
    return deserializeRadixStructure(des)
  }

  if (nodeType === 2) {
    // Flat node
    const numberToDocumentIdLen = des.deserializeUInt32()
    const numberToDocumentId = []
    for (let i = 0; i < numberToDocumentIdLen; i++) {
      const key = des.deserializeString()
      const ids = deserializeStringArray(des)
      numberToDocumentId.push([key, ids])
    }
    return { numberToDocumentId }
  } else {
    // Generic fallback
    return deserializeValue(des)
  }
}

function deserializeStringToNumberMap(des: Des): Record<string, number> {
  const len = des.deserializeUInt32()
  const map: Record<string, number> = {}
  for (let i = 0; i < len; i++) {
    const key = des.deserializeString()
    map[key] = des.deserializeNumber()
  }
  return map
}

function deserializeFrequencies(des: Des): any {
  const fieldCount = des.deserializeUInt32()
  const frequencies: any = {}
  for (let i = 0; i < fieldCount; i++) {
    const field = des.deserializeString()
    const docCount = des.deserializeUInt32()
    const docFreqs: any = {}
    for (let j = 0; j < docCount; j++) {
      const docId = des.deserializeString()
      docFreqs[docId] = deserializeStringToNumberMap(des)
    }
    frequencies[field] = docFreqs
  }
  return frequencies
}

function deserializeTokenOccurrences(des: Des): any {
  const fieldCount = des.deserializeUInt32()
  const tokenOccurrences: any = {}
  for (let i = 0; i < fieldCount; i++) {
    const field = des.deserializeString()
    tokenOccurrences[field] = deserializeStringToNumberMap(des)
  }
  return tokenOccurrences
}

function deserializeValue(des: Des): JSONLike {
  const type = des.deserializeUInt32()
  if (type === 0) return null
  if (type === 1) return undefined
  if (type === 2) return des.deserializeString()
  if (type === 3) return des.deserializeNumber()
  if (type === 4) return des.deserializeBoolean()
  if (type === 5) {
    const len = des.deserializeUInt32()
    const arr = new Array<JSONLike>(len)
    for (let i = 0; i < len; i++) {
      arr[i] = deserializeValue(des)
    }
    return arr
  }
  if (type === 6) {
    const len = des.deserializeUInt32()
    const obj: Record<string, JSONLike> = {}
    for (let i = 0; i < len; i++) {
      const key = des.deserializeString()
      obj[key] = deserializeValue(des)
    }
    return obj
  }
  throw new Error(`Unknown type: ${type}`)
}

// Reads the format versions 1 and 2.
function deserializeLegacy(des: Des, version: number): RawData {
  if (version === 1) {
    // Fallback to old generic deserialization
    const raw = deserializeValue(des) as unknown as RawData
    return raw
  }

  // Schema-aware deserialization
  const raw: any = {}

  // Inline deserialize internalDocumentIDStore
  const idStoreLen = des.deserializeUInt32()
  const internalIdToId = new Array(idStoreLen)
  for (let i = 0; i < idStoreLen; i++) {
    internalIdToId[i] = des.deserializeString()
  }
  raw.internalDocumentIDStore = { internalIdToId }

  // Inline deserialize docs
  const docCount = des.deserializeUInt32()
  const docsLength = des.deserializeUInt32()
  const docs: any = {}

  for (let i = 0; i < docsLength; i++) {
    const docId = des.deserializeString()
    const doc: any = {}

    const fieldCount = des.deserializeUInt32()
    for (let j = 0; j < fieldCount; j++) {
      const field = des.deserializeString()
      const arrayInfo = des.deserializeUInt32()

      if (arrayInfo & 0x80000000) {
        // High bit set = array
        const len = arrayInfo & 0x7fffffff
        const arr = new Array(len)
        for (let k = 0; k < len; k++) {
          arr[k] = des.deserializeString()
        }
        doc[field] = arr
      } else {
        doc[field] = des.deserializeString()
      }
    }
    docs[docId] = doc
  }

  raw.docs = { docs, count: docCount }

  // Inline deserialize indexes
  const indexCount = des.deserializeUInt32()
  const indexes: any = {}

  for (let i = 0; i < indexCount; i++) {
    const key = des.deserializeString()
    const type = des.deserializeString()
    const isArray = des.deserializeBoolean()

    // Inline index node deserialization
    const nodeType = des.deserializeUInt32()
    let node: any

    if (nodeType === 1) {
      // Legacy radix node with inline doc IDs
      const w = des.deserializeString()
      const s = des.deserializeString()
      const e = des.deserializeBoolean()
      const k = des.deserializeString()

      const dLen = des.deserializeUInt32()
      const d = new Array(dLen)
      for (let j = 0; j < dLen; j++) {
        d[j] = des.deserializeNumber()
      }

      const cLen = des.deserializeUInt32()
      const c = new Array(cLen)
      for (let j = 0; j < cLen; j++) {
        const cKey = des.deserializeString()
        const child = deserializeIndexNode(des)
        c[j] = [cKey, child]
      }

      node = { w, s, e, k, d, c }
    } else if (nodeType === 3) {
      node = deserializeRadixStructure(des)
      node.postings = deserializeRadixPostings(des)
    } else if (nodeType === 2) {
      // Flat node
      const ntdiLen = des.deserializeUInt32()
      const numberToDocumentId = new Array(ntdiLen)
      for (let j = 0; j < ntdiLen; j++) {
        const key = des.deserializeString()
        const idsLen = des.deserializeUInt32()
        const ids = new Array(idsLen)
        for (let k = 0; k < idsLen; k++) {
          ids[k] = des.deserializeString()
        }
        numberToDocumentId[j] = [key, ids]
      }
      node = { numberToDocumentId }
    } else {
      node = {}
    }

    indexes[key] = { type, isArray, node }
  }

  // Inline deserialize searchableProperties
  const searchPropLen = des.deserializeUInt32()
  const searchableProperties = new Array(searchPropLen)
  for (let i = 0; i < searchPropLen; i++) {
    searchableProperties[i] = des.deserializeString()
  }

  // Inline deserialize searchablePropertiesWithTypes
  const propsWithTypesLen = des.deserializeUInt32()
  const searchablePropertiesWithTypes: any = {}
  for (let i = 0; i < propsWithTypesLen; i++) {
    const key = des.deserializeString()
    const value = des.deserializeString()
    searchablePropertiesWithTypes[key] = value
  }

  // Keep function calls for complex nested structures
  const frequencies = deserializeFrequencies(des)
  const tokenOccurrences = deserializeTokenOccurrences(des)

  // Inline deserialize avgFieldLength
  const avgFLLen = des.deserializeUInt32()
  const avgFieldLength: any = {}
  for (let i = 0; i < avgFLLen; i++) {
    const key = des.deserializeString()
    avgFieldLength[key] = des.deserializeNumber()
  }

  // Inline deserialize fieldLengths
  const fieldLengthsLen = des.deserializeUInt32()
  const fieldLengths: any = {}
  for (let i = 0; i < fieldLengthsLen; i++) {
    const field = des.deserializeString()
    const dataLen = des.deserializeUInt32()
    const fieldData: any = {}
    for (let j = 0; j < dataLen; j++) {
      const key = des.deserializeString()
      fieldData[key] = des.deserializeNumber()
    }
    fieldLengths[field] = fieldData
  }

  raw.index = {
    indexes,
    vectorIndexes: {},
    searchableProperties,
    searchablePropertiesWithTypes,
    frequencies,
    tokenOccurrences,
    avgFieldLength,
    fieldLengths
  }

  // Deserialize language
  raw.language = des.deserializeString()

  // Deserialize pinning rules
  const pinningRulesLen = des.deserializeUInt32()
  const pinningRules = new Array(pinningRulesLen)
  for (let i = 0; i < pinningRulesLen; i++) {
    const ruleId = des.deserializeString()
    const rule = deserializeValue(des)
    pinningRules[i] = [ruleId, rule]
  }
  raw.pinning = { rules: pinningRules }

  // Set empty sorting - it will be reconstructed by ZBSearch when needed
  raw.sorting = {}

  return raw as RawData
}

// Grows the serializer buffer (seqproto's own buffer has a fixed size) so that `bytes` more bytes fit.
function ensure(ser: Ser, bytes: number): void {
  const needed = ser.index * 4 + bytes
  if (needed <= ser.buffer.byteLength) {
    return
  }

  if (needed > MAX_BUFFER_SIZE) {
    throw new RangeError(
      `The database is too large for the seqproto format (over ${MAX_BUFFER_SIZE} bytes). Use the "snapshot" format.`
    )
  }

  let size = ser.buffer.byteLength * 2
  while (size < needed) {
    size *= 2
  }
  size = Math.min(size, MAX_BUFFER_SIZE)

  const next = new ArrayBuffer(size)
  new Uint32Array(next).set(ser.uint32Array.subarray(0, ser.index))
  ser.buffer = next
  ser.uint32Array = new Uint32Array(next)
  ser.float32Array = new Float32Array(next)
}

function writeU32(ser: Ser, value: number): void {
  ensure(ser, 4)
  ser.uint32Array[ser.index++] = value
}

function writeF64(ser: Ser, value: number): void {
  ensure(ser, 8)
  float64[0] = value
  ser.uint32Array[ser.index++] = float64Words[0]
  ser.uint32Array[ser.index++] = float64Words[1]
}

function readF64(des: Des): number {
  float64Words[0] = des.uint32Array[des.index++]
  float64Words[1] = des.uint32Array[des.index++]
  return float64[0]
}

function writeString(ser: Ser, value: string): void {
  ensure(ser, 8 + value.length * 3)
  ser.serializeString(value)
}

function isOmitted(value: unknown): boolean {
  const type = typeof value
  return type === 'undefined' || type === 'function' || type === 'symbol'
}

function writeValue(ser: Ser, value: unknown): void {
  switch (typeof value) {
    case 'string':
      writeU32(ser, Tag.String)
      writeString(ser, value)
      return
    case 'number':
      if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff && !Object.is(value, -0)) {
        writeU32(ser, Tag.Uint32)
        writeU32(ser, value)
      } else {
        writeU32(ser, Tag.Number)
        writeF64(ser, value)
      }
      return
    case 'boolean':
      writeU32(ser, value ? Tag.True : Tag.False)
      return
    case 'object':
      break
    default:
      writeU32(ser, Tag.Undefined)
      return
  }

  if (value === null) {
    writeU32(ser, Tag.Null)
    return
  }

  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const array = value as unknown as ArrayLike<unknown>
    const length = array.length
    let numeric = length > 0
    for (let i = 0; i < length && numeric; i++) {
      numeric = typeof array[i] === 'number'
    }

    if (numeric) {
      writeU32(ser, Tag.NumberArray)
      writeU32(ser, length)
      for (let i = 0; i < length; i++) {
        writeF64(ser, array[i] as number)
      }
      return
    }

    writeU32(ser, Tag.Array)
    writeU32(ser, length)
    for (let i = 0; i < length; i++) {
      writeValue(ser, isOmitted(array[i]) ? null : array[i])
    }
    return
  }

  const toJSON = (value as { toJSON?: unknown }).toJSON
  if (typeof toJSON === 'function') {
    writeValue(ser, toJSON.call(value))
    return
  }

  const object = value as Record<string, unknown>
  const keys = Object.keys(object).filter((key) => !isOmitted(object[key]))
  writeU32(ser, Tag.Object)
  writeU32(ser, keys.length)
  for (const key of keys) {
    writeString(ser, key)
    writeValue(ser, object[key])
  }
}

function readValue(des: Des): unknown {
  const tag = des.deserializeUInt32()
  switch (tag) {
    case Tag.Null:
      return null
    case Tag.Undefined:
      return undefined
    case Tag.String:
      return des.deserializeString()
    case Tag.Number:
      return readF64(des)
    case Tag.Uint32:
      return des.deserializeUInt32()
    case Tag.True:
      return true
    case Tag.False:
      return false
    case Tag.NumberArray: {
      const length = des.deserializeUInt32()
      const out = new Array<number>(length)
      for (let i = 0; i < length; i++) {
        out[i] = readF64(des)
      }
      return out
    }
    case Tag.Array: {
      const length = des.deserializeUInt32()
      const out = new Array<unknown>(length)
      for (let i = 0; i < length; i++) {
        out[i] = readValue(des)
      }
      return out
    }
    case Tag.Object: {
      const length = des.deserializeUInt32()
      const out: Record<string, unknown> = {}
      for (let i = 0; i < length; i++) {
        const key = des.deserializeString()
        const item = readValue(des)
        if (key === '__proto__') {
          Object.defineProperty(out, key, { value: item, writable: true, enumerable: true, configurable: true })
        } else {
          out[key] = item
        }
      }
      return out
    }
    default:
      throw new Error(`Corrupted seqproto snapshot: unknown value tag ${tag}`)
  }
}

/**
 * Serializes a database with seqproto. The buffer grows as needed (up to 4 GiB), and every part of the saved data
 * is kept exactly, vectors and sorting included.
 */
export function serializeZBSearchInstance<T extends AnyZBSearch>(db: T): ArrayBuffer {
  const ser = createSer({ bufferSize: INITIAL_BUFFER_SIZE })
  writeU32(ser, FORMAT_VERSION)
  writeValue(ser, save(db))
  return ser.getBuffer()
}

function toAlignedArrayBuffer(data: ArrayBuffer | Uint8Array | string): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    return data
  }

  const bytes = typeof data === 'string' ? Uint8Array.from(data, (c) => c.charCodeAt(0)) : data
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer
  }

  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

/**
 * Deserializes a snapshot written by {@link serializeZBSearchInstance} (any format version).
 */
export function deserializeZBSearchInstance(data: ArrayBuffer | Uint8Array | string): RawData {
  const des = createDes(toAlignedArrayBuffer(data) as any)
  const version = des.deserializeUInt32()

  if (version === FORMAT_VERSION) {
    return readValue(des) as RawData
  }

  if (version === 1 || version === 2) {
    return deserializeLegacy(des, version)
  }

  throw new Error(`Unsupported seqproto ZBSearch serialization version: ${version}`)
}
