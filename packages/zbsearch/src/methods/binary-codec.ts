// Low-level building blocks of the binary snapshot format (see serialization-binary.ts): CRC32, a growable
// byte writer, a bounds-checked byte reader and a compact tagged encoding for JSON-like values.
// Everything here is dependency free and works in every runtime that has TextEncoder / TextDecoder.

import { createError } from '../errors.js'

export type BinarySnapshotArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Int32Array
  | Uint32Array
  | Int16Array
  | Uint16Array

const MAX_SAFE = Number.MAX_SAFE_INTEGER
const MAX_ZIGZAG = 2 ** 52

export const IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

// ---------------------------------------------------------------------------------------------------------------
// CRC32 (IEEE 802.3, the zlib/PNG polynomial), slice-by-8.
// ---------------------------------------------------------------------------------------------------------------

let crcTables: Int32Array | undefined

function getCrcTables(): Int32Array {
  if (crcTables) {
    return crcTables
  }

  const tables = new Int32Array(8 * 256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    tables[n] = c
  }

  for (let t = 1; t < 8; t++) {
    for (let n = 0; n < 256; n++) {
      const previous = tables[(t - 1) * 256 + n]
      tables[t * 256 + n] = (previous >>> 8) ^ tables[previous & 0xff]
    }
  }

  crcTables = tables
  return tables
}

/**
 * CRC32 of `data`. Pass the result of a previous call as `crc` to checksum several buffers as one stream.
 */
export function crc32(data: Uint8Array, crc = 0): number {
  const t = getCrcTables()
  let c = ~crc
  let i = 0
  const n = data.length
  const end8 = n - (n % 8)

  while (i < end8) {
    c ^= data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)
    c =
      t[1792 + (c & 0xff)] ^
      t[1536 + ((c >>> 8) & 0xff)] ^
      t[1280 + ((c >>> 16) & 0xff)] ^
      t[1024 + (c >>> 24)] ^
      t[768 + data[i + 4]] ^
      t[512 + data[i + 5]] ^
      t[256 + data[i + 6]] ^
      t[data[i + 7]]
    i += 8
  }

  while (i < n) {
    c = t[(c ^ data[i++]) & 0xff] ^ (c >>> 8)
  }

  return ~c >>> 0
}

// ---------------------------------------------------------------------------------------------------------------
// Typed arrays
// ---------------------------------------------------------------------------------------------------------------

type TypedArrayConstructor = {
  new (length: number): BinarySnapshotArray
  readonly BYTES_PER_ELEMENT: number
}

const TYPED_ARRAY_CONSTRUCTORS: TypedArrayConstructor[] = [
  Float32Array,
  Float64Array,
  Int8Array,
  Uint8Array,
  Int32Array,
  Uint32Array,
  Int16Array,
  Uint16Array
]

export function typedArrayCode(array: unknown): number {
  for (let i = 0; i < TYPED_ARRAY_CONSTRUCTORS.length; i++) {
    if (array instanceof TYPED_ARRAY_CONSTRUCTORS[i]) {
      return i + 1
    }
  }

  return 0
}

export function createTypedArray(code: number, length: number): BinarySnapshotArray {
  const ctor = TYPED_ARRAY_CONSTRUCTORS[code - 1]
  if (!ctor || !Number.isSafeInteger(length) || length < 0) {
    throw invalid(`unknown typed array (type ${code}, length ${length})`)
  }

  return new ctor(length)
}

function setElement(view: DataView, offset: number, code: number, value: number): void {
  switch (code) {
    case 1:
      return view.setFloat32(offset, value, true)
    case 2:
      return view.setFloat64(offset, value, true)
    case 3:
      return view.setInt8(offset, value)
    case 4:
      return view.setUint8(offset, value)
    case 5:
      return view.setInt32(offset, value, true)
    case 6:
      return view.setUint32(offset, value, true)
    case 7:
      return view.setInt16(offset, value, true)
    default:
      return view.setUint16(offset, value, true)
  }
}

