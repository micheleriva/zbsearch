import type { AnyZBSearch, CodeBuffer, VectorBinarySnapshot, VectorQuantizer, VectorQuantizerFactory } from 'zbsearch'
import { loadVectorQuantizerWasm, loadVectorQuantizerWasmSync, type VectorQuantizerWasm } from './wasm.js'

export { loadVectorQuantizerWasm, loadVectorQuantizerWasmSync, VectorQuantizerWasm } from './wasm.js'

export const PQ_KIND = 'pq'

export interface PQOptions {
  /** Number of subspaces, i.e. bytes per vector. Defaults to `dim / 8` (8 dimensions per subspace). */
  m?: number
  /** Centroids per subspace, at most 256 (codes are bytes). Defaults to 256. */
  ks?: number
  /** k-means iterations per subspace. Defaults to 12. */
  iterations?: number
  /**
   * Vectors collected before the quantizer is trained. Until then the index keeps them as float32 and searches them
   * exactly. Defaults to `max(4 * ks, 1024)`.
   */
  trainingSize?: number
  /** Upper bound on the vectors used by one fit (evenly sampled). Defaults to `max(trainingSize, 4096)`. */
  maxTrainingSize?: number
  /** Seed of the k-means initialisation, so fits are reproducible. Defaults to 42. */
  seed?: number
}

interface ResolvedPQOptions {
  m: number
  ks: number
  iterations: number
  trainingSize: number
  maxTrainingSize: number
  seed: number
}

function resolveOptions(dim: number, options: PQOptions): ResolvedPQOptions {
  const m = options.m ?? Math.max(1, Math.round(dim / 8))
  const ks = options.ks ?? 256
  if (!Number.isInteger(m) || m < 1 || m > dim) {
    throw new Error(`pq: m must be an integer between 1 and the vector size (${dim}), got ${m}.`)
  }
  if (!Number.isInteger(ks) || ks < 2 || ks > 256) {
    throw new Error(`pq: ks must be an integer between 2 and 256, got ${ks}.`)
  }
  const trainingSize = Math.max(options.trainingSize ?? Math.max(4 * ks, 1024), ks)
  return {
    m,
    ks,
    iterations: options.iterations ?? 12,
    trainingSize,
    maxTrainingSize: Math.max(options.maxTrainingSize ?? Math.max(trainingSize, 4096), trainingSize),
    seed: options.seed ?? 42
  }
}

function align4(bytes: number): number {
  return (bytes + 3) & ~3
}

/**
 * Product quantizer backed by the WebAssembly build of vector_quantizer.
 *
 * Each vector is split into `m` subspaces; every subspace is replaced by the index of its nearest centroid among
 * `ks` (one byte). Queries are scored with asymmetric distance computation: a `m × ks` table of query-centroid dot
 * products is built once per query, then each code is scored with `m` table lookups. The score is divided by the
 * norm of the reconstructed vector, so it estimates the cosine similarity used by zbsearch.
 *
 * Code layout: `m` code bytes, padding to 4 bytes, then the float32 inverse norm of the reconstruction.
 */
export class ProductQuantizer implements VectorQuantizer<Float32Array> {
  readonly kind = PQ_KIND
  readonly codeSize: number
  readonly m: number
  readonly ks: number
  readonly iterations: number
  readonly trainingSize: number
  readonly maxTrainingSize: number
  readonly seed: number

  private codewords: Float32Array | undefined
  private width = 0
  private handle: number | undefined
  private handleToken: object | undefined
  private readonly offsets: Int32Array
  private readonly normOffset: number
  private codewordNorms: Float32Array | undefined

