import { describe, expect, it } from 'vitest'
import { create, insertMultiple, load, remove, save, search, update, type AnyZBSearch } from '../src/index.js'
import { RESERVED_VECTOR_INDEX_KEY } from '../src/constants.js'
import { flat } from '../src/trees/vector.js'
import { ivf } from '../src/trees/vector-ivf.js'
import { QuantizedVectorIndex } from '../src/trees/vector-quantized.js'
import {
  BinaryQuantizer,
  Int8Quantizer,
  base64ToBytes,
  bytesToBase64,
  createCodeBuffer,
  snapshotFromJSON,
  snapshotToJSON,
  type CodeBuffer,
  type VectorBinarySnapshot,
  type VectorQuantizer,
  type VectorQuantizerFactory
} from '../src/trees/vector-quantization.js'
import { clusteredVectors, recallAtK } from './helpers/synthetic-vectors.js'

const DIM = 64
const DATA = clusteredVectors({ count: 2000, queries: 40, dim: DIM, clusters: 24, seed: 7 })

function makeDb(index?: ReturnType<typeof flat>): AnyZBSearch {
  return create({
    schema: { name: 'string', group: 'number', embedding: `vector[${DIM}]` } as const,
    ...(index ? { indexes: { embedding: index } } : {})
  })
}

async function populate(db: AnyZBSearch) {
  await insertMultiple(
    db,
    DATA.vectors.map((embedding, i) => ({ id: String(i), name: `doc ${i}`, group: i % 4, embedding }))
  )
}

async function topK(db: AnyZBSearch, query: number[], k = 10, where?: Record<string, unknown>) {
  const results = await search(db, {
    mode: 'vector',
    vector: { value: query, property: 'embedding' },
    similarity: -1,
    limit: k,
    ...(where ? { where } : {})
  } as any)
  return results.hits.map((hit) => hit.id)
}

async function recallOf(index: ReturnType<typeof flat>, where?: Record<string, unknown>) {
  const exact = makeDb()
  const quantized = makeDb(index)
  await populate(exact)
  await populate(quantized)

  const expected: string[][] = []
  const actual: string[][] = []
  for (const query of DATA.queries) {
    expected.push(await topK(exact, query, 10, where))
    actual.push(await topK(quantized, query, 10, where))
  }
  return recallAtK(expected, actual, 10)
}

function vectorNode(db: AnyZBSearch) {
  return db.data.index.vectorIndexes.embedding.node
}

