/**
 * Vector quantization primitives shared by the flat and IVF vector indexes.
 *
 * A quantizer turns a normalized float32 vector into a fixed number of bytes ("code") and scores a prepared query
 * against a code. Codes live in one contiguous buffer per index (see `CodeBuffer`), so a quantized index costs
 * `codeSize` bytes per vector plus a small id map, instead of one Float32Array object per vector.
 *
 * Built-in quantizers:
 * - `float32`: full precision, 4 bytes per dimension. Used for rescoring.
 * - `int8`: per-vector affine quantization (scale + offset), 1 byte per dimension plus 8 bytes.
 * - `binary`: one sign bit per dimension packed in 32-bit words, scored with Hamming distance.
 *
 * Plugins can provide their own quantizer (for example product quantization) by implementing
 * `VectorQuantizerFactory`.
 */

export type SnapshotTypedArray = Float32Array | Float64Array | Int8Array | Uint8Array | Int32Array | Uint32Array

/**
 * The binary snapshot contract shared by every vector index and quantizer: a small JSON-serializable `meta` object
 * and a set of named typed arrays holding the bulk data. Typed arrays are stored in platform byte order (little
 * endian on every engine zbsearch supports).
 */
export interface VectorBinarySnapshot {
  meta: Record<string, unknown>
  arrays: Record<string, SnapshotTypedArray>
}

/**
 * Views over the single ArrayBuffer that holds the encoded vectors of an index. Every code starts at a byte offset
 * that is a multiple of 4, so quantizers can read and write 32-bit words and floats at `offset >> 2`.
 */
export interface CodeBuffer {
  readonly u8: Uint8Array
  readonly i8: Int8Array
  readonly u32: Uint32Array
  readonly f32: Float32Array
}

/**
 * A vector quantizer for one vector property. Every vector passed to it has already been L2 normalized by the index,
 * so `score` should estimate the cosine similarity (a dot product) between the query and the encoded vector.
 */
export interface VectorQuantizer<PreparedQuery = unknown> {
  /** Identifier used to find the factory that restores this quantizer from a snapshot. */
  readonly kind: string
  /** Number of dimensions of the vectors. */
  readonly dim: number
  /** Bytes used by one encoded vector. The index pads it to a multiple of 4. Must not change after creation. */
  readonly codeSize: number
  /** False while the quantizer still needs `fit()`. The index keeps raw vectors until then. */
  readonly ready: boolean
  /** Number of vectors to collect before calling `fit()`. Only read when `ready` is false. */
  readonly trainingSize?: number
  /** Train the quantizer. Called once with at least `trainingSize` vectors (or when the user asks for a refit). */
  fit?(vectors: Float32Array[]): void
  /** Encode `vector` into `codes` starting at byte `offset`, writing exactly `codeSize` bytes. */
  encode(vector: Float32Array, codes: CodeBuffer, offset: number): void
  /** Precompute whatever `score` needs for a normalized query (lookup tables, packed bits, sums...). */
  prepareQuery(query: Float32Array): PreparedQuery
  /** Estimated cosine similarity between the prepared query and the code at byte `offset`. */
  score(query: PreparedQuery, codes: CodeBuffer, offset: number): number
  /** Approximate reconstruction of the code at `offset` into `out`. Used to re-encode after a refit. */
  decode?(codes: CodeBuffer, offset: number, out: Float32Array): void
  /** Serialize the trained state (codebooks, parameters). Codes themselves are stored by the index. */
  toSnapshot(): VectorBinarySnapshot
}

export interface VectorQuantizerFactory {
  readonly kind: string
  create(dim: number): VectorQuantizer
  fromSnapshot(snapshot: VectorBinarySnapshot): VectorQuantizer
}

export type BuiltinQuantization = 'none' | 'int8' | 'binary'

export type QuantizationOption = BuiltinQuantization | VectorQuantizerFactory

export type RescoreOption = 'none' | 'int8' | 'float32'

