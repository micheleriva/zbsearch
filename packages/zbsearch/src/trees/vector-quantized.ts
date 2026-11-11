import type { InternalDocumentID } from '../components/internal-document-id-store.js'
import type { SimilarVector, VectorFindOptions, VectorIndexLike } from '../types.js'
import { getProbeCentroids, trainCentroids } from './vector-kmeans.js'
import { dotProduct, nearestCentroidIndex, normalizeVector } from './vector-math.js'
import {
  builtinQuantizers,
  codeStride,
  createCodeBuffer,
  prefixArrays,
  snapshotFromJSON,
  snapshotToJSON,
  unprefixArrays,
  type CodeBuffer,
  type SnapshotTypedArray,
  type VectorBinarySnapshot,
  type VectorQuantizer,
  type VectorQuantizerFactory,
  type VectorSnapshotJSON
} from './vector-quantization.js'

export const QUANTIZED_VECTOR_INDEX_FORMAT = 'zbsearch-quantized-vector-index@1'

const EMPTY_SLOT = 0xffffffff
const DEFAULT_OVERSAMPLE = 10
const DEFAULT_RESCORE_MARGIN = 0.15
const QUANTIZER_PREFIX = 'quantizer.'
const RESCORE_PREFIX = 'rescore.'

export interface QuantizedIvfConfig {
  nlist: number
  nprobe: number
  trainMin: number
}

export interface QuantizedVectorIndexOptions {
  dim: number
  quantizer: VectorQuantizer
  rescorer?: VectorQuantizer
  oversample?: number
  rescoreMargin?: number
  ivf?: QuantizedIvfConfig
}

export interface QuantizedVectorIndexJSON extends VectorSnapshotJSON {
  kind: 'flat' | 'ivf'
  format: typeof QUANTIZED_VECTOR_INDEX_FORMAT
}

interface Lane {
  quantizer: VectorQuantizer
  stride: number
  codes: CodeBuffer
}

/** Fixed-size min-heap of (slot, score) pairs used to keep the best rescoring candidates. */
class TopCandidates {
  readonly slots: Uint32Array
  readonly scores: Float64Array
  size = 0

  constructor(readonly capacity: number) {
    this.slots = new Uint32Array(capacity)
    this.scores = new Float64Array(capacity)
  }

  push(slot: number, score: number): void {
    if (this.size < this.capacity) {
      let i = this.size++
      while (i > 0) {
        const parent = (i - 1) >> 1
        if (this.scores[parent]! <= score) break
        this.slots[i] = this.slots[parent]!
        this.scores[i] = this.scores[parent]!
        i = parent
      }
      this.slots[i] = slot
      this.scores[i] = score
      return
    }

    if (score <= this.scores[0]!) {
      return
    }

    let i = 0
    const size = this.size
    for (;;) {
      const left = 2 * i + 1
      if (left >= size) break
      const right = left + 1
      const child = right < size && this.scores[right]! < this.scores[left]! ? right : left
      if (this.scores[child]! >= score) break
      this.slots[i] = this.slots[child]!
      this.scores[i] = this.scores[child]!
      i = child
    }
    this.slots[i] = slot
    this.scores[i] = score
  }
}

function removeFromList(list: InternalDocumentID[], id: InternalDocumentID) {
  const index = list.indexOf(id)
  if (index === -1) {
    return
  }

  const lastIndex = list.length - 1
  if (index !== lastIndex) {
    list[index] = list[lastIndex]!
  }
  list.pop()
}

/**
 * A vector index that stores quantized codes in one contiguous buffer, optionally partitioned with IVF.
 *
 * Until the quantizer is trained (and, with IVF, until the centroids are trained) vectors are kept as float32 and
 * searched exactly. Once enough vectors have been collected, the quantizer is fitted, the centroids trained, and
 * every buffered vector encoded.
 */
