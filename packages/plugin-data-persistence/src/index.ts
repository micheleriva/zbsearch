import { encode } from '@msgpack/msgpack'
import type { AnyZBSearch } from 'zbsearch'
import { create, isBinarySnapshot, load, loadBinary, save } from 'zbsearch'
import type { PersistenceFormat, Runtime } from './types.js'
import * as dpack from './dpack.js'
import { METHOD_MOVED, UNSUPPORTED_FORMAT } from './errors.js'
import { decodeMsgpackPayload, snapshotToBytes, toBytes } from './payload.js'
import { serializeZBSearchInstance, deserializeZBSearchInstance } from './seqproto.js'

export { persistToStorage, restoreFromStorage } from './storage.js'
export { snapshotToBytes } from './payload.js'
export type { PersistenceStorage, PersistToStorageOptions, RestoreFromStorageOptions } from './storage.js'

function createPlaceholderDB(): AnyZBSearch {
  return create({
    schema: {
      __placeholder: 'string'
    }
  }) as unknown as AnyZBSearch
}

/**
 * Serializes a database in memory.
 *
 * - `'snapshot'`: the core binary snapshot format (`saveBinary` from `zbsearch`), as one `Uint8Array`. The most
 *   compact and fastest format, and the only one that stays within memory limits on large indexes. To stream it
 *   instead of holding it whole, use `saveBinary` directly or `persistToFile` from `/server`.
 * - `'binary'`: msgpack bytes (a `Uint8Array`; previous versions returned them as a hex string).
 * - `'json'`: a JSON string. `'dpack'`: a dpack string. `'seqproto'`: an `ArrayBuffer`.
 */
export async function persist<T extends AnyZBSearch>(
  db: T,
  format: PersistenceFormat = 'binary',
  _runtime?: Runtime
): Promise<string | Uint8Array | ArrayBuffer> {
  switch (format) {
    case 'json':
      return JSON.stringify(await save(db))
    case 'dpack':
      return dpack.serialize(await save(db))
    case 'binary':
      return encode(await save(db))
    case 'seqproto':
      return serializeZBSearchInstance(db)
    case 'snapshot':
      return snapshotToBytes(db)
    default:
      throw new Error(UNSUPPORTED_FORMAT(format))
  }
}

/**
 * Restores a database serialized by {@link persist}. `'binary'` also accepts the hex strings returned by previous
 * versions and binary snapshots.
 */
export async function restore<T extends AnyZBSearch>(
  format: PersistenceFormat,
  data: string | Uint8Array | ArrayBuffer,
  _runtime?: Runtime
): Promise<T> {
  const db = createPlaceholderDB()
  let deserialized: any

  switch (format) {
    case 'json':
      deserialized = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(toBytes(data)))
      break
    case 'dpack':
      deserialized = dpack.parse(data)
      break
    case 'binary': {
      if (typeof data !== 'string' && isBinarySnapshot(toBytes(data))) {
        await loadBinary(db, toBytes(data))
        return db as unknown as T
      }
      deserialized = decodeMsgpackPayload(data)
      break
    }
    case 'snapshot':
      await loadBinary(db, toBytes(data as Uint8Array | ArrayBuffer))
      return db as unknown as T
    case 'seqproto':
      deserialized = deserializeZBSearchInstance(data)
      break
    default:
      throw new Error(UNSUPPORTED_FORMAT(format))
  }

  load(db, deserialized)

  return db as unknown as T
}

export async function persistToFile<T extends AnyZBSearch>(
  _db: T,
  _format: PersistenceFormat = 'json',
  _path?: string,
  _runtime?: Runtime
): Promise<never> {
  throw new Error(METHOD_MOVED('persistToFile'))
}

export async function restoreFromFile<_T extends AnyZBSearch>(
  _format: PersistenceFormat = 'json',
  _path?: string,
  _runtime?: Runtime
): Promise<never> {
  throw new Error(METHOD_MOVED('restoreFromFile'))
}