describe('vector quantization: accuracy', () => {
  it('int8 keeps recall@10 close to float32', async () => {
    expect(await recallOf(flat({ quantization: 'int8' }))).toBeGreaterThanOrEqual(0.95)
  })

  it('binary alone gives coarse candidates', async () => {
    // Only 64 bits per vector here: binary codes are meant for candidate generation followed by rescoring.
    expect(await recallOf(flat({ quantization: 'binary' }))).toBeGreaterThanOrEqual(0.15)
  })

  it('binary with int8 rescoring recovers most of the recall', async () => {
    const binary = await recallOf(flat({ quantization: 'binary' }))
    const rescored = await recallOf(flat({ quantization: 'binary', rescore: 'int8' }))
    expect(rescored).toBeGreaterThanOrEqual(0.9)
    expect(rescored).toBeGreaterThan(binary)
  })

  it('binary with float32 rescoring returns exact scores for the candidates', async () => {
    const db = makeDb(flat({ quantization: 'binary', rescore: 'float32', oversample: 50 }))
    const exact = makeDb()
    await populate(db)
    await populate(exact)

    const query = DATA.queries[0]!
    const params = {
      mode: 'vector',
      vector: { value: query, property: 'embedding' },
      similarity: -1,
      limit: 5
    } as const
    const [quantizedHits, exactHits] = [await search(db, params as any), await search(exact, params as any)]
    expect(quantizedHits.hits.map((h) => h.id)).toEqual(exactHits.hits.map((h) => h.id))
    for (let i = 0; i < 5; i++) {
      expect(quantizedHits.hits[i]!.score).toBeCloseTo(exactHits.hits[i]!.score, 5)
    }
  })

  it('respects where filters', async () => {
    expect(await recallOf(flat({ quantization: 'int8' }), { group: { eq: 1 } })).toBeGreaterThanOrEqual(0.95)
    expect(
      await recallOf(flat({ quantization: 'binary', rescore: 'int8' }), { group: { eq: 2 } })
    ).toBeGreaterThanOrEqual(0.9)

    const db = makeDb(flat({ quantization: 'int8' }))
    await populate(db)
    const ids = await topK(db, DATA.queries[1]!, 50, { group: { eq: 3 } })
    expect(ids.length).toBe(50)
    expect(ids.every((id) => Number(id) % 4 === 3)).toBe(true)
  })

  it('works with IVF partitioning', async () => {
    const recall = await recallOf(ivf({ nlist: 16, nprobe: 8, trainMin: 256, quantization: 'int8' }))
    expect(recall).toBeGreaterThanOrEqual(0.8)

    const rescored = await recallOf(
      ivf({ nlist: 16, nprobe: 8, trainMin: 256, quantization: 'binary', rescore: 'int8' })
    )
    expect(rescored).toBeGreaterThanOrEqual(0.75)
  })

  it('applies the similarity threshold to quantized scores', async () => {
    const db = makeDb(flat({ quantization: 'int8' }))
    await insertMultiple(db, [
      { id: 'a', name: 'a', group: 0, embedding: Array.from({ length: DIM }, (_, i) => (i === 0 ? 1 : 0)) },
      { id: 'b', name: 'b', group: 0, embedding: Array.from({ length: DIM }, (_, i) => (i === 1 ? 1 : 0)) }
    ])
    const results = await search(db, {
      mode: 'vector',
      vector: { value: Array.from({ length: DIM }, (_, i) => (i === 0 ? 1 : 0)), property: 'embedding' },
      similarity: 0.9
    })
    expect(results.hits.map((h) => h.id)).toEqual(['a'])
    expect(results.hits[0]!.score).toBeCloseTo(1, 2)
  })

  it('works in hybrid search', async () => {
    const db = makeDb(flat({ quantization: 'binary', rescore: 'int8' }))
    await populate(db)
    const results = await search(db, {
      mode: 'hybrid',
      term: 'doc',
      vector: { value: DATA.vectors[10]!, property: 'embedding' },
      similarity: 0.5,
      limit: 3
    })
    expect(results.hits[0]!.id).toBe('10')
  })
})

describe('vector quantization: memory', () => {
  it('stores int8 codes contiguously at about a quarter of float32', async () => {
    const db = makeDb(flat({ quantization: 'int8' }))
    await populate(db)
    const node = vectorNode(db) as QuantizedVectorIndex
    expect(node).toBeInstanceOf(QuantizedVectorIndex)
    expect(node.count).toBe(DATA.vectors.length)
    // 64 bytes of codes + 8 bytes of scale/offset + 4 bytes of id per vector, plus at most ~25% growth slack.
    const floatBytes = DATA.vectors.length * DIM * 4
    expect(node.byteLength).toBeLessThan(floatBytes * 0.4)
  })

  it('stores binary codes at 1 bit per dimension', async () => {
    const db = makeDb(flat({ quantization: 'binary' }))
    await populate(db)
    const snapshot = (vectorNode(db) as QuantizedVectorIndex).toBinarySnapshot()
    expect(snapshot.arrays.codes!.byteLength).toBe(DATA.vectors.length * (DIM / 8))
  })
})