export interface QuantizationOptions {
  /** How vectors are stored. Defaults to `'none'` (float32). */
  quantization?: QuantizationOption
  /**
   * Keep a second, more precise copy of each vector to rescore the best candidates found with the quantized codes.
   * Defaults to `'none'`.
   */
  rescore?: RescoreOption
  /**
   * With `rescore`, how many candidates per requested result are rescored (`limit * oversample`). Defaults to 10.
   */
  oversample?: number
  /**
   * With `rescore`, when the caller gives no result limit, candidates whose quantized score is at least
   * `similarity - rescoreMargin` are rescored. Defaults to 0.15.
   */
  rescoreMargin?: number
}

function align4(bytes: number): number {
  return (bytes + 3) & ~3
}

export function createCodeBuffer(byteLength: number): CodeBuffer {
  const buffer = new ArrayBuffer(align4(byteLength))
  return {
    u8: new Uint8Array(buffer),
    i8: new Int8Array(buffer),
    u32: new Uint32Array(buffer),
    f32: new Float32Array(buffer)
  }
}

export function codeStride(quantizer: VectorQuantizer): number {
  return align4(quantizer.codeSize)
}

function clampSimilarity(value: number): number {
  return value > 1 ? 1 : value < -1 ? -1 : value
}

// ---------------------------------------------------------------------------------------------------------------
// float32
// ---------------------------------------------------------------------------------------------------------------

export class Float32Quantizer implements VectorQuantizer<Float32Array> {
  readonly kind = 'float32'
  readonly ready = true
  readonly codeSize: number

  constructor(readonly dim: number) {
    this.codeSize = dim * 4
  }

  encode(vector: Float32Array, codes: CodeBuffer, offset: number): void {
    codes.f32.set(vector.subarray(0, this.dim), offset >> 2)
  }

  prepareQuery(query: Float32Array): Float32Array {
    return query
  }

  score(query: Float32Array, codes: CodeBuffer, offset: number): number {
    const f32 = codes.f32
    const base = offset >> 2
    const dim = this.dim
    let sum = 0
    let i = 0
    for (; i < dim - 3; i += 4) {
      sum +=
        query[i]! * f32[base + i]! +
        query[i + 1]! * f32[base + i + 1]! +
        query[i + 2]! * f32[base + i + 2]! +
        query[i + 3]! * f32[base + i + 3]!
    }
    for (; i < dim; i++) {
      sum += query[i]! * f32[base + i]!
    }
    return clampSimilarity(sum)
  }

  decode(codes: CodeBuffer, offset: number, out: Float32Array): void {
    const base = offset >> 2
    out.set(codes.f32.subarray(base, base + this.dim))
  }