  constructor(
    readonly dim: number,
    options: PQOptions,
    private readonly wasm: VectorQuantizerWasm
  ) {
    const resolved = resolveOptions(dim, options)
    this.m = resolved.m
    this.ks = resolved.ks
    this.iterations = resolved.iterations
    this.trainingSize = resolved.trainingSize
    this.maxTrainingSize = resolved.maxTrainingSize
    this.seed = resolved.seed
    this.normOffset = align4(this.m)
    this.codeSize = this.normOffset + 4

    // Same split as vector_quantizer: the first `dim % m` subspaces get one extra dimension.
    this.offsets = new Int32Array(this.m + 1)
    const quotient = Math.floor(dim / this.m)
    const remainder = dim % this.m
    for (let s = 0; s < this.m; s++) {
      this.offsets[s + 1] = this.offsets[s]! + (s < remainder ? quotient + 1 : quotient)
    }
  }

  get ready(): boolean {
    return this.codewords !== undefined
  }

  /** The trained codebook, shaped (m, ks, width) in row-major order. */
  get codebook(): Float32Array | undefined {
    return this.codewords
  }

  private setCodebook(codewords: Float32Array, width: number, handle: number | undefined) {
    if (this.handle !== undefined) {
      this.wasm.release(this.handle, this.handleToken)
    }
    this.codewords = codewords
    this.width = width
    this.handle = handle
    this.handleToken = handle === undefined ? undefined : this.wasm.track(this, handle)

    const norms = new Float32Array(this.m * this.ks)
    for (let s = 0; s < this.m; s++) {
      const length = this.offsets[s + 1]! - this.offsets[s]!
      for (let k = 0; k < this.ks; k++) {
        const base = (s * this.ks + k) * width
        let sum = 0
        for (let d = 0; d < length; d++) {
          sum += codewords[base + d]! * codewords[base + d]!
        }
        norms[s * this.ks + k] = sum
      }
    }
    this.codewordNorms = norms
  }

  private modelHandle(): number {
    if (!this.codewords) {
      throw new Error('pq: the quantizer has not been trained yet.')
    }
    if (this.handle === undefined) {
      const handle = this.wasm.load(this.codewords, this.m, this.ks, this.width, this.dim)
      this.handle = handle
      this.handleToken = this.wasm.track(this, handle)
    }
    return this.handle
  }

  fit(vectors: Float32Array[]): void {
    let sample = vectors
    if (vectors.length > this.maxTrainingSize) {
      const step = vectors.length / this.maxTrainingSize
      sample = Array.from({ length: this.maxTrainingSize }, (_, i) => vectors[Math.floor(i * step)]!)
    }
    if (sample.length < this.ks) {
      throw new Error(`pq: training needs at least ks (${this.ks}) vectors, got ${sample.length}.`)
    }

    const data = new Float32Array(sample.length * this.dim)
    sample.forEach((vector, i) => data.set(vector.subarray(0, this.dim), i * this.dim))
    const trained = this.wasm.fit(data, sample.length, this.dim, this.m, this.ks, this.iterations, this.seed)
    this.setCodebook(trained.codewords, trained.width, trained.handle)
  }

  encode(vector: Float32Array, codes: CodeBuffer, offset: number): void {
    const encoded = this.wasm.encode(this.modelHandle(), vector.subarray(0, this.dim), 1, this.m)
    codes.u8.set(encoded, offset)

    let normSq = 0
    const norms = this.codewordNorms!
    for (let s = 0; s < this.m; s++) {
      normSq += norms[s * this.ks + encoded[s]!]!
    }
    codes.f32[(offset + this.normOffset) >> 2] = normSq > 0 ? 1 / Math.sqrt(normSq) : 0
  }

  prepareQuery(query: Float32Array): Float32Array {
    const codewords = this.codewords!
    const table = new Float32Array(this.m * this.ks)
    for (let s = 0; s < this.m; s++) {
      const start = this.offsets[s]!
      const length = this.offsets[s + 1]! - start
      for (let k = 0; k < this.ks; k++) {
        const base = (s * this.ks + k) * this.width
        let sum = 0
        for (let d = 0; d < length; d++) {
          sum += query[start + d]! * codewords[base + d]!
        }
        table[s * this.ks + k] = sum
      }
    }
    return table
  }

