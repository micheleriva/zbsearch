import { describe, expect, it } from 'vitest'
import {
  BINARY_SNAPSHOT_VERSION,
  count,
  create,
  getByID,
  insert,
  insertMultiple,
  insertPin,
  isBinarySnapshot,
  load,
  loadBinary,
  loadBinarySync,
  remove,
  save,
  saveBinary,
  saveBinarySync,
  search,
  searchVector,
  update
} from '../src/index.js'
import type { AnyZBSearch, VectorIndexBinarySnapshot, VectorIndexFactory } from '../src/index.js'
import { createIndex } from '../src/components/index.js'
import { createSorter } from '../src/components/sorter.js'
import { createDocumentsStore } from '../src/components/documents-store.js'
import { ivf } from '../src/trees/vector-ivf.js'
import { flat, VectorIndex } from '../src/trees/vector.js'
import { createFlatVectorIndexFactory, deserializeVectorIndexBinary } from '../src/trees/vector-index.js'
import { packDocumentIds } from '../src/trees/vector-snapshot.js'
import {
  ByteReader,
  ByteWriter,
  crc32,
  decodeValue,
  encodeValue,
  estimateJsonLength,
  KeyDictionary
} from '../src/methods/binary-codec.js'

const schema = {
  id: 'string',
  title: 'string',
  description: 'string',
  rating: 'number',
  year: 'number',
  available: 'boolean',
  genre: 'enum',
  genres: 'enum[]',
  tags: 'string[]',
  scores: 'number[]',
  flags: 'boolean[]',
  location: 'geopoint',
  meta: {
    author: 'string',
    pages: 'number'
  },
  embedding: 'vector[8]'
} as const

const WORDS = ['quick', 'brown', 'fox', 'lazy', 'dog', 'über', 'naïve', 'café', '東京', 'jumps', 'over', 'river']

function vector(i: number): number[] {
  return Array.from({ length: 8 }, (_, d) => Math.sin(i * 7 + d * 3) + (d === i % 8 ? 2 : 0))
}

function makeDoc(i: number) {
  return {
    id: `doc-${i}`,
    title: `${WORDS[i % WORDS.length]} title ${i} ${WORDS[(i * 7) % WORDS.length]}`,
    description: Array.from({ length: 12 }, (_, j) => WORDS[(i * 3 + j * j) % WORDS.length]).join(' ') + ` n${i}`,
    rating: (i % 50) / 10,
    year: 1990 + (i % 35),
    available: i % 3 === 0,
    genre: `g${i % 5}`,
    genres: [`genre-${i % 11}`, `genre-${i % 5}`],
    tags: [`tag-${i % 13}`, WORDS[i % WORDS.length]],
    scores: [i % 7, (i % 9) / 2],
    flags: [i % 2 === 0, i % 5 === 0],
    location: { lat: -80 + ((i * 7) % 160), lon: -170 + ((i * 13) % 340) },
    meta: { author: `author ${i % 17}`, pages: 10 + (i % 300) },
    embedding: vector(i)
  }
}

type DB = AnyZBSearch

function populated(howMany: number, options: Parameters<typeof create>[0] | Record<string, unknown> = {}): DB {
  const db = create({ schema, ...options } as Parameters<typeof create>[0]) as unknown as DB
  insertMultiple(db as any, Array.from({ length: howMany }, (_, i) => makeDoc(i)))
  return db
}

function empty(options: Record<string, unknown> = {}): DB {
  return create({ schema: { __placeholder: 'string' }, ...options } as any) as unknown as DB
}

function normalized(db: DB): unknown {
  return JSON.parse(JSON.stringify(save(db)))
}

function probe(db: DB) {
  const out: Record<string, unknown> = {}
  const hitIds = (res: { hits: { id: string; score: number }[] }) => res.hits.map((h) => [h.id, h.score])

  for (const term of ['fox', 'lazy dog', 'café', '東京', 'title', 'n17']) {
    out[term] = hitIds(search(db, { term, limit: 20, includeVectors: true }) as any)
  }
  out['typo'] = (search(db, { term: 'jumsp', tolerance: 2, includeVectors: true }) as any).count
  out['where'] = hitIds(
    search(db, {
      term: 'fox',
      where: {
        rating: { gt: 2 },
        available: true,
        genres: { containsAll: ['genre-1'] },
        tags: 'river',
        scores: { gte: 3 },
        flags: true,
        'meta.pages': { lt: 200 }
      },
      includeVectors: true
    } as any) as any
  )
  out['enum'] = hitIds(search(db, { where: { genre: { eq: 'g2' } }, limit: 50, includeVectors: true } as any) as any)
  out['geo'] = hitIds(
    search(db, {
      where: { location: { radius: { coordinates: { lat: 0, lon: 0 }, unit: 'km', value: 3000, inside: true } } },
      limit: 50,
      includeVectors: true
    } as any) as any
  )
  out['sorted'] = (
    search(db, { term: 'title', sortBy: { property: 'year', order: 'DESC' }, limit: 30, includeVectors: true } as any) as any
  ).hits.map((h: any) => h.id)
  out['sortedText'] = (
    search(db, { sortBy: { property: 'title' }, limit: 30, includeVectors: true } as any) as any
  ).hits.map((h: any) => h.id)
  out['facets'] = (
    search(db, { term: 'fox', facets: { genre: {}, year: { ranges: [{ from: 1990, to: 2005 }] } }, includeVectors: true } as any) as any
  ).facets
  out['vector'] = hitIds(
    searchVector(db as any, {
      vector: { value: vector(3), property: 'embedding' },
      similarity: 0.1,
      limit: 10,
      includeVectors: true
    }) as any
  )
  out['count'] = count(db as any)
  return out
}

