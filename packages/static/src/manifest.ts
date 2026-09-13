export const STATIC_FORMAT_VERSION = 1

export const MANIFEST_FILE = 'manifest.json'
export const DICTIONARY_FILE = 'dictionary.json'

export function shardFile(index: number): string {
  return `postings/${index}.bin`
}

export function fragmentFile(index: number): string {
  return `fragments/${index}.json`
}

export interface ShardRef {
  file: string
  bytes: number
  /** First term covered by this shard (inclusive). */
  firstTerm: string
  /** Last term covered by this shard (inclusive). */
  lastTerm: string
  terms: number
}

export interface StaticManifest {
  version: number
  language: string
  docsCount: number
  /** Ordered searchable string properties; shard entries reference them by position. */
  props: string[]
  schema: Record<string, 'string'>
  avgFieldLength: Record<string, number>
  dictionary: { file: string; bytes: number }
  shards: ShardRef[]
  fragments: { groupSize: number; count: number }
  /**
   * True when document IDs are the sequential strings "1".."N", which lets the
   * client regenerate the ID store from docsCount alone. Otherwise the full
   * mapping is embedded.
   */
  sequentialIds: boolean
  internalIdToId?: string[]
}

export function assertSupportedManifest(manifest: StaticManifest): StaticManifest {
  if (manifest.version !== STATIC_FORMAT_VERSION) {
    throw new Error(
      `[zbsearch-static] index format version ${manifest.version} is not supported by this client (expected ${STATIC_FORMAT_VERSION}). Rebuild the index and redeploy both halves together.`
    )
  }

  return manifest
}

/** Locates the shard whose [firstTerm, lastTerm] range covers `term`, if any. */
export function shardForTerm(shards: ShardRef[], term: string): ShardRef | undefined {
  let low = 0
  let high = shards.length - 1

  while (low <= high) {
    const mid = (low + high) >> 1
    const shard = shards[mid]

    if (term < shard.firstTerm) {
      high = mid - 1
    } else if (term > shard.lastTerm) {
      low = mid + 1
    } else {
      return shard
    }
  }

  return undefined
}
