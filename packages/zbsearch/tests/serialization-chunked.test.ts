import { describe, expect, it } from 'vitest'
import { count, create, getByID, insert, insertMultiple, load, loadAsync, save, search } from '../src/index.js'
import type { ChunkedRawData, RawData } from '../src/index.js'
import {
  CHUNKED_FORMAT_VERSION,
  fromChunkedRawData,
  isChunkedRawData,
  parseChunked,
  stringifyChunked,
  toChunkedRawData
} from '../src/methods/serialization.js'

const schema = {
  id: 'string',
  title: 'string',
  description: 'string',
  rating: 'number',
  available: 'boolean',
  genres: 'enum[]',
  tags: 'string[]',
  location: 'geopoint'
} as const

function makeDocs(howMany: number) {
  return Array.from({ length: howMany }, (_, i) => ({
    id: `doc-${i}`,
    title: `Document number ${i} about foxes and dogs`,
    description: `A longer body of text for document ${i} mentioning quick brown foxes, lazy dogs and other ${i % 7} things`,
    rating: (i % 50) / 10,
    available: i % 3 === 0,
    genres: [`genre-${i % 11}`, `genre-${i % 5}`],
    tags: [`tag-${i % 13}`, `tag-${i % 4}`],
    location: { lat: -90 + ((i * 7) % 180), lon: -180 + ((i * 13) % 360) }
  }))
}

function populated(howMany: number, sorted = true) {
  const db = create({ schema, sort: sorted ? undefined : { enabled: false } })
  insertMultiple(db, makeDocs(howMany))
  return db
}

function roundTripped(raw: RawData): RawData {
  return JSON.parse(JSON.stringify(raw)) as RawData
}

function probe(db: ReturnType<typeof populated>) {
  const out: Record<string, unknown> = {}
  for (const term of ['foxes', 'lazy dogs', 'document', 'quick brown']) {
    const res = search(db, { term, limit: 20 })
    out[term] = { count: res.count, hits: res.hits.map((h) => [h.id, h.score]) }
  }
  out['filtered'] = search(db, { term: 'foxes', where: { rating: { gt: 2 } }, limit: 20 }).hits.map((h) => h.id)
  out['enum'] = search(db, { term: 'foxes', where: { genres: { containsAll: ['genre-1'] } }, limit: 20 }).hits.map(
    (h) => h.id
  )
  out['sorted'] = search(db, { term: 'foxes', sortBy: { property: 'rating' }, limit: 20 }).hits.map((h) => h.id)
  out['typo'] = search(db, { term: 'foxs', tolerance: 2, limit: 20 }).count
  return out
}

describe('chunked serialization format', () => {
  it('should reconstruct exactly the same raw data as the default format', () => {
    const db = populated(400)

    const plain = roundTripped(save(db))
    const chunked = save(db, { format: 'chunked', chunkSize: 8 * 1024 })

    expect(fromChunkedRawData(chunked)).toEqual(plain)
    expect(JSON.stringify(fromChunkedRawData(chunked))).toBe(JSON.stringify(plain))
  })

  it('should reconstruct exactly the same raw data at many chunk sizes', () => {
    const db = populated(300)
    const plain = roundTripped(save(db))

    for (const chunkSize of [1024, 4096, 64 * 1024, 1024 * 1024, 64 * 1024 * 1024]) {
      const chunked = save(db, { format: 'chunked', chunkSize })
      expect(JSON.stringify(fromChunkedRawData(chunked)), `chunkSize ${chunkSize}`).toBe(JSON.stringify(plain))
    }
  })

  it('should actually split the payload into bounded chunks', () => {
    const db = populated(400)
    const chunkSize = 16 * 1024
    const chunked = save(db, { format: 'chunked', chunkSize })

    expect(chunked.chunks.length).toBeGreaterThan(5)

    const oversized = chunked.chunks.slice(1).filter((chunk) => chunk.length > chunkSize)
    expect(oversized.length).toBeLessThanOrEqual(2)
  })

  it('should stamp the format version', () => {
    const chunked = save(populated(20), { format: 'chunked' })
    expect(chunked.version).toBe(CHUNKED_FORMAT_VERSION)
    expect(isChunkedRawData(chunked)).toBe(true)
    expect(isChunkedRawData(save(populated(20)))).toBe(false)
  })

  it('should survive a JSON round trip of the chunk envelope', () => {
    const db = populated(200)
    const plain = roundTripped(save(db))

    const chunked = save(db, { format: 'chunked', chunkSize: 4096 })
    const transported = JSON.parse(JSON.stringify(chunked)) as ChunkedRawData

    expect(fromChunkedRawData(transported)).toEqual(plain)
  })

  it('should reject an unknown format version', () => {
    const chunked = save(populated(10), { format: 'chunked' })
    expect(() => fromChunkedRawData({ ...chunked, version: 99 })).toThrow(/unsupported chunked index version/)
  })

  it('should reject an empty chunk list', () => {
    expect(() => fromChunkedRawData({ version: CHUNKED_FORMAT_VERSION, chunks: [] })).toThrow(/empty/)
  })

  it('should reject a nonsensical chunk size', () => {
    const db = populated(10)
    expect(() => toChunkedRawData(save(db), 10)).toThrow(/chunkSize/)
    expect(() => toChunkedRawData(save(db), 1.5)).toThrow(/chunkSize/)
  })
})

