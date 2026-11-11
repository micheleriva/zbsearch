import { load, save } from 'zbsearch'
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
  async *encode(db) {
    yield new TextEncoder().encode(JSON.stringify(save(db)))
  },
  async decode(db, source) {
    load(db, JSON.parse(new TextDecoder().decode(await collectBytes(source))))
  }
}

/**
 * The codec used when `openShardedDatabase` is not given one. Switching every
 * sharded database to the core binary snapshot format is a one-line change:
 *
 *   export const defaultShardCodec: ShardCodec = { encode: (db) => saveBinary(db), decode: loadBinary }
 *
 * with `saveBinary` and `loadBinary` imported from 'zbsearch'.
 */
export const defaultShardCodec: ShardCodec = jsonShardCodec