async function collect(iterable: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const out: Uint8Array[] = []
  for await (const chunk of iterable) {
    out.push(chunk)
  }
  return out
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

function split(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += size) {
    out.push(bytes.subarray(i, i + size))
  }
  return out
}

async function expectError(promise: Promise<unknown> | (() => unknown), code: string, message?: RegExp) {
  let error: any
  try {
    await (typeof promise === 'function' ? promise() : promise)
  } catch (e) {
    error = e
  }
  expect(error, `expected ${code}`).toBeDefined()
  expect(error.code).toBe(code)
  if (message) {
    expect(error.message).toMatch(message)
  }
}

describe('binary snapshot round trip', () => {
  it('restores exactly the same state as the JSON save format (sync)', () => {
    const db = populated(300)
    const expected = probe(db)
    const snapshot = saveBinarySync(db as any)

    expect(isBinarySnapshot(snapshot)).toBe(true)
    expect(isBinarySnapshot(snapshot.buffer.slice(0))).toBe(true)

    const restored = empty()
    loadBinarySync(restored as any, snapshot)

    expect(normalized(restored)).toEqual(normalized(db))
    expect(probe(restored)).toEqual(expected)
    expect(getByID(restored as any, 'doc-42')).toEqual(getByID(db as any, 'doc-42'))
  })

  it('restores the same state through the streaming API at any segment and chunk size', async () => {
    const db = populated(250)
    const expected = normalized(db)
    const results = probe(db)

    for (const segmentSize of [1024, 4096, 64 * 1024, 1024 * 1024]) {
      const segments = await collect(saveBinary(db as any, { segmentSize }))
      const bytes = concat(segments)
      expect(bytes).toEqual(saveBinarySync(db as any, { segmentSize }))

      for (const chunkSize of [1, 7, 1000, 1 << 20]) {
        if (chunkSize === 1 && segmentSize > 4096) {
          continue
        }
        const restored = empty()
        await loadBinary(restored as any, split(bytes, chunkSize))
        expect(normalized(restored), `segment ${segmentSize}, chunk ${chunkSize}`).toEqual(expected)
      }

      const restored = empty()
      await loadBinary(restored as any, saveBinary(db as any, { segmentSize }))
      expect(probe(restored)).toEqual(results)
    }
  })

  it('accepts ArrayBuffers, sync iterables, async iterables and ReadableStreams', async () => {
    const db = populated(60)
    const expected = normalized(db)
    const bytes = saveBinarySync(db as any, { segmentSize: 2048 })

    const fromBuffer = empty()
    await loadBinary(fromBuffer as any, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    expect(normalized(fromBuffer)).toEqual(expected)

    const fromArrayBufferChunks = empty()
    loadBinarySync(
      fromArrayBufferChunks as any,
      split(bytes, 333).map((c) => c.slice().buffer)
    )
    expect(normalized(fromArrayBufferChunks)).toEqual(expected)

    const fromViews = empty()
    await loadBinary(
      fromViews as any,
      split(bytes, 512).map((c) => new DataView(c.buffer, c.byteOffset, c.byteLength))
    )
    expect(normalized(fromViews)).toEqual(expected)

    const fromStream = empty()
    const chunks = split(bytes, 999)
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift()
        if (next) {
          controller.enqueue(next)
        } else {
          controller.close()
        }
      }
    })
    // Hide the async iterator to exercise the getReader() path used by browsers without it.
    Object.defineProperty(stream, Symbol.asyncIterator, { value: undefined })
    await loadBinary(fromStream as any, stream)
    expect(normalized(fromStream)).toEqual(expected)
  })

  it('round trips an empty database', async () => {
    const db = create({ schema }) as unknown as DB
    const restored = empty()
    await loadBinary(restored as any, saveBinary(db as any))
    expect(normalized(restored)).toEqual(normalized(db))
    expect(count(restored as any)).toBe(0)
  })

  it('round trips removals, updates, pinning rules and the language', async () => {
    const db = populated(120, { language: 'italian' } as any)
    for (let i = 0; i < 120; i += 7) {
      remove(db as any, `doc-${i}`)
    }
    update(db as any, 'doc-3', { ...makeDoc(3), title: 'a brand new title', rating: 4.9 })
    insertPin(db as any, {
      id: 'promote-fox',
      conditions: [{ anchoring: 'contains', pattern: 'fox' }],
      consequence: { promote: [{ doc_id: 'doc-5', position: 0 }] }
    })

    const restored = empty()
    await loadBinary(restored as any, saveBinary(db as any, { segmentSize: 2048 }))

    expect(normalized(restored)).toEqual(normalized(db))
    expect(restored.tokenizer.language).toBe('italian')
    expect(probe(restored)).toEqual(probe(db))
    expect(search(restored as any, { term: 'fox' }).hits[0].id).toBe('doc-5')
    expect(getByID(restored as any, 'doc-7')).toBeUndefined()

    // The restored database keeps working.
    insert(restored as any, { ...makeDoc(1000), id: 'fresh' })
    expect(getByID(restored as any, 'fresh')).toBeDefined()
    expect(search(restored as any, { term: 'n1000' }).hits.map((h) => h.id)).toEqual(['fresh'])
  })

  it('keeps sorter positions that are not derivable from the sorted order', () => {
    const db = populated(40)
    remove(db as any, 'doc-2')
    save(db as any)
    // A removal leaves stale positions until the next sort; save them as they are.
    const sorts = (db.data.sorting as any).sorts
    sorts.year.docs.set(1, 999)

    const restored = empty()
    loadBinarySync(restored as any, saveBinarySync(db as any))
    expect((restored.data.sorting as any).sorts.year.docs.get(1)).toBe(999)
    expect(normalized(restored)).toEqual(normalized(db))
  })

  it('round trips a database with sorting disabled', () => {
    const db = populated(30, { sort: { enabled: false } } as any)
    const restored = empty()
    loadBinarySync(restored as any, saveBinarySync(db as any))
    expect(normalized(restored)).toEqual(normalized(db))
  })

  it('stores sort values that differ from the documents explicitly', () => {
    const db = populated(30)
    save(db as any)
    const ordered = (db.data.sorting as any).sorts.title.orderedDocs as [number, string][]
    ordered[0] = [ordered[0][0], 'zzz not the document value']

    const restored = empty()
    loadBinarySync(restored as any, saveBinarySync(db as any))
    expect((restored.data.sorting as any).sorts.title.orderedDocs[0][1]).toBe('zzz not the document value')
    expect(normalized(restored)).toEqual(normalized(db))
  })

  it('preserves unusual index content', () => {
    const db = populated(40)
    const index = db.data.index as any
    const radix = index.indexes.title.node

    // A posting list with an id that does not fit 32 bits, and a posted word that has no node.
    radix.postings.get('fox').push(2 ** 40)
    radix.postings.set('orphan', [3, 1, 2])
    // Fractional frequencies, a token unknown to the radix tree and a non-numeric document key.
    index.frequencies.title[5] = { fox: 0.25, unknownToken: 2, other: -3 }
    index.frequencies.title['custom-key'] = { fox: 1 }
    index.frequencies.title[6] = null
    index.fieldLengths.title['custom-key'] = 4.5
    index.fieldLengths.title[7] = 'odd'

    const restored = empty()
    loadBinarySync(restored as any, saveBinarySync(db as any, { segmentSize: 1024 }))
    const restoredIndex = restored.data.index as any

    expect(restoredIndex.indexes.title.node.postings.get('orphan')).toEqual([1, 2, 3])
    expect(restoredIndex.indexes.title.node.postings.get('fox')).toContain(2 ** 40)
    expect(restoredIndex.frequencies.title[5]).toEqual({ fox: 0.25, unknownToken: 2, other: -3 })
    expect(restoredIndex.frequencies.title['custom-key']).toEqual({ fox: 1 })
    expect(restoredIndex.frequencies.title[6]).toBeNull()
    expect(restoredIndex.fieldLengths.title['custom-key']).toBe(4.5)
    expect(restoredIndex.fieldLengths.title[7]).toBe('odd')
    expect(normalized(restored)).toEqual(normalized(db))
  })
})