  toSnapshot(): VectorBinarySnapshot {
    return { meta: { kind: this.kind, dim: this.dim }, arrays: {} }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// int8
// ---------------------------------------------------------------------------------------------------------------

/**
 * Per-vector affine int8 quantization: `x[i] ≈ scale * q[i] + offset` with `q[i]` in [-128, 127].
 *
 * Per-vector parameters (rather than per-dimension ones) need no training and stay correct when the data drifts,
 * which suits an index that accepts inserts at any time. For L2 normalized embeddings the per-vector range is
 * narrow, so the step is about 1/255 of it and the dot-product error is far below typical similarity gaps.
 *
 * The query stays in float32 (asymmetric scoring): `q · x ≈ scale * Σ q[i] * code[i] + offset * Σ q[i]`.
 */
export class Int8Quantizer implements VectorQuantizer<{ vector: Float32Array; sum: number }> {
  readonly kind = 'int8'
  readonly ready = true
  readonly codeSize: number
  private readonly paramsOffset: number

  constructor(readonly dim: number) {
    this.paramsOffset = align4(dim)
    this.codeSize = this.paramsOffset + 8
  }

  encode(vector: Float32Array, codes: CodeBuffer, offset: number): void {
    const dim = this.dim
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < dim; i++) {
      const value = vector[i]!
      if (value < min) min = value
      if (value > max) max = value
    }

    const i8 = codes.i8
    const scale = max > min ? (max - min) / 255 : 0
    const inv = scale > 0 ? 1 / scale : 0
    for (let i = 0; i < dim; i++) {
      let q = Math.round((vector[i]! - min) * inv) - 128
      if (q > 127) q = 127
      else if (q < -128) q = -128
      i8[offset + i] = q
    }

    const params = (offset + this.paramsOffset) >> 2
    codes.f32[params] = scale
    codes.f32[params + 1] = min + 128 * scale
  }

  prepareQuery(query: Float32Array): { vector: Float32Array; sum: number } {
    let sum = 0
    for (let i = 0; i < this.dim; i++) {
      sum += query[i]!
    }
    return { vector: query, sum }
  }

  score(query: { vector: Float32Array; sum: number }, codes: CodeBuffer, offset: number): number {
    const q = query.vector
    const i8 = codes.i8
    const dim = this.dim
    let dot = 0
    let i = 0
    for (; i < dim - 3; i += 4) {
      dot +=
        q[i]! * i8[offset + i]! +
        q[i + 1]! * i8[offset + i + 1]! +
        q[i + 2]! * i8[offset + i + 2]! +
        q[i + 3]! * i8[offset + i + 3]!
    }
    for (; i < dim; i++) {
      dot += q[i]! * i8[offset + i]!
    }

    const params = (offset + this.paramsOffset) >> 2
    return clampSimilarity(codes.f32[params]! * dot + codes.f32[params + 1]! * query.sum)
  }

  decode(codes: CodeBuffer, offset: number, out: Float32Array): void {
    const params = (offset + this.paramsOffset) >> 2
    const scale = codes.f32[params]!
    const shift = codes.f32[params + 1]!
    for (let i = 0; i < this.dim; i++) {
      out[i] = scale * codes.i8[offset + i]! + shift
    }
  }

  toSnapshot(): VectorBinarySnapshot {
    return { meta: { kind: this.kind, dim: this.dim }, arrays: {} }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// binary
// ---------------------------------------------------------------------------------------------------------------

function popcount32(value: number): number {
  value = value - ((value >>> 1) & 0x55555555)
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333)
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/**
 * Sign-bit quantization: bit `i` is set when `x[i] > 0`, packed in 32-bit words (32x smaller than float32).
 *
 * The score is the angle estimate of random-hyperplane hashing, `cos(π · hamming / dim)`, so it is monotonic in
 * the Hamming distance and roughly on the cosine scale used by `similarity`. Use `rescore: 'int8' | 'float32'` to
 * rescore the best Hamming candidates exactly.
 */
export class BinaryQuantizer implements VectorQuantizer<Uint32Array> {
  readonly kind = 'binary'
  readonly ready = true
  readonly codeSize: number
  private readonly words: number

  constructor(readonly dim: number) {
    this.words = Math.ceil(dim / 32)
    this.codeSize = this.words * 4
  }

  private pack(vector: Float32Array, out: Uint32Array, base: number): void {
    for (let w = 0; w < this.words; w++) {
      let word = 0
      const start = w * 32
      const end = Math.min(start + 32, this.dim)
      for (let i = start; i < end; i++) {
        if (vector[i]! > 0) {
          word |= 1 << (i - start)
        }
      }
      out[base + w] = word >>> 0
    }
  }

  encode(vector: Float32Array, codes: CodeBuffer, offset: number): void {
    this.pack(vector, codes.u32, offset >> 2)
  }

  prepareQuery(query: Float32Array): Uint32Array {
    const packed = new Uint32Array(this.words)
    this.pack(query, packed, 0)
    return packed
  }

  hamming(query: Uint32Array, codes: CodeBuffer, offset: number): number {
    const u32 = codes.u32
    const base = offset >> 2
    let distance = 0
    for (let w = 0; w < this.words; w++) {
      distance += popcount32((query[w]! ^ u32[base + w]!) >>> 0)
    }
    return distance
  }

  score(query: Uint32Array, codes: CodeBuffer, offset: number): number {
    return Math.cos((Math.PI * this.hamming(query, codes, offset)) / this.dim)
  }

  decode(codes: CodeBuffer, offset: number, out: Float32Array): void {
    const base = offset >> 2
    const value = 1 / Math.sqrt(this.dim)
    for (let i = 0; i < this.dim; i++) {
      const word = codes.u32[base + (i >>> 5)]!
      out[i] = (word >>> (i & 31)) & 1 ? value : -value
    }
  }

  toSnapshot(): VectorBinarySnapshot {
    return { meta: { kind: this.kind, dim: this.dim }, arrays: {} }
  }
}

function builtinFactory(kind: string, create: (dim: number) => VectorQuantizer): VectorQuantizerFactory {
  return {
    kind,
    create,
    fromSnapshot: (snapshot) => create(Number(snapshot.meta.dim))
  }
}

export const float32Quantizer: VectorQuantizerFactory = builtinFactory('float32', (dim) => new Float32Quantizer(dim))
export const int8Quantizer: VectorQuantizerFactory = builtinFactory('int8', (dim) => new Int8Quantizer(dim))
export const binaryQuantizer: VectorQuantizerFactory = builtinFactory('binary', (dim) => new BinaryQuantizer(dim))

export const builtinQuantizers: Record<string, VectorQuantizerFactory> = {
  float32: float32Quantizer,
  int8: int8Quantizer,
  binary: binaryQuantizer
}

/** Resolves the `quantization` option. Returns `undefined` for `'none'`. */
export function resolveQuantizer(option: QuantizationOption | undefined): VectorQuantizerFactory | undefined {
  if (option === undefined || option === 'none') {
    return undefined
  }

  if (typeof option === 'string') {
    const factory = option === ('float32' as string) ? undefined : builtinQuantizers[option]
    if (!factory) {
      throw new Error(`Unknown vector quantization "${option}". Expected "none", "int8", "binary" or a quantizer.`)
    }
    return factory
  }

  if (typeof option.create !== 'function' || typeof option.fromSnapshot !== 'function' || !option.kind) {
    throw new Error('A custom vector quantizer must have a kind and implement create() and fromSnapshot().')
  }

  return option
}

export function resolveRescore(option: RescoreOption | undefined): VectorQuantizerFactory | undefined {
  if (option === undefined || option === 'none') {
    return undefined
  }

  if (option === 'int8' || option === 'float32') {
    return builtinQuantizers[option]
  }

  throw new Error(`Unknown vector rescore option "${option}". Expected "none", "int8" or "float32".`)
}

// ---------------------------------------------------------------------------------------------------------------
// JSON encoding of binary snapshots
// ---------------------------------------------------------------------------------------------------------------

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_LOOKUP = /* @__PURE__ */ (() => {
  const lookup = new Uint8Array(128)
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    lookup[BASE64_ALPHABET.charCodeAt(i)] = i
  }
  return lookup
})()

/** Base64 without depending on `Buffer` or `btoa`, so it runs in browsers, Node, Deno and Gecko. */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  const chunkSize = 3 * 8192
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, bytes.length)
    let out = ''
    let i = start
    for (; i + 2 < end; i += 3) {
      const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!
      out +=
        BASE64_ALPHABET[n >>> 18]! +
        BASE64_ALPHABET[(n >>> 12) & 63]! +
        BASE64_ALPHABET[(n >>> 6) & 63]! +
        BASE64_ALPHABET[n & 63]!
    }
    const rest = end - i
    if (rest === 1) {
      const n = bytes[i]! << 16
      out += BASE64_ALPHABET[n >>> 18]! + BASE64_ALPHABET[(n >>> 12) & 63]! + '=='
    } else if (rest === 2) {
      const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8)
      out += BASE64_ALPHABET[n >>> 18]! + BASE64_ALPHABET[(n >>> 12) & 63]! + BASE64_ALPHABET[(n >>> 6) & 63]! + '='
    }
    chunks.push(out)
  }
  return chunks.join('')
}