export class QuantizedVectorIndex implements VectorIndexLike {
  readonly size: number
  readonly oversample: number
  readonly rescoreMargin: number
  readonly ivf: QuantizedIvfConfig | undefined

  private quantizer: VectorQuantizer
  private lanes: Lane[]
  private capacity = 0
  private used = 0
  private freeSlots: number[] = []
  private slotIds = new Uint32Array(0)
  private slotClusters = new Uint32Array(0)
  private idToSlot = new Map<InternalDocumentID, number>()
  private pending = new Map<InternalDocumentID, Float32Array>()

  private centroids: Float32Array[] = []
  private lists: InternalDocumentID[][] = []
  private ivfTrained = false

  constructor(options: QuantizedVectorIndexOptions) {
    this.size = options.dim
    this.quantizer = options.quantizer
    this.oversample = options.oversample ?? DEFAULT_OVERSAMPLE
    this.rescoreMargin = options.rescoreMargin ?? DEFAULT_RESCORE_MARGIN
    this.ivf = options.ivf

    if (options.quantizer.dim !== options.dim || (options.rescorer && options.rescorer.dim !== options.dim)) {
      throw new Error(`Vector quantizer dimension does not match the vector property size (${options.dim}).`)
    }

    this.lanes = [this.createLane(options.quantizer, 0)]
    if (options.rescorer) {
      this.lanes.push(this.createLane(options.rescorer, 0))
    }

    if (this.ivf) {
      this.lists = Array.from({ length: this.ivf.nlist }, () => [])
    }
  }

  get quantization(): string {
    return this.quantizer.kind
  }

  get rescore(): string {
    return this.lanes[1]?.quantizer.kind ?? 'none'
  }

  /** Number of vectors stored, encoded or still waiting for training. */
  get count(): number {
    return this.idToSlot.size + this.pending.size
  }

  /** True once vectors are encoded (the quantizer is trained and, with IVF, centroids are trained). */
  get ready(): boolean {
    return this.quantizer.ready && (!this.ivf || this.ivfTrained)
  }

  /** Bytes held by encoded vectors, rescoring copies and vectors waiting for training (excludes the id map). */
  get byteLength(): number {
    let bytes = 0
    for (const lane of this.lanes) {
      bytes += lane.codes.u8.byteLength
    }
    bytes += this.slotIds.byteLength + this.slotClusters.byteLength
    bytes += this.pending.size * this.size * 4
    bytes += this.centroids.length * this.size * 4
    return bytes
  }

  getQuantizer(): VectorQuantizer {
    return this.quantizer
  }

  private createLane(quantizer: VectorQuantizer, capacity: number): Lane {
    const stride = codeStride(quantizer)
    return { quantizer, stride, codes: createCodeBuffer(stride * capacity) }
  }

  private ensureCapacity(required: number) {
    if (required <= this.capacity) {
      return
    }

    // Grow by 12.5% (plus a fixed step) rather than doubling: the codes are the bulk of the memory.
    this.resize(Math.max(required, Math.ceil(this.capacity * 1.125) + 1024))
  }

  /** Releases the spare capacity kept for future inserts, e.g. after a bulk load. */
  shrinkToFit() {
    if (this.capacity > this.used) {
      this.resize(this.used)
    }
  }

  private resize(capacity: number) {
    for (const lane of this.lanes) {
      const codes = createCodeBuffer(lane.stride * capacity)
      codes.u8.set(lane.codes.u8.subarray(0, lane.stride * Math.min(capacity, this.capacity)))
      lane.codes = codes
    }

    const kept = Math.min(capacity, this.capacity)
    const slotIds = new Uint32Array(capacity).fill(EMPTY_SLOT)
    slotIds.set(this.slotIds.subarray(0, kept))
    this.slotIds = slotIds

    if (this.ivf) {
      const slotClusters = new Uint32Array(capacity)
      slotClusters.set(this.slotClusters.subarray(0, kept))
      this.slotClusters = slotClusters
    }

    this.capacity = capacity
  }

