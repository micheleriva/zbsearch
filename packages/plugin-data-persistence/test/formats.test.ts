import { describe, expect, it, onTestFinished } from 'vitest'
import { readFileSync } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { create, insertMultiple, isBinarySnapshot, save, search, searchVector, count, getByID } from 'zbsearch'
import type { AnyZBSearch } from 'zbsearch'
import { persist, restore, snapshotToBytes } from '../src/index.js'
import { persistToFile, restoreFromFile, getDefaultFileName } from '../src/server.js'
import { persistToStorage, restoreFromStorage } from '../src/storage.js'
import type { PersistenceStorage } from '../src/storage.js'
import { legacyHexToBytes, decodeMsgpackPayload } from '../src/payload.js'
import { deserializeZBSearchInstance, serializeZBSearchInstance } from '../src/seqproto.js'

const legacy = JSON.parse(readFileSync(new URL('./fixtures/legacy-payloads.json', import.meta.url), 'utf8')) as {
  hex: string
  seq: string
}

const schema = {
  text: 'string',
  title: 'string',
  page: 'number',
  ratio: 'number',
  year: 'number',
  published: 'boolean',
  collection: 'enum',
  tags: 'string[]',
  location: 'geopoint',
  embedding: 'vector[16]'
} as const

const WORDS = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau'.split(
  ' '
)

function makeDocs(howMany: number, words = 20) {
  return Array.from({ length: howMany }, (_, i) => ({
    id: `doc-${i}`,
    text: Array.from({ length: words }, (_, j) => WORDS[(i * 7 + j * j) % WORDS.length]).join(' ') + ` n${i}`,
    title: `Paper ${Math.floor(i / 10)} ${WORDS[i % WORDS.length]}`,
    page: i % 80,
    ratio: i / 7,
    year: 1990 + (i % 30),
    published: i % 2 === 0,
    collection: `c${i % 4}`,
    tags: [WORDS[i % 5], `t${i % 3}`],
    location: { lat: (i % 90) - 45, lon: (i % 180) - 90 },
    embedding: Array.from({ length: 16 }, (_, d) => Math.sin(i + d * 1.3))
  }))
}

function populated(howMany: number, words?: number) {
  const db = create({ schema })
  insertMultiple(db, makeDocs(howMany, words))
  return db as unknown as AnyZBSearch
}

function probe(db: AnyZBSearch) {
  const ids = (res: { hits: { id: string; score: number }[] }) => res.hits.map((h) => [h.id, h.score])
  return {
    count: count(db),
    text: ids(search(db, { term: 'gamma delta', limit: 20 }) as any),
    numbers: ids(search(db, { where: { ratio: { gt: 3.5 }, year: { lt: 2000 } }, limit: 50 } as any) as any),
    bool: ids(search(db, { where: { published: true }, limit: 50 } as any) as any),
    enums: ids(search(db, { where: { collection: { eq: 'c2' } }, limit: 50 } as any) as any),
    geo: ids(
      search(db, {
        where: { location: { radius: { coordinates: { lat: 0, lon: 0 }, unit: 'km', value: 2000 } } },
        limit: 50
      } as any) as any
    ),
    sorted: (search(db, { sortBy: { property: 'ratio', order: 'DESC' }, limit: 20 } as any) as any).hits.map(
      (h: any) => h.id
    ),
    vector: ids(
      searchVector(db as any, {
        vector: { value: makeDocs(4)[3].embedding, property: 'embedding' },
        similarity: 0.2,
        limit: 10
      }) as any
    ),
    doc: getByID(db as any, 'doc-3')
  }
}

class MemoryStorage implements PersistenceStorage {
  store = new Map<string, Uint8Array>()
  async get(key: string) {
    const body = this.store.get(key)
    return body ? { body } : null
  }
  async put(key: string, body: Uint8Array) {
    this.store.set(key, body)
  }
}

describe("'binary' format", () => {
  it('returns raw msgpack bytes instead of a hex string', async () => {
    const db = populated(50)
    const payload = await persist(db, 'binary')
    expect(payload).toBeInstanceOf(Uint8Array)
    expect(typeof payload).not.toBe('string')

    const restored = await restore<AnyZBSearch>('binary', payload)
    expect(probe(restored)).toEqual(probe(db))
  })

  it('still restores the hex payloads of previous versions', async () => {
    const fromString = await restore<AnyZBSearch>('binary', legacy.hex)
    expect(search(fromString, { term: 'work' }).hits.map((h) => h.id)).toEqual(['a'])

    // The hex text saved to a file and read back as bytes
    const fromBytes = await restore<AnyZBSearch>('binary', new TextEncoder().encode(legacy.hex))
    expect(save(fromBytes)).toEqual(save(fromString))

    // Uppercase hex and the non-Buffer decoder
    const bytes = legacyHexToBytes(new TextEncoder().encode(legacy.hex.toUpperCase()))
    expect(bytes).toEqual(new Uint8Array(Buffer.from(legacy.hex, 'hex')))
    expect(legacyHexToBytes(new TextEncoder().encode('0aff zz'))).toEqual(new Uint8Array([10, 255]))
    expect(decodeMsgpackPayload(new TextEncoder().encode(legacy.hex).buffer)).toEqual(decodeMsgpackPayload(legacy.hex))
  })

  it('also restores binary snapshots', async () => {
    const db = populated(30)
    const restored = await restore<AnyZBSearch>('binary', await snapshotToBytes(db))
    expect(probe(restored)).toEqual(probe(db))
  })
})