describe('vector quantization: getVector', () => {
  function cosine(a: ArrayLike<number>, b: ArrayLike<number>) {
    let dot = 0
    let na = 0
    let nb = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!
      na += a[i]! * a[i]!
      nb += b[i]! * b[i]!
    }
    return dot / Math.sqrt(na * nb)
  }

  async function vectorOf(index: ReturnType<typeof flat>, docIndex: number) {
    const db = makeDb(index)
    await populate(db)
    const internalId = db.internalDocumentIDStore.idToInternalId.get(String(docIndex))!
    return {
      node: vectorNode(db) as QuantizedVectorIndex,
      vector: (vectorNode(db) as QuantizedVectorIndex).getVector(internalId)!
    }
  }

  it('returns normalized, dequantized vectors', async () => {
    const original = DATA.vectors[12]!

    const int8 = await vectorOf(flat({ quantization: 'int8' }), 12)
    expect(int8.vector.length).toBe(DIM)
    expect(cosine(int8.vector, original)).toBeGreaterThan(0.999)
    expect(cosine(int8.vector, int8.vector)).toBeCloseTo(1, 5)
    let norm = 0
    for (const value of int8.vector) norm += value * value
    expect(norm).toBeCloseTo(1, 4)

    const binary = await vectorOf(flat({ quantization: 'binary' }), 12)
    for (let i = 0; i < DIM; i++) {
      if (Math.abs(original[i]!) > 1e-6) expect(Math.sign(binary.vector[i]!)).toBe(Math.sign(original[i]!))
    }

    // With a full-precision rescoring copy the exact normalized vector comes back.
    const kept = await vectorOf(flat({ quantization: 'binary', rescore: 'float32' }), 12)
    expect(cosine(kept.vector, original)).toBeCloseTo(1, 6)

    expect(int8.node.getVector(999_999)).toBeUndefined()
  })

  it('returns buffered vectors before training and undefined when the quantizer cannot decode', async () => {
    const db = makeDb(flat({ quantization: centered }))
    await insertMultiple(db, [{ id: 'p', name: 'p', group: 0, embedding: DATA.vectors[0]! }])
    const node = vectorNode(db) as QuantizedVectorIndex
    const id = db.internalDocumentIDStore.idToInternalId.get('p')!
    expect(cosine(node.getVector(id)!, DATA.vectors[0]!)).toBeCloseTo(1, 6)

    const noDecode: VectorQuantizerFactory = {
      kind: 'no-decode',
      create: (dim) => {
        const inner = new Int8Quantizer(dim)
        return {
          kind: 'no-decode',
          dim,
          ready: true,
          codeSize: inner.codeSize,
          encode: inner.encode.bind(inner),
          prepareQuery: inner.prepareQuery.bind(inner),
          score: inner.score.bind(inner),
          toSnapshot: () => ({ meta: { dim }, arrays: {} })
        }
      },
      fromSnapshot: () => {
        throw new Error('unused')
      }
    }
    const other = makeDb(flat({ quantization: noDecode }))
    await insertMultiple(other, [{ id: 'q', name: 'q', group: 0, embedding: DATA.vectors[0]! }])
    const otherId = other.internalDocumentIDStore.idToInternalId.get('q')!
    expect((vectorNode(other) as QuantizedVectorIndex).getVector(otherId)).toBeUndefined()
    expect((await topK(other, DATA.vectors[0]!, 1))[0]).toBe('q')
  })
})

describe('vector quantization: insert, remove, update', () => {
  for (const quantization of ['int8', 'binary'] as const) {
    it(`supports remove and update with ${quantization}`, async () => {
      const db = makeDb(flat({ quantization }))
      const ids = await insertMultiple(db, [
        { id: 'x', name: 'x', group: 0, embedding: DATA.vectors[0]! },
        { id: 'y', name: 'y', group: 0, embedding: DATA.vectors[1]! },
        { id: 'z', name: 'z', group: 0, embedding: DATA.vectors[2]! }
      ])

      expect(await topK(db, DATA.vectors[1]!, 1)).toEqual(['y'])

      await remove(db, ids[1]!)
      expect(await topK(db, DATA.vectors[1]!, 3)).not.toContain('y')
      expect((vectorNode(db) as QuantizedVectorIndex).count).toBe(2)

      await update(db, 'x', { id: 'x', name: 'x', group: 0, embedding: DATA.vectors[1]! })
      expect(await topK(db, DATA.vectors[1]!, 1)).toEqual(['x'])

      // A freed slot is reused by the next insert.
      await insertMultiple(db, [{ id: 'w', name: 'w', group: 0, embedding: DATA.vectors[3]! }])
      expect(await topK(db, DATA.vectors[3]!, 1)).toEqual(['w'])
      expect((vectorNode(db) as QuantizedVectorIndex).count).toBe(3)
    })
  }

  it('supports remove and update with IVF + int8', async () => {
    const db = makeDb(ivf({ nlist: 4, nprobe: 4, trainMin: 8, quantization: 'int8' }))
    await populate(db)
    await remove(db, '5')
    expect(await topK(db, DATA.vectors[5]!, 10)).not.toContain('5')
    await update(db, '6', { id: '6', name: 'six', group: 0, embedding: DATA.vectors[5]! })
    expect((await topK(db, DATA.vectors[5]!, 1))[0]).toBe('6')
  })

  it('ignores zero query vectors', async () => {
    const db = makeDb(flat({ quantization: 'int8' }))
    await populate(db)
    expect(await topK(db, new Array(DIM).fill(0), 10)).toEqual([])
  })
})