  private allocateSlot(id: InternalDocumentID): number {
    let slot = this.freeSlots.pop()
    if (slot === undefined) {
      this.ensureCapacity(this.used + 1)
      slot = this.used++
    }
    this.slotIds[slot] = id
    this.idToSlot.set(id, slot)
    return slot
  }

  private encodeInto(id: InternalDocumentID, vector: Float32Array) {
    const slot = this.allocateSlot(id)
    for (const lane of this.lanes) {
      lane.quantizer.encode(vector, lane.codes, slot * lane.stride)
    }

    if (this.ivf) {
      const cluster = nearestCentroidIndex(vector, this.centroids, this.size)
      this.slotClusters[slot] = cluster
      this.lists[cluster]!.push(id)
    }
  }

  add(internalDocumentId: InternalDocumentID, value: number[] | Float32Array) {
    const stored = new Float32Array(value)
    normalizeVector(stored, this.size)

    this.remove(internalDocumentId)

    if (!this.ready) {
      this.pending.set(internalDocumentId, stored)
      this.maybeTrain()
      return
    }

    this.encodeInto(internalDocumentId, stored)
  }

  remove(internalDocumentId: InternalDocumentID) {
    if (this.pending.delete(internalDocumentId)) {
      return
    }

    const slot = this.idToSlot.get(internalDocumentId)
    if (slot === undefined) {
      return
    }

    this.idToSlot.delete(internalDocumentId)
    this.slotIds[slot] = EMPTY_SLOT
    this.freeSlots.push(slot)

    if (this.ivf) {
      removeFromList(this.lists[this.slotClusters[slot]!]!, internalDocumentId)
    }
  }

  private trainingThreshold(): number {
    let threshold = 0
    if (!this.quantizer.ready) {
      threshold = Math.max(threshold, this.quantizer.trainingSize ?? 1)
    }
    if (this.ivf && !this.ivfTrained) {
      threshold = Math.max(threshold, this.ivf.trainMin)
    }
    return threshold
  }

  private maybeTrain() {
    if (this.pending.size >= this.trainingThreshold()) {
      this.train()
    }
  }

  /** Fits the quantizer and the IVF centroids on the buffered vectors, then encodes them. */
  train() {
    if (this.pending.size === 0) {
      return
    }

    const vectors = Array.from(this.pending.values())

    if (!this.quantizer.ready) {
      if (!this.quantizer.fit) {
        throw new Error(`Vector quantizer "${this.quantizer.kind}" is not ready and has no fit() method.`)
      }
      this.quantizer.fit(vectors)
    }

    if (this.ivf && !this.ivfTrained) {
      this.centroids = trainCentroids(vectors, this.ivf.nlist, this.size)
      this.ivfTrained = true
    }

    const entries = Array.from(this.pending.entries())
    this.pending.clear()
    for (const [id, vector] of entries) {
      this.encodeInto(id, vector)
    }
  }

  /**
   * Re-trains the quantizer and re-encodes every vector. Vectors are taken from `sample` for training when given,
   * otherwise from the rescoring copy (when kept) or from the decoded codes.
   */
  refit(sample?: Iterable<Float32Array | number[]>) {
    if (!this.quantizer.fit) {
      return
    }

    const sources = this.collectVectors()
    const training = sample
      ? Array.from(sample, (vector) => {
          const stored = new Float32Array(vector)
          normalizeVector(stored, this.size)
          return stored
        })
      : sources.map(([, vector]) => vector)

    if (training.length === 0) {
      return
    }

    this.quantizer.fit(training)
    this.resetStorage()
    for (const [id, vector] of sources) {
      this.pending.set(id, vector)
    }
    this.train()
  }