describe("'seqproto' format", () => {
  it('round trips vectors, numbers, booleans, enums, geopoints and sorting exactly', async () => {
    const db = populated(200)
    const payload = await persist(db, 'seqproto')
    expect(payload).toBeInstanceOf(ArrayBuffer)

    const restored = await restore<AnyZBSearch>('seqproto', payload)
    expect(JSON.parse(JSON.stringify(save(restored)))).toEqual(JSON.parse(JSON.stringify(save(db))))
    expect(probe(restored)).toEqual(probe(db))

    // From a Uint8Array view with an unaligned offset
    const bytes = new Uint8Array((payload as ArrayBuffer).byteLength + 1)
    bytes.set(new Uint8Array(payload as ArrayBuffer), 1)
    const fromView = await restore<AnyZBSearch>('seqproto', bytes.subarray(1))
    expect(probe(fromView)).toEqual(probe(db))
  })

  it('grows its buffer past the old fixed 16 MiB', () => {
    const db = create({ schema: { text: 'string' } as const })
    const words = Array.from({ length: 400 }, (_, i) => `word${i}`)
    insertMultiple(
      db,
      Array.from({ length: 2000 }, (_, i) => ({
        text: Array.from({ length: 250 }, (_, j) => words[(i * 31 + j * 17) % words.length]).join(' ') + ` u${i}`
      }))
    )

    const payload = serializeZBSearchInstance(db)
    expect(payload.byteLength).toBeGreaterThan(16 * 1024 * 1024)
    const raw = deserializeZBSearchInstance(new Uint8Array(payload))
    expect(raw).toEqual(JSON.parse(JSON.stringify(save(db))))
  })

  it('reads payloads of the previous format version', async () => {
    const restored = await restore<AnyZBSearch>('seqproto', new Uint8Array(Buffer.from(legacy.seq, 'base64')))
    expect(search(restored, { term: 'yourself' }).hits.map((h) => h.id)).toEqual(['b'])
  })

  it('rejects unknown versions and corrupted payloads', () => {
    const payload = new Uint32Array([99, 0]).buffer
    expect(() => deserializeZBSearchInstance(payload)).toThrow(/version: 99/)
    expect(() => deserializeZBSearchInstance(new Uint32Array([3, 77]).buffer)).toThrow(/unknown value tag 77/)
  })
})

describe("'snapshot' format", () => {
  it('persists in memory as a binary snapshot', async () => {
    const db = populated(120)
    const payload = await persist(db, 'snapshot')
    expect(payload).toBeInstanceOf(Uint8Array)
    expect(isBinarySnapshot(payload as Uint8Array)).toBe(true)
    expect((payload as Uint8Array).length).toBeLessThan(((await persist(db, 'json')) as string).length / 2)

    const restored = await restore<AnyZBSearch>('snapshot', payload)
    expect(probe(restored)).toEqual(probe(db))
  })

  it('streams to and from files', async () => {
    const db = populated(300)
    const path = join(tmpdir(), `zbsearch-snapshot-${process.pid}-${Date.now()}.zbsb`)
    onTestFinished(() => rm(path, { force: true }))

    expect(await persistToFile(db, 'snapshot', path)).toBe(path)
    expect((await stat(path)).size).toBeGreaterThan(1000)
    expect(await getDefaultFileName('snapshot')).toMatch(/\.zbsb$/)

    const restored = await restoreFromFile<AnyZBSearch>('snapshot', path)
    expect(probe(restored)).toEqual(probe(db))

    // A 'binary' restore detects the snapshot as well
    const viaBinary = await restoreFromFile<AnyZBSearch>('binary', path)
    expect(probe(viaBinary)).toEqual(probe(db))
  })

  it('works with storage backends', async () => {
    const db = populated(80)
    const storage = new MemoryStorage()

    await persistToStorage(db, storage, 'snap', { format: 'snapshot' })
    expect(isBinarySnapshot(storage.store.get('snap')!)).toBe(true)
    expect(probe(await restoreFromStorage<AnyZBSearch>(storage, 'snap', { format: 'snapshot' }))).toEqual(probe(db))
    expect(probe(await restoreFromStorage<AnyZBSearch>(storage, 'snap', { format: 'binary' }))).toEqual(probe(db))

    await persistToStorage(db, storage, 'msgpack', { format: 'binary' })
    expect(probe(await restoreFromStorage<AnyZBSearch>(storage, 'msgpack'))).toEqual(probe(db))

    await persistToStorage(db, storage, 'seq', { format: 'seqproto' })
    expect(probe(await restoreFromStorage<AnyZBSearch>(storage, 'seq', { format: 'seqproto' }))).toEqual(probe(db))
  })
})