describe('binary snapshot store settings', () => {
  const allPaths = [
    'title',
    'description',
    'rating',
    'year',
    'available',
    'genre',
    'genres',
    'tags',
    'scores',
    'flags',
    'location',
    'meta',
    'embedding'
  ]

  function indexIsEmpty(db: DB) {
    const index = db.data.index as any
    for (const prop of ['title', 'description', 'tags']) {
      expect(index.indexes[prop].node.postings.size, prop).toBe(0)
    }
    for (const prop of ['rating', 'year', 'scores', 'meta.pages']) {
      expect(search(db as any, { where: { [prop]: { gte: -1000 } } } as any).count, prop).toBe(0)
    }
    expect(index.indexes.genre.node.numberToDocumentId.size).toBe(0)
    expect(Object.keys(index.unstoredValues.rating ?? {})).toHaveLength(0)
    expect(Object.keys(index.unstoredTerms.tags?.docs ?? {})).toHaveLength(0)
    expect(search(db as any, { where: { available: true } } as any).count).toBe(0)
  }

  it('restores excluded fields so that remove and update still clean the index', async () => {
    const store = { exclude: allPaths }
    const db = populated(60, { store } as any)
    expect(Object.keys(getByID(db as any, 'doc-1')!)).toEqual(['id'])

    // Loaded into a database created without the option: the snapshot's settings win.
    const restored = empty()
    await loadBinary(restored as any, saveBinary(db as any, { segmentSize: 1024 }))

    expect(restored.store).toEqual({ exclude: allPaths, vectors: false })
    expect(normalized(restored)).toEqual(normalized(db))
    const index = restored.data.index as any
    expect(index.unstoredTerms.tags.docs[1]).toBeInstanceOf(Uint32Array)
    expect(index.unstoredTerms.tags.termIds.get(index.unstoredTerms.tags.terms[0])).toBe(0)
    const excludedProbe = (target: DB) => [
      search(target as any, { term: 'fox lazy', limit: 20 }).hits.map((h) => [h.id, h.score]),
      search(target as any, { where: { rating: { gt: 2 }, genres: { containsAll: ['genre-1'] } } } as any).hits.map(
        (h) => h.id
      ),
      search(target as any, { term: 'title', sortBy: { property: 'year' } } as any).hits.map((h) => h.id),
      searchVector(target as any, {
        vector: { value: vector(3), property: 'embedding' },
        includeVectors: true
      } as any).hits.map((h) => [h.id, h.document])
    ]
    expect(excludedProbe(restored)).toEqual(excludedProbe(db))

    update(restored as any, 'doc-5', { ...makeDoc(5), title: 'replaced heading', tags: ['replaced'] })
    expect(search(restored as any, { term: 'replaced' }).hits.map((h) => h.id)).toEqual(['doc-5'])
    expect(getByID(restored as any, 'doc-5')).toEqual({ id: 'doc-5' })

    for (let i = 0; i < 60; i++) {
      remove(restored as any, `doc-${i}`)
    }
    expect(count(restored as any)).toBe(0)
    indexIsEmpty(restored)
  })

  it('keeps vectors in the documents store when asked to, and the create settings for old snapshots', () => {
    const db = populated(20, { store: { vectors: true } } as any)
    expect(getByID(db as any, 'doc-3')!.embedding).toEqual(vector(3))

    const restored = empty({ store: { exclude: ['title'] } })
    loadBinarySync(restored as any, saveBinarySync(db as any))
    expect(restored.store).toEqual({ exclude: [], vectors: true })
    expect(getByID(restored as any, 'doc-3')!.embedding).toEqual(vector(3))

    // A database without store settings (a snapshot from before they existed) keeps the target configuration.
    const legacy = populated(5) as any
    delete legacy.store
    const target = empty({ store: { exclude: ['title'] } })
    loadBinarySync(target as any, saveBinarySync(legacy))
    expect(target.store).toEqual({ exclude: ['title'], vectors: false })
  })
})