function getElement(view: DataView, offset: number, code: number): number {
  switch (code) {
    case 1:
      return view.getFloat32(offset, true)
    case 2:
      return view.getFloat64(offset, true)
    case 3:
      return view.getInt8(offset)
    case 4:
      return view.getUint8(offset)
    case 5:
      return view.getInt32(offset, true)
    case 6:
      return view.getUint32(offset, true)
    case 7:
      return view.getInt16(offset, true)
    default:
      return view.getUint16(offset, true)
  }
}

/**
 * Little-endian bytes of `array[start, end)`. A view (no copy) on little-endian platforms.
 */
export function typedArrayBytes(array: BinarySnapshotArray, start = 0, end = array.length): Uint8Array {
  const size = array.BYTES_PER_ELEMENT
  if (IS_LITTLE_ENDIAN || size === 1) {
    return new Uint8Array(array.buffer, array.byteOffset + start * size, (end - start) * size)
  }

  /* c8 ignore next 8 */
  const code = typedArrayCode(array)
  const out = new Uint8Array((end - start) * size)
  const view = new DataView(out.buffer)
  for (let i = start; i < end; i++) {
    setElement(view, (i - start) * size, code, array[i])
  }
  return out
}

/**
 * Copies little-endian `bytes` into `array`, starting at element `start`.
 */
