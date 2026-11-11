import { describe, expect, it } from 'vitest'
import { create, insertMultiple, load, remove, save, search, type AnyZBSearch } from 'zbsearch'
import { flat, QuantizedVectorIndex } from 'zbsearch/trees/vector-flat'
import { ivf } from 'zbsearch/trees/vector-ivf'
import {
  loadVectorQuantizerWasm,
  loadVectorQuantizerWasmSync,
  pq,
  pqSync,
  refit,
  ProductQuantizer,
  type PQFactory
} from '../src/index.js'
import { WASM_BASE64, WASM_SHA256 } from '../src/wasm-binary.js'
import { createHash } from 'node:crypto'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clustered(count: number, queries: number, dim: number, clusters: number, seed = 11) {
  const random = mulberry32(seed)
  const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random())
  const mean = Array.from({ length: dim }, () => gaussian() * 0.5)
  const scales = Array.from({ length: dim }, (_, d) => 1 / Math.sqrt(1 + d / 8))
  const centers = Array.from({ length: clusters }, () => mean.map((m, d) => m + gaussian() * scales[d]!))
  const sample = () => centers[Math.floor(random() * clusters)]!.map((c, d) => c + gaussian() * 0.6 * scales[d]!)
  return { vectors: Array.from({ length: count }, sample), queries: Array.from({ length: queries }, sample) }
}

const DIM = 64
const DATA = clustered(2000, 30, DIM, 24)
const OPTIONS = { m: 16, ks: 64, iterations: 15, trainingSize: 512 }

function makeDb(index?: ReturnType<typeof flat>): AnyZBSearch {
  return create({
    schema: { title: 'string', embedding: `vector[${DIM}]` } as const,
    ...(index ? { indexes: { embedding: index } } : {})
  })
}

async function populate(db: AnyZBSearch, vectors = DATA.vectors) {
  await insertMultiple(
    db,
    vectors.map((embedding, i) => ({ id: String(i), title: `doc ${i}`, embedding }))
  )
}

async function topK(db: AnyZBSearch, query: number[], k = 10) {
  const results = await search(db, {
    mode: 'vector',
    vector: { value: query, property: 'embedding' },
    similarity: -1,
    limit: k
  })
  return results.hits.map((hit) => hit.id)
}

async function recall(index: ReturnType<typeof flat>) {
  const exact = makeDb()
  const quantized = makeDb(index)
  await populate(exact)
  await populate(quantized)
  let hits = 0
  for (const query of DATA.queries) {
    const truth = new Set(await topK(exact, query))
    for (const id of await topK(quantized, query)) {
      if (truth.has(id)) hits++
    }
  }
  return hits / (DATA.queries.length * 10)
}

function node(db: AnyZBSearch): QuantizedVectorIndex {
  return db.data.index.vectorIndexes.embedding.node as QuantizedVectorIndex
}

describe('WebAssembly module', () => {
  it('matches the recorded checksum', () => {
    const digest = createHash('sha256').update(Buffer.from(WASM_BASE64, 'base64')).digest('hex')
    expect(digest).toBe(WASM_SHA256)
  })

  it('loads synchronously and asynchronously as one shared instance', async () => {
    const sync = loadVectorQuantizerWasmSync()
    expect(await loadVectorQuantizerWasm()).toBe(sync)
  })

  it('fits, encodes and decodes', () => {
    const wasm = loadVectorQuantizerWasmSync()
    const data = new Float32Array(DATA.vectors.slice(0, 300).flat())
    const model = wasm.fit(data, 300, DIM, 8, 16, 10, 1)
    expect(model.codewords.length).toBe(8 * 16 * 8)
    expect(model.width).toBe(8)

    const codes = wasm.encode(model.handle, data.subarray(0, DIM * 3), 3, 8)
    expect(codes.length).toBe(24)
    expect(Math.max(...codes)).toBeLessThan(16)

    const decoded = wasm.decode(model.handle, codes, 3, DIM)
    let error = 0
    let energy = 0
    for (let i = 0; i < decoded.length; i++) {
      error += (decoded[i]! - data[i]!) ** 2
      energy += data[i]! ** 2
    }
    expect(error / energy).toBeLessThan(0.5)

    // Same seed, same codebook.
    expect(wasm.fit(data, 300, DIM, 8, 16, 10, 1).codewords).toEqual(model.codewords)

    const reloaded = wasm.load(model.codewords, 8, 16, model.width, DIM)
    expect(wasm.encode(reloaded, data.subarray(0, DIM * 3), 3, 8)).toEqual(codes)
    wasm.release(reloaded)
    wasm.release(model.handle)
  })

  it('reports errors from the Rust side', () => {
    const wasm = loadVectorQuantizerWasmSync()
    const data = new Float32Array(10 * DIM)
    expect(() => wasm.fit(data, 10, DIM, 8, 16, 5, 1)).toThrow(/training vectors \(10\) must be more than ks \(16\)/)
    expect(() => wasm.encode(9999, new Float32Array(DIM), 1, 8)).toThrow(/Unknown model handle/)
  })
})

