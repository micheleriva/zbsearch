import { load, loadBinary, save, saveBinary } from 'zbsearch'
import type { AnyZBSearch } from 'zbsearch'

export type ShardBytesSource = AsyncIterable<Uint8Array> | Iterable<Uint8Array> | Uint8Array

/**
 * Turns one shard (a complete ZBSearch database) into bytes and back. The
 * signatures match the streaming snapshot API of the core package, so a codec
 * is a two-line adapter over whatever snapshot format the core ships.
 */
export interface ShardCodec {
  encode(db: AnyZBSearch): AsyncIterable<Uint8Array>
  decode(db: AnyZBSearch, source: ShardBytesSource): Promise<void>
  /**
   * Heap bytes of a loaded shard per snapshot byte, vectors aside: the memory
   * budget's default size estimate. Over-estimating only evicts earlier.
   */
  residentFactor?: number
  /** Snapshot bytes per float32 vector component. */
  vectorComponentBytes?: number
}

export async function collectBytes(source: ShardBytesSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) {
    return source
  }

  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of source as AsyncIterable<Uint8Array>) {
    chunks.push(chunk)
    total += chunk.byteLength
  }

  if (chunks.length === 1) {
    return chunks[0]
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Core `save()`/`load()` serialized as UTF-8 JSON: works with every core version, but is large and slow to parse. */
export const jsonShardCodec: ShardCodec = {
  // Measured 1.0-2.3 heap bytes per JSON byte (V8, passages of 150-250 words).
  residentFactor: 2.5,
  // Shortest round-trip decimal of a float32 component, comma included.
  vectorComponentBytes: 10,
  async *encode(db) {
    yield new TextEncoder().encode(JSON.stringify(save(db)))
  },
  async decode(db, source) {
    load(db, JSON.parse(new TextDecoder().decode(await collectBytes(source))))
  }
}

/** Core's binary snapshot format (`saveBinary` / `loadBinary`): compact, streamed and checksummed. */
export const binaryShardCodec: ShardCodec = {
  // Measured 7.6 heap bytes per non-vector snapshot byte (V8, passages of 150-250 words).
  residentFactor: 8,
  vectorComponentBytes: 4,
  encode: (db) => saveBinary(db),
  decode: (db, source) => loadBinary(db, source)
}

/** The codec used when `openShardedDatabase` is not given one. */
export const defaultShardCodec: ShardCodec = binaryShardCodec
