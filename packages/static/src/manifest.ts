export const STATIC_FORMAT_VERSION = 1

export const MANIFEST_FILE = 'manifest.json'
export const DICTIONARY_FILE = 'dictionary.json'

/**
 * Shards and fragments live under a directory named after the build they
 * belong to, so a manifest can never be paired with files from another build:
 * a stale cache yields a missing file, never a silently different index.
 */
export function shardFile(index: number, buildId: string): string {
  return `postings/${buildId}/${index}.bin`
}

export function fragmentFile(index: number, buildId: string): string {
  return `fragments/${buildId}/${index}.json`
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
  /**
   * Content hash of the build. Every other artifact either carries it (the
   * dictionary) or is addressed by it (shards, fragments), so the client can
   * tell when a redeploy or a cache served pieces of different builds.
   */
  buildId: string
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

  if (typeof manifest.buildId !== 'string' || manifest.buildId.length === 0) {
    throw new Error('[zbsearch-static] the manifest carries no build id. Rebuild the index and redeploy it.')
  }

  return manifest
}

export function assertSameBuild(manifest: StaticManifest, dictionaryBuildId: string): void {
  if (dictionaryBuildId !== manifest.buildId) {
    throw new Error(
      `[zbsearch-static] the dictionary comes from build ${dictionaryBuildId} but the manifest from build ${manifest.buildId}. ` +
        'The index files were served from different deploys: redeploy every file together and clear stale caches.'
    )
  }
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