describe('binary snapshot vectors', () => {
  it('round trips flat vector indexes as raw float32', () => {
    const db = populated(100)
    const node = (db.data.index as any).vectorIndexes.embedding.node as VectorIndex
    const snapshot = node.toBinarySnapshot()
    expect(snapshot.meta).toEqual({ kind: 'flat', size: 8, count: 100 })
    expect(snapshot.arrays.vectors).toBeInstanceOf(Float32Array)
    expect(snapshot.arrays.vectors.length).toBe(800)
    expect(snapshot.arrays.ids).toBeInstanceOf(Uint32Array)

    const restored = empty()
    loadBinarySync(restored as any, saveBinarySync(db as any, { segmentSize: 1024 }))
    expect((restored.data.index as any).vectorIndexes.embedding.node).toBeInstanceOf(VectorIndex)
    expect(normalized(restored)).toEqual(normalized(db))

    const query = { vector: { value: vector(9), property: 'embedding' }, similarity: 0.2, limit: 15 }
    expect(searchVector(restored as any, query as any).hits.map((h) => [h.id, h.score])).toEqual(
      searchVector(db as any, query as any).hits.map((h) => [h.id, h.score])
    )
  })

  it('round trips trained and untrained IVF indexes', async () => {
    for (const howMany of [10, 200]) {
      const options = { indexes: { embedding: ivf({ nlist: 4, nprobe: 2, trainMin: 50 }) } }
      const db = populated(howMany, options as any)
      remove(db as any, 'doc-1')

      const node = (db.data.index as any).vectorIndexes.embedding.node
      expect(node.toBinarySnapshot().meta).toMatchObject({ kind: 'ivf', trained: howMany >= 50, nlist: 4 })

      const restored = empty(options)
      await loadBinary(restored as any, saveBinary(db as any, { segmentSize: 1024 }))
      const restoredNode = (restored.data.index as any).vectorIndexes.embedding.node

      expect(normalized(restored)).toEqual(normalized(db))
      expect(restoredNode.idToCluster).toEqual(node.idToCluster)

      const query = { vector: { value: vector(9), property: 'embedding' }, similarity: 0.1, limit: 15 }
      expect(searchVector(restored as any, query as any).hits.map((h) => [h.id, h.score])).toEqual(
        searchVector(db as any, query as any).hits.map((h) => [h.id, h.score])
      )

      // Still usable after the restore.
      insert(restored as any, { ...makeDoc(5000), id: 'after-restore' })
      expect(getByID(restored as any, 'after-restore')).toBeDefined()
    }
  })

  it('requires a matching vector index factory', async () => {
    const ivfDb = populated(60, { indexes: { embedding: ivf({ nlist: 2, trainMin: 10 }) } } as any)
    await expectError(
      loadBinary(empty() as any, saveBinary(ivfDb as any)),
      'IVF_INDEX_REQUIRES_FACTORY'
    )

    const flatDb = populated(20)
    await expectError(
      () => loadBinarySync(empty({ indexes: { embedding: ivf() } }) as any, saveBinarySync(flatDb as any)),
      'VECTOR_INDEX_KIND_MISMATCH'
    )

    const legacyFactory = Object.assign((ctx: { dim: number }) => new VectorIndex(ctx.dim), {
      kind: 'flat' as const,
      fromJSON: VectorIndex.fromJSON
    })
    await expectError(
      () => loadBinarySync(empty({ indexes: { embedding: legacyFactory } }) as any, saveBinarySync(flatDb as any)),
      'VECTOR_INDEX_BINARY_UNSUPPORTED'
    )
  })

  it('writes vector indexes without toBinarySnapshot through toJSON', () => {
    class JsonOnlyIndex extends VectorIndex {
      static fromJSON(json: unknown): JsonOnlyIndex {
        const base = VectorIndex.fromJSON(json)
        return Object.assign(Object.create(JsonOnlyIndex.prototype), base)
      }
    }
    Object.defineProperty(JsonOnlyIndex.prototype, 'toBinarySnapshot', { value: undefined })
    const factory: VectorIndexFactory = Object.assign((ctx: { dim: number }) => new JsonOnlyIndex(ctx.dim), {
      kind: 'flat' as const,
      fromJSON: JsonOnlyIndex.fromJSON
    })

    const db = populated(50, { indexes: { embedding: factory } } as any)
    const restored = empty({ indexes: { embedding: factory } })
    loadBinarySync(restored as any, saveBinarySync(db as any, { segmentSize: 1024 }))
    expect((restored.data.index as any).vectorIndexes.embedding.node).toBeInstanceOf(JsonOnlyIndex)
    expect(normalized(restored)).toEqual(normalized(db))
  })

  it('stores snapshot arrays generically, whatever their names and types', () => {
    const arrays = {
      ids: new Uint32Array([1, 2]),
      vectors: new Float32Array([1, 0, 0, 1]),
      codes: new Int8Array([-128, 127]),
      bytes: new Uint8Array([0, 255]),
      offsets: new Int32Array([-5, 5]),
      wide: new Float64Array([Math.PI, -Math.E])
    }
    const received: VectorIndexBinarySnapshot[] = []
    const factory: VectorIndexFactory = Object.assign(
      (ctx: { dim: number }) => {
        const index = new VectorIndex(ctx.dim)
        return Object.assign(index, {
          toBinarySnapshot: () => ({ meta: { kind: 'flat', size: 2, extra: 'yes' }, arrays })
        })
      },
      {
        kind: 'flat' as const,
        fromJSON: VectorIndex.fromJSON,
        fromBinarySnapshot: (snapshot: VectorIndexBinarySnapshot) => {
          received.push(snapshot)
          return VectorIndex.fromBinarySnapshot(snapshot)
        }
      }
    )

    const db = create({ schema: { v: 'vector[2]' }, indexes: { v: factory } } as any)
    const restored = empty({ indexes: { v: factory } })
    loadBinarySync(restored as any, saveBinarySync(db as any))

    expect(received).toHaveLength(1)
    expect(received[0].meta).toEqual({ kind: 'flat', size: 2, extra: 'yes' })
    for (const [name, array] of Object.entries(arrays)) {
      expect(received[0].arrays[name]).toBeInstanceOf(array.constructor)
      expect(Array.from(received[0].arrays[name])).toEqual(Array.from(array))
    }
  })

  it('validates vector snapshots', () => {
    const ok = new VectorIndex(2).toBinarySnapshot()
    expect(() => VectorIndex.fromBinarySnapshot({ meta: { kind: 'flat' }, arrays: ok.arrays })).toThrow(/size/)
    expect(() =>
      VectorIndex.fromBinarySnapshot({
        meta: { kind: 'flat', size: 2 },
        arrays: { ids: new Uint32Array([1]), vectors: new Float32Array(3) }
      })
    ).toThrow(/dimension/)

    const converted = VectorIndex.fromBinarySnapshot({
      meta: { kind: 'flat', size: 2 },
      arrays: { ids: new Uint32Array([4]), vectors: new Float64Array([0.6, 0.8]) }
    })
    expect(converted.find([0.6, 0.8], 0.9, undefined)).toHaveLength(1)

    expect(() =>
      ivf()({ dim: 2, property: 'v' }).constructor.prototype.constructor.fromBinarySnapshot({
        meta: { kind: 'ivf', size: 2, nlist: 1, nprobe: 1, trainMin: 1, centroidCount: 1 },
        arrays: {
          ids: new Uint32Array(0),
          vectors: new Float32Array(0),
          centroids: new Float32Array(1),
          listOffsets: new Uint32Array([0, 0]),
          listIds: new Uint32Array(0)
        }
      })
    ).toThrow(/inconsistent/)

    expect(() =>
      deserializeVectorIndexBinary('v', { meta: {}, arrays: ok.arrays }, { v: flat() })
    ).toThrow(/size/)
    expect(createFlatVectorIndexFactory().fromBinarySnapshot!(ok)).toBeInstanceOf(VectorIndex)
  })

  it('packs document ids that do not fit 32 bits as float64', () => {
    expect(packDocumentIds([1, 2, 3], 3)).toBeInstanceOf(Uint32Array)
    const wide = packDocumentIds([1, 2 ** 40, 3], 3)
    expect(wide).toBeInstanceOf(Float64Array)
    expect(Array.from(wide)).toEqual([1, 2 ** 40, 3])
  })
})