describe('vector quantization: serialization', () => {
  for (const config of [
    { name: 'int8', index: () => flat({ quantization: 'int8' }) },
    { name: 'binary + int8 rescore', index: () => flat({ quantization: 'binary', rescore: 'int8' }) },
    { name: 'ivf + int8', index: () => ivf({ nlist: 8, nprobe: 4, trainMin: 64, quantization: 'int8' }) },
    {
      name: 'ivf + binary + float32 rescore',
      index: () => ivf({ nlist: 8, nprobe: 4, trainMin: 64, quantization: 'binary', rescore: 'float32' })
    }
  ]) {
    it(`round-trips ${config.name} through save/load`, async () => {
      const db = makeDb(config.index())
      await populate(db)
      await remove(db, '3')

      const raw = save(db)
      const json = JSON.stringify(raw)
      // Codes are stored as base64 strings, not as arrays of JSON numbers.
      const vectorJSON = JSON.stringify((raw as any).index.vectorIndexes.embedding)
      expect(vectorJSON).not.toMatch(/\[-?\d+\.\d+,-?\d+\.\d+/)

      const restored = makeDb(config.index())
      load(restored, JSON.parse(json))

      for (const query of DATA.queries.slice(0, 5)) {
        expect(await topK(restored, query)).toEqual(await topK(db, query))
      }

      await insertMultiple(restored, [{ id: 'new', name: 'new', group: 0, embedding: DATA.queries[0]! }])
      expect((await topK(restored, DATA.queries[0]!, 1))[0]).toBe('new')
    })
  }

  it('writes a much smaller JSON than float32', async () => {
    const plain = makeDb()
    const int8 = makeDb(flat({ quantization: 'int8' }))
    const binary = makeDb(flat({ quantization: 'binary' }))
    await populate(plain)
    await populate(int8)
    await populate(binary)

    const size = (db: AnyZBSearch) => JSON.stringify((save(db) as any).index.vectorIndexes.embedding).length
    expect(size(int8)).toBeLessThan(size(plain) / 10)
    expect(size(binary)).toBeLessThan(size(int8) / 5)
  })

  it('loads built-in quantized indexes without an indexes config', async () => {
    const db = makeDb(flat({ quantization: 'int8' }))
    await populate(db)
    const restored = makeDb()
    load(restored, JSON.parse(JSON.stringify(save(db))))
    expect(vectorNode(restored)).toBeInstanceOf(QuantizedVectorIndex)
    expect(await topK(restored, DATA.queries[2]!)).toEqual(await topK(db, DATA.queries[2]!))
  })

  it('round-trips through the binary snapshot contract', async () => {
    for (const factory of [
      flat({ quantization: 'int8' }),
      flat({ quantization: 'binary', rescore: 'int8' }),
      ivf({ nlist: 8, nprobe: 8, trainMin: 64, quantization: 'int8' }),
      flat(),
      ivf({ nlist: 8, nprobe: 8, trainMin: 64 })
    ]) {
      const db = makeDb(factory)
      await populate(db)
      const node = vectorNode(db)
      const snapshot = node.toBinarySnapshot!()
      expect(JSON.parse(JSON.stringify(snapshot.meta))).toEqual(snapshot.meta)
      for (const array of Object.values(snapshot.arrays)) {
        expect(ArrayBuffer.isView(array)).toBe(true)
      }

      const restored = factory.fromBinarySnapshot!(snapshot)
      const query = DATA.queries[3]!
      expect(
        restored
          .find(query, -1, undefined, { limit: 10 })
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
      ).toEqual(
        node
          .find(query, -1, undefined, { limit: 10 })
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
      )
    }
  })

  it('encodes snapshots as base64 JSON', () => {
    const snapshot: VectorBinarySnapshot = {
      meta: { hello: 'world' },
      arrays: {
        a: new Float32Array([1.5, -2.25, 3]),
        b: new Int8Array([-128, 0, 127]),
        c: new Uint32Array([0, 0xffffffff]),
        d: new Float64Array([Math.PI]),
        e: new Int32Array([-5]),
        f: new Uint8Array([])
      }
    }
    const restored = snapshotFromJSON(JSON.parse(JSON.stringify(snapshotToJSON(snapshot))))
    expect(restored.meta).toEqual(snapshot.meta)
    for (const key of Object.keys(snapshot.arrays)) {
      expect(restored.arrays[key]).toEqual(snapshot.arrays[key])
    }
    expect(() => snapshotFromJSON({ meta: {}, arrays: { x: { type: 'BigInt64Array' as any, base64: '' } } })).toThrow()
  })

  it('base64 round-trips every length', () => {
    for (let length = 0; length < 40; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) & 255)
      const encoded = bytesToBase64(bytes)
      if (typeof Buffer !== 'undefined') {
        expect(encoded).toBe(Buffer.from(bytes).toString('base64'))
      }
      expect(base64ToBytes(encoded)).toEqual(bytes)
    }
  })
})

