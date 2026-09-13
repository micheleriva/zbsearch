import { create, insertMultiple, save } from 'zbsearch'
import type { RawData } from 'zbsearch'
import { DEFAULT_FRAGMENT_GROUP_SIZE, encodeFragment, fragmentIndexFor, type FragmentDocs } from './fragments.js'
import { encodeDictionary, type DictionaryNodeJSON } from './dictionary.js'
import {
  DICTIONARY_FILE,
  MANIFEST_FILE,
  STATIC_FORMAT_VERSION,
  fragmentFile,
  shardFile,
  type ShardRef,
  type StaticManifest
} from './manifest.js'
import { decodeRawPostings, rawParts, type SerializedPostings } from './raw.js'
import { encodeShard, encodedTermSize, type TermPostings } from './shard.js'
import { encodeJSON } from './varint.js'

export const DEFAULT_TARGET_SHARD_BYTES = 40 * 1024

export interface BuildStaticIndexOptions {
  records: Array<Record<string, unknown>>
  schema: Record<string, 'string'>
  language?: string
  /** Pre-compression byte budget per postings shard. A single oversized term may exceed it. */
  targetShardBytes?: number
  fragmentGroupSize?: number
}

export interface StaticIndexStats {
  termCount: number
  shardCount: number
  fragmentCount: number
  dictionaryBytes: number
  postingsBytes: number
  fragmentsBytes: number
  totalBytes: number
}

export interface StaticFileSet {
  manifest: StaticManifest
  /** Every artifact to deploy, keyed by relative path. Includes manifest.json itself. */
  files: Map<string, Uint8Array>
  stats: StaticIndexStats
}

function assertStringSchema(schema: Record<string, string>): void {
  for (const [prop, type] of Object.entries(schema)) {
    if (type !== 'string') {
      throw new Error(
        `[zbsearch-static] property "${prop}" has type "${type}" — the static index format currently supports "string" properties only`
      )
    }
  }
}

function isSequential(ids: string[]): boolean {
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== String(i + 1)) {
      return false
    }
  }
  return true
}