  /**
   * The normalized vector stored for a document, at the best precision available: the buffered float32 vector
   * before training, else the rescoring copy when one is kept, else the decoded code. Returns `undefined` for
   * unknown ids or quantizers that cannot decode. Used to rebuild vectors for `includeVectors`.
   */
  getVector(internalDocumentId: InternalDocumentID): Float32Array | undefined {
    const pending = this.pending.get(internalDocumentId)
    if (pending) {
      return pending.slice()
    }

    const slot = this.idToSlot.get(internalDocumentId)
    if (slot === undefined) {
      return undefined
    }

    const lane = this.lanes[1] ?? this.lanes[0]!
    if (!lane.quantizer.decode) {
      return undefined
    }

    const vector = new Float32Array(this.size)
    lane.quantizer.decode(lane.codes, slot * lane.stride, vector)
    normalizeVector(vector, this.size)
    return vector
  }

  /** Returns every stored vector at the best precision available. */
  private collectVectors(): [InternalDocumentID, Float32Array][] {
    const out: [InternalDocumentID, Float32Array][] = Array.from(this.pending.entries())
    const lane = this.lanes[1] ?? this.lanes[0]!
    if (!lane.quantizer.decode) {
      throw new Error(`Vector quantizer "${lane.quantizer.kind}" cannot decode vectors.`)
    }

    for (const [id, slot] of this.idToSlot) {
      const vector = new Float32Array(this.size)
      lane.quantizer.decode(lane.codes, slot * lane.stride, vector)
      normalizeVector(vector, this.size)
      out.push([id, vector])
    }
    return out
  }

  private resetStorage() {
    this.lanes = this.lanes.map((lane) => this.createLane(lane.quantizer, 0))
    this.capacity = 0
    this.used = 0
    this.freeSlots = []
    this.slotIds = new Uint32Array(0)
    this.slotClusters = new Uint32Array(0)
    this.idToSlot.clear()
    if (this.ivf) {
      this.lists = Array.from({ length: this.ivf.nlist }, () => [])
    }
  }

  find(
    vector: number[] | Float32Array,
    similarity: number,
    whereFiltersIDs: Set<InternalDocumentID> | undefined,
    options?: VectorFindOptions
  ): SimilarVector[] {
    const query = new Float32Array(vector)
    if (normalizeVector(query, this.size) === 0) {
      return []
    }

    const results: SimilarVector[] = []

    for (const [id, stored] of this.pending) {
      if (whereFiltersIDs && !whereFiltersIDs.has(id)) {
        continue
      }
      const score = dotProduct(query, stored, this.size)
      if (score >= similarity) {
        results.push([id, score])
      }
    }

    if (this.idToSlot.size === 0) {
      return results
    }

    const primary = this.lanes[0]!
    const rescorer = this.lanes[1]
    const prepared = primary.quantizer.prepareQuery(query)
    const { codes, stride, quantizer } = primary

    if (!rescorer) {
      this.forEachCandidate(query, whereFiltersIDs, (slot) => {
        const score = quantizer.score(prepared, codes, slot * stride)
        if (score >= similarity) {
          results.push([this.slotIds[slot]!, score])
        }
      })
      return results
    }

    const candidates: number[] = []
    const limit = options?.limit
    if (limit !== undefined && limit > 0) {
      const top = new TopCandidates(Math.max(1, Math.ceil(limit * this.oversample)))
      this.forEachCandidate(query, whereFiltersIDs, (slot) => {
        top.push(slot, quantizer.score(prepared, codes, slot * stride))
      })
      for (let i = 0; i < top.size; i++) {
        candidates.push(top.slots[i]!)
      }
    } else {
      const threshold = similarity - this.rescoreMargin
      this.forEachCandidate(query, whereFiltersIDs, (slot) => {
        if (quantizer.score(prepared, codes, slot * stride) >= threshold) {
          candidates.push(slot)
        }
      })
    }

    const rescoreQuery = rescorer.quantizer.prepareQuery(query)
    for (const slot of candidates) {
      const score = rescorer.quantizer.score(rescoreQuery, rescorer.codes, slot * rescorer.stride)
      if (score >= similarity) {
        results.push([this.slotIds[slot]!, score])
      }
    }

    return results
  }