  score(table: Float32Array, codes: CodeBuffer, offset: number): number {
    const u8 = codes.u8
    const ks = this.ks
    let sum = 0
    for (let s = 0; s < this.m; s++) {
      sum += table[s * ks + u8[offset + s]!]!
    }
    const score = sum * codes.f32[(offset + this.normOffset) >> 2]!
    return score > 1 ? 1 : score < -1 ? -1 : score
  }

  decode(codes: CodeBuffer, offset: number, out: Float32Array): void {
    const codewords = this.codewords!
    for (let s = 0; s < this.m; s++) {
      const start = this.offsets[s]!
      const length = this.offsets[s + 1]! - start
      const base = (s * this.ks + codes.u8[offset + s]!) * this.width
      for (let d = 0; d < length; d++) {
        out[start + d] = codewords[base + d]!
      }
    }
  }

  toSnapshot(): VectorBinarySnapshot {
    return {
      meta: {
        kind: PQ_KIND,
        dim: this.dim,
        m: this.m,
        ks: this.ks,
        iterations: this.iterations,
        trainingSize: this.trainingSize,
        maxTrainingSize: this.maxTrainingSize,
        seed: this.seed,
        width: this.width
      },
      arrays: this.codewords ? { codewords: this.codewords } : {}
    }
  }

  static fromSnapshot(snapshot: VectorBinarySnapshot, wasm: VectorQuantizerWasm): ProductQuantizer {
    const meta = snapshot.meta as Required<PQOptions> & { dim: number; width: number }
    const quantizer = new ProductQuantizer(meta.dim, meta, wasm)
    const codewords = snapshot.arrays.codewords as Float32Array | undefined
    if (codewords) {
      // The model is only loaded into WebAssembly when a new vector has to be encoded.
      quantizer.setCodebook(codewords, meta.width, undefined)
    }
    return quantizer
  }
}

export interface PQFactory extends VectorQuantizerFactory {
  readonly kind: typeof PQ_KIND
  readonly options: PQOptions
  create(dim: number): ProductQuantizer
  fromSnapshot(snapshot: VectorBinarySnapshot): ProductQuantizer
}

function createFactory(options: PQOptions, wasm: VectorQuantizerWasm): PQFactory {
  return {
    kind: PQ_KIND,
    options,
    create: (dim) => new ProductQuantizer(dim, options, wasm),
    fromSnapshot: (snapshot) => ProductQuantizer.fromSnapshot(snapshot, wasm)
  }
}

/**
 * Product quantization for zbsearch vector indexes. Pass the result as `quantization` to `flat()` or `ivf()`.
 *
 * ```js
 * import { flat } from 'zbsearch/trees/vector-flat'
 * import { pq } from '@zbsearch/plugin-vector-quantizer'
 *
 * const db = create({
 *   schema: { embedding: 'vector[384]' },
 *   indexes: { embedding: flat({ quantization: await pq({ m: 48 }), rescore: 'int8' }) }
 * })
 * ```
 */
export async function pq(options: PQOptions = {}): Promise<PQFactory> {
  return createFactory(options, await loadVectorQuantizerWasm())
}

/** Synchronous variant of `pq()`, for Node.js, Deno, workers and privileged Gecko code. */
export function pqSync(options: PQOptions = {}): PQFactory {
  return createFactory(options, loadVectorQuantizerWasmSync())
}

interface RefittableIndex {
  refit(sample?: Iterable<Float32Array | number[]>): void
}

/**
 * Re-trains the quantizer of a vector property and re-encodes every vector, for instance after the data drifted
 * away from the initial training sample. Without `sample`, training uses the rescoring copy when the index keeps
 * one (`rescore: 'float32' | 'int8'`), otherwise the decoded codes.
 */
export function refit(db: AnyZBSearch, property: string, sample?: Iterable<Float32Array | number[]>): void {
  const node = db.data.index.vectorIndexes[property]?.node as Partial<RefittableIndex> | undefined
  if (!node) {
    throw new Error(`Unknown vector property "${property}".`)
  }
  if (typeof node.refit !== 'function') {
    throw new Error(`The vector index of "${property}" is not quantized.`)
  }
  node.refit(sample)
}