describe('text transport', () => {
  it('should round trip through line-delimited text without a monolithic parse', async () => {
    const source = populated(300)
    const expected = probe(source)

    const text = stringifyChunked(save(source, { format: 'chunked', chunkSize: 8 * 1024 }))
    expect(text).not.toContain('\n\n')

    const db = create({ schema })
    await loadAsync(db, parseChunked(text))

    expect(count(db)).toBe(300)
    expect(probe(db)).toEqual(expected)
  })

  it('should produce one line per chunk', () => {
    const chunked = save(populated(200), { format: 'chunked', chunkSize: 4096 })
    const text = stringifyChunked(chunked)

    expect(text.split('\n')).toHaveLength(chunked.chunks.length)
    expect(parseChunked(text).chunks).toEqual(chunked.chunks)
    expect(parseChunked(text).version).toBe(CHUNKED_FORMAT_VERSION)
  })

  it('should never emit a raw newline inside a chunk', () => {
    const db = create({ schema })
    insert(db, {
      id: 'multiline',
      title: 'a title\nwith newlines\r\nand carriage returns',
      description: 'body\nwith\nbreaks',
      rating: 1,
      available: true,
      genres: ['g'],
      tags: ['t'],
      location: { lat: 0, lon: 0 }
    })

    const chunked = save(db, { format: 'chunked', chunkSize: 1024 })
    for (const chunk of chunked.chunks) {
      expect(chunk).not.toContain('\n')
    }

    const restored = create({ schema })
    load(restored, parseChunked(stringifyChunked(chunked)))
    expect(getByID(restored, 'multiline')).toEqual(getByID(db, 'multiline'))
  })
})

describe('save format is opt-in', () => {
  it('should return the untouched default format when no options are passed', () => {
    const db = populated(50)
    const raw = save(db)

    expect(isChunkedRawData(raw)).toBe(false)
    expect(Object.keys(raw).sort()).toEqual(
      ['docs', 'index', 'internalDocumentIDStore', 'language', 'pinning', 'sorting'].sort()
    )
  })

  it('should return the default format for an explicit format: default', () => {
    const db = populated(50)
    expect(save(db, { format: 'default' })).toEqual(save(db))
  })
})