describe('pq quantizer', () => {
  it('validates options', () => {
    const factory = pqSync({ m: 100 })
    expect(() => factory.create(DIM)).toThrow(/m must be/)
    expect(() => pqSync({ ks: 1000 }).create(DIM)).toThrow(/ks must be/)
    const defaults = pqSync().create(384)
    expect(defaults.m).toBe(48)
    expect(defaults.ks).toBe(256)
    expect(defaults.codeSize).toBe(52)
    expect(defaults.trainingSize).toBe(1024)
  })

  it('handles dimensions that do not split evenly', async () => {
    const quantizer = (await pq({ m: 5, ks: 8 })).create(DIM)
    const vectors = DATA.vectors.slice(0, 100).map((v) => Float32Array.from(v))
    quantizer.fit(vectors)
    expect(quantizer.ready).toBe(true)
    expect(quantizer.codebook!.length).toBe(5 * 8 * 13)
  })

  it('refuses to train on fewer vectors than ks', () => {
    const quantizer = pqSync({ m: 4, ks: 64 }).create(DIM)
    expect(() => quantizer.fit(DATA.vectors.slice(0, 10).map((v) => Float32Array.from(v)))).toThrow(/at least ks/)
  })
})

describe('pq through create / insert / search', () => {
  it('reaches good recall@10 against float32', async () => {
    const factory = await pq(OPTIONS)
    const alone = await recall(flat({ quantization: factory }))
    const rescored = await recall(flat({ quantization: factory, rescore: 'int8' }))
    // 16 bytes per 64-dimensional vector (16x smaller than float32) on anisotropic data: PQ alone is coarse, and
    // rescoring the PQ candidates against int8 copies recovers near-exact results.
    expect(alone).toBeGreaterThanOrEqual(0.4)
    expect(rescored).toBeGreaterThanOrEqual(0.9)
  })

  it('works with IVF', async () => {
    const factory = await pq(OPTIONS)
    expect(await recall(ivf({ nlist: 8, nprobe: 4, trainMin: 512, quantization: factory }))).toBeGreaterThanOrEqual(0.4)
  })

  it('searches exactly until trained, then encodes everything', async () => {
    const db = makeDb(flat({ quantization: await pq(OPTIONS) }))
    await populate(db, DATA.vectors.slice(0, 200))
    expect(node(db).ready).toBe(false)
    expect((await topK(db, DATA.vectors[42]!, 1))[0]).toBe('42')

    await insertMultiple(
      db,
      DATA.vectors.slice(200, 600).map((embedding, i) => ({ id: String(200 + i), title: 't', embedding }))
    )
    expect(node(db).ready).toBe(true)
    expect(node(db).quantization).toBe('pq')
    // 16 code bytes + 4 bytes of norm per vector.
    expect(node(db).toBinarySnapshot().arrays.codes!.byteLength).toBe(600 * 20)
    expect(await topK(db, DATA.vectors[300]!, 3)).toContain('300')
  })

  it('round-trips through save/load and keeps encoding new vectors identically', async () => {
    const factory = await pq(OPTIONS)
    const db = makeDb(flat({ quantization: factory }))
    await populate(db)
    await remove(db, '1')

    const raw = JSON.parse(JSON.stringify(save(db)))
    const restored = makeDb(flat({ quantization: await pq(OPTIONS) }))
    load(restored, raw)

    for (const query of DATA.queries.slice(0, 5)) {
      expect(await topK(restored, query)).toEqual(await topK(db, query))
    }

    const extra = [{ id: 'extra', title: 'extra', embedding: DATA.queries[0]! }]
    await insertMultiple(db, extra)
    await insertMultiple(restored, extra)
    const codesById = (index: QuantizedVectorIndex) => {
      const snapshot = index.toBinarySnapshot()
      const ids = snapshot.arrays.ids as Uint32Array
      const codes = snapshot.arrays.codes as Uint8Array
      const stride = codes.length / ids.length
      return new Map(Array.from(ids, (id, i) => [id, Array.from(codes.subarray(i * stride, (i + 1) * stride))]))
    }
    expect(codesById(node(restored))).toEqual(codesById(node(db)))
    expect(node(restored).toBinarySnapshot().arrays['quantizer.codewords']).toEqual(
      node(db).toBinarySnapshot().arrays['quantizer.codewords']
    )
  })

  it('round-trips through the binary snapshot contract', async () => {
    const factory = flat({ quantization: await pq(OPTIONS), rescore: 'int8' })
    const db = makeDb(factory)
    await populate(db)
    const snapshot = node(db).toBinarySnapshot()
    expect(snapshot.meta.quantization).toMatchObject({ kind: 'pq', meta: { m: 16, ks: 64 } })
    expect(snapshot.arrays['quantizer.codewords']).toBeInstanceOf(Float32Array)

    const restored = factory.fromBinarySnapshot!(snapshot)
    const query = DATA.queries[1]!
    const top = (index: typeof restored) =>
      index
        .find(query, -1, undefined, { limit: 10 })
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    expect(top(restored)).toEqual(top(node(db)))
  })

  it('reconstructs vectors through getVector', async () => {
    const db = makeDb(flat({ quantization: await pq(OPTIONS) }))
    await populate(db)
    const id = db.internalDocumentIDStore.idToInternalId.get('77')!
    const decoded = node(db).getVector(id)!
    const original = DATA.vectors[77]!
    let dot = 0
    let norm = 0
    let decodedNorm = 0
    for (let i = 0; i < DIM; i++) {
      dot += decoded[i]! * original[i]!
      norm += original[i]! * original[i]!
      decodedNorm += decoded[i]! * decoded[i]!
    }
    expect(decodedNorm).toBeCloseTo(1, 4)
    expect(dot / Math.sqrt(norm)).toBeGreaterThan(0.9)
  })

  it('needs the pq quantizer to load a pq snapshot', async () => {
    const db = makeDb(flat({ quantization: await pq(OPTIONS) }))
    await populate(db)
    const raw = JSON.parse(JSON.stringify(save(db)))
    expect(() => load(makeDb(), raw)).toThrow(/"pq" quantizer/)
  })

  it('refits on demand', async () => {
    const factory: PQFactory = await pq({ ...OPTIONS, seed: 1 })
    const db = makeDb(flat({ quantization: factory, rescore: 'float32' }))
    await populate(db)
    const quantizer = node(db).getQuantizer() as ProductQuantizer
    const before = quantizer.codebook
    refit(db, 'embedding')
    expect(quantizer.codebook).not.toBe(before)
    expect(node(db).count).toBe(DATA.vectors.length)
    expect(await topK(db, DATA.vectors[5]!, 1)).toEqual(['5'])

    refit(db, 'embedding', DATA.vectors.slice(0, 600))
    expect(await topK(db, DATA.vectors[7]!, 1)).toEqual(['7'])

    expect(() => refit(db, 'missing')).toThrow(/Unknown vector property/)
    const plain = makeDb()
    await populate(plain, DATA.vectors.slice(0, 5))
    expect(() => refit(plain, 'embedding')).toThrow(/not quantized/)
  })
})