export function base64ToBytes(text: string): Uint8Array {
  let length = text.length
  while (length > 0 && text[length - 1] === '=') {
    length--
  }
  const out = new Uint8Array(Math.floor((length * 3) / 4))
  let o = 0
  let i = 0
  for (; i + 3 < length; i += 4) {
    const n =
      (BASE64_LOOKUP[text.charCodeAt(i)]! << 18) |
      (BASE64_LOOKUP[text.charCodeAt(i + 1)]! << 12) |
      (BASE64_LOOKUP[text.charCodeAt(i + 2)]! << 6) |
      BASE64_LOOKUP[text.charCodeAt(i + 3)]!
    out[o++] = n >>> 16
    out[o++] = (n >>> 8) & 255
    out[o++] = n & 255
  }
  const rest = length - i
  if (rest >= 2) {
    const n = (BASE64_LOOKUP[text.charCodeAt(i)]! << 18) | (BASE64_LOOKUP[text.charCodeAt(i + 1)]! << 12)
    out[o++] = n >>> 16
    if (rest === 3) {
      out[o++] = ((n | (BASE64_LOOKUP[text.charCodeAt(i + 2)]! << 6)) >>> 8) & 255
    }
  }
  return out
}

const TYPED_ARRAYS = {
  Float32Array,
  Float64Array,
  Int8Array,
  Uint8Array,
  Int32Array,
  Uint32Array
} as const

