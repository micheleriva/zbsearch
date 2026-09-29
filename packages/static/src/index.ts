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
  assertSameBuild,
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
  compactDictionary,
  decodeDictionary,
  encodeCompactDictionary,
  encodeDictionary,
  toCompactNode,
  type CompactNode,
  type DecodedDictionary
} from './dictionary.js'
export { buildIdFor } from './build-id.js'
export {
  DEFAULT_FRAGMENT_GROUP_SIZE,
  decodeFragment,
  encodeFragment,
  fragmentIndexFor,
  type FragmentDocs
} from './fragments.js'
export { ByteReader, ByteWriter } from './varint.js'