  private forEachCandidate(
    query: Float32Array,
    whereFiltersIDs: Set<InternalDocumentID> | undefined,
    visit: (slot: number) => void
  ) {
    if (this.ivf) {
      const probes = getProbeCentroids(query, this.centroids, this.ivf.nprobe, this.size)
      for (const cluster of probes) {
        const list = this.lists[cluster]!
        for (let i = 0; i < list.length; i++) {
          const id = list[i]!
          if (whereFiltersIDs && !whereFiltersIDs.has(id)) {
            continue
          }
          visit(this.idToSlot.get(id)!)
        }
      }
      return
    }

    if (whereFiltersIDs && whereFiltersIDs.size < this.idToSlot.size) {
      for (const id of whereFiltersIDs) {
        const slot = this.idToSlot.get(id)
        if (slot !== undefined) {
          visit(slot)
        }
      }
      return
    }

    const slotIds = this.slotIds
    for (let slot = 0; slot < this.used; slot++) {
      const id = slotIds[slot]!
      if (id === EMPTY_SLOT || (whereFiltersIDs && !whereFiltersIDs.has(id))) {
        continue
      }
      visit(slot)
    }
  }

  toBinarySnapshot(): VectorBinarySnapshot {
    const count = this.idToSlot.size
    const ids = new Uint32Array(count)
    const clusters = this.ivf ? new Uint32Array(count) : undefined
    const laneCodes = this.lanes.map((lane) => new Uint8Array(count * lane.stride))

    let i = 0
    for (let slot = 0; slot < this.used; slot++) {
      const id = this.slotIds[slot]!
      if (id === EMPTY_SLOT) {
        continue
      }
      ids[i] = id
      if (clusters) {
        clusters[i] = this.slotClusters[slot]!
      }
      for (let l = 0; l < this.lanes.length; l++) {
        const lane = this.lanes[l]!
        const start = slot * lane.stride
        laneCodes[l]!.set(lane.codes.u8.subarray(start, start + lane.stride), i * lane.stride)
      }
      i++
    }

    const pendingIds = new Uint32Array(this.pending.size)
    const pendingVectors = new Float32Array(this.pending.size * this.size)
    let p = 0
    for (const [id, vector] of this.pending) {
      pendingIds[p] = id
      pendingVectors.set(vector, p * this.size)
      p++
    }

    const quantizerSnapshot = this.quantizer.toSnapshot()
    const rescorer = this.lanes[1]?.quantizer
    const rescoreSnapshot = rescorer?.toSnapshot()

    const arrays: Record<string, SnapshotTypedArray> = {
      ids,
      codes: laneCodes[0]!,
      pendingIds,
      pendingVectors,
      ...prefixArrays(QUANTIZER_PREFIX, quantizerSnapshot.arrays)
    }

    if (rescoreSnapshot) {
      arrays.rescoreCodes = laneCodes[1]!
      Object.assign(arrays, prefixArrays(RESCORE_PREFIX, rescoreSnapshot.arrays))
    }

    if (this.ivf) {
      arrays.clusters = clusters!
      const centroids = new Float32Array(this.centroids.length * this.size)
      this.centroids.forEach((centroid, index) => centroids.set(centroid, index * this.size))
      arrays.centroids = centroids
    }

    return {
      meta: {
        kind: this.ivf ? 'ivf' : 'flat',
        format: QUANTIZED_VECTOR_INDEX_FORMAT,
        size: this.size,
        count,
        oversample: this.oversample,
        rescoreMargin: this.rescoreMargin,
        quantization: { kind: this.quantizer.kind, meta: quantizerSnapshot.meta },
        rescore: rescorer ? { kind: rescorer.kind, meta: rescoreSnapshot!.meta } : null,
        ivf: this.ivf ? { ...this.ivf, trained: this.ivfTrained } : null
      },
      arrays
    }
  }

