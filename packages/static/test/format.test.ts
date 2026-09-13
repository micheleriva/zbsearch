import { describe, expect, it } from 'vitest'
import { create, insertMultiple, save } from 'zbsearch'
import type { RawData } from 'zbsearch'
import { ByteReader, ByteWriter } from '../src/varint.js'
import { decodeShard, encodeShard, encodedTermSize, type TermPostings } from '../src/shard.js'
import { decodeDictionary, encodeDictionary } from '../src/dictionary.js'
import { decodeFragment, encodeFragment } from '../src/fragments.js'
import { shardForTerm, type ShardRef } from '../src/manifest.js'
import { rawParts } from '../src/raw.js'

describe('varint', () => {
  it('round-trips values across the whole range', () => {
    const values = [0, 1, 127, 128, 300, 16_383, 16_384, 2 ** 21, 2 ** 31, 2 ** 32 + 5, Number.MAX_SAFE_INTEGER]
    const writer = new ByteWriter()
    for (const value of values) {
      writer.writeVarint(value)
    }

    const reader = new ByteReader(writer.toUint8Array())
    for (const value of values) {
      expect(reader.readVarint()).toBe(value)
    }
    expect(reader.eof).toBe(true)
  })

  it('rejects negative and fractional values', () => {
    const writer = new ByteWriter()
    expect(() => writer.writeVarint(-1)).toThrow(TypeError)
    expect(() => writer.writeVarint(1.5)).toThrow(TypeError)
  })

  it('round-trips strings, including non-ASCII', () => {
    const writer = new ByteWriter()
    writer.writeString('hello')
    writer.writeString('ricerca però àèì')
    writer.writeString('')

    const reader = new ByteReader(writer.toUint8Array())
    expect(reader.readString()).toBe('hello')
    expect(reader.readString()).toBe('ricerca però àèì')
    expect(reader.readString()).toBe('')
  })
})

describe('shard codec', () => {
  const sample: TermPostings[] = [
    {
      term: 'query',
      byProp: [
        { prop: 0, entries: [{ docId: 1, tf: 2, fieldLen: 10 }] },
        {
          prop: 3,
          entries: [
            { docId: 2, tf: 1, fieldLen: 45 },
            { docId: 7, tf: 4, fieldLen: 120 },
            { docId: 90, tf: 1, fieldLen: 8 }
          ]
        }
      ]
    },
    { term: 'zebra', byProp: [{ prop: 1, entries: [{ docId: 500, tf: 1, fieldLen: 3 }] }] }
  ]

  it('round-trips term postings', () => {
    expect(decodeShard(encodeShard(sample))).toEqual(sample)
  })

  it('encodedTermSize matches the per-term encoded footprint', () => {
    const both = encodeShard(sample).length
    const first = encodeShard([sample[0]]).length
    const second = encodeShard([sample[1]]).length
    // Each single-term shard spends 1 byte on its own count varint.
    expect(encodedTermSize(sample[0]) + encodedTermSize(sample[1])).toBe(both - 1)
    expect(encodedTermSize(sample[0])).toBe(first - 1)
    expect(encodedTermSize(sample[1])).toBe(second - 1)
  })
})

describe('fragments codec', () => {
  it('round-trips document groups', () => {
    const docs = { 1: { id: '1', title: 'a' }, 2: { id: '2', title: 'b' } }
    expect(decodeFragment(encodeFragment(docs))).toEqual(docs)
  })
})

describe('shard lookup', () => {
  const shards: ShardRef[] = [
    { file: 'postings/0.bin', bytes: 0, firstTerm: 'alpha', lastTerm: 'delta', terms: 4 },
    { file: 'postings/1.bin', bytes: 0, firstTerm: 'echo', lastTerm: 'lima', terms: 4 },
    { file: 'postings/2.bin', bytes: 0, firstTerm: 'mike', lastTerm: 'zulu', terms: 4 }
  ]

  it('finds the covering shard by range', () => {
    expect(shardForTerm(shards, 'alpha')?.file).toBe('postings/0.bin')
    expect(shardForTerm(shards, 'delta')?.file).toBe('postings/0.bin')
    expect(shardForTerm(shards, 'foxtrot')?.file).toBe('postings/1.bin')
    expect(shardForTerm(shards, 'zulu')?.file).toBe('postings/2.bin')
    // Terms between ranges or outside them resolve to nothing.
    expect(shardForTerm(shards, 'dz')).toBeUndefined()
    expect(shardForTerm(shards, 'zzz')).toBeUndefined()
    expect(shardForTerm([], 'anything')).toBeUndefined()
  })
})

describe('dictionary codec', () => {
  it('rebuilds tries whose word walks match the original', async () => {
    const db = create({
      schema: { title: 'string', content: 'string' } as const,
      language: 'english',
      inferSchema: false,
      sort: { enabled: false }
    })
    await insertMultiple(db, [
      { id: '1', title: 'sharded search', content: 'shards and sharding for lazy search indexes' },
      { id: '2', title: 'query planner', content: 'the query planner shapes sharded query execution' }
    ])

    const raw = save(db) as RawData
    const { index: rawIndex } = rawParts(raw)

    const bytes = encodeDictionary({
      title: rawIndex.indexes['title'].node,
      content: rawIndex.indexes['content'].node
    })
    const tries = decodeDictionary(bytes)

    for (const prop of ['title', 'content'] as const) {
      const original = Object.keys(rawIndex.indexes[prop].node.postings ?? {}).sort()

      // Every indexed word is findable exactly, with no postings attached.
      for (const word of original) {
        const found = tries[prop].find({ term: word, exact: true })
        expect(Object.keys(found)).toEqual([word])
        expect(found[word]).toEqual([])
      }

      // A prefix walk enumerates the same words the original index holds.
      const walked = Object.keys(tries[prop].find({ term: '' })).sort()
      expect(walked).toEqual(original)
    }

    // Typo-tolerant walks work on the rebuilt trie too.
    expect(Object.keys(tries['content'].find({ term: 'qeury', tolerance: 2 }))).toContain('query')
  })
})