describe('load and loadAsync accept both formats', () => {
  it('should load the default format synchronously, unchanged', () => {
    const source = populated(300)
    const expected = probe(source)

    const db = create({ schema })
    load(db, roundTripped(save(source)))

    expect(count(db)).toBe(300)
    expect(probe(db)).toEqual(expected)
  })

  it('should load the chunked format synchronously', () => {
    const source = populated(300)
    const expected = probe(source)

    const db = create({ schema })
    load(db, save(source, { format: 'chunked', chunkSize: 8 * 1024 }))

    expect(count(db)).toBe(300)
    expect(probe(db)).toEqual(expected)
  })

  it('should load the default format asynchronously', async () => {
    const source = populated(300)
    const expected = probe(source)

    const db = create({ schema })
    await loadAsync(db, roundTripped(save(source)))

    expect(count(db)).toBe(300)
    expect(probe(db)).toEqual(expected)
  })

  it('should load the chunked format asynchronously', async () => {
    const source = populated(300)
    const expected = probe(source)

    const db = create({ schema })
    await loadAsync(db, save(source, { format: 'chunked', chunkSize: 8 * 1024 }))

    expect(count(db)).toBe(300)
    expect(probe(db)).toEqual(expected)
  })

  it('should produce identical databases across all four load paths', async () => {
    const source = populated(250)
    const plain = roundTripped(save(source))
    const chunked = save(source, { format: 'chunked', chunkSize: 16 * 1024 })

    const a = create({ schema })
    load(a, plain)
    const b = create({ schema })
    load(b, chunked)
    const c = create({ schema })
    await loadAsync(c, plain)
    const d = create({ schema })
    await loadAsync(d, chunked)

    const expected = probe(a)
    expect(probe(b)).toEqual(expected)
    expect(probe(c)).toEqual(expected)
    expect(probe(d)).toEqual(expected)
    expect(save(b)).toEqual(save(a))
    expect(save(c)).toEqual(save(a))
    expect(save(d)).toEqual(save(a))
  })

  it('should remain searchable and re-serializable after a chunked round trip', async () => {
    const source = populated(200)

    const db = create({ schema })
    await loadAsync(db, save(source, { format: 'chunked', chunkSize: 4096 }))

    insert(db, {
      id: 'extra',
      title: 'An extra fox document',
      description: 'added after loading',
      rating: 4.2,
      available: true,
      genres: ['genre-1'],
      tags: ['tag-1'],
      location: { lat: 10, lon: 10 }
    })

    expect(count(db)).toBe(201)
    expect(getByID(db, 'extra')).toBeTruthy()
    expect(search(db, { term: 'extra' }).count).toBe(1)

    const again = create({ schema })
    await loadAsync(again, save(db, { format: 'chunked', chunkSize: 4096 }))
    expect(count(again)).toBe(201)
    expect(search(again, { term: 'extra' }).count).toBe(1)
  })
})

describe('edge cases', () => {
  it('should handle an empty database', async () => {
    const source = create({ schema })
    const chunked = save(source, { format: 'chunked' })

    expect(fromChunkedRawData(chunked)).toEqual(roundTripped(save(source)))

    const db = create({ schema })
    await loadAsync(db, chunked)
    expect(count(db)).toBe(0)
  })

  it('should handle a single document', async () => {
    const source = populated(1)
    const db = create({ schema })
    await loadAsync(db, save(source, { format: 'chunked', chunkSize: 1024 }))
    expect(count(db)).toBe(1)
    expect(getByID(db, 'doc-0')).toEqual(getByID(source, 'doc-0'))
  })

  it('should handle a database with sorting disabled', async () => {
    const source = populated(120, false)
    const db = create({ schema, sort: { enabled: false } })
    await loadAsync(db, save(source, { format: 'chunked', chunkSize: 4096 }))
    expect(count(db)).toBe(120)
    expect(search(db, { term: 'foxes' }).count).toBe(search(source, { term: 'foxes' }).count)
  })

  it('should preserve vector indexes', async () => {
    const vectorSchema = { id: 'string', title: 'string', embedding: 'vector[3]' } as const
    const source = create({ schema: vectorSchema })
    insertMultiple(source, [
      { id: 'a', title: 'first', embedding: [1, 0, 0] },
      { id: 'b', title: 'second', embedding: [0, 1, 0] },
      { id: 'c', title: 'third', embedding: [0, 0, 1] }
    ])

    const db = create({ schema: vectorSchema })
    await loadAsync(db, save(source, { format: 'chunked', chunkSize: 1024 }))

    expect(count(db)).toBe(3)
    const results = search(db, { mode: 'vector', vector: { value: [1, 0, 0], property: 'embedding' } })
    expect(results.hits[0].id).toBe('a')
  })
})