  static fromBinarySnapshot(
    snapshot: VectorBinarySnapshot,
    factories: Record<string, VectorQuantizerFactory | undefined> = {}
  ): QuantizedVectorIndex {
    const meta = snapshot.meta as {
      size: number
      count: number
      oversample: number
      rescoreMargin: number
      quantization: { kind: string; meta: Record<string, unknown> }
      rescore: { kind: string; meta: Record<string, unknown> } | null
      ivf: (QuantizedIvfConfig & { trained: boolean }) | null
    }

    const restore = (spec: { kind: string; meta: Record<string, unknown> }, prefix: string) => {
      const factory = factories[spec.kind] ?? builtinQuantizers[spec.kind]
      if (!factory) {
        throw new Error(
          `Vector index was saved with the "${spec.kind}" quantizer. Pass the same quantizer in the indexes option of create() before loading.`
        )
      }
      return factory.fromSnapshot({ meta: spec.meta, arrays: unprefixArrays(prefix, snapshot.arrays) })
    }

    const ivfConfig = meta.ivf
      ? { nlist: meta.ivf.nlist, nprobe: meta.ivf.nprobe, trainMin: meta.ivf.trainMin }
      : undefined

    const index = new QuantizedVectorIndex({
      dim: meta.size,
      quantizer: restore(meta.quantization, QUANTIZER_PREFIX),
      rescorer: meta.rescore ? restore(meta.rescore, RESCORE_PREFIX) : undefined,
      oversample: meta.oversample,
      rescoreMargin: meta.rescoreMargin,
      ivf: ivfConfig
    })

    const arrays = snapshot.arrays
    const ids = arrays.ids as Uint32Array
    const count = ids.length

    if (meta.ivf?.trained) {
      const centroids = arrays.centroids as Float32Array
      index.centroids = []
      for (let c = 0; c < centroids.length / meta.size; c++) {
        index.centroids.push(centroids.slice(c * meta.size, (c + 1) * meta.size))
      }
      index.ivfTrained = true
    }

    index.ensureCapacity(count)
    const laneArrays = [arrays.codes, arrays.rescoreCodes]
    for (let l = 0; l < index.lanes.length; l++) {
      const lane = index.lanes[l]!
      const source = laneArrays[l]!
      lane.codes.u8.set(new Uint8Array(source.buffer, source.byteOffset, count * lane.stride))
    }

    const clusters = arrays.clusters as Uint32Array | undefined
    for (let i = 0; i < count; i++) {
      const id = ids[i]!
      index.slotIds[i] = id
      index.idToSlot.set(id, i)
      if (index.ivf && clusters) {
        index.slotClusters[i] = clusters[i]!
        index.lists[clusters[i]!]!.push(id)
      }
    }
    index.used = count

    const pendingIds = arrays.pendingIds as Uint32Array
    const pendingVectors = arrays.pendingVectors as Float32Array
    for (let i = 0; i < pendingIds.length; i++) {
      index.pending.set(pendingIds[i]!, pendingVectors.slice(i * meta.size, (i + 1) * meta.size))
    }

    return index
  }

  toJSON(): QuantizedVectorIndexJSON {
    const snapshot = this.toBinarySnapshot()
    return { kind: this.ivf ? 'ivf' : 'flat', format: QUANTIZED_VECTOR_INDEX_FORMAT, ...snapshotToJSON(snapshot) }
  }

  static fromJSON(
    json: unknown,
    factories: Record<string, VectorQuantizerFactory | undefined> = {}
  ): QuantizedVectorIndex {
    return QuantizedVectorIndex.fromBinarySnapshot(snapshotFromJSON(json as QuantizedVectorIndexJSON), factories)
  }
}

export function isQuantizedVectorIndexPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false
  }
  const record = payload as { format?: unknown; meta?: { format?: unknown } }
  return record.format === QUANTIZED_VECTOR_INDEX_FORMAT || record.meta?.format === QUANTIZED_VECTOR_INDEX_FORMAT
}
