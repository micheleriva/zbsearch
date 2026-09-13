import { create } from 'zbsearch'
import type { AnyZBSearch } from 'zbsearch'
import { radix } from 'zbsearch/trees'
import { decodeDictionary } from './dictionary.js'
import type { FragmentDocs } from './fragments.js'
import type { StaticManifest } from './manifest.js'
import type { TermPostings } from './shard.js'

type RadixTree = InstanceType<typeof radix.RadixTree>

interface ShellIndexData {
  indexes: Record<string, { type: string; node: RadixTree; isArray: boolean }>
  frequencies: Record<string, Record<number, Record<string, number> | undefined>>
  avgFieldLength: Record<string, number>
  fieldLengths: Record<string, Record<number, number | undefined>>
}

interface ShellDocsData {
  docs: Record<number, unknown>
  count: number
}

/**
 * A real ZBSearch database whose index structures start empty and are filled
 * shard by shard. Core `search()` runs against it unmodified, which is what
 * guarantees sharded results match the monolithic index exactly.
 */
export interface StaticShell {
  db: AnyZBSearch
  manifest: StaticManifest
  tries: Record<string, RadixTree>
  /** Terms whose postings are already merged; merges are idempotent per term. */
  mergedTerms: Set<string>
  /** Internal IDs whose documents are already resident. */
  presentDocs: Set<number>
}

export function createShell(manifest: StaticManifest, dictionaryBytes: Uint8Array): StaticShell {
  const db = create({
    schema: manifest.schema,
    language: manifest.language,
    inferSchema: false,
    sort: { enabled: false }
  }) as AnyZBSearch

  const index = db.data.index as unknown as ShellIndexData
  const tries = decodeDictionary(dictionaryBytes)

  for (const prop of manifest.props) {
    const tree = tries[prop]
    if (!tree) {
      throw new Error(`[zbsearch-static] the dictionary is missing property "${prop}" declared in the manifest`)
    }

    index.indexes[prop] = { type: 'Radix', node: tree, isArray: false }
    index.avgFieldLength[prop] = manifest.avgFieldLength[prop]
    index.frequencies[prop] = {}
    index.fieldLengths[prop] = {}
  }

  const internalIdToId = manifest.sequentialIds
    ? Array.from({ length: manifest.docsCount }, (_, i) => String(i + 1))
    : manifest.internalIdToId

  if (!internalIdToId || internalIdToId.length !== manifest.docsCount) {
    throw new Error('[zbsearch-static] the manifest carries no usable document ID mapping')
  }

  db.internalDocumentIDStore.load(db, { internalIdToId })
  ;(db.data.docs as unknown as ShellDocsData).count = manifest.docsCount

  return { db, manifest, tries, mergedTerms: new Set(), presentDocs: new Set() }
}

export function mergeTermPostings(shell: StaticShell, terms: TermPostings[]): void {
  const index = shell.db.data.index as unknown as ShellIndexData

  for (const { term, byProp } of terms) {
    if (shell.mergedTerms.has(term)) {
      continue
    }
    shell.mergedTerms.add(term)

    for (const { prop: propIdx, entries } of byProp) {
      const prop = shell.manifest.props[propIdx]
      const tree = shell.tries[prop]
      if (!tree) {
        continue
      }

      const ids = entries.map((entry) => entry.docId)
      tree.postings.set(term, ids)

      const frequencies = index.frequencies[prop]
      const fieldLengths = index.fieldLengths[prop]
      for (const { docId, tf, fieldLen } of entries) {
        ;(frequencies[docId] ??= {})[term] = tf
        fieldLengths[docId] = fieldLen
      }
    }
  }
}

export function mergeDocuments(shell: StaticShell, docs: FragmentDocs): void {
  const store = shell.db.data.docs as unknown as ShellDocsData

  for (const [internalIdKey, doc] of Object.entries(docs)) {
    const internalId = Number(internalIdKey)
    if (shell.presentDocs.has(internalId)) {
      continue
    }

    store.docs[internalId] = doc
    shell.presentDocs.add(internalId)
  }
}