export function fillTypedArray(array: BinarySnapshotArray, start: number, bytes: Uint8Array): void {
  const size = array.BYTES_PER_ELEMENT
  if (bytes.length % size !== 0 || start * size + bytes.length > array.byteLength) {
    throw invalid('typed array chunk does not fit its array')
  }

  if (IS_LITTLE_ENDIAN || size === 1) {
    new Uint8Array(array.buffer, array.byteOffset + start * size, bytes.length).set(bytes)
    return
  }

  /* c8 ignore next 6 */
  const code = typedArrayCode(array)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = bytes.length / size
  for (let i = 0; i < count; i++) {
    array[start + i] = getElement(view, i * size, code)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------------------------

export function invalid(reason: string) {
  return createError('INVALID_BINARY_SNAPSHOT', reason)
}

// ---------------------------------------------------------------------------------------------------------------
// ByteWriter
// ---------------------------------------------------------------------------------------------------------------

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export class ByteWriter {
  public buf: Uint8Array
  public view: DataView
  public pos = 0

  constructor(capacity = 1024) {
    this.buf = new Uint8Array(capacity)
    this.view = new DataView(this.buf.buffer)
  }

  reset(): void {
    this.pos = 0
  }

  /** Releases a buffer that grew past `limit` bytes because of an unusually large record. */
  shrink(limit: number, capacity: number): void {
    if (this.buf.length > limit) {
      this.buf = new Uint8Array(capacity)
      this.view = new DataView(this.buf.buffer)
      this.pos = 0
    }
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
    this.view = new DataView(next.buffer)
  }

  bytes(): Uint8Array {
    return this.buf.subarray(0, this.pos)
  }

  u8(value: number): void {
    this.ensure(1)
    this.buf[this.pos++] = value
  }

  /** Unsigned LEB128 varint, for integers in [0, 2^53). */
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

  /** Zig-zag encoded signed varint. */
  svar(value: number): void {
    this.uvar(value >= 0 ? value * 2 : -value * 2 - 1)
  }

  f64(value: number): void {
    this.ensure(8)
    this.view.setFloat64(this.pos, value, true)
    this.pos += 8
  }

  f32(value: number): void {
    this.ensure(4)
    this.view.setFloat32(this.pos, value, true)
    this.pos += 4
  }

  str(value: string): void {
    const length = value.length

    if (length < 64) {
      this.ensure(length + 1)
      const buf = this.buf
      let pos = this.pos + 1
      let i = 0
      for (; i < length; i++) {
        const code = value.charCodeAt(i)
        if (code >= 0x80) {
          break
        }
        buf[pos++] = code
      }

      if (i === length) {
        buf[this.pos] = length
        this.pos = pos
        return
      }
    }

    // Encode past the widest possible length prefix, then move the bytes back next to the real prefix.
    this.ensure(5 + length * 3)
    const start = this.pos
    const { written } = textEncoder.encodeInto(value, this.buf.subarray(start + 5))
    this.uvar(written)
    if (this.pos !== start + 5) {
      this.buf.copyWithin(this.pos, start + 5, start + 5 + written)
    }
    this.pos += written
  }

  raw(bytes: Uint8Array): void {
    this.ensure(bytes.length)
    this.buf.set(bytes, this.pos)
    this.pos += bytes.length
  }
}

// ---------------------------------------------------------------------------------------------------------------
// ByteReader
// ---------------------------------------------------------------------------------------------------------------

export class ByteReader {
  public pos: number
  private readonly view: DataView

  constructor(
    public readonly buf: Uint8Array,
    pos = 0,
    public readonly end = buf.length
  ) {
    this.pos = pos
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }

  get done(): boolean {
    return this.pos >= this.end
  }

  private need(n: number): void {
    if (this.pos + n > this.end) {
      throw invalid('unexpected end of record')
    }
  }

  u8(): number {
    this.need(1)
    return this.buf[this.pos++]
  }

  uvar(): number {
    const buf = this.buf
    const end = this.end
    let pos = this.pos
    if (pos >= end) {
      throw invalid('unexpected end of record')
    }

    let byte = buf[pos++]
    if (byte < 128) {
      this.pos = pos
      return byte
    }

    let result = byte & 127
    let multiplier = 128
    for (let i = 1; i < 8; i++) {
      if (pos >= end) {
        throw invalid('unexpected end of record')
      }
      byte = buf[pos++]
      result += (byte & 127) * multiplier
      if (byte < 128) {
        this.pos = pos
        return result
      }
      multiplier *= 128
    }

    throw invalid('varint is too long')
  }

  /** Reads an element count and checks that `count * minSize` bytes are left. */
  count(minSize: number): number {
    const value = this.uvar()
    if (value * minSize > this.end - this.pos) {
      throw invalid('element count exceeds the record size')
    }
    return value
  }

  svar(): number {
    const value = this.uvar()
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2
  }

  f64(): number {
    this.need(8)
    const value = this.view.getFloat64(this.pos, true)
    this.pos += 8
    return value
  }

  f32(): number {
    this.need(4)
    const value = this.view.getFloat32(this.pos, true)
    this.pos += 4
    return value
  }

  str(): string {
    const length = this.uvar()
    this.need(length)
    const buf = this.buf
    const start = this.pos

    if (length < 24) {
      let out = ''
      let i = 0
      for (; i < length; i++) {
        const code = buf[start + i]
        if (code >= 0x80) {
          break
        }
        out += String.fromCharCode(code)
      }

      if (i === length) {
        this.pos += length
        return out
      }
    }

    this.pos += length
    return textDecoder.decode(buf.subarray(start, start + length))
  }

  raw(length: number): Uint8Array {
    this.need(length)
    const out = this.buf.subarray(this.pos, this.pos + length)
    this.pos += length
    return out
  }

  typed(code: number, length: number): BinarySnapshotArray {
    const array = createTypedArray(code, length)
    fillTypedArray(array, 0, this.raw(length * array.BYTES_PER_ELEMENT))
    return array
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tagged value encoding
//
// Encodes the JSON data model (with JSON's rules for `undefined`, functions and `toJSON`) plus typed arrays,
// Maps and Sets. Arrays of numbers are packed (varints, float32 when every value is exactly representable,
// float64 otherwise). Object keys go through a dictionary shared by the whole stream, and integer-like keys
// (document ids) are written as varints.
// ---------------------------------------------------------------------------------------------------------------

const T_NULL = 0
const T_UNDEFINED = 1
const T_FALSE = 2
const T_TRUE = 3
const T_UINT = 4
const T_NINT = 5
const T_F64 = 6
const T_STRING = 7
const T_ARRAY = 8
const T_OBJECT = 9
const T_UINT_ARRAY = 10
const T_SINT_ARRAY = 11
const T_F32_ARRAY = 12
const T_F64_ARRAY = 13
const T_TYPED = 14
const T_MAP = 15
const T_SET = 16

const MAX_DICTIONARY_KEYS = 65536

export class KeyDictionary {
  readonly keys: string[] = []
  readonly ids = new Map<string, number>()
}

export function isIndexKey(key: string): boolean {
  const length = key.length
  if (length === 0 || length > 15) {
    return false
  }

  const first = key.charCodeAt(0)
  if (first === 48) {
    return length === 1
  }

  for (let i = 0; i < length; i++) {
    const code = key.charCodeAt(i)
    if (code < 48 || code > 57) {
      return false
    }
  }

  return true
}

export function writeKey(w: ByteWriter, dict: KeyDictionary, key: string): void {
  const id = dict.ids.get(key)
  if (id !== undefined) {
    w.uvar(id + 2)
    return
  }

  if (isIndexKey(key)) {
    w.uvar(1)
    w.uvar(+key)
    return
  }

  w.uvar(0)
  w.str(key)
  if (dict.keys.length < MAX_DICTIONARY_KEYS) {
    dict.ids.set(key, dict.keys.length)
    dict.keys.push(key)
  }
}

export function readKey(r: ByteReader, dict: KeyDictionary): string {
  const ref = r.uvar()
  if (ref >= 2) {
    const key = dict.keys[ref - 2]
    if (key === undefined) {
      throw invalid('unknown key reference')
    }
    return key
  }

  if (ref === 1) {
    return String(r.uvar())
  }

  const key = r.str()
  if (dict.keys.length < MAX_DICTIONARY_KEYS) {
    dict.keys.push(key)
  }
  return key
}

/** Assigns a property like JSON.parse does, so a "__proto__" key stays an own property. */
export function setProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
    return
  }
  target[key] = value
}

function isSkipped(value: unknown): boolean {
  const type = typeof value
  return type === 'undefined' || type === 'function' || type === 'symbol'
}

export function isPlainContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  if (Array.isArray(value)) {
    return true
  }

  return (
    !ArrayBuffer.isView(value) &&
    !(value instanceof Map) &&
    !(value instanceof Set) &&
    typeof (value as { toJSON?: unknown }).toJSON !== 'function'
  )
}

function writeNumberArray(w: ByteWriter, value: unknown[]): boolean {
  const length = value.length
  let unsigned = true
  let integer = true
  let float32 = true
  let signedFits = true

  for (let i = 0; i < length; i++) {
    const item = value[i]
    if (typeof item !== 'number') {
      return false
    }

    if (integer && (!Number.isInteger(item) || item > MAX_SAFE || item < -MAX_SAFE || Object.is(item, -0))) {
      integer = false
      unsigned = false
    } else if (item < 0) {
      unsigned = false
    }

    // Zig-zag doubles the magnitude, so signed varints are only exact up to 2^52.
    if (integer && (item > MAX_ZIGZAG || item < -MAX_ZIGZAG)) {
      signedFits = false
    }

    // NaN is representable in float32 too.
    if (float32 && Math.fround(item) !== item && item === item) {
      float32 = false
    }
  }

  if (unsigned) {
    w.u8(T_UINT_ARRAY)
    w.uvar(length)
    for (let i = 0; i < length; i++) {
      w.uvar(value[i] as number)
    }
    return true
  }

  if (integer && signedFits) {
    w.u8(T_SINT_ARRAY)
    w.uvar(length)
    for (let i = 0; i < length; i++) {
      w.svar(value[i] as number)
    }
    return true
  }

  const size = float32 ? 4 : 8
  w.u8(float32 ? T_F32_ARRAY : T_F64_ARRAY)
  w.uvar(length)
  w.ensure(length * size)
  const view = w.view
  let pos = w.pos
  if (float32) {
    for (let i = 0; i < length; i++, pos += 4) {
      view.setFloat32(pos, value[i] as number, true)
    }
  } else {
    for (let i = 0; i < length; i++, pos += 8) {
      view.setFloat64(pos, value[i] as number, true)
    }
  }
  w.pos = pos
  return true
}

export function encodeValue(w: ByteWriter, dict: KeyDictionary, value: unknown): void {
  switch (typeof value) {
    case 'string':
      w.u8(T_STRING)
      w.str(value)
      return
    case 'number':
      if (Number.isInteger(value) && !Object.is(value, -0) && value <= MAX_SAFE && value >= -MAX_SAFE) {
        if (value >= 0) {
          w.u8(T_UINT)
          w.uvar(value)
        } else {
          w.u8(T_NINT)
          w.uvar(-value)
        }
        return
      }
      w.u8(T_F64)
      w.f64(value)
      return
    case 'boolean':
      w.u8(value ? T_TRUE : T_FALSE)
      return
    case 'bigint':
      throw new TypeError('Do not know how to serialize a BigInt')
    case 'object':
      break
    default:
      w.u8(T_UNDEFINED)
      return
  }

  if (value === null) {
    w.u8(T_NULL)
    return
  }

  if (Array.isArray(value)) {
    const length = value.length
    if (length > 1 && typeof value[0] === 'number') {
      const start = w.pos
      if (writeNumberArray(w, value)) {
        return
      }
      w.pos = start
    }

    w.u8(T_ARRAY)
    w.uvar(length)
    for (let i = 0; i < length; i++) {
      const item = value[i]
      if (isSkipped(item)) {
        w.u8(T_NULL)
      } else {
        encodeValue(w, dict, item)
      }
    }
    return
  }

  if (ArrayBuffer.isView(value)) {
    const code = typedArrayCode(value)
    if (code === 0) {
      // DataView and BigInt arrays: follow JSON, which sees them as plain objects.
      encodeObject(w, dict, value as unknown as Record<string, unknown>)
      return
    }

    const array = value as BinarySnapshotArray
    w.u8(T_TYPED)
    w.u8(code)
    w.uvar(array.length)
    w.raw(typedArrayBytes(array))
    return
  }

  if (value instanceof Map) {
    w.u8(T_MAP)
    w.uvar(value.size)
    for (const [key, item] of value) {
      encodeValue(w, dict, key)
      encodeValue(w, dict, item)
    }
    return
  }

  if (value instanceof Set) {
    w.u8(T_SET)
    w.uvar(value.size)
    for (const item of value) {
      encodeValue(w, dict, item)
    }
    return
  }

  const toJSON = (value as { toJSON?: unknown }).toJSON
  if (typeof toJSON === 'function') {
    encodeValue(w, dict, toJSON.call(value))
    return
  }

  encodeObject(w, dict, value as Record<string, unknown>)
}

function encodeObject(w: ByteWriter, dict: KeyDictionary, value: Record<string, unknown>): void {
  const keys = Object.keys(value)
  let count = 0
  for (let i = 0; i < keys.length; i++) {
    if (!isSkipped(value[keys[i]])) {
      count++
    }
  }

  w.u8(T_OBJECT)
  w.uvar(count)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const item = value[key]
    if (isSkipped(item)) {
      continue
    }
    writeKey(w, dict, key)
    encodeValue(w, dict, item)
  }
}

