import { describe, expect, it } from 'vitest'
import { buildStaticIndex } from '../src/builder.js'
import { decodeShard } from '../src/shard.js'
import { decodeFragment } from '../src/fragments.js'
import { decodeJSON } from '../src/varint.js'
import { MANIFEST_FILE, type StaticManifest } from '../src/manifest.js'
import { CORPUS_SCHEMA, makeCorpus } from './corpus.js'

describe('buildStaticIndex', () => {
  it('produces a coherent file set', async () => {
    const records = makeCorpus(2)
    const { manifest, files, stats } = await buildStaticIndex({
      records: records as unknown as Array<Record<string, unknown>>,
      schema: CORPUS_SCHEMA,
      targetShardBytes: 2048
    })

    expect(manifest.version).toBe(1)
    expect(manifest.docsCount).toBe(records.length)
    expect(manifest.props).toEqual(['title', 'section', 'content'])
    expect(manifest.sequentialIds).toBe(true)
    expect(manifest.internalIdToId).toBeUndefined()

    // The manifest file matches the returned manifest.
    expect(decodeJSON<StaticManifest>(files.get(MANIFEST_FILE)!)).toEqual(manifest)

    // Every term lives in exactly one shard, ranges are sorted and disjoint.
    const seen = new Set<string>()
    let previousLast = ''
    for (const shard of manifest.shards) {
      expect(shard.firstTerm > previousLast || previousLast === '').toBe(true)
      const terms = decodeShard(files.get(shard.file)!)
      expect(terms.length).toBe(shard.terms)
      expect(terms[0].term).toBe(shard.firstTerm)
      expect(terms[terms.length - 1].term).toBe(shard.lastTerm)
      for (const { term, byProp } of terms) {
        expect(seen.has(term)).toBe(false)
        seen.add(term)
        expect(byProp.length).toBeGreaterThan(0)
        for (const { entries } of byProp) {
          let previousDocId = 0
          for (const entry of entries) {
            expect(entry.docId).toBeGreaterThan(previousDocId)
            expect(Number.isInteger(entry.tf) && entry.tf >= 1).toBe(true)
            expect(Number.isInteger(entry.fieldLen) && entry.fieldLen >= 1).toBe(true)
            previousDocId = entry.docId
          }
        }
      }
      previousLast = shard.lastTerm
    }
    expect(seen.size).toBe(stats.termCount)

    // Shards respect the byte budget (a lone oversized term is the only exception).
    for (const shard of manifest.shards) {
      if (shard.terms > 1) {
        expect(shard.bytes).toBeLessThanOrEqual(2048 + 64)
      }
    }

    // Fragments cover every document exactly once.
    const coveredIds = new Set<number>()
    for (let group = 0; group < manifest.fragments.count; group++) {
      const docs = decodeFragment(files.get(`fragments/${group}.json`)!)
      for (const id of Object.keys(docs)) {
        coveredIds.add(Number(id))
      }
    }
    expect(coveredIds.size).toBe(records.length)
    for (let id = 1; id <= records.length; id++) {
      expect(coveredIds.has(id)).toBe(true)
    }
  })

  it('handles an empty record set', async () => {
    const { manifest, stats } = await buildStaticIndex({ records: [], schema: CORPUS_SCHEMA })
    expect(manifest.docsCount).toBe(0)
    expect(manifest.shards).toEqual([])
    expect(stats.termCount).toBe(0)
    expect(manifest.fragments.count).toBe(0)
  })

  it('preserves caller-provided document IDs via the manifest mapping', async () => {
    const records = [
      { id: 'doc-a', title: 'alpha', section: 's', content: 'alpha content' },
      { id: 'doc-b', title: 'beta', section: 's', content: 'beta content' }
    ]
    const { manifest } = await buildStaticIndex({ records, schema: CORPUS_SCHEMA })
    expect(manifest.sequentialIds).toBe(false)
    expect(manifest.internalIdToId).toEqual(['doc-a', 'doc-b'])
  })

  it('rejects non-string schemas', async () => {
    await expect(
      buildStaticIndex({ records: [], schema: { n: 'number' } as unknown as Record<string, 'string'> })
    ).rejects.toThrow(/string/)
  })
})
