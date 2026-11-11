export { ShardedDatabase } from './database.js'
export type {
  ShardCreateOptions,
  ShardSizeInfo,
  ShardedDatabaseOptions,
  ShardedDatabaseStats,
  ShardedResults,
  ShardedSearchParams,
  ShardedSearchStats
} from './database.js'
export { collectBytes, defaultShardCodec, jsonShardCodec } from './codec.js'
export type { ShardBytesSource, ShardCodec } from './codec.js'
export { IndexedDBStorage, MemoryStorage } from './storage.js'
export type { IndexedDBStorageOptions, ShardStorage } from './storage.js'
export { BloomFilter } from './bloom.js'

import { ShardedDatabase, type ShardedDatabaseOptions } from './database.js'

/** Opens the sharded database kept in `options.storage` (creating it when the storage is empty) and replays its write-ahead log. */
export function openShardedDatabase(options: ShardedDatabaseOptions): Promise<ShardedDatabase> {
  return ShardedDatabase.open(options)
}