export function decodeValue(r: ByteReader, dict: KeyDictionary): unknown {
  const tag = r.u8()

  switch (tag) {
    case T_NULL:
      return null
    case T_UNDEFINED:
      return undefined
    case T_FALSE:
      return false
    case T_TRUE:
      return true
    case T_UINT:
      return r.uvar()
    case T_NINT:
      return -r.uvar()
    case T_F64:
      return r.f64()
    case T_STRING:
      return r.str()
    case T_ARRAY: {
      const length = r.count(1)
      const out = new Array(length)
      for (let i = 0; i < length; i++) {
        out[i] = decodeValue(r, dict)
      }
      return out
    }
    case T_OBJECT: {
      const count = r.count(2)
      const out: Record<string, unknown> = {}
      for (let i = 0; i < count; i++) {
        const key = readKey(r, dict)
        setProperty(out, key, decodeValue(r, dict))
      }
      return out
    }
    case T_UINT_ARRAY: {
      const length = r.count(1)
      const out = new Array<number>(length)
      for (let i = 0; i < length; i++) {
        out[i] = r.uvar()
      }
      return out
    }
    case T_SINT_ARRAY: {
      const length = r.count(1)
      const out = new Array<number>(length)
      for (let i = 0; i < length; i++) {
        out[i] = r.svar()
      }
      return out
    }
    case T_F32_ARRAY: {
      const length = r.count(4)
      const out = new Array<number>(length)
      for (let i = 0; i < length; i++) {
        out[i] = r.f32()
      }
      return out
    }
    case T_F64_ARRAY: {
      const length = r.count(8)
      const out = new Array<number>(length)
      for (let i = 0; i < length; i++) {
        out[i] = r.f64()
      }
      return out
    }
    case T_TYPED: {
      const code = r.u8()
      return r.typed(code, r.uvar())
    }
    case T_MAP: {
      const size = r.count(2)
      const out = new Map()
      for (let i = 0; i < size; i++) {
        const key = decodeValue(r, dict)
        out.set(key, decodeValue(r, dict))
      }
      return out
    }
    case T_SET: {
      const size = r.count(1)
      const out = new Set()
      for (let i = 0; i < size; i++) {
        out.add(decodeValue(r, dict))
      }
      return out
    }
    default:
      throw invalid(`unknown value tag ${tag}`)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Size estimation
// ---------------------------------------------------------------------------------------------------------------

function numberLength(value: number): number {
  if (Number.isInteger(value) && value < 1e15 && value > -1e15) {
    let digits = value < 0 ? 2 : 1
    let rest = Math.abs(value)
    while (rest >= 10) {
      rest = Math.floor(rest / 10)
      digits++
    }
    return digits
  }

  return 22
}

/**
 * Estimates the JSON length of `value` by walking it, without serializing it. The walk stops as soon as the
 * estimate passes `limit`, so measuring a huge structure only costs about `limit` worth of work: the result is
 * then some number greater than `limit`. Strings are counted without escapes and non-integers as 22 characters,
 * so this is an estimate, not an exact length.
 */
export function estimateJsonLength(value: unknown, limit: number): number {
  return measure(value, 0, limit)
}

function measure(value: unknown, total: number, limit: number): number {
  switch (typeof value) {
    case 'string':
      return total + value.length + 2
    case 'number':
      return total + numberLength(value)
    case 'boolean':
      return total + 5
    case 'object':
      break
    default:
      return total
  }

  if (value === null) {
    return total + 4
  }

  if (Array.isArray(value)) {
    total += 2
    for (let i = 0; i < value.length; i++) {
      total = measure(value[i], total + 1, limit)
      if (total > limit) {
        return total
      }
    }
    return total
  }

  if (ArrayBuffer.isView(value)) {
    return total + 2 + value.byteLength * 3
  }

  if (value instanceof Map || value instanceof Set) {
    total += 2
    for (const item of value) {
      total = measure(item, total + 1, limit)
      if (total > limit) {
        return total
      }
    }
    return total
  }

  const toJSON = (value as { toJSON?: unknown }).toJSON
  if (typeof toJSON === 'function') {
    return measure(toJSON.call(value), total, limit)
  }

  total += 2
  for (const key in value) {
    if (!Object.hasOwn(value, key)) {
      continue
    }
    const item = (value as Record<string, unknown>)[key]
    if (isSkipped(item)) {
      continue
    }
    total = measure(item, total + key.length + 4, limit)
    if (total > limit) {
      return total
    }
  }
  return total
}