describe('binary snapshot streaming', () => {
  it('yields bounded segments and gives the event loop a turn between them', async () => {
    const db = populated(400)
    const segmentSize = 4096
    let ticks = 0
    const timer = setInterval(() => ticks++, 0)
    const sizes: number[] = []
    const ticksSeen: number[] = []

    for await (const segment of saveBinary(db as any, { segmentSize })) {
      sizes.push(segment.length)
      ticksSeen.push(ticks)
      await new Promise((resolve) => setImmediate(resolve))
    }
    clearInterval(timer)

    expect(sizes.length).toBeGreaterThan(20)
    // file header (16) + segment header (12) + payload, then header + payload, the last one shorter.
    expect(sizes[0]).toBe(16 + 12 + segmentSize)
    for (const size of sizes.slice(1, -1)) {
      expect(size).toBe(12 + segmentSize)
    }
    expect(sizes[sizes.length - 1]).toBeLessThanOrEqual(12 + segmentSize)
    expect(ticksSeen[ticksSeen.length - 1]).toBeGreaterThan(0)
  })

  it('keeps vector data in bounded segments too', async () => {
    const db = create({ schema: { v: 'vector[256]' } } as any)
    insertMultiple(
      db as any,
      Array.from({ length: 64 }, (_, i) => ({ v: Array.from({ length: 256 }, (_, d) => Math.cos(i + d)) }))
    )
    const sizes = (await collect(saveBinary(db as any, { segmentSize: 1024 }))).map((s) => s.length)
    expect(Math.max(...sizes)).toBe(16 + 12 + 1024)
  })

  it('does not block the event loop while loading', async () => {
    const db = populated(1500)
    const bytes = saveBinarySync(db as any, { segmentSize: 16 * 1024 })
    let ticks = 0
    const timer = setInterval(() => ticks++, 1)
    const restored = empty()
    await loadBinary(restored as any, split(bytes, 16 * 1024))
    clearInterval(timer)
    expect(count(restored as any)).toBe(1500)
    expect(ticks).toBeGreaterThan(0)
  })

  it('handles components that save asynchronously', async () => {
    const documentsStore = createDocumentsStore()
    const asyncStore = { ...documentsStore, save: async (store: any) => documentsStore.save(store) }
    const db = create({ schema, components: { documentsStore: asyncStore } } as any) as unknown as DB
    insertMultiple(db as any, [makeDoc(1), makeDoc(2)])

    await expectError(() => saveBinarySync(db as any), 'BINARY_SNAPSHOT_ASYNC_COMPONENT')

    const restored = empty()
    await loadBinary(restored as any, saveBinary(db as any))
    expect(getByID(restored as any, 'doc-2')).toEqual(getByID(db as any, 'doc-2'))
  })

  it('validates the segment size', () => {
    const db = populated(1)
    for (const segmentSize of [0, 100, 1.5, 2 ** 30]) {
      expect(() => saveBinarySync(db as any, { segmentSize })).toThrow(/segmentSize/)
    }
  })
})

