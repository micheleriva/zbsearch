import { create, insert as coreInsert, remove as coreRemove, internals } from 'zbsearch'
import type {
  AnyDocument,
  AnySchema,
  AnyZBSearch,
  BM25Params,
  ElapsedTime,
  HybridWeights,
  IndexesConfig,
  Result,
  StoreConfig,
  TokenScore
} from 'zbsearch'
import { VectorIndex } from 'zbsearch/trees/vector-flat'
import { collectBytes, defaultShardCodec, type ShardCodec } from './codec.js'
import { GlobalStatistics, type GlobalStatisticsJSON } from './statistics.js'
import { MemoryStorage, type ShardStorage } from './storage.js'
import { fieldInfo, ShardSummary, type FieldInfo, type ShardSummaryJSON } from './summary.js'
import {
  decodeJSON,
  encodeJSON,
  shardKey,
  SHARDS_PREFIX,
  STATE_KEY,
  WAL_PREFIX,
  walKey,
  walSeqFromKey,
  type WalOp,
  type WalRecord
} from './wal.js'

export interface ShardSizeInfo {
  /** Documents in the shard. */
  docs: number
  /** Size of the shard's last snapshot, 0 if it was never written. */
  snapshotBytes: number
}

/** Options forwarded to zbsearch `create()` for every shard (and for the resident template database). */
export interface ShardCreateOptions {
  language?: string
  components?: Record<string, unknown>
  plugins?: unknown[]
  sort?: { enabled?: boolean; unsortableProperties?: string[] }
  /** Vector index per property, e.g. `{ embedding: flat({ quantization: 'int8' }) }`. */
  indexes?: IndexesConfig
  /** What the documents store keeps: `{ exclude: [...] }`, `{ vectors: true }`. */
  store?: StoreConfig
}

export interface ShardedDatabaseOptions {
  /** Schema of the documents. Required when the storage holds no database yet; checked against the stored one otherwise. */
  schema?: AnySchema
  /** Where snapshots, the write-ahead log and the global state live. Default: a new MemoryStorage. */
  storage?: ShardStorage
  /** Shard snapshot format. Default: `defaultShardCodec`. */
  codec?: ShardCodec
  /**
   * Document property (dot path) whose value keeps documents together: all
   * documents with the same value go to the same shard while it has room, so
   * filters on it load a single shard and removing them all touches one.
   * Without it, documents fill shards in insertion order.
   */
  partitionBy?: string
  /**
   * With `partitionBy`, let several partitions share a shard (filled in
   * insertion order) instead of giving every value shards of its own. Use it
   * for many small partitions, such as the passages of one paper. Default false.
   */
  packPartitions?: boolean
  /** Maximum documents per shard. Default 5,000. */
  maxDocsPerShard?: number
  /**
   * Memory budget in bytes for the resident global layer plus the loaded
   * shards (as estimated by `estimateShardBytes`). Least recently used shards
   * are evicted to stay under it. Default: unlimited.
   */
  memoryBudget?: number
  /** Estimated heap size of a loaded shard. Default: 1.8 × its snapshot size (measured 1.3–1.75× with the JSON codec), or 16 KiB per document before its first snapshot. */
  estimateShardBytes?: (shard: ShardSizeInfo) => number
  /** Compact (snapshot dirty shards, persist the global state, truncate the WAL) after this many WAL records. 0 disables. Default 64. */
  compactEvery?: number
  /** Documents per WAL record in insertMultiple. Default 500. */
  writeBatchSize?: number
  /** Extra arguments for zbsearch `create()`. They are not persisted: pass the same ones every time the database is opened. */
  createOptions?: ShardCreateOptions
}

export interface ShardedSearchParams {
  mode?: 'fulltext' | 'vector' | 'hybrid'
  term?: string
  properties?: '*' | string[]
  exact?: boolean
  prefix?: boolean
  tolerance?: number
  threshold?: number
  boost?: Record<string, number>
  relevance?: BM25Params
  where?: Record<string, unknown>
  vector?: { value: number[] | Float32Array; property: string }
  similarity?: number
  hybridWeights?: HybridWeights
  includeVectors?: boolean
  limit?: number
  offset?: number
  preflight?: boolean
  /**
   * Approximate vector routing: search only the `vectorProbe` shards whose
   * vector centroid is most similar to the query. Off by default, which
   * keeps vector results exact.
   */
  vectorProbe?: number
}

export interface ShardedSearchStats {
  /** Shards of the database. */
  total: number
  /** Shards that could hold a match after pruning by filters, terms and vector bounds. */
  candidates: number
  /** Shards loaded from storage by this search (cold shards). */
  loaded: number
}

export interface ShardedResults<Doc = AnyDocument> {
  count: number
  hits: Result<Doc>[]
  elapsed: ElapsedTime
  shards: ShardedSearchStats
}

export interface ShardedDatabaseStats {
  documents: number
  shards: number
  residentShards: number
  /** Estimated bytes of the resident shards. */
  residentBytes: number
  /** Estimated bytes of the resident global layer (statistics, dictionary, routing, shard summaries). */
  globalBytes: number
  memoryBudget: number
  loads: number
  evictions: number
  flushes: number
  compactions: number
  /** WAL records not yet folded into snapshots. */
  pendingWalRecords: number
  /** Distinct (property, term) pairs in the resident dictionary. */
  terms: number
}

interface IndexShape {
  indexes: Record<string, { type: string; node: { postings: Map<string, number[]> } }>
  unstoredTerms?: Record<string, { terms: string[]; docs: Record<number, Iterable<number> | undefined> }>
  frequencies: Record<string, Record<number, Record<string, number> | undefined>>
  fieldLengths: Record<string, Record<number, number | undefined>>
  searchablePropertiesWithTypes: Record<string, string>
}

interface VectorNode {
  getVector?(internalId: number): ArrayLike<number> | undefined
}

interface Shard {
  ordinal: number
  /** Storage key of the snapshot the shard was last written to. */
  key: string | undefined
  docs: number
  snapshotBytes: number
  summary: ShardSummary
  db: AnyZBSearch | undefined
  /** Estimated resident bytes while loaded. */
  bytes: number
  /** Loaded state differs from the snapshot at `key`. */
  dirty: boolean
  lastUsed: number
  pins: number
  /** Local internal ID → global sequence number, rebuilt when stale. */
  localSeq: Int32Array | undefined
}

interface ShardJSON {
  ordinal: number
  key?: string
  docs: number
  snapshotBytes: number
  summary: ShardSummaryJSON
}

interface StateJSON {
  version: 1
  schema: AnySchema
  partitionBy?: string
  packPartitions: boolean
  maxDocsPerShard: number
  walSeq: number
  generation: number
  stats: GlobalStatisticsJSON
  ids: string[]
  locations: number[]
  partitions: [string, number[]][]
  openShard: number
  shards: ShardJSON[]
}

interface Entry {
  score: number
  seq: number
  ordinal: number
  local: number
}

interface PrefetchedDoc {
  id: string
  doc: AnyDocument | undefined
}

const STATE_VERSION = 1
const DEFAULT_MAX_DOCS = 5000
const DEFAULT_COMPACT_EVERY = 64
const DEFAULT_BATCH = 500
const DEFAULT_SIMILARITY = 0.8
/** Slack on vector upper bounds: core compares float32-normalized vectors. */
const VECTOR_BOUND_EPSILON = 1e-4
/** Heap per document inserted into a loaded shard, relative to its rough object size (index structures included). */
const GROWTH_FACTOR = 5
const UNSUPPORTED_PARAMS = ['facets', 'groupBy', 'distinctOn', 'sortBy'] as const