describe('vector quantization: built-in quantizers', () => {
  function encodeOne(quantizer: VectorQuantizer, vector: Float32Array): CodeBuffer {
    const codes = createCodeBuffer(quantizer.codeSize)
    quantizer.encode(vector, codes, 0)
    return codes
  }

  it('int8 decodes close to the original vector', () => {
    const quantizer = new Int8Quantizer(5)
    const vector = new Float32Array([0.5, -0.5, 0.1, 0.3, -0.62])
    const codes = encodeOne(quantizer, vector)
    const out = new Float32Array(5)
    quantizer.decode(codes, 0, out)
    for (let i = 0; i < 5; i++) {
      expect(out[i]).toBeCloseTo(vector[i]!, 2)
    }
  })

  it('int8 handles constant vectors', () => {
    const quantizer = new Int8Quantizer(4)
    const vector = new Float32Array([0.5, 0.5, 0.5, 0.5])
    const codes = encodeOne(quantizer, vector)
    expect(quantizer.score(quantizer.prepareQuery(vector), codes, 0)).toBeCloseTo(1, 5)
  })

  it('binary packs sign bits and estimates the angle', () => {
    const quantizer = new BinaryQuantizer(40)
    const vector = new Float32Array(40).map((_, i) => (i % 3 === 0 ? 1 : -1))
    const codes = encodeOne(quantizer, vector)
    expect(quantizer.codeSize).toBe(8)
    expect(quantizer.hamming(quantizer.prepareQuery(vector), codes, 0)).toBe(0)
    expect(quantizer.score(quantizer.prepareQuery(vector), codes, 0)).toBe(1)
    const opposite = vector.map((v) => -v)
    expect(quantizer.score(quantizer.prepareQuery(opposite), codes, 0)).toBeCloseTo(-1, 5)
    const decoded = new Float32Array(40)
    quantizer.decode(codes, 0, decoded)
    expect(Math.sign(decoded[0]!)).toBe(1)
    expect(Math.sign(decoded[1]!)).toBe(-1)
  })

  it('rejects invalid options', () => {
    expect(() => flat({ quantization: 'int4' as any })).toThrow(/Unknown vector quantization/)
    expect(() => flat({ quantization: 'float32' as any })).toThrow(/Unknown vector quantization/)
    expect(() => flat({ rescore: 'int8' })).toThrow(/requires a quantization/)
    expect(() => ivf({ rescore: 'float32' })).toThrow(/requires a quantization/)
    expect(() => flat({ quantization: 'binary', rescore: 'int4' as any })).toThrow(/Unknown vector rescore/)
    expect(() => flat({ quantization: {} as any })).toThrow(/custom vector quantizer/)
    expect(() => flat({ quantization: 'none' })).not.toThrow()
  })
})

/**
 * A toy trained quantizer: subtracts the training mean, then stores int8 with a fixed global scale. It exercises the
 * extension point the same way a product quantizer from a plugin does (training, custom snapshot arrays).
 */
class CenteredQuantizer implements VectorQuantizer<Float32Array> {
  readonly kind = 'centered-test'
  readonly codeSize: number
  readonly trainingSize = 100
  mean: Float32Array | undefined
  fits = 0

  constructor(readonly dim: number) {
    this.codeSize = dim
  }

  get ready() {
    return this.mean !== undefined
  }

  fit(vectors: Float32Array[]) {
    this.fits++
    const mean = new Float32Array(this.dim)
    for (const vector of vectors) {
      for (let i = 0; i < this.dim; i++) mean[i] += vector[i]! / vectors.length
    }
    this.mean = mean
  }

  encode(vector: Float32Array, codes: CodeBuffer, offset: number) {
    for (let i = 0; i < this.dim; i++) {
      codes.i8[offset + i] = Math.max(-127, Math.min(127, Math.round((vector[i]! - this.mean![i]!) * 127)))
    }
  }

  prepareQuery(query: Float32Array) {
    return query
  }

