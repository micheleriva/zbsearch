import { describe, expect, it } from 'vitest'
import { buildStaticIndex, type StaticFileSet } from '../src/builder.js'
import { createStaticSearchClient } from '../src/client.js'
import { DICTIONARY_FILE, MANIFEST_FILE } from '../src/manifest.js'
import { CORPUS_SCHEMA, makeCorpus } from './corpus.js'

function serve(...fileSets: StaticFileSet[]) {
  return async (path: string): Promise<Uint8Array> => {
    for (const fileSet of fileSets) {
      const bytes = fileSet.files.get(path)
      if (bytes) {
        return bytes
      }
    }
    throw new Error(`missing file: ${path}`)
  }
}

describe('build id', () => {
  it('rejects a dictionary served from a different build than the manifest', async () => {
    const current = await buildStaticIndex({
      records: makeCorpus(1) as unknown as Array<Record<string, unknown>>,
      schema: CORPUS_SCHEMA
    })
    const stale = await buildStaticIndex({
      records: [{ title: 'old', section: 'old', content: 'an older deploy' }],
      schema: CORPUS_SCHEMA
    })
    expect(stale.manifest.buildId).not.toBe(current.manifest.buildId)

    const mixed = new Map(current.files)
    mixed.set(DICTIONARY_FILE, stale.files.get(DICTIONARY_FILE)!)

    const client = createStaticSearchClient({ fetchBytes: serve({ ...current, files: mixed }) })
    await expect(client.search({ term: 'search' })).rejects.toThrow(/different deploys/)
  })

  it('never reads shards or fragments of another build', async () => {
    const current = await buildStaticIndex({
      records: makeCorpus(1) as unknown as Array<Record<string, unknown>>,
      schema: CORPUS_SCHEMA,
      targetShardBytes: 512
    })
    const stale = await buildStaticIndex({
      records: makeCorpus(2) as unknown as Array<Record<string, unknown>>,
      schema: CORPUS_SCHEMA,
      targetShardBytes: 512
    })

    // A stale manifest and dictionary next to the current build's shards and
    // fragments: the client asks for the stale build's files and gets a clear
    // miss instead of silently scoring against the wrong postings.
    const mixed = new Map(current.files)
    mixed.set(MANIFEST_FILE, stale.files.get(MANIFEST_FILE)!)
    mixed.set(DICTIONARY_FILE, stale.files.get(DICTIONARY_FILE)!)

    const client = createStaticSearchClient({ fetchBytes: serve({ ...stale, files: mixed }) })
    await expect(client.search({ term: 'search' })).rejects.toThrow(/missing file: postings\//)
  })
})