export async function buildStaticIndex(options: BuildStaticIndexOptions): Promise<StaticFileSet> {
  const { records, schema } = options
  const language = options.language ?? 'english'
  const targetShardBytes = options.targetShardBytes ?? DEFAULT_TARGET_SHARD_BYTES
  const fragmentGroupSize = options.fragmentGroupSize ?? DEFAULT_FRAGMENT_GROUP_SIZE

  assertStringSchema(schema)

  for (const [name, value] of [
    ['targetShardBytes', targetShardBytes],
    ['fragmentGroupSize', fragmentGroupSize]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`[zbsearch-static] ${name} must be a positive integer, got "${value}"`)
    }
  }

  const db = create({ schema, language, inferSchema: false, sort: { enabled: false } })

  if (records.length > 0) {
    // Sequential IDs let the client rebuild the ID store from docsCount alone.
    // Records that carry their own `id` keep it; the mapping then ships in the manifest.
    const docs = records.map((record, i) => ('id' in record ? record : { id: String(i + 1), ...record }))
    await insertMultiple(db, docs)
  }

  const raw = save(db) as RawData
  const { index: rawIndex, docs: rawDocs, internalIdToId } = rawParts(raw)

  const props = Object.keys(rawIndex.indexes)

  // Union term space across properties, sorted so shard ranges are contiguous.
  const termSet = new Set<string>()
  const postingsByProp: Record<string, SerializedPostings> = {}
  for (const prop of props) {
    const serialized = (rawIndex.indexes[prop].node.postings ?? {}) as SerializedPostings
    postingsByProp[prop] = serialized
    for (const term of Object.keys(serialized)) {
      termSet.add(term)
    }
  }
  const terms = Array.from(termSet).sort()

  const files = new Map<string, Uint8Array>()
  const shards: ShardRef[] = []

  let currentTerms: TermPostings[] = []
  let currentBytes = 0
  let postingsBytes = 0

  const flush = (): void => {
    if (currentTerms.length === 0) {
      return
    }

    const bytes = encodeShard(currentTerms)
    const file = shardFile(shards.length)
    files.set(file, bytes)
    shards.push({
      file,
      bytes: bytes.length,
      firstTerm: currentTerms[0].term,
      lastTerm: currentTerms[currentTerms.length - 1].term,
      terms: currentTerms.length
    })
    postingsBytes += bytes.length
    currentTerms = []
    currentBytes = 0
  }

  for (const term of terms) {
    const byProp: TermPostings['byProp'] = []

    for (let propIdx = 0; propIdx < props.length; propIdx++) {
      const prop = props[propIdx]
      const encoded = postingsByProp[prop][term]
      if (!encoded) {
        continue
      }

      const docIds = decodeRawPostings(encoded)
      const entries = docIds.map((docId) => {
        const tf = rawIndex.frequencies[prop][docId]?.[term]
        const fieldLen = rawIndex.fieldLengths[prop][docId]

        if (tf === undefined || !Number.isInteger(tf) || fieldLen === undefined) {
          throw new Error(
            `[zbsearch-static] inconsistent index state for term "${term}" on "${prop}" (doc ${docId}): tf=${tf}, fieldLen=${fieldLen}`
          )
        }

        return { docId, tf, fieldLen }
      })

      byProp.push({ prop: propIdx, entries })
    }

    const termPostings: TermPostings = { term, byProp }
    const size = encodedTermSize(termPostings)

    if (currentBytes > 0 && currentBytes + size > targetShardBytes) {
      flush()
    }

    currentTerms.push(termPostings)
    currentBytes += size
  }
  flush()

  // Fragment groups: contiguous internal-ID ranges of stored documents.
  const fragmentGroups = new Map<number, FragmentDocs>()
  for (const [internalIdKey, doc] of Object.entries(rawDocs)) {
    const internalId = Number(internalIdKey)
    const group = fragmentIndexFor(internalId, fragmentGroupSize)
    let docs = fragmentGroups.get(group)
    if (!docs) {
      docs = {}
      fragmentGroups.set(group, docs)
    }
    docs[internalId] = doc
  }

  let fragmentsBytes = 0
  const fragmentCount = records.length === 0 ? 0 : fragmentIndexFor(records.length, fragmentGroupSize) + 1
  for (const [group, docs] of fragmentGroups) {
    const bytes = encodeFragment(docs)
    files.set(fragmentFile(group), bytes)
    fragmentsBytes += bytes.length
  }

  const dictionaryNodes: Record<string, DictionaryNodeJSON> = {}
  for (const prop of props) {
    dictionaryNodes[prop] = rawIndex.indexes[prop].node
  }
  const dictionaryBytes = encodeDictionary(dictionaryNodes)
  files.set(DICTIONARY_FILE, dictionaryBytes)

  const sequentialIds = isSequential(internalIdToId)

  const manifest: StaticManifest = {
    version: STATIC_FORMAT_VERSION,
    language,
    docsCount: records.length,
    props,
    schema,
    avgFieldLength: { ...rawIndex.avgFieldLength },
    dictionary: { file: DICTIONARY_FILE, bytes: dictionaryBytes.length },
    shards,
    fragments: { groupSize: fragmentGroupSize, count: fragmentCount },
    sequentialIds,
    ...(sequentialIds ? {} : { internalIdToId })
  }

  const manifestBytes = encodeJSON(manifest)
  files.set(MANIFEST_FILE, manifestBytes)

  let totalBytes = 0
  for (const bytes of files.values()) {
    totalBytes += bytes.length
  }

  return {
    manifest,
    files,
    stats: {
      termCount: terms.length,
      shardCount: shards.length,
      fragmentCount,
      dictionaryBytes: dictionaryBytes.length,
      postingsBytes,
      fragmentsBytes,
      totalBytes
    }
  }
}