function defaultEstimate({ docs, snapshotBytes }: ShardSizeInfo): number {
  return snapshotBytes > 0 ? Math.ceil(snapshotBytes * 1.8) : docs * 16384
}

/** Rough heap size of a document, for the growth of a loaded shard between snapshots. */
function roughSize(value: unknown): number {
  switch (typeof value) {
    case 'string':
      return 16 + value.length * 2
    case 'number':
    case 'boolean':
      return 8
    case 'object': {
      if (value === null) return 8
      if (ArrayBuffer.isView(value)) return 64 + (value as ArrayBufferView).byteLength
      let total = 32
      if (Array.isArray(value)) {
        for (const item of value) total += roughSize(item)
      } else {
        for (const [key, item] of Object.entries(value)) total += key.length + roughSize(item)
      }
      return total
    }
    default:
      return 8
  }
}

function compareEntries(a: Entry, b: Entry): number {
  return b.score - a.score || a.seq - b.seq
}

/** The best `k` entries of `entries` in rank order. */
function topK(entries: Entry[], k: number): Entry[] {
  if (k <= 0) return []
  if (entries.length <= k * 4) {
    return entries.sort(compareEntries).slice(0, k)
  }
  const scores = new Float64Array(entries.length)
  for (let i = 0; i < entries.length; i++) scores[i] = -entries[i].score
  scores.sort()
  const cutoff = -scores[k - 1]
  return entries
    .filter((entry) => entry.score >= cutoff)
    .sort(compareEntries)
    .slice(0, k)
}

function maxScore(entries: Entry[]): number {
  // Same as core's getMaxScore: starts from 0.
  let max = 0
  for (const entry of entries) {
    if (entry.score > max) max = entry.score
  }
  return max
}

function normalizeVector(vector: ArrayLike<number>): Float64Array | undefined {
  const out = Float64Array.from(vector as ArrayLike<number>)
  let norm = 0
  for (let i = 0; i < out.length; i++) norm += out[i] * out[i]
  norm = Math.sqrt(norm)
  if (!norm) return undefined
  for (let i = 0; i < out.length; i++) out[i] /= norm
  return out
}

function shardedError(message: string): Error {
  return new Error(`[zbsearch-sharded] ${message}`)
}

/**
 * A ZBSearch database split into shards that are loaded on demand and evicted
 * under a memory budget. Full-text, vector and hybrid rankings are identical
 * to a single ZBSearch instance holding the same documents: shards score BM25
 * with corpus-wide statistics, and results are merged with core's own
 * tie-breaking (insertion order).
 */
export class ShardedDatabase {
  private readonly storage: ShardStorage
  private readonly codec: ShardCodec
  private readonly maxDocsPerShard: number
  private readonly memoryBudget: number
  private readonly estimateShardBytes: (shard: ShardSizeInfo) => number
  private readonly compactEvery: number
  private readonly writeBatchSize: number
  private readonly createOptions: ShardCreateOptions
  private readonly partitionBy: string | undefined
  private readonly packPartitions: boolean
  readonly schema: AnySchema

  private readonly template: AnyZBSearch
  private readonly fields: Record<string, FieldInfo> = {}
  private readonly searchableProps: string[]
  private readonly stringProps: string[] = []
  private readonly valueProps: string[] = []
  private readonly vectorProps: string[] = []

  private stats: GlobalStatistics
  private shards: Shard[] = []
  /** Document ID → global sequence number (core's internal ID in a single instance; kept after removal, as core does). */
  private ids = new Map<string, number>()
  private seqIds: string[] = []
  /** Global sequence number → shard ordinal, -1 once removed. */
  private locations = new Int32Array(1024).fill(-1)
  private partitions = new Map<string, number[]>()
  private openShard = -1

  private walSeq = 0
  private walKeys: string[] = []
  private generation = 0
  private garbage: string[] = []

  private residentBytes = 0
  private clock = 0
  private pendingId: string | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  private counters = { loads: 0, evictions: 0, flushes: 0, compactions: 0 }
  /** How the current search returns vectors in its hits (core's includeVectors rules). */
  private hitVectors: { include: boolean; props: string[] } = { include: false, props: [] }

  private constructor(options: ShardedDatabaseOptions, state: StateJSON | undefined) {
    this.storage = options.storage ?? new MemoryStorage()
    this.codec = options.codec ?? defaultShardCodec
    this.memoryBudget = options.memoryBudget ?? Infinity
    this.estimateShardBytes = options.estimateShardBytes ?? defaultEstimate
    this.compactEvery = options.compactEvery ?? DEFAULT_COMPACT_EVERY
    this.writeBatchSize = Math.max(1, options.writeBatchSize ?? DEFAULT_BATCH)
    this.createOptions = options.createOptions ?? {}

    if (state) {
      if (options.schema && JSON.stringify(options.schema) !== JSON.stringify(state.schema)) {
        throw shardedError('the schema passed to openShardedDatabase differs from the stored one')
      }
      this.schema = state.schema
      this.partitionBy = state.partitionBy
      this.packPartitions = state.packPartitions
      this.maxDocsPerShard = state.maxDocsPerShard
    } else {
      if (!options.schema) {
        throw shardedError('a schema is required to create a sharded database')
      }
      this.schema = options.schema
      this.partitionBy = options.partitionBy
      this.packPartitions = !options.partitionBy || Boolean(options.packPartitions)
      this.maxDocsPerShard = Math.max(1, options.maxDocsPerShard ?? DEFAULT_MAX_DOCS)
    }

    this.template = this.createDb(false)
    const types = (this.template.data.index as unknown as IndexShape).searchablePropertiesWithTypes
    this.searchableProps = Object.keys(types)
    for (const prop of this.searchableProps) {
      const info = fieldInfo(types[prop])
      this.fields[prop] = info
      if (info.kind === 'string') this.stringProps.push(prop)
      else if (info.kind === 'vector') this.vectorProps.push(prop)
      else if (info.kind !== 'geopoint') this.valueProps.push(prop)
    }

    this.stats = new GlobalStatistics(this.stringProps)
    if (state) {
      this.restore(state)
    }
  }