describe('binary snapshot integrity', () => {
  const bytes = () => saveBinarySync(populated(80) as any, { segmentSize: 1024 })

  function rewriteHeader(snapshot: Uint8Array, version: number): Uint8Array {
    const copy = snapshot.slice()
    const view = new DataView(copy.buffer)
    view.setUint16(4, version, true)
    view.setUint32(12, crc32(copy.subarray(0, 12)), true)
    return copy
  }

  it('rejects a corrupted segment and leaves the database untouched', async () => {
    const corrupted = bytes()
    corrupted[5000] ^= 0x40

    const db = populated(5)
    const before = normalized(db)
    await expectError(loadBinary(db as any, corrupted), 'BINARY_SNAPSHOT_CHECKSUM_MISMATCH', /segment 4/)
    await expectError(() => loadBinarySync(db as any, corrupted), 'BINARY_SNAPSHOT_CHECKSUM_MISMATCH')
    expect(normalized(db)).toEqual(before)
    expect(count(db as any)).toBe(5)
  })

  it('rejects a corrupted file header', async () => {
    const corrupted = bytes()
    corrupted[9] ^= 1
    await expectError(loadBinary(empty() as any, corrupted), 'BINARY_SNAPSHOT_CHECKSUM_MISMATCH', /header/)
  })

  it('rejects a corrupted segment length', async () => {
    const corrupted = bytes()
    new DataView(corrupted.buffer).setUint32(16, 0xffffffff, true)
    await expectError(loadBinary(empty() as any, corrupted), 'BINARY_SNAPSHOT_CHECKSUM_MISMATCH', /invalid length/)
  })

  it('can skip checksum verification', async () => {
    const snapshot = bytes()
    new DataView(snapshot.buffer).setUint32(16 + 8, 0, true)
    const restored = empty()
    await loadBinary(restored as any, snapshot, { verifyChecksums: false })
    expect(count(restored as any)).toBe(80)
  })

  it('rejects other format versions', async () => {
    await expectError(
      loadBinary(empty() as any, rewriteHeader(bytes(), BINARY_SNAPSHOT_VERSION + 1)),
      'UNSUPPORTED_BINARY_SNAPSHOT_VERSION',
      new RegExp(`version ${BINARY_SNAPSHOT_VERSION + 1}`)
    )
    await expectError(
      () => loadBinarySync(empty() as any, rewriteHeader(bytes(), 0)),
      'UNSUPPORTED_BINARY_SNAPSHOT_VERSION'
    )
  })

  it('rejects data that is not a snapshot', async () => {
    const text = new TextEncoder().encode(JSON.stringify(save(populated(2) as any)))
    expect(isBinarySnapshot(text)).toBe(false)
    await expectError(loadBinary(empty() as any, text), 'INVALID_BINARY_SNAPSHOT', /magic/)
  })

  it('rejects truncated snapshots', async () => {
    const snapshot = bytes()
    for (const length of [0, 10, 16, 30, 2000, snapshot.length - 1]) {
      await expectError(loadBinary(empty() as any, snapshot.subarray(0, length)), 'INVALID_BINARY_SNAPSHOT', /truncated/)
    }
    await expectError(
      () => loadBinarySync(empty() as any, snapshot.subarray(0, 3000)),
      'INVALID_BINARY_SNAPSHOT',
      /truncated/
    )
  })

  it('rejects data after the end of the snapshot', async () => {
    const snapshot = bytes()
    await expectError(
      loadBinary(empty() as any, concat([snapshot, new Uint8Array([1])])),
      'INVALID_BINARY_SNAPSHOT',
      /after the end/
    )
    await expectError(
      loadBinary(empty() as any, [snapshot, new Uint8Array(0), new Uint8Array([1])]),
      'INVALID_BINARY_SNAPSHOT',
      /after the end/
    )
    await expectError(
      () => loadBinarySync(empty() as any, [snapshot, new Uint8Array([1])]),
      'INVALID_BINARY_SNAPSHOT',
      /after the end/
    )
    const restored = empty()
    loadBinarySync(restored as any, [snapshot, new Uint8Array(0)])
    expect(count(restored as any)).toBe(80)
  })

  it('rejects reordered segments', async () => {
    const segments = await collect(saveBinary(populated(80) as any, { segmentSize: 1024 }))
    const swapped = [segments[0], segments[2], segments[1], ...segments.slice(3)]
    await expectError(loadBinary(empty() as any, swapped), 'INVALID_BINARY_SNAPSHOT', /segment 2 where segment 1/)
  })

  it('rejects invalid sources and chunks', async () => {
    await expect(loadBinary(empty() as any, 42 as any)).rejects.toThrow(TypeError)
    await expect(loadBinary(empty() as any, ['text'] as any)).rejects.toThrow(TypeError)
  })

  it('closes the source when loading fails', async () => {
    let closed = false
    const snapshot = bytes()
    snapshot[3000] ^= 1
    const source = {
      [Symbol.asyncIterator]() {
        const chunks = split(snapshot, 512)
        return {
          next: async () => (chunks.length ? { done: false, value: chunks.shift()! } : { done: true, value: undefined }),
          return: async () => {
            closed = true
            return { done: true, value: undefined }
          }
        }
      }
    }
    await expectError(loadBinary(empty() as any, source as any), 'BINARY_SNAPSHOT_CHECKSUM_MISMATCH')
    expect(closed).toBe(true)
  })
})