type TypedArrayName = keyof typeof TYPED_ARRAYS

export interface EncodedTypedArray {
  type: TypedArrayName
  base64: string
}

export interface VectorSnapshotJSON {
  meta: Record<string, unknown>
  arrays: Record<string, EncodedTypedArray>
}

function typedArrayName(array: SnapshotTypedArray): TypedArrayName {
  for (const name of Object.keys(TYPED_ARRAYS) as TypedArrayName[]) {
    if (array instanceof TYPED_ARRAYS[name]) {
      return name
    }
  }
  throw new Error('Unsupported typed array in vector snapshot.')
}

export function snapshotToJSON(snapshot: VectorBinarySnapshot): VectorSnapshotJSON {
  const arrays: Record<string, EncodedTypedArray> = {}
  for (const [name, array] of Object.entries(snapshot.arrays)) {
    arrays[name] = {
      type: typedArrayName(array),
      base64: bytesToBase64(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
    }
  }
  return { meta: snapshot.meta, arrays }
}

export function snapshotFromJSON(json: VectorSnapshotJSON): VectorBinarySnapshot {
  const arrays: Record<string, SnapshotTypedArray> = {}
  for (const [name, encoded] of Object.entries(json.arrays)) {
    const Ctor = TYPED_ARRAYS[encoded.type] as unknown as new (
      buffer: ArrayBufferLike,
      byteOffset: number,
      length: number
    ) => SnapshotTypedArray
    if (!Ctor) {
      throw new Error(`Unsupported typed array "${encoded.type}" in vector snapshot.`)
    }
    const bytes = base64ToBytes(encoded.base64)
    const elementSize = TYPED_ARRAYS[encoded.type].BYTES_PER_ELEMENT
    // base64ToBytes returns a fresh, zero-offset buffer, so it is aligned for every element size.
    arrays[name] = new Ctor(bytes.buffer, 0, bytes.byteLength / elementSize)
  }
  return { meta: json.meta, arrays }
}

/** Prefixes the arrays of a nested snapshot, e.g. a quantizer inside an index snapshot. */
export function prefixArrays(prefix: string, arrays: Record<string, SnapshotTypedArray>) {
  const out: Record<string, SnapshotTypedArray> = {}
  for (const [name, array] of Object.entries(arrays)) {
    out[`${prefix}${name}`] = array
  }
  return out
}

export function unprefixArrays(prefix: string, arrays: Record<string, SnapshotTypedArray>) {
  const out: Record<string, SnapshotTypedArray> = {}
  for (const [name, array] of Object.entries(arrays)) {
    if (name.startsWith(prefix)) {
      out[name.slice(prefix.length)] = array
    }
  }
  return out
}