  score(query: Float32Array, codes: CodeBuffer, offset: number) {
    let sum = 0
    for (let i = 0; i < this.dim; i++) sum += query[i]! * (codes.i8[offset + i]! / 127 + this.mean![i]!)
    return sum
  }

  decode(codes: CodeBuffer, offset: number, out: Float32Array) {
    for (let i = 0; i < this.dim; i++) out[i] = codes.i8[offset + i]! / 127 + this.mean![i]!
  }

  toSnapshot(): VectorBinarySnapshot {
    return { meta: { dim: this.dim }, arrays: this.mean ? { mean: this.mean } : {} }
  }
}

const centered: VectorQuantizerFactory = {
  kind: 'centered-test',
  create: (dim) => new CenteredQuantizer(dim),
  fromSnapshot: (snapshot) => {
    const quantizer = new CenteredQuantizer(Number(snapshot.meta.dim))
    quantizer.mean = snapshot.arrays.mean as Float32Array | undefined
    return quantizer
  }
}

describe('vector quantization: custom quantizers', () => {
  it('buffers vectors until training, then encodes them', async () => {
    const db = makeDb(flat({ quantization: centered }))
    await insertMultiple(
      db,
      DATA.vectors.slice(0, 50).map((embedding, i) => ({ id: String(i), name: 'n', group: 0, embedding }))
    )
    const node = vectorNode(db) as QuantizedVectorIndex
    expect(node.ready).toBe(false)
    // Before training, search is exact over the buffered vectors.
    expect((await topK(db, DATA.vectors[7]!, 1))[0]).toBe('7')

    // Pending vectors survive a save/load before training.
    const early = makeDb(flat({ quantization: centered }))
    load(early, JSON.parse(JSON.stringify(save(db))))
    expect((vectorNode(early) as QuantizedVectorIndex).count).toBe(50)
    await remove(early, '7')
    expect((vectorNode(early) as QuantizedVectorIndex).count).toBe(49)

    await insertMultiple(
      db,
      DATA.vectors.slice(50, 500).map((embedding, i) => ({ id: String(i + 50), name: 'n', group: 0, embedding }))
    )
    expect(node.ready).toBe(true)
    expect(node.quantization).toBe('centered-test')
    expect((node.getQuantizer() as CenteredQuantizer).fits).toBe(1)
    expect((await topK(db, DATA.vectors[300]!, 1))[0]).toBe('300')

    const restored = makeDb(flat({ quantization: centered }))
    load(restored, JSON.parse(JSON.stringify(save(db))))
    expect(await topK(restored, DATA.queries[0]!)).toEqual(await topK(db, DATA.queries[0]!))
  })

  it('refits and re-encodes on demand', async () => {
    const db = makeDb(flat({ quantization: centered, rescore: 'float32' }))
    await populate(db)
    const node = vectorNode(db) as QuantizedVectorIndex
    const before = await topK(db, DATA.queries[4]!)
    node.refit()
    expect((node.getQuantizer() as CenteredQuantizer).fits).toBe(2)
    expect(node.count).toBe(DATA.vectors.length)
    expect(await topK(db, DATA.queries[4]!)).toEqual(before)

    node.refit(DATA.vectors.slice(0, 200))
    expect((node.getQuantizer() as CenteredQuantizer).fits).toBe(3)
    expect(recallAtK([before], [await topK(db, DATA.queries[4]!)], 10)).toBeGreaterThanOrEqual(0.8)
  })

  it('requires the quantizer to load a custom snapshot', async () => {
    const db = makeDb(flat({ quantization: centered }))
    await populate(db)
    const raw = JSON.parse(JSON.stringify(save(db)))
    expect(() => load(makeDb(), raw)).toThrow(/centered-test/)
    expect(() => load(makeDb(flat({ quantization: 'int8' })), raw)).toThrow(/centered-test/)
  })

  it('works as the default vector index', async () => {
    const db = create({
      schema: { embedding: `vector[${DIM}]` } as const,
      indexes: { [RESERVED_VECTOR_INDEX_KEY]: flat({ quantization: 'int8' }) }
    })
    await insertMultiple(
      db,
      DATA.vectors.slice(0, 20).map((embedding) => ({ embedding }))
    )
    expect(db.data.index.vectorIndexes.embedding.node).toBeInstanceOf(QuantizedVectorIndex)
  })

  it('rejects dimension mismatches', () => {
    expect(() => new QuantizedVectorIndex({ dim: 8, quantizer: new Int8Quantizer(4) })).toThrow(/dimension/)
  })
})