  /** Opens the sharded database kept in `options.storage`, creating it if the storage is empty, and replays its WAL. */
  static async open(options: ShardedDatabaseOptions): Promise<ShardedDatabase> {
    const storage = options.storage ?? new MemoryStorage()
    const stored = await storage.get(STATE_KEY)
    const state = stored ? decodeJSON<StateJSON>(stored.body) : undefined
    if (state && state.version !== STATE_VERSION) {
      throw shardedError(`unsupported state version ${state.version}`)
    }

    const db = new ShardedDatabase({ ...options, storage }, state)
    if (!state) {
      // Make the schema and partitioning durable before the first WAL record.
      await storage.put(STATE_KEY, encodeJSON(db.toState()))
    }
    await db.recover()
    return db
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async insert(doc: AnyDocument): Promise<string> {
    const [id] = await this.insertMultiple([doc])
    return id
  }

  async insertMultiple(docs: AnyDocument[]): Promise<string[]> {
    return this.exclusive(async () => {
      const ops: WalOp[] = []
      const seen = new Set<string>()
      for (const doc of docs) {
        const id = this.prepare(doc)
        if (this.isLive(id) || seen.has(id)) {
          throw shardedError(`a document with id "${id}" already exists`)
        }
        seen.add(id)
        ops.push({ op: 'insert', id, doc })
      }

      for (let i = 0; i < ops.length; i += this.writeBatchSize) {
        await this.commit(ops.slice(i, i + this.writeBatchSize))
      }
      return ops.map((op) => op.id)
    })
  }

  async remove(id: string): Promise<boolean> {
    return (await this.removeMultiple([id])) === 1
  }

  async removeMultiple(ids: string[]): Promise<number> {
    return this.exclusive(async () => {
      const live = [...new Set(ids)].filter((id) => this.isLive(id))
      for (let i = 0; i < live.length; i += this.writeBatchSize) {
        await this.commit(live.slice(i, i + this.writeBatchSize).map((id) => ({ op: 'remove', id }) as WalOp))
      }
      return live.length
    })
  }

  /** Replaces document `id` with `doc` (core semantics: remove, then insert). Returns the new document's ID. */
  async update(id: string, doc: AnyDocument): Promise<string> {
    return this.exclusive(async () => this.updateNow(id, doc))
  }

  /** Inserts `doc`, or replaces the document with the same ID. */
  async upsert(doc: AnyDocument): Promise<string> {
    return this.exclusive(async () => {
      const id = this.prepare(doc)
      if (this.isLive(id)) {
        return this.updateNow(id, doc)
      }
      await this.commit([{ op: 'insert', id, doc }])
      return id
    })
  }

  async getByID(id: string): Promise<AnyDocument | undefined> {
    return this.exclusive(async () => {
      const seq = this.ids.get(id)
      if (seq === undefined || this.locations[seq] < 0) {
        return undefined
      }
      const shard = await this.acquire(this.locations[seq])
      try {
        const db = shard.db!
        const local = db.internalDocumentIDStore.idToInternalId.get(id)
        return local === undefined ? undefined : (db.documentsStore.get(db.data.docs, local) as AnyDocument)
      } finally {
        this.release(shard)
        await this.makeRoom(0)
      }
    })
  }

  /** Number of documents. */
  count(): number {
    return this.stats.docsCount
  }

  async search<Doc = AnyDocument>(params: ShardedSearchParams, language?: string): Promise<ShardedResults<Doc>> {
    return this.exclusive(async () => (await this.searchNow(params, language)) as ShardedResults<Doc>)
  }

  /** Writes every modified shard, persists the global state and truncates the write-ahead log. */
  async compact(): Promise<void> {
    return this.exclusive(() => this.compactNow())
  }

  /** Compacts, then releases every loaded shard. The database cannot be used afterwards. */
  async close(): Promise<void> {
    return this.exclusive(async () => {
      await this.compactNow()
      for (const shard of this.shards) {
        if (shard.db) this.unload(shard)
      }
      this.closed = true
    })
  }

  getStats(): ShardedDatabaseStats {
    return {
      documents: this.stats.docsCount,
      shards: this.shards.length,
      residentShards: this.shards.filter((shard) => shard.db).length,
      residentBytes: this.residentBytes,
      globalBytes: this.globalBytes(),
      memoryBudget: this.memoryBudget,
      ...this.counters,
      pendingWalRecords: this.walKeys.length,
      terms: this.stats.terms
    }
  }

  // ---------------------------------------------------------------------------
  // Shards, memory budget and persistence
  // ---------------------------------------------------------------------------

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(() => {
      if (this.closed) {
        throw shardedError('the database is closed')
      }
      return fn()
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private createDb(asShard: boolean): AnyZBSearch {
    const options = this.createOptions
    const components = asShard
      ? { ...options.components, getDocumentIndexId: () => this.pendingId as string }
      : options.components
    return create({
      ...options,
      schema: this.schema,
      inferSchema: false,
      sort: options.sort ?? { enabled: false },
      components
    } as never) as AnyZBSearch
  }

  private createShard(): number {
    const ordinal = this.shards.length
    this.shards.push({
      ordinal,
      key: undefined,
      docs: 0,
      snapshotBytes: 0,
      summary: new ShardSummary(),
      db: undefined,
      bytes: 0,
      dirty: false,
      lastUsed: 0,
      pins: 0,
      localSeq: undefined
    })
    return ordinal
  }

  private estimate(shard: Shard): number {
    return this.estimateShardBytes({ docs: shard.docs, snapshotBytes: shard.snapshotBytes })
  }

  private globalBytes(): number {
    // Per-entry costs measured on V8 (dictionary: radix node, postings entry and frequency entry).
    let total = 4096 + this.ids.size * 120 + this.locations.byteLength + this.stats.terms * 500
    for (const shard of this.shards) {
      total += 160 + shard.summary.bytes
    }
    for (const list of this.partitions.values()) {
      total += 64 + list.length * 8
    }
    return total
  }

  private async acquire(ordinal: number): Promise<Shard> {
    const shard = this.shards[ordinal]
    shard.lastUsed = ++this.clock
    if (!shard.db) {
      await this.load(shard)
    }
    shard.pins++
    return shard
  }

  private release(shard: Shard): void {
    shard.pins--
  }

  private async load(shard: Shard): Promise<void> {
    const estimate = this.estimate(shard)
    await this.makeRoom(estimate)

    const db = this.createDb(true)
    if (shard.key) {
      const stored = await this.storage.get(shard.key)
      if (!stored) {
        throw shardedError(`the snapshot of shard ${shard.ordinal} ("${shard.key}") is missing from storage`)
      }
      await this.codec.decode(db, stored.body)
    }
    internals.setCorpusStatistics(db, this.stats)

    shard.db = db
    shard.bytes = estimate
    shard.localSeq = undefined
    this.residentBytes += estimate
    if (shard.key) {
      this.counters.loads++
    }
  }

  private unload(shard: Shard): void {
    shard.db = undefined
    shard.localSeq = undefined
    this.residentBytes -= shard.bytes
    shard.bytes = 0
  }

  /** Evicts least recently used shards until `incoming` more bytes fit in the budget. */
  private async makeRoom(incoming: number): Promise<void> {
    if (this.memoryBudget === Infinity) return
    const limit = this.memoryBudget - this.globalBytes()

    while (this.residentBytes + incoming > limit) {
      let victim: Shard | undefined
      for (const shard of this.shards) {
        if (shard.db && shard.pins === 0 && (!victim || shard.lastUsed < victim.lastUsed)) {
          victim = shard
        }
      }
      if (!victim) return
      if (victim.dirty) {
        await this.flush(victim)
      }
      this.unload(victim)
      this.counters.evictions++
    }
  }

  /** Writes a loaded shard to a new snapshot key and tightens its summary. The global state still points to the old key until the next compaction. */
  private async flush(shard: Shard): Promise<void> {
    const db = shard.db!
    this.rebuildSummary(shard)
    const body = await collectBytes(this.codec.encode(db))
    const key = shardKey(shard.ordinal, ++this.generation)
    await this.storage.put(key, body)

    if (shard.key) this.garbage.push(shard.key)
    shard.key = key
    shard.snapshotBytes = body.byteLength
    shard.dirty = false
    this.counters.flushes++

    const estimate = this.estimate(shard)
    this.residentBytes += estimate - shard.bytes
    shard.bytes = estimate
  }

  /**
   * Rebuilds a tight summary of a loaded shard from its index structures, not
   * from the stored documents: those may lack vectors and excluded fields.
   */
  private rebuildSummary(shard: Shard): void {
    const db = shard.db!
    const index = db.data.index as unknown as IndexShape

    let terms = 0
    for (const prop of this.stringProps) {
      terms += index.indexes[prop]?.node.postings.size ?? 0
    }

    const summary = new ShardSummary(Math.max(64, Math.ceil(terms * 1.25)))
    for (const prop of this.stringProps) {
      const postings = index.indexes[prop]?.node.postings
      if (postings) summary.addTerms(prop, postings.keys())
    }

    for (const prop of this.valueProps) {
      const info = this.fields[prop]
      const tree = index.indexes[prop] as unknown as { type: string; node: unknown } | undefined
      if (!tree) continue
      switch (tree.type) {
        case 'Bool': {
          const node = tree.node as { true: Set<number>; false: Set<number> }
          if (node.true.size) summary.addValue(prop, info, true)
          if (node.false.size) summary.addValue(prop, info, false)
          break
        }
        case 'Flat': {
          const node = tree.node as { numberToDocumentId: Map<string | number, Set<number>> }
          for (const [value, ids] of node.numberToDocumentId) {
            if (ids.size) summary.addValue(prop, { kind: info.kind, isArray: false }, value)
          }
          break
        }
        case 'AVL': {
          type AvlNode = { k: number; v: Set<number>; l: AvlNode | null; r: AvlNode | null }
          const visit = (node: AvlNode | null): void => {
            if (!node) return
            if (node.v.size) summary.addValue(prop, { kind: 'number', isArray: false }, node.k)
            visit(node.l)
            visit(node.r)
          }
          visit((tree.node as { root: AvlNode | null }).root)
          break
        }
      }
    }

    const ids = db.internalDocumentIDStore.internalIdToId
    const docs = db.documentsStore.getAll(db.data.docs) as Record<number, AnyDocument | undefined>
    for (const prop of this.vectorProps) {
      const node = (db.data.index.vectorIndexes as Record<string, { node: VectorNode }>)[prop]?.node
      const vectors: ArrayLike<number>[] = []
      let complete = true
      for (let local = 1; local <= ids.length; local++) {
        if (!docs[local]) continue
        const vector =
          node?.getVector?.(local) ??
          ((db.getDocumentProperties(docs[local]!, [prop]) as Record<string, unknown>)[prop] as
            | ArrayLike<number>
            | undefined)
        if (vector) vectors.push(vector)
        else if (!node?.getVector) complete = false
      }
      if (complete) {
        summary.setVectors(prop, vectors)
      } else if (shard.summary.vectors[prop]) {
        // Vectors cannot be read back: keep the incremental cone.
        summary.vectors[prop] = shard.summary.vectors[prop]
      }
    }

    shard.summary = summary
  }

  private async compactNow(): Promise<void> {
    for (const shard of this.shards) {
      if (shard.db && shard.dirty) {
        await this.flush(shard)
      }
    }

    // The commit point: the state names the snapshots and the last WAL record they include.
    await this.storage.put(STATE_KEY, encodeJSON(this.toState()))

    for (const key of this.walKeys) await this.storage.delete(key)
    for (const key of this.garbage) await this.storage.delete(key)
    this.walKeys = []
    this.garbage = []
    this.counters.compactions++
    await this.makeRoom(0)
  }

  private toState(): StateJSON {
    return {
      version: STATE_VERSION,
      schema: this.schema,
      partitionBy: this.partitionBy,
      packPartitions: this.packPartitions,
      maxDocsPerShard: this.maxDocsPerShard,
      walSeq: this.walSeq,
      generation: this.generation,
      stats: this.stats.toJSON(),
      ids: this.seqIds,
      locations: Array.from(this.locations.subarray(0, this.seqIds.length)),
      partitions: [...this.partitions],
      openShard: this.openShard,
      shards: this.shards.map((shard) => ({
        ordinal: shard.ordinal,
        key: shard.key,
        docs: shard.docs,
        snapshotBytes: shard.snapshotBytes,
        summary: shard.summary.toJSON()
      }))
    }
  }

  private restore(state: StateJSON): void {
    this.walSeq = state.walSeq
    this.generation = state.generation
    this.stats = GlobalStatistics.fromJSON(this.stringProps, state.stats)
    this.seqIds = state.ids
    this.locations = new Int32Array(Math.max(1024, state.ids.length * 2)).fill(-1)
    this.locations.set(state.locations)
    this.ids = new Map(state.ids.map((id, seq) => [id, seq]))
    this.partitions = new Map(state.partitions)
    this.openShard = state.openShard
    this.shards = state.shards.map((shard) => ({
      ordinal: shard.ordinal,
      key: shard.key,
      docs: shard.docs,
      snapshotBytes: shard.snapshotBytes,
      summary: ShardSummary.fromJSON(shard.summary),
      db: undefined,
      bytes: 0,
      dirty: false,
      lastUsed: 0,
      pins: 0,
      localSeq: undefined
    }))
  }

  /** Drops what a crash left behind and replays the WAL records the state does not include yet. */
  private async recover(): Promise<void> {
    const referenced = new Set(this.shards.map((shard) => shard.key))
    const orphans: string[] = []
    for await (const { key } of this.storage.list(SHARDS_PREFIX)) {
      if (!referenced.has(key)) orphans.push(key)
    }
    for (const key of orphans) await this.storage.delete(key)

    const committed = this.walSeq
    const keys: string[] = []
    for await (const { key } of this.storage.list(WAL_PREFIX)) keys.push(key)
    keys.sort()

    for (const key of keys) {
      const seq = walSeqFromKey(key)
      if (seq <= committed) {
        await this.storage.delete(key)
        continue
      }
      const stored = await this.storage.get(key)
      if (!stored) continue
      const record = decodeJSON<WalRecord>(stored.body)
      await this.applyOps(record.ops)
      this.walSeq = Math.max(this.walSeq, seq)
      this.walKeys.push(key)
      await this.makeRoom(0)
    }
  }

  // ---------------------------------------------------------------------------
  // Write path
  // ---------------------------------------------------------------------------

  private isLive(id: string): boolean {
    const seq = this.ids.get(id)
    return seq !== undefined && this.locations[seq] >= 0
  }

  /** Validates `doc` against the schema and returns its ID, as core insert would. */
  private prepare(doc: AnyDocument): string {
    const id = this.template.getDocumentIndexId(doc)
    if (typeof id !== 'string') {
      throw shardedError(`document IDs must be strings, got ${typeof id}`)
    }
    const invalid = this.template.validateSchema(doc, this.template.schema)
    if (invalid) {
      throw shardedError(`the document does not match the schema at property "${invalid}"`)
    }
    return id
  }

  private async updateNow(id: string, doc: AnyDocument): Promise<string> {
    const newId = this.prepare(doc)
    if (newId !== id && this.isLive(newId)) {
      throw shardedError(`a document with id "${newId}" already exists`)
    }
    const ops: WalOp[] = this.isLive(id) ? [{ op: 'remove', id }] : []
    ops.push({ op: 'insert', id: newId, doc })
    await this.commit(ops)
    return newId
  }

  private async commit(ops: WalOp[]): Promise<void> {
    const seq = this.walSeq + 1
    const key = walKey(seq)
    await this.storage.put(key, encodeJSON({ seq, ops } satisfies WalRecord))
    this.walSeq = seq
    this.walKeys.push(key)

    const error = await this.applyOps(ops)
    await this.makeRoom(0)
    if (this.compactEvery > 0 && this.walKeys.length >= this.compactEvery) {
      await this.compactNow()
    }
    if (error) throw error
  }

  /**
   * Applies every op, also after one fails (WAL replay does the same, so a
   * failed write leaves the same state live and after recovery). Returns the
   * first error.
   */
  private async applyOps(ops: WalOp[]): Promise<unknown> {
    let first: unknown
    for (const op of ops) {
      try {
        if (op.op === 'insert') {
          await this.applyInsert(op.id, op.doc)
        } else {
          await this.applyRemove(op.id)
        }
      } catch (error) {
        first ??= error
      }
    }
    return first
  }

  private route(doc: AnyDocument): number {
    let key = ''
    if (this.partitionBy) {
      const value = (this.template.getDocumentProperties(doc, [this.partitionBy]) as Record<string, unknown>)[
        this.partitionBy
      ]
      key = value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
    }

    const list = this.partitions.get(key)
    const last = list?.[list.length - 1]
    if (last !== undefined && this.shards[last].docs < this.maxDocsPerShard) {
      return last
    }

    let target: number
    if (this.packPartitions) {
      target = this.openShard
      if (target < 0 || target === last || this.shards[target].docs >= this.maxDocsPerShard) {
        target = this.createShard()
        this.openShard = target
      }
    } else {
      target = this.createShard()
    }
    if (list) list.push(target)
    else this.partitions.set(key, [target])
    return target
  }

  private setLocation(seq: number, ordinal: number): void {
    if (seq >= this.locations.length) {
      const grown = new Int32Array(Math.max(seq + 1, this.locations.length * 2)).fill(-1)
      grown.set(this.locations)
      this.locations = grown
    }
    this.locations[seq] = ordinal
  }

  private async applyInsert(id: string, doc: AnyDocument): Promise<void> {
    if (this.isLive(id)) {
      throw shardedError(`a document with id "${id}" already exists`)
    }

    const ordinal = this.route(doc)
    const shard = await this.acquire(ordinal)
    try {
      const db = shard.db!
      this.pendingId = id
      try {
        await coreInsert(db, doc)
      } finally {
        this.pendingId = undefined
      }

      const local = db.internalDocumentIDStore.idToInternalId.get(id)!
      let seq = this.ids.get(id)
      if (seq === undefined) {
        seq = this.seqIds.length
        this.seqIds.push(id)
        this.ids.set(id, seq)
      }
      this.setLocation(seq, ordinal)

      const growth = Math.ceil(roughSize(doc) * GROWTH_FACTOR)
      shard.docs++
      shard.dirty = true
      shard.bytes += growth
      this.residentBytes += growth

      // Global statistics. The average field length mirrors core's incremental
      // update (insertDocumentScoreParameters) with the corpus-wide count, so a
      // sharded database inserting in the same order as a single instance holds
      // bit-identical averages.
      const stats = this.stats
      stats.docsCount++
      const n = stats.docsCount
      const index = db.data.index as unknown as IndexShape
      const values = db.getDocumentProperties(doc, this.searchableProps) as Record<string, unknown>

      for (const prop of this.stringProps) {
        const value = values[prop]
        if (value === undefined) continue

        let terms: Iterable<string>
        if (this.fields[prop].isArray) {
          // Core indexes each element on its own: the average is updated once
          // per element, and a term found in several elements is posted (and
          // so counted in the document frequency) once per element.
          const posted: string[] = []
          for (const element of value as string[]) {
            const tokens = db.tokenizer.tokenize(element, undefined, prop)
            stats.avgFieldLength[prop] = ((stats.avgFieldLength[prop] ?? 0) * (n - 1) + tokens.length) / n
            posted.push(...new Set(tokens))
          }
          terms = posted
        } else {
          const length = index.fieldLengths[prop][local]!
          stats.avgFieldLength[prop] = ((stats.avgFieldLength[prop] ?? 0) * (n - 1) + length) / n
          terms = Object.keys(index.frequencies[prop][local] ?? {})
        }

        stats.addTerms(prop, terms)
        shard.summary.addTerms(prop, terms)
      }

      for (const prop of this.valueProps) shard.summary.addValue(prop, this.fields[prop], values[prop])
      for (const prop of this.vectorProps) {
        const value = values[prop]
        if (value) shard.summary.addVector(prop, value as unknown as ArrayLike<number>)
      }
    } finally {
      this.release(shard)
    }
  }

  private async applyRemove(id: string): Promise<boolean> {
    const seq = this.ids.get(id)
    if (seq === undefined || this.locations[seq] < 0) {
      return false
    }

    const shard = await this.acquire(this.locations[seq])
    try {
      const db = shard.db!
      const local = db.internalDocumentIDStore.idToInternalId.get(id)
      const doc = local === undefined ? undefined : db.documentsStore.get(db.data.docs, local)
      if (!doc || local === undefined) {
        throw shardedError(`document "${id}" is missing from shard ${shard.ordinal}`)
      }

      // Mirrors core's removeDocumentScoreParameters with the corpus-wide count,
      // including its per-element updates of array properties.
      const stats = this.stats
      const n = stats.docsCount
      const index = db.data.index as unknown as IndexShape
      const values = db.getDocumentProperties(doc, this.searchableProps) as Record<string, unknown>
      const removedTerms: [string, Iterable<string>][] = []

      for (const prop of this.stringProps) {
        const value = values[prop]
        const isArray = this.fields[prop].isArray
        const frequencies = index.frequencies[prop]?.[local]

        if (value === undefined) {
          // Indexed but not stored (store.exclude): core's removeUnstored updates the
          // average once and drops every posting of the terms it kept for the document.
          const termIds = index.unstoredTerms?.[prop]?.docs[local]
          if (!frequencies && !termIds) continue
          const terms = new Set<string>(frequencies ? Object.keys(frequencies) : [])
          if (termIds) {
            for (const termId of termIds) terms.add(index.unstoredTerms![prop].terms[termId])
          }
          stats.avgFieldLength[prop] =
            n > 1
              ? ((stats.avgFieldLength[prop] as number) * n - (index.fieldLengths[prop][local] as number)) / (n - 1)
              : undefined
          removedTerms.push([prop, isArray ? postedTerms(index, prop, local, terms) : terms])
          continue
        }

        // Mirrors core's remove(): one score-parameters update per element, the
        // stored field length being cleared after the first.
        let fieldLength = index.fieldLengths[prop][local]
        const elements = isArray ? (value as string[]) : [value]
        for (let i = 0; i < elements.length; i++) {
          stats.avgFieldLength[prop] =
            n > 1 ? ((stats.avgFieldLength[prop] as number) * n - (fieldLength as number)) / (n - 1) : undefined
          fieldLength = undefined
        }

        if (isArray) {
          const terms = new Set<string>()
          for (const element of value as string[]) {
            for (const token of db.tokenizer.tokenize(element, undefined, prop)) terms.add(token)
          }
          removedTerms.push([prop, postedTerms(index, prop, local, terms)])
        } else {
          removedTerms.push([prop, Object.keys(frequencies ?? {})])
        }
      }

      await coreRemove(db, id)

      for (const [prop, terms] of removedTerms) stats.removeTerms(prop, terms)
      stats.docsCount--
      this.locations[seq] = -1
      shard.docs--
      shard.dirty = true
      return true
    } finally {
      this.release(shard)
    }
  }

  // ---------------------------------------------------------------------------
  // Query path
  // ---------------------------------------------------------------------------

  private localSeqs(shard: Shard): Int32Array {
    const ids = shard.db!.internalDocumentIDStore.internalIdToId
    if (!shard.localSeq || shard.localSeq.length !== ids.length + 1) {
      const seqs = new Int32Array(ids.length + 1).fill(-1)
      for (let i = 0; i < ids.length; i++) {
        seqs[i + 1] = this.ids.get(ids[i]) ?? -1
      }
      shard.localSeq = seqs
    }
    return shard.localSeq
  }

  private toEntries(shard: Shard, scores: TokenScore[], seqs: Int32Array): Entry[] {
    const entries: Entry[] = new Array(scores.length)
    for (let i = 0; i < scores.length; i++) {
      const [local, score] = scores[i]
      entries[i] = { score, seq: seqs[local], ordinal: shard.ordinal, local }
    }
    return entries
  }

  /** Reads the hit documents of `entries` while their shard is loaded, with vectors set as core sets them. */
  private prefetch(shard: Shard, entries: Entry[], into: Map<string, PrefetchedDoc>): void {
    const db = shard.db!
    for (const entry of entries) {
      const key = `${entry.ordinal}:${entry.local}`
      if (into.has(key)) continue
      const id = db.internalDocumentIDStore.internalIdToId[entry.local - 1]
      const doc = db.documentsStore.get(db.data.docs, entry.local) as AnyDocument | undefined
      if (!doc) {
        into.set(key, { id, doc: undefined })
        continue
      }
      // Rebuilds unstored vectors from the shard's vector index, or nulls them; never touches the stored document.
      const hit = { id, score: 0, document: doc }
      internals.setHitsVectors(db, [hit], this.hitVectors.include, this.hitVectors.props)
      into.set(key, { id, doc: hit.document as AnyDocument })
    }
  }

  private async searchNow(params: ShardedSearchParams, language: string | undefined): Promise<ShardedResults> {
    const start = internals.getNanosecondsTime()
    const loadsBefore = this.counters.loads

    for (const key of UNSUPPORTED_PARAMS) {
      if ((params as Record<string, unknown>)[key] !== undefined) {
        throw shardedError(`the "${key}" search option is not supported by sharded databases`)
      }
    }

    const mode = params.mode ?? 'fulltext'
    // Vector searches null only the queried property, full-text and hybrid ones every vector property (as core).
    this.hitVectors = {
      include: Boolean(params.includeVectors),
      props: mode === 'vector' && params.vector ? [params.vector.property] : this.vectorProps
    }
    const limit = params.limit ?? 10
    const offset = params.offset ?? 0
    const k = offset + limit
    const term = params.term ?? ''
    const where = params.where && Object.keys(params.where).length > 0 ? params.where : undefined
    const threshold = params.threshold ?? 1
    const fractional = threshold > 0 && threshold < 1
    const hasText = mode === 'fulltext' || (mode === 'hybrid' && (Boolean(params.term) || Boolean(params.properties)))
    const hasVector = mode === 'vector' || mode === 'hybrid'
    const template = this.template

    // Validate against the empty template so errors match core's even when every shard is pruned.
    if (where) {
      this.validateWhere(where)
    }
    const props = internals.getPropertiesToSearch(template, params.properties) as string[]
    if (hasVector) {
      internals.innerVectorSearch(
        template,
        { vector: params.vector, similarity: params.similarity } as never,
        undefined
      )
    }
    if (fractional && params.exact && term) {
      throw shardedError('"exact" with a threshold between 0 and 1 is not supported by sharded databases')
    }

    if (mode === 'fulltext' && !term && !where && !params.properties) {
      return this.browse(params, start, loadsBefore)
    }

    const queryTokens = hasText && term ? internalsUniqueTokens(template.tokenizer.tokenize(term, language)) : []
    const prefix = params.prefix ?? true
    const tolerance = params.tolerance ?? 0
    const radixExact = Boolean(term) && (Boolean(params.exact) || (!prefix && !tolerance))
    // Core scores a multi-term threshold-0 query only over the properties where
    // some document of the whole corpus holds every term: a corpus-wide fact,
    // so shards report per-property scores and the merge picks the properties.
    const zeroMode = hasText && threshold === 0 && queryTokens.length > 1
    if (zeroMode && params.exact && tolerance) {
      throw shardedError('"exact" with "tolerance" and a threshold of 0 is not supported by sharded databases')
    }

    // ---- Pruning ----------------------------------------------------------
    const nonEmpty = this.shards.filter((shard) => shard.docs > 0)
    let candidates = nonEmpty
    if (where) {
      const tokenize = (value: string, prop: string) => template.tokenizer.tokenize(value, language, prop)
      candidates = candidates.filter((shard) => shard.summary.mayMatchWhere(where, this.fields, tokenize))
    }
    const whereCandidates = new Set(candidates)

    let textMay: (shard: Shard) => boolean = () => hasText
    if (queryTokens.length > 0) {
      const tokens = queryTokens
      // Per token: the dictionary words it resolves to in each property, or undefined if it cannot prune.
      const expansions = tokens.map((token) => {
        const perProp: [string, string[]][] = []
        for (const prop of props) {
          const words = this.stats.expand(prop, token, radixExact, tolerance)
          if (!words) return undefined
          if (words.length) perProp.push([prop, words])
        }
        return perProp
      })
      const present = (shard: Shard, i: number) => {
        const perProp = expansions[i]
        return !perProp || perProp.some(([prop, words]) => words.some((word) => shard.summary.hasTerm(prop, word)))
      }
      const all = threshold === 0 && tokens.length > 1
      if (tokens.length > 0) {
        textMay = (shard) =>
          all ? tokens.every((_, i) => present(shard, i)) : tokens.some((_, i) => present(shard, i))
      }
    }

    let vectorMay: (shard: Shard) => boolean = () => false
    let query: Float64Array | undefined
    if (hasVector) {
      query = normalizeVector(params.vector!.value)
      const similarity = params.similarity ?? DEFAULT_SIMILARITY
      const prop = params.vector!.property
      // Similarity bounds are exact for the exact flat index only: quantized indexes score approximately.
      const exactIndex = template.data.index.vectorIndexes[prop]?.node instanceof VectorIndex
      const bound = (shard: Shard, q: Float64Array) =>
        exactIndex
          ? shard.summary.vectorUpperBound(prop, q)
          : shard.summary.vectorUpperBound(prop, q) > -Infinity
            ? 1
            : -Infinity
      let allowed: Set<Shard> | undefined
      if (query && params.vectorProbe !== undefined) {
        const q = query
        allowed = new Set(
          candidates
            .filter((shard) => bound(shard, q) >= similarity - VECTOR_BOUND_EPSILON)
            .sort((a, b) => b.summary.centroidSimilarity(prop, q) - a.summary.centroidSimilarity(prop, q))
            .slice(0, Math.max(1, params.vectorProbe))
        )
      }
      vectorMay = (shard) =>
        query !== undefined &&
        (!allowed || allowed.has(shard)) &&
        bound(shard, query) >= similarity - VECTOR_BOUND_EPSILON
    }

    const plan = (zeroMode ? nonEmpty : candidates)
      .map((shard) => {
        const inWhere = whereCandidates.has(shard)
        const termMatch = hasText && textMay(shard)
        return {
          shard,
          text: inWhere && termMatch,
          vector: inWhere && hasVector && vectorMay(shard),
          // Outside the filter, a threshold-0 shard only tells which properties hold every term.
          probe: zeroMode && termMatch && !inWhere
        }
      })
      .filter((item) => item.text || item.vector || item.probe)
      // Loaded shards first: they cost nothing and are less likely to be evicted mid-query.
      .sort((a, b) => Number(Boolean(b.shard.db)) - Number(Boolean(a.shard.db)) || a.shard.ordinal - b.shard.ordinal)

    // ---- Per-shard scoring --------------------------------------------------
    const textParams = {
      term: params.term,
      properties: params.properties,
      exact: params.exact,
      prefix: params.prefix,
      tolerance: params.tolerance,
      boost: params.boost,
      relevance: params.relevance,
      where,
      threshold: fractional ? 1 : threshold
    }
    // Indexes that rescore a candidate set size it from limit + offset, as in a single instance.
    const vectorParams = { vector: params.vector, similarity: params.similarity, where, limit, offset }
    const prefetched = new Map<string, PrefetchedDoc>()

    // fulltext / vector: running top-k (per threshold group) and counts.
    let fullBest: Entry[] = []
    let partialBest: Entry[] = []
    let fullCount = 0
    let partialCount = 0
    // hybrid: every scored entry, merged at the end with global maxima.
    const textAll: { entry: Entry; full: boolean }[] = []
    const vectorAll: Entry[] = []
    // threshold 0: properties holding every term somewhere, and per-property scores of the candidates.
    const matchingProps = new Set<number>()
    const zeroEntries: { entry: Entry; parts: Float64Array }[] = []

    for (const { shard: planned, text, vector, probe } of plan) {
      if (probe && !text && !vector && matchingProps.size === props.length) {
        continue
      }
      const shard = await this.acquire(planned.ordinal)
      try {
        const db = shard.db!
        const seqs = this.localSeqs(shard)
        const whereIds = where
          ? db.index.searchByWhereClause(db.data.index, db.tokenizer, where as never, language)
          : undefined

        let textEntries: Entry[] = []
        let fullIds: Set<number> | undefined
        if (zeroMode && (text || probe)) {
          const scored = this.zeroThresholdScores(db, shard, props, queryTokens, radixExact, tolerance, {
            matchingProps,
            score: text,
            whereIds,
            textParams,
            params,
            language
          })
          zeroEntries.push(...scored)
          if (text && mode === 'fulltext') {
            // Likely hits, assuming every property matches.
            this.prefetch(
              shard,
              topK(
                scored.map(({ entry, parts }) => ({ ...entry, score: sum(parts) })),
                k
              ),
              prefetched
            )
          }
        } else if (text) {
          const scored = internals.innerFullTextSearch(db, textParams as never, language as never, whereIds)
          textEntries = this.toEntries(shard, scored, seqs)
          if (fractional) {
            fullIds = fullMatchIds(db, term, language, props, params, whereIds)
          }
        }
        let vectorEntries: Entry[] = []
        if (vector) {
          const scored = internals.innerVectorSearch(db, vectorParams as never, language as never, whereIds)
          vectorEntries = this.toEntries(shard, scored as TokenScore[], seqs)
        }

        if (zeroMode && mode === 'fulltext') {
          continue
        }

        if (mode === 'hybrid') {
          for (const entry of textEntries) textAll.push({ entry, full: !fullIds || fullIds.has(entry.local) })
          for (const entry of vectorEntries) vectorAll.push(entry)
          // Likely hits: best local hybrid scores with local maxima.
          this.prefetch(shard, topK(localHybrid(textEntries, vectorEntries, params.hybridWeights), k), prefetched)
          continue
        }

        const entries = mode === 'vector' ? vectorEntries : textEntries
        const full = fullIds ? entries.filter((entry) => fullIds!.has(entry.local)) : entries
        const partial = fullIds ? entries.filter((entry) => !fullIds!.has(entry.local)) : []
        fullCount += full.length
        partialCount += partial.length

        const localFull = topK(full, k)
        const localPartial = topK(partial, k)
        this.prefetch(shard, localFull, prefetched)
        this.prefetch(shard, localPartial, prefetched)
        fullBest = topK([...fullBest, ...localFull], k)
        partialBest = topK([...partialBest, ...localPartial], k)

        // Drop documents that can no longer reach the page.
        if (prefetched.size > 4 * k + 64) {
          const keep = new Set([...fullBest, ...partialBest].map((entry) => `${entry.ordinal}:${entry.local}`))
          for (const key of prefetched.keys()) if (!keep.has(key)) prefetched.delete(key)
        }
      } finally {
        this.release(shard)
      }
    }

    // ---- Global merge -------------------------------------------------------
    let ranked: Entry[]
    let count: number

    if (zeroMode) {
      for (const { entry, parts } of zeroEntries) {
        let score = 0
        for (let i = 0; i < parts.length; i++) {
          if (matchingProps.has(i)) score += parts[i]
        }
        entry.score = score
        textAll.push({ entry, full: true })
      }
    }

    if (zeroMode && mode === 'fulltext') {
      count = textAll.length
      ranked = topK(
        textAll.map(({ entry }) => entry),
        k
      )
    } else if (mode === 'hybrid') {
      let textList = textAll.map(({ entry }) => entry)
      if (fractional) {
        textList = applyThreshold(
          textAll.filter((item) => item.full).map((item) => item.entry),
          textAll.filter((item) => !item.full).map((item) => item.entry),
          threshold
        )
      }
      const merged = mergeHybrid(textList, vectorAll, params.hybridWeights)
      count = merged.length
      ranked = topK(merged, k)
    } else if (fractional && fullCount > 0) {
      const included = Math.ceil(partialCount * threshold)
      count = fullCount + included
      ranked = topK([...fullBest, ...partialBest.slice(0, included)], k)
    } else {
      count = fullCount + partialCount
      ranked = topK([...fullBest, ...partialBest], k)
    }

    const page = params.preflight ? [] : ranked.slice(offset, k)
    const hits = await this.fetchHits(page, prefetched)

    return this.results(count, hits, start, loadsBefore, plan.length)
  }

  /**
   * Threshold 0 with several terms, one shard. Records in `matchingProps` the
   * properties where a document of this shard holds every term (core decides
   * this before applying filters), and when `score` is set returns the
   * candidates (documents holding every term in some property and passing the
   * filters) with their score in each property.
   */
  private validateWhere(where: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(where)) {
      if (key === 'and' || key === 'or') {
        for (const clause of (value as Record<string, unknown>[]) ?? []) this.validateWhere(clause)
      } else if (key === 'not') {
        this.validateWhere(value as Record<string, unknown>)
      } else if (!this.fields[key] || this.fields[key].kind === 'vector') {
        throw shardedError(`Unknown filter property "${key}".`)
      }
    }
  }

  private zeroThresholdScores(
    db: AnyZBSearch,
    shard: Shard,
    props: string[],
    tokens: string[],
    radixExact: boolean,
    tolerance: number,
    context: {
      matchingProps: Set<number>
      score: boolean
      whereIds: Set<number> | undefined
      textParams: Record<string, unknown>
      params: ShardedSearchParams
      language: string | undefined
    }
  ): { entry: Entry; parts: Float64Array }[] {
    const { matchingProps, whereIds, params, language } = context
    const holders = props.map((prop) => docsWithEveryToken(db, prop, tokens, radixExact, tolerance))
    holders.forEach((ids, i) => {
      if (ids.size) matchingProps.add(i)
    })
    if (!context.score) {
      return []
    }

    let candidates = new Set<number>()
    for (const ids of holders) {
      for (const id of ids) {
        if (!whereIds || whereIds.has(id)) candidates.add(id)
      }
    }
    if (params.exact && params.term) {
      candidates = new Set([...candidates].filter((id) => exactMatch(db, id, props, params.term!)))
    }
    if (!candidates.size) {
      return []
    }

    const seqs = this.localSeqs(shard)
    const parts = new Map<number, Float64Array>()
    props.forEach((prop, i) => {
      const scored = internals.innerFullTextSearch(
        db,
        {
          ...context.textParams,
          properties: [prop],
          threshold: 1,
          // Core's exact check looks at every searched property: done above.
          ...(params.exact ? { exact: false, prefix: false, tolerance: 0 } : {})
        } as never,
        language as never,
        whereIds
      )
      for (const [id, score] of scored) {
        if (!candidates.has(id)) continue
        let row = parts.get(id)
        if (!row) parts.set(id, (row = new Float64Array(props.length)))
        row[i] = score
      }
    })

    return [...parts].map(([local, row]) => ({
      entry: { score: 0, seq: seqs[local], ordinal: shard.ordinal, local },
      parts: row
    }))
  }

  private async fetchHits(page: Entry[], prefetched: Map<string, PrefetchedDoc>): Promise<Result<AnyDocument>[]> {
    const hits: Result<AnyDocument>[] = []
    for (const entry of page) {
      let found = prefetched.get(`${entry.ordinal}:${entry.local}`)
      if (!found) {
        const shard = await this.acquire(entry.ordinal)
        try {
          this.prefetch(shard, [entry], prefetched)
          found = prefetched.get(`${entry.ordinal}:${entry.local}`)!
        } finally {
          this.release(shard)
        }
      }
      if (found.doc) {
        hits.push({ id: found.id, score: entry.score, document: found.doc })
      }
    }
    return hits
  }

  /** No term, filter or properties: every document, in insertion order, as core lists them. */
  private async browse(params: ShardedSearchParams, start: bigint | number, loadsBefore: number) {
    const offset = params.offset ?? 0
    const k = offset + (params.limit ?? 10)
    const page: Entry[] = []
    let seen = 0
    if (!params.preflight) {
      for (let seq = 0; seq < this.seqIds.length && seen < k; seq++) {
        const ordinal = this.locations[seq]
        if (ordinal < 0) continue
        if (seen++ >= offset) {
          const shard = await this.acquire(ordinal)
          try {
            const local = shard.db!.internalDocumentIDStore.idToInternalId.get(this.seqIds[seq])!
            page.push({ score: 0, seq, ordinal, local })
          } finally {
            this.release(shard)
          }
        }
      }
    }
    const prefetched = new Map<string, PrefetchedDoc>()
    this.hitVectors = { include: Boolean(params.includeVectors), props: this.vectorProps }
    const hits = await this.fetchHits(page, prefetched)
    return this.results(this.stats.docsCount, hits, start, loadsBefore, this.shards.length)
  }

  private async results(
    count: number,
    hits: Result<AnyDocument>[],
    start: bigint | number,
    loadsBefore: number,
    candidates: number
  ): Promise<ShardedResults> {
    await this.makeRoom(0)
    const elapsed = (internals.getNanosecondsTime() as bigint) - (start as bigint)
    return {
      count,
      hits,
      elapsed: { raw: Number(elapsed), formatted: internals.formatNanoseconds(elapsed) as string },
      shards: { total: this.shards.length, candidates, loaded: this.counters.loads - loadsBefore }
    }
  }
}

function internalsUniqueTokens(tokens: string[]): string[] {
  return tokens.length > 1 ? Array.from(new Set(tokens)) : tokens
}

/**
 * The documents of a shard that core's threshold handling counts as matching
 * every keyword in at least one property (search() in core's index component,
 * trackKeywordMatches): the threshold is applied across shards afterwards.
 */
function fullMatchIds(
  db: AnyZBSearch,
  term: string,
  language: string | undefined,
  props: string[],
  params: ShardedSearchParams,
  whereIds: Set<number> | undefined
): Set<number> {
  const tokens = internalsUniqueTokens(db.tokenizer.tokenize(term, language))
  const keywordsCount = tokens.length || 1
  if (!tokens.length && !term) tokens.push('')
  const prefix = params.prefix ?? true
  const tolerance = params.tolerance ?? 0
  const radixExact = term ? Boolean(params.exact) || (!prefix && !tolerance) : false

  const index = db.data.index as unknown as {
    indexes: Record<string, { node: { find(p: object): Record<string, number[]> } }>
  }
  const full = new Set<number>()
  for (const prop of props) {
    const tree = index.indexes[prop]
    if (!tree) continue
    const counts = new Map<number, number>()
    for (const token of tokens) {
      const found = tree.node.find({ term: token, exact: radixExact, tolerance })
      for (const word in found) {
        for (const id of found[word]) {
          if (whereIds && !whereIds.has(id)) continue
          counts.set(id, (counts.get(id) ?? 0) + 1)
        }
      }
    }
    for (const [id, matches] of counts) {
      if (matches === keywordsCount) full.add(id)
    }
  }
  return full
}

/**
 * Each term of `terms` once per posting of document `local` (a string[] value
 * posts a term once per element holding it): removing the document lowers the
 * term's document frequency by as much.
 */
function postedTerms(index: IndexShape, prop: string, local: number, terms: Iterable<string>): string[] {
  const postings = index.indexes[prop]?.node.postings
  const out: string[] = []
  for (const term of terms) {
    const list = postings?.get(term)
    if (!list) continue
    for (const id of list) {
      if (id === local) out.push(term)
    }
  }
  return out
}

function sum(values: Float64Array): number {
  let total = 0
  for (const value of values) total += value
  return total
}

interface RadixLike {
  find(params: { term: string; exact: boolean; tolerance: number }): Record<string, number[]>
}

/** Documents of `db` holding every token in `prop`, filters not applied (core's searchThresholdZero). */
function docsWithEveryToken(
  db: AnyZBSearch,
  prop: string,
  tokens: string[],
  radixExact: boolean,
  tolerance: number
): Set<number> {
  const tree = (db.data.index as unknown as { indexes: Record<string, { node: RadixLike } | undefined> }).indexes[prop]
  if (!tree) return new Set()
  let result: Set<number> | undefined
  for (const token of tokens) {
    const found = tree.node.find({ term: token, exact: radixExact, tolerance })
    const ids = new Set<number>()
    for (const word in found) {
      for (const id of found[word]) {
        if (!result || result.has(id)) ids.add(id)
      }
    }
    result = ids
    if (!result.size) break
  }
  return result ?? new Set()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Core's exact check: some searched property contains every whitespace-separated term as a whole word, case-sensitively. */
function exactMatch(db: AnyZBSearch, local: number, props: string[], term: string): boolean {
  const doc = db.documentsStore.get(db.data.docs, local)
  if (!doc) return false
  const regexes = term
    .trim()
    .split(/\s+/)
    .map((word) => new RegExp(`\\b${escapeRegex(word)}\\b`))
  // As core: properties excluded from the documents store cannot be checked, and keep the document.
  const excluded = (db as { store?: { exclude: string[] } }).store?.exclude ?? []
  const isExcluded = (prop: string) => excluded.some((path) => prop === path || prop.startsWith(`${path}.`))
  const verifiable = props.filter((prop) => !isExcluded(prop))
  const values = db.getDocumentProperties(doc, verifiable) as Record<string, unknown>
  return (
    verifiable.some((prop) => {
      const value = values[prop]
      return typeof value === 'string' && regexes.every((regex) => regex.test(value))
    }) || verifiable.length < props.length
  )
}

/** Core's threshold rule: every full match plus the best ceil(partials × threshold) partial matches, or everything when nothing fully matches. */
function applyThreshold(full: Entry[], partial: Entry[], threshold: number): Entry[] {
  if (full.length === 0) {
    return partial
  }
  const included = Math.ceil(partial.length * threshold)
  return [...full, ...partial.sort(compareEntries).slice(0, included)]
}

function hybridWeightsOf(weights: HybridWeights | undefined): { text: number; vector: number } {
  return weights && typeof weights.text === 'number' && typeof weights.vector === 'number'
    ? weights
    : { text: 0.5, vector: 0.5 }
}

/** Core's mergeAndRankResults, over entries from every shard. */
function mergeHybrid(text: Entry[], vector: Entry[], weights: HybridWeights | undefined): Entry[] {
  const { text: textWeight, vector: vectorWeight } = hybridWeightsOf(weights)
  const hybridScore = (textScore: number, vectorScore: number) => textScore * textWeight + vectorScore * vectorWeight
  const maxText = maxScore(text)
  const maxVector = maxScore(vector)
  const merged = new Map<string, Entry>()

  for (const entry of text) {
    const normalized = maxText > 0 ? entry.score / maxText : 0
    merged.set(`${entry.ordinal}:${entry.local}`, { ...entry, score: hybridScore(normalized, 0) })
  }
  for (const entry of vector) {
    const normalized = maxVector > 0 ? entry.score / maxVector : 0
    const key = `${entry.ordinal}:${entry.local}`
    const existing = merged.get(key)
    merged.set(key, { ...entry, score: (existing?.score ?? 0) + hybridScore(0, normalized) })
  }
  return [...merged.values()]
}

/** Hybrid scores with one shard's own maxima: only used to guess which documents to keep while the shard is loaded. */
function localHybrid(text: Entry[], vector: Entry[], weights: HybridWeights | undefined): Entry[] {
  return mergeHybrid(text, vector, weights)
}