describe('binary snapshot with custom components', () => {
  it('writes custom components through their own save and load', async () => {
    const index = createIndex()
    const sorter = createSorter()
    const components = {
      index: { ...index, save: (i: any) => index.save(i), load: (...args: any[]) => (index.load as any)(...args) },
      sorter: { ...sorter, save: (s: any) => sorter.save(s), load: (...args: any[]) => (sorter.load as any)(...args) }
    }
    const db = populated(150, { components } as any)
    // Custom components go through their own save/load, so they behave exactly like a JSON save + load
    // (which, for instance, re-normalizes vectors).
    const reference = empty({ components })
    load(reference as any, JSON.parse(JSON.stringify(save(db as any))))

    const restored = empty({ components })
    await loadBinary(restored as any, saveBinary(db as any, { segmentSize: 1024 }))
    expect(normalized(restored)).toEqual(normalized(reference))
    expect(probe(restored)).toEqual(probe(reference))

    const asyncRestored = empty({
      components: {
        ...components,
        index: { ...components.index, loadAsync: undefined },
        sorter: { ...components.sorter, loadAsync: undefined }
      }
    })
    loadBinarySync(asyncRestored as any, saveBinarySync(db as any))
    expect(normalized(asyncRestored)).toEqual(normalized(reference))
  })

  it('refuses to load built-in component data into custom components', async () => {
    const snapshot = saveBinarySync(populated(10) as any)
    const index = createIndex()
    const sorter = createSorter()
    await expectError(
      loadBinary(empty({ components: { index: { ...index, load: (...a: any[]) => (index.load as any)(...a) } } }) as any, snapshot),
      'BINARY_SNAPSHOT_COMPONENT_MISMATCH',
      /index/
    )
    await expectError(
      loadBinary(empty({ components: { sorter: { ...sorter, save: (s: any) => sorter.save(s) } } }) as any, snapshot),
      'BINARY_SNAPSHOT_COMPONENT_MISMATCH',
      /sort/
    )
  })

  it('splits large custom values into bounded records', async () => {
    const big = {
      list: Array.from({ length: 3000 }, (_, i) => ({ i, name: `item ${i}`, nested: [i, i * 2, `x${i}`] })),
      nested: {
        deeper: Array.from({ length: 2000 }, (_, i) => [`k${i}`, Array.from({ length: 30 }, (_, j) => i * j)]),
        small: 1
      },
      arrayOfBig: [Array.from({ length: 2000 }, (_, i) => `entry ${i}`), { a: Array.from({ length: 2000 }, (_, i) => i) }],
      sparse: [undefined, () => 1, null, 2]
    }
    const pinning = { ...(create({ schema: { a: 'string' } }) as any).pinning }
    const customPinning = { ...pinning, save: () => big, load: (store: any, raw: any) => ({ ...pinning.load(store, { rules: [] }), raw }) }

    const db = create({ schema: { a: 'string' }, components: { pinning: customPinning } } as any)
    const restored = create({ schema: { a: 'string' }, components: { pinning: customPinning } } as any)
    const segments = await collect(saveBinary(db as any, { segmentSize: 1024 }))
    expect(Math.max(...segments.map((s) => s.length))).toBeLessThanOrEqual(16 + 12 + 1024)
    await loadBinary(restored as any, segments)
    expect((restored as any).data.pinning.raw).toEqual(JSON.parse(JSON.stringify(big)))
  })
})

