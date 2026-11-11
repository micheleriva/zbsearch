import { base64ToBytes } from 'zbsearch/trees/vector-flat'
import { WASM_BASE64 } from './wasm-binary.js'

interface VectorQuantizerExports {
  memory: WebAssembly.Memory
  vq_alloc(bytes: number): number
  vq_free(ptr: number, bytes: number): void
  vq_error_ptr(): number
  vq_error_len(): number
  vq_pq_fit(data: number, n: number, dim: number, m: number, ks: number, iterations: number, seed: number): number
  vq_pq_from_codewords(codewords: number, m: number, ks: number, width: number, dim: number): number
  vq_pq_codewords_len(handle: number): number
  vq_pq_width(handle: number): number
  vq_pq_codewords(handle: number, out: number): number
  vq_pq_encode(handle: number, data: number, n: number, out: number): number
  vq_pq_decode(handle: number, codes: number, n: number, out: number): number
  vq_pq_drop(handle: number): void
}

export interface TrainedCodebook {
  handle: number
  codewords: Float32Array
  width: number
}

/**
 * Thin wrapper over the WebAssembly build of vector_quantizer's product quantizer. The module has no imports, so it
 * instantiates the same way in browsers, Node.js, Deno, workers and Gecko (Zotero) without bundler configuration.
 */
export class VectorQuantizerWasm {
  private readonly exports: VectorQuantizerExports
  private readonly registry: FinalizationRegistry<number> | undefined

  constructor(instance: WebAssembly.Instance) {
    this.exports = instance.exports as unknown as VectorQuantizerExports
    this.registry =
      typeof FinalizationRegistry === 'function'
        ? new FinalizationRegistry((handle: number) => this.exports.vq_pq_drop(handle))
        : undefined
  }

  /** Frees the model `handle` once `owner` is garbage collected. Returns the token to pass to `release`. */
  track(owner: object, handle: number): object {
    const token = {}
    this.registry?.register(owner, handle, token)
    return token
  }

  /** Frees the model `handle` now. */
  release(handle: number, token?: object) {
    if (token) {
      this.registry?.unregister(token)
    }
    this.exports.vq_pq_drop(handle)
  }

  private check(result: number): number {
    if (result >= 0) {
      return result
    }
    const ptr = this.exports.vq_error_ptr()
    const len = this.exports.vq_error_len()
    const bytes = new Uint8Array(this.exports.memory.buffer, ptr, len)
    let message = ''
    for (let i = 0; i < bytes.length; i++) {
      message += String.fromCharCode(bytes[i]!)
    }
    throw new Error(`vector_quantizer: ${message}`)
  }

  private withBuffer<T>(bytes: number, run: (ptr: number) => T): T {
    const ptr = this.exports.vq_alloc(bytes)
    try {
      return run(ptr)
    } finally {
      this.exports.vq_free(ptr, bytes)
    }
  }

  private writeFloats(ptr: number, values: Float32Array) {
    new Float32Array(this.exports.memory.buffer, ptr, values.length).set(values)
  }

  private readCodebook(handle: number): TrainedCodebook {
    const length = this.check(this.exports.vq_pq_codewords_len(handle))
    const width = this.check(this.exports.vq_pq_width(handle))
    const codewords = this.withBuffer(length * 4, (out) => {
      this.check(this.exports.vq_pq_codewords(handle, out))
      return new Float32Array(this.exports.memory.buffer, out, length).slice()
    })
    return { handle, codewords, width }
  }

  /** Trains a product quantizer on `n` row-major vectors (`data.length === n * dim`). */
  fit(data: Float32Array, n: number, dim: number, m: number, ks: number, iterations: number, seed: number) {
    return this.withBuffer(data.byteLength, (ptr) => {
      this.writeFloats(ptr, data)
      const handle = this.check(this.exports.vq_pq_fit(ptr, n, dim, m, ks, iterations, seed >>> 0))
      return this.readCodebook(handle)
    })
  }

  /** Loads a trained codebook of shape (m, ks, width) and returns its model handle. */
  load(codewords: Float32Array, m: number, ks: number, width: number, dim: number): number {
    return this.withBuffer(codewords.byteLength, (ptr) => {
      this.writeFloats(ptr, codewords)
      return this.check(this.exports.vq_pq_from_codewords(ptr, m, ks, width, dim))
    })
  }

  /** Encodes `n` row-major vectors into `n * m` byte codes. */
  encode(handle: number, data: Float32Array, n: number, m: number): Uint8Array {
    return this.withBuffer(data.byteLength, (input) =>
      this.withBuffer(n * m, (out) => {
        this.writeFloats(input, data)
        this.check(this.exports.vq_pq_encode(handle, input, n, out))
        return new Uint8Array(this.exports.memory.buffer, out, n * m).slice()
      })
    )
  }

  /** Decodes `n * m` byte codes into `n * dim` floats. */
  decode(handle: number, codes: Uint8Array, n: number, dim: number): Float32Array {
    return this.withBuffer(codes.byteLength, (input) =>
      this.withBuffer(n * dim * 4, (out) => {
        new Uint8Array(this.exports.memory.buffer, input, codes.length).set(codes)
        this.check(this.exports.vq_pq_decode(handle, input, n, out))
        return new Float32Array(this.exports.memory.buffer, out, n * dim).slice()
      })
    )
  }
}

let wasmBytes: Uint8Array | undefined
let shared: VectorQuantizerWasm | undefined
let pending: Promise<VectorQuantizerWasm> | undefined

function bytes(): Uint8Array {
  wasmBytes ??= base64ToBytes(WASM_BASE64)
  return wasmBytes
}

/** Compiles and instantiates the WebAssembly module asynchronously (works on every engine's main thread). */
export function loadVectorQuantizerWasm(): Promise<VectorQuantizerWasm> {
  if (shared) {
    return Promise.resolve(shared)
  }
  pending ??= (async () => {
    const module = await WebAssembly.compile(bytes() as Uint8Array<ArrayBuffer>)
    const instance = await WebAssembly.instantiate(module, {})
    shared ??= new VectorQuantizerWasm(instance)
    return shared
  })()
  return pending
}

/**
 * Compiles and instantiates the module synchronously. Fine in Node.js, Deno, workers and privileged Gecko code;
 * browsers may refuse synchronous compilation of large modules on the main thread, so prefer the async loader there.
 */
export function loadVectorQuantizerWasmSync(): VectorQuantizerWasm {
  shared ??= new VectorQuantizerWasm(
    new WebAssembly.Instance(new WebAssembly.Module(bytes() as Uint8Array<ArrayBuffer>), {})
  )
  return shared
}
