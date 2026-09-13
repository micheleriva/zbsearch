export {
  buildStaticIndex,
  DEFAULT_TARGET_SHARD_BYTES,
  type BuildStaticIndexOptions,
  type StaticFileSet,
  type StaticIndexStats
} from './builder.js'
export {
  createStaticSearchClient,
  type StaticClientOptions,
  type StaticClientStats,
  type StaticSearchClient,
  type StaticSearchParams
} from './client.js'
export {
  MANIFEST_FILE,
  DICTIONARY_FILE,
  STATIC_FORMAT_VERSION,
  assertSupportedManifest,
  fragmentFile,
  shardFile,
  shardForTerm,
  type ShardRef,
  type StaticManifest
} from './manifest.js'
export { createShell, mergeDocuments, mergeTermPostings, type StaticShell } from './shell.js'
export { encodeShard, decodeShard, encodedTermSize, type TermPostings, type TermPostingEntry } from './shard.js'
export {
  buildDictionaryTree,
  decodeDictionary,
  encodeDictionary,
  toCompactNode,
  type CompactNode
} from './dictionary.js'
export {
  DEFAULT_FRAGMENT_GROUP_SIZE,
  decodeFragment,
  encodeFragment,
  fragmentIndexFor,
  type FragmentDocs
} from './fragments.js'
export { ByteReader, ByteWriter } from './varint.js'