describe('binary value codec', () => {
  function roundTrip(value: unknown): unknown {
    const w = new ByteWriter(4)
    encodeValue(w, new KeyDictionary(), value)
    return decodeValue(new ByteReader(w.bytes()), new KeyDictionary())
  }

  it('computes standard CRC32 values', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
    const data = new TextEncoder().encode('The quick brown fox jumps over the lazy dog')
    expect(crc32(data)).toBe(0x414fa339)
    expect(crc32(data.subarray(10), crc32(data.subarray(0, 10)))).toBe(0x414fa339)
  })

  it('round trips the JSON data model and more', () => {
    const value = {
      str: 'plain',
      unicode: 'naïve café 東京 😀',
      long: 'x'.repeat(5000) + 'é',
      empty: '',
      ints: [0, 1, 127, 128, 2 ** 31, 2 ** 53 - 1],
      negatives: [-1, -(2 ** 31), -(2 ** 53 - 1)],
      floats: [0.1, -2.5, 1e300],
      float32: [0.5, -0.25, 1.5],
      special: [NaN, Infinity, -Infinity, -0, 2 ** 60, -(2 ** 60)],
      single: [42],
      mixed: [1, 'a', null, true, false, { a: 1 }, [2]],
      bools: [true, false],
      nested: { a: { b: { c: [1, { d: 'e' }] } } },
      typed: new Float32Array([1.5, 2.5]),
      typed64: new Float64Array([Math.PI]),
      bytes: new Uint8Array([1, 2, 3]),
      i16: new Int16Array([-2, 2]),
      u16: new Uint16Array([65535]),
      map: new Map<unknown, unknown>([
        ['k', 1],
        [2, [3]]
      ]),
      set: new Set([1, 'two']),
      '123': 'numeric key',
      '0': 'zero',
      '0123': 'not an index key'
    }

    const decoded = roundTrip(value) as any
    expect(decoded).toEqual(value)
    expect(Object.is(decoded.special[3], -0)).toBe(true)
    expect(decoded.typed).toBeInstanceOf(Float32Array)
    expect(decoded.map).toBeInstanceOf(Map)
    expect(decoded.set).toBeInstanceOf(Set)
  })

  it('follows JSON semantics for undefined, functions and toJSON', () => {
    const date = new Date(0)
    expect(roundTrip({ a: undefined, b: () => 1, c: Symbol('s'), d: 1 })).toEqual({ d: 1 })
    expect(roundTrip([undefined, () => 1, 1])).toEqual([null, null, 1])
    expect(roundTrip(date)).toBe(date.toJSON())
    expect(roundTrip(undefined)).toBeUndefined()
    expect(roundTrip(new DataView(new ArrayBuffer(2)))).toEqual({})
    expect(() => roundTrip(10n)).toThrow(TypeError)
  })

  it('keeps __proto__ keys as own properties', () => {
    const value = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}')
    const decoded = roundTrip(value) as any
    expect(Object.hasOwn(decoded, '__proto__')).toBe(true)
    expect(({} as any).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(decoded)).toBe(Object.prototype)
  })

  it('shares object keys through a dictionary', () => {
    const w = new ByteWriter()
    const dict = new KeyDictionary()
    encodeValue(w, dict, { someLongKeyName: 1 })
    const first = w.pos
    encodeValue(w, dict, { someLongKeyName: 2 })
    expect(w.pos - first).toBeLessThan(first)

    const r = new ByteReader(w.bytes())
    const readDict = new KeyDictionary()
    expect(decodeValue(r, readDict)).toEqual({ someLongKeyName: 1 })
    expect(decodeValue(r, readDict)).toEqual({ someLongKeyName: 2 })
  })

  it('rejects malformed input', () => {
    expect(() => decodeValue(new ByteReader(new Uint8Array([99])), new KeyDictionary())).toThrow(/unknown value tag/)
    expect(() => decodeValue(new ByteReader(new Uint8Array([8, 100])), new KeyDictionary())).toThrow(/exceeds/)
    expect(() => decodeValue(new ByteReader(new Uint8Array([7, 5, 65])), new KeyDictionary())).toThrow(/end of record/)
    expect(() => decodeValue(new ByteReader(new Uint8Array([9, 1, 9, 0])), new KeyDictionary())).toThrow(
      /unknown key/
    )
    expect(() => new ByteReader(new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255])).uvar()).toThrow(
      /too long/
    )
    expect(() => new ByteReader(new Uint8Array([255])).uvar()).toThrow(/end of record/)
    expect(() => new ByteReader(new Uint8Array(0)).uvar()).toThrow(/end of record/)
    expect(() => decodeValue(new ByteReader(new Uint8Array([14, 99, 0])), new KeyDictionary())).toThrow(
      /unknown typed array/
    )
  })

  it('estimates JSON sizes without serializing, stopping at the limit', () => {
    const value = { a: [1, 22, 'abc', null, true], b: { c: 1.5 }, d: undefined, e: new Map([[1, 2]]) }
    const estimate = estimateJsonLength(value, 1e9)
    expect(Math.abs(estimate - JSON.stringify(value).length)).toBeLessThan(40)
    expect(estimateJsonLength(new Date(0), 1e9)).toBe(JSON.stringify(new Date(0)).length)
    expect(estimateJsonLength(new Float32Array(10), 1e9)).toBeGreaterThan(10)
    expect(estimateJsonLength(-123, 10)).toBe(4)

    let reads = 0
    const huge = new Proxy(Array.from({ length: 100000 }, (_, i) => i), {
      get(target, key) {
        if (typeof key === 'string' && /^\d+$/.test(key)) {
          reads++
        }
        return Reflect.get(target, key)
      }
    })
    expect(estimateJsonLength(huge, 1000)).toBeGreaterThan(1000)
    expect(reads).toBeLessThan(1000)

    const bigObject = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`key${i}`, 'value']))
    expect(estimateJsonLength(bigObject, 100)).toBeGreaterThan(100)
    expect(estimateJsonLength(new Set(Array.from({ length: 1000 }, (_, i) => i)), 100)).toBeGreaterThan(100)
  })
})
