import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  create,
  freeze,
  insertMultiple,
  loadBinarySync,
  remove,
  saveBinarySync,
  update,
  type AnyZBSearch
} from '../src/index.js'
import type { Index } from '../src/components/index.js'
// @ts-expect-error: a plain JavaScript module, shared with the script that wrote the fixture
import { SCHEMA, STORE, releaseSnapshotDocs } from './fixtures/release-snapshot-docs.mjs'
import { expectParity, expectSuggestParity } from './helpers/parity.js'

// A binary snapshot written by zbsearch 4.0.3 (format version 1, no frozen segments) must load and rank as before,
// and must be freezable once loaded.

const fixture = new Uint8Array(readFileSync(new URL('./fixtures/release-4.0.3.zbsb', import.meta.url)))

function newDb(): AnyZBSearch {
  return create({ schema: SCHEMA, store: STORE } as never) as AnyZBSearch
}

// The database the fixture was written from, rebuilt with this build
function rebuild(): AnyZBSearch {
  const docs = releaseSnapshotDocs()
  const db = newDb()
  insertMultiple(db, docs)
  for (let i = 0; i < 300; i += 13) remove(db, `r${i}`)
  for (let i = 5; i < 300; i += 17) {
    if (i % 13 !== 0) update(db, `r${i}`, { ...docs[(i * 7) % 300], id: `r${i}` } as never)
  }
  return db
}

const QUERIES: Record<string, unknown>[] = [
  { term: 'ka' },
  { term: 'kaka lo', tolerance: 1 },
  { term: 'mi ne', threshold: 0 },
  { term: 'lomi', exact: true },
  { term: 'ka', where: { year: { gte: 2010 }, kind: { eq: 'k1' } } },
  { term: 'ru', properties: ['title', 'tags'], boost: { title: 2 } },
  { term: 'sa', sortBy: { property: 'year', order: 'DESC' } },
  { term: 'ti', facets: { kind: {}, open: {} } },
  { where: { tags: 'ka' } },
  { term: '' }
]

function expectSameRankings(actual: AnyZBSearch, reference: AnyZBSearch) {
  for (const params of QUERIES) {
    expectParity(actual, reference, params)
  }
  expectSuggestParity(actual, reference, 'ka lo')
  expectSuggestParity(actual, reference, 'mi', 1)
}

describe('snapshots written by zbsearch 4.0.3', () => {
  it('load, rank as before, freeze and save as version 2', () => {
    expect(fixture[4]).toBe(1)
    const reference = rebuild()

    const loaded = newDb()
    loadBinarySync(loaded, fixture)
    expectSameRankings(loaded, reference)

    freeze(loaded)
    expect((loaded.data.index as Index).frozen!.text).toHaveLength(1)
    expectSameRankings(loaded, reference)

    // Removing and updating frozen documents of the loaded snapshot
    const docs = releaseSnapshotDocs()
    for (const db of [loaded, reference]) {
      remove(db, 'r1')
      update(db, 'r2', { ...docs[99], id: 'r2' } as never)
    }
    expectSameRankings(loaded, reference)

    const snapshot = saveBinarySync(loaded)
    expect(snapshot[4]).toBe(2)
    const reloaded = newDb()
    loadBinarySync(reloaded, snapshot)
    expectSameRankings(reloaded, reference)

    // Without frozen segments, this build still writes version 1, which 4.0.3 reads
    expect(saveBinarySync(reference)[4]).toBe(1)
  })
})
