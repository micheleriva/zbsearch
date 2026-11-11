import { describe, expect, it } from 'vitest'
import {
  create,
  freeze,
  insertMultiple,
  insertPin,
  load,
  loadBinarySync,
  remove,
  save,
  saveBinarySync,
  search,
  update,
  upsert,
  internals,
  type AnyZBSearch
} from '../src/index.js'
import type { Index } from '../src/components/index.js'
import type { CorpusStatistics } from '../src/internals.js'
import { FROZEN_BLOCK_SIZE } from '../src/trees/frozen.js'
import { expectParity, expectSuggestParity } from './helpers/parity.js'

// Frozen segments (issue #87) must not change any search result: every database below is compared with a reference
// database that went through the same inserts, updates and removals but was never frozen. Rankings must match with
// the standard of the sharded parity tests: same count, scores within 1e-9 at every rank, the same ids in the same
// order except for swaps inside groups of tied scores.

const SCHEMA = {
  text: 'string',
  title: 'string',
  tags: 'string[]',
  meta: { note: 'string' },
  year: 'number',
  collection: 'enum',
  open: 'boolean'
} as const

type Doc = {
  id: string
  text: string
  title: string
  tags?: string[]
  meta?: { note: string }
  year: number
  collection: string
  open: boolean
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SYLLABLES = ['ka', 'lo', 'mi', 'ne', 'ru', 'sa', 'ti', 'vo', 'ze', 'pa', 'do', 'fi']
const WORDS: string[] = []
for (let i = 0; WORDS.length < 400; i++) {
  let word = ''
  let n = i + SYLLABLES.length
  while (n > 0) {
    word += SYLLABLES[n % SYLLABLES.length]
    n = Math.floor(n / SYLLABLES.length)
  }
  WORDS.push(word)
}

function corpus(seed: number) {
  const random = rng(seed)
  const cdf: number[] = []
  let total = 0
  for (let i = 0; i < WORDS.length; i++) {
    total += 1 / (i + 1)
    cdf.push(total)
  }
  const word = () => {
    const target = random() * total
    let i = 0
    while (cdf[i] < target) i++
    return WORDS[i]
  }
  const sentence = (n: number) => Array.from({ length: n }, word).join(' ')
  let next = 0

  return {
    random,
    word,
    doc(id = `d${next++}`): Doc {
      const doc: Doc = {
        id,
        // Some documents have an empty text (field length 0)
        text: random() < 0.03 ? '' : sentence(3 + Math.floor(random() * 40)),
        title: sentence(1 + Math.floor(random() * 5)),
        year: 1990 + Math.floor(random() * 30),
        collection: `c${Math.floor(random() * 5)}`,
        open: random() < 0.5
      }
      if (random() < 0.7) {
        doc.tags = Array.from({ length: Math.floor(random() * 4) }, () => sentence(1 + Math.floor(random() * 2)))
      }
      if (random() < 0.6) {
        doc.meta = { note: sentence(1 + Math.floor(random() * 6)) }
      }
      return doc
    }
  }
}

type Op =
  | { type: 'insert'; docs: Doc[] }
  | { type: 'remove'; ids: string[] }
  | { type: 'update'; docs: Doc[] }
  | { type: 'upsert'; docs: Doc[] }
  | { type: 'freeze' }

// A history of inserts, freezes, removals, updates and upserts touching frozen and unfrozen documents alike
function history(seed: number, size: number): Op[] {
  const c = corpus(seed)
  const live: string[] = []
  const ops: Op[] = []
  const take = (n: number) => {
    const ids: string[] = []
    for (let i = 0; i < n && live.length > 0; i++) {
      ids.push(live.splice(Math.floor(c.random() * live.length), 1)[0])
    }
    return ids
  }

  const insert = (n: number) => {
    const docs = Array.from({ length: n }, () => c.doc())
    live.push(...docs.map((d) => d.id))
    ops.push({ type: 'insert', docs })
  }

  insert(size)
  ops.push({ type: 'freeze' })
  insert(Math.ceil(size / 4))
  ops.push({ type: 'remove', ids: take(Math.ceil(size / 10)) })
  let ids = take(Math.ceil(size / 8))
  ops.push({ type: 'update', docs: ids.map((id) => c.doc(id)) })
  live.push(...ids)
  ops.push({ type: 'freeze' })
  insert(Math.ceil(size / 5))
  ids = take(Math.ceil(size / 10))
  ops.push({ type: 'upsert', docs: [...ids.map((id) => c.doc(id)), c.doc(), c.doc()] })
  live.push(...ids)
  ops.push({ type: 'remove', ids: take(Math.ceil(size / 12)) })
  ids = take(Math.ceil(size / 12))
  ops.push({ type: 'update', docs: ids.map((id) => c.doc(id)) })
  live.push(...ids)
  return ops
}

type Options = { exclude?: boolean; threshold?: number }

function newDb({ exclude, threshold }: Options = {}): AnyZBSearch {
  return create({
    schema: SCHEMA,
    ...(exclude ? { store: { exclude: ['text', 'tags'] } } : {}),
    ...(threshold ? { freeze: { threshold } } : {})
  } as never) as AnyZBSearch
}

// `freezes`: which freeze operations of the history to apply (the reference applies none)
function build(ops: Op[], options: Options, freezes: (n: number) => boolean): AnyZBSearch {
  const db = newDb(options)
  let n = 0
  for (const op of ops) {
    switch (op.type) {
      case 'insert':
        insertMultiple(db, structuredClone(op.docs) as never)
        break
      case 'remove':
        for (const id of op.ids) remove(db, id)
        break
      case 'update':
        for (const doc of op.docs) update(db, doc.id, structuredClone(doc) as never)
        break
      case 'upsert':
        for (const doc of op.docs) upsert(db, structuredClone(doc) as never)
        break
      case 'freeze':
        if (freezes(n++)) freeze(db)
        break
    }
  }
  return db
}

function queries(seed: number): Record<string, unknown>[] {
  const c = corpus(seed)
  const w = () => c.word()
  const rare = () => WORDS[100 + Math.floor(c.random() * 300)]
  const out: Record<string, unknown>[] = [
    { term: '' },
    { term: '', properties: ['title'] },
    { term: 'zzzz' },
    { term: WORDS[0] },
    { term: WORDS[0].slice(0, 2) },
    { term: WORDS[1], exact: true },
    { term: `${WORDS[0]} ${WORDS[3]}`, threshold: 0 },
    { term: `${WORDS[0]} ${rare()}`, threshold: 0.5 },
    { term: WORDS[2], properties: ['tags'] },
    { term: WORDS[2], properties: ['meta.note'] },
    { where: { collection: { eq: 'c1' } } },
    { where: { title: WORDS[0] } },
    { term: WORDS[0], where: { title: [WORDS[1], WORDS[2]] } },
    { term: WORDS[4], where: { tags: WORDS[3] } }
  ]

  const variants: Array<(term: string) => Record<string, unknown>> = [
    (term) => ({ term }),
    (term) => ({ term, tolerance: 1 }),
    (term) => ({ term, tolerance: 2, limit: 30 }),
    (term) => ({ term, prefix: false }),
    (term) => ({ term, exact: true }),
    (term) => ({ term, threshold: 0 }),
    (term) => ({ term, threshold: 0.3 }),
    (term) => ({ term, boost: { title: 2.5, tags: 0.5 } }),
    (term) => ({ term, properties: ['text', 'meta.note'] }),
    (term) => ({ term, relevance: { k: 1.6, b: 0.4, d: 0.2 } }),
    (term) => ({ term, where: { year: { between: [1995, 2010] } } }),
    (term) => ({ term, where: { or: [{ collection: { in: ['c1', 'c2'] } }, { open: true }] } }),
    (term) => ({ term, where: { not: { year: { lt: 2000 } } } }),
    (term) => ({ term, facets: { collection: {}, open: {}, year: { ranges: [{ from: 1990, to: 2005 }] } } }),
    (term) => ({ term, groupBy: { properties: ['open', 'year'], maxResult: 3 } }),
    (term) => ({ term, sortBy: { property: 'year', order: 'DESC' } }),
    (term) => ({ term, sortBy: { property: 'title' } }),
    (term) => ({ term, limit: 5, offset: 7 }),
    (term) => ({ term, distinctOn: 'collection' }),
    (term) => ({ term, preflight: true })
  ]

  for (let i = 0; i < 70; i++) {
    const n = 1 + Math.floor(c.random() * 3)
    const words = Array.from({ length: n }, () => (c.random() < 0.3 ? rare() : w()))
    // Prefixes and typos
    if (c.random() < 0.25) words[0] = words[0].slice(0, Math.max(1, words[0].length - 2))
    if (c.random() < 0.2) words[0] = `${words[0]}x`
    out.push(variants[i % variants.length](words.join(' ')))
  }
  return out
}

function frozenSegments(db: AnyZBSearch): number {
  const frozen = (db.data.index as Index).frozen ?? {}
  return Object.values(frozen).reduce((n, segments) => n + segments.length, 0)
}

function checkAll(actual: AnyZBSearch, reference: AnyZBSearch, seed: number) {
  for (const params of queries(seed)) {
    expectParity(actual, reference, params)
  }
  for (const term of [WORDS[0].slice(0, 2), `${WORDS[1]} ${WORDS[5].slice(0, 3)}`, WORDS[7]]) {
    expectSuggestParity(actual, reference, term)
    expectSuggestParity(actual, reference, term, 1)
  }
}

describe('frozen segments', () => {
  for (const exclude of [false, true]) {
    describe(exclude ? 'with text and tags excluded from the store' : 'with every property stored', () => {
      const ops = history(exclude ? 11 : 7, 260)
      const reference = build(ops, { exclude }, () => false)

      it('a fully frozen index ranks like the mutable one', () => {
        const db = build(ops, { exclude }, () => true)
        freeze(db)
        expect(frozenSegments(db)).toBeGreaterThan(0)
        checkAll(db, reference, 1)
      })

      it('frozen segments with a mutable tail and tombstones rank like the mutable index', () => {
        // Frozen once: later inserts are in the tail, later removals and updates are tombstones
        const db = build(ops, { exclude }, (n) => n === 0)
        const index = db.data.index as Index
        expect(index.frozen!.text[0].deleted).toBeGreaterThan(0)
        checkAll(db, reference, 2)
      })

      it('several segments from automatic freezes rank like the mutable index', () => {
        // 37 documents per freeze leave 7 segments at the end of the history (17 leaves one, after merges)
        const db = build(ops, { exclude, threshold: 37 }, () => false)
        expect((db.data.index as Index).frozen!.text.length).toBe(7)
        checkAll(db, reference, 3)
        const merged = build(ops, { exclude, threshold: 17 }, () => false)
        expect((merged.data.index as Index).frozen!.text.length).toBe(1)
        checkAll(merged, reference, 10)
      })

      it('JSON and binary snapshots of a frozen index rank like the mutable index', () => {
        const db = build(ops, { exclude }, (n) => n === 0)

        const fromJson = newDb({ exclude })
        load(fromJson, JSON.parse(JSON.stringify(save(db))))
        expect(frozenSegments(fromJson)).toBe(frozenSegments(db))
        checkAll(fromJson, reference, 4)

        const fromBinary = newDb({ exclude })
        loadBinarySync(fromBinary, saveBinarySync(db))
        expect(frozenSegments(fromBinary)).toBe(frozenSegments(db))
        checkAll(fromBinary, reference, 5)

        // The loaded databases keep working: more changes, then a freeze
        const extra = corpus(99)
        const docs = Array.from({ length: 20 }, (_, i) => extra.doc(`x${i}`))
        const replacement = extra.doc('d10')
        for (const target of [fromJson, fromBinary, reference]) {
          insertMultiple(target, structuredClone(docs) as never)
          remove(target, 'd3')
          remove(target, 'x4')
          update(target, 'd10', structuredClone(replacement) as never)
        }
        freeze(fromJson)
        checkAll(fromJson, reference, 6)
        checkAll(fromBinary, reference, 7)
        for (const target of [fromJson, fromBinary, reference]) remove(target, 'x5')
      })
    })
  }

  it('honours the corpus statistics of a sharded index', () => {
    const ops = history(21, 160)
    const reference = build(ops, {}, () => false)
    const frozen = build(ops, {}, () => true)
    const index = reference.data.index as Index
    const stats: CorpusStatistics = {
      docsCount: 1000,
      avgFieldLength: { ...index.avgFieldLength, text: 12.5 },
      documentFrequency: (prop, term) => {
        const tree = index.indexes[prop]
        return tree?.type === 'Radix' ? tree.node.getDocumentFrequency(term) * 3 + 1 : 0
      }
    }
    internals.setCorpusStatistics(reference, stats)
    internals.setCorpusStatistics(frozen, stats)
    checkAll(frozen, reference, 8)
  })

  it('applies pinning rules to frozen indexes', () => {
    const ops = history(31, 120)
    const reference = build(ops, {}, () => false)
    const frozen = build(ops, {}, () => true)
    for (const db of [reference, frozen]) {
      insertPin(db, {
        id: 'rule',
        conditions: [{ anchoring: 'contains', pattern: WORDS[0] }],
        consequence: {
          promote: [
            { doc_id: 'd5', position: 0 },
            { doc_id: 'd60', position: 3 }
          ]
        }
      })
    }
    for (const term of [WORDS[0], `${WORDS[0]} ${WORDS[2]}`, WORDS[1]]) {
      expectParity(frozen, reference, { term })
      expectParity(frozen, reference, { term, limit: 2 })
    }
  })

  it('keeps BM25 statistics exact through removals of frozen documents', () => {
    const ops = history(41, 200)
    const reference = build(ops, { exclude: true }, () => false)
    const frozen = build(ops, { exclude: true }, () => true)
    const a = frozen.data.index as Index
    const b = reference.data.index as Index
    expect(a.avgFieldLength).toStrictEqual(b.avgFieldLength)
    for (const id of ['d1', 'd2', 'd30', 'd31', 'd150']) {
      expect(remove(frozen, id)).toBe(remove(reference, id))
      expect(remove(frozen, id)).toBe(false)
    }
    expect(a.avgFieldLength).toStrictEqual(b.avgFieldLength)
    expect(internals.calculateResultScores).toBeTypeOf('function')
    checkAll(frozen, reference, 9)
  })

  it('freezes long postings lists in blocks and still skips nothing', () => {
    const db = create({ schema: { text: 'string' } as const })
    const reference = create({ schema: { text: 'string' } as const })
    const docs = Array.from({ length: FROZEN_BLOCK_SIZE * 3 + 17 }, (_, i) => ({
      id: `${i}`,
      text: `common ${i % 3 === 0 ? 'third' : 'other'} ${'repeat '.repeat(i % 7)}`
    }))
    insertMultiple(db, docs)
    insertMultiple(reference, docs)
    freeze(db)
    for (const id of ['0', '128', '129', '300']) {
      remove(db, id)
      remove(reference, id)
    }
    for (const term of ['common', 'third', 'repeat', 'rep', 'comon', 'other repeat']) {
      expectParity(db, reference, { term, tolerance: term === 'comon' ? 1 : 0 })
    }
  })

  it('validates the freeze option and rejects custom index components', () => {
    expect(() => create({ schema: { text: 'string' } as const, freeze: { threshold: 0 } })).toThrow(
      'INVALID_FREEZE_CONFIG'.length ? /threshold/ : ''
    )
    expect(() => create({ schema: { text: 'string' } as const, freeze: { threshold: 1.5 } })).toThrow(/threshold/)
    const db = create({ schema: { text: 'string' } as const })
    const custom = create({
      schema: { text: 'string' } as const,
      components: { index: { ...db.index, search: (...args: unknown[]) => (db.index.search as any)(...args) } }
    })
    expect(() => freeze(custom)).toThrow(/built-in index/)
  })

  it('freezing an empty or already frozen database is a no-op', () => {
    const db = create({ schema: { text: 'string' } as const })
    freeze(db)
    expect(search(db, { term: 'x' }).count).toBe(0)
    insertMultiple(db, [{ id: 'a', text: 'hello world' }])
    freeze(db)
    const segments = (db.data.index as Index).frozen!.text
    freeze(db)
    expect((db.data.index as Index).frozen!.text).toBe(segments)
    expect(search(db, { term: 'hello' }).hits.map((h) => h.id)).toStrictEqual(['a'])
  })
})
