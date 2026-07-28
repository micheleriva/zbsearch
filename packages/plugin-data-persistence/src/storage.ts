import { decode, encode } from '@msgpack/msgpack'
import type { AnyZBSearch } from 'zbsearch'
import { create, load, save } from 'zbsearch'
import * as dpack from './dpack.js'
import { STORAGE_KEY_NOT_FOUND, UNSUPPORTED_FORMAT } from './errors.js'
import { serializeZBSearchInstance, deserializeZBSearchInstance } from './seqproto.js'
import type { PersistenceFormat } from './types.js'

/**
 * Minimal, byte-oriented storage contract used by `persistToStorage` /
 * `restoreFromStorage`. It is intentionally structurally compatible with
 * `ObjectStorage` from `@zbsearch/edge-core`, so an `S3ObjectStorage` (or any
 * other edge-core storage backend) can be passed directly, with no adapter in
 * between. Browser backends such as the bundled IndexedDB adapter implement the
 * same shape.
 */
export interface PersistenceStorage {
  get(key: string, opts?: { ifNoneMatch?: string }): Promise<{ body: Uint8Array } | null>
  put(key: string, body: Uint8Array, opts?: { contentType?: string }): Promise<unknown>
}

export interface PersistToStorageOptions {
  format?: PersistenceFormat
  /** Passed through to `storage.put` (e.g. for S3/HTTP backends). */
  contentType?: string
}

export interface RestoreFromStorageOptions {
  format?: PersistenceFormat
}

function toUint8Array(data: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (data instanceof Uint8Array) {
    return data
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }
  return new TextEncoder().encode(data)
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Copy into a standalone ArrayBuffer so we never hand out a view into a
  // larger, pooled buffer (e.g. a Node Buffer backing store).
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

/**
 * Serialize a database into a compact byte payload. Unlike the string-returning
 * `persist`, the `binary` format here stays as raw msgpack bytes instead of hex,
 * so persisted payloads are ~half the size.
 */
async function serializeToBytes<T extends AnyZBSearch>(db: T, format: PersistenceFormat): Promise<Uint8Array> {
  switch (format) {
    case 'json':
      return new TextEncoder().encode(JSON.stringify(await save(db)))
    case 'dpack':
      return toUint8Array(dpack.serialize(await save(db)) as string | Uint8Array | ArrayBuffer)
    case 'binary':
      return encode(await save(db))
    case 'seqproto':
      return toUint8Array(serializeZBSearchInstance(db) as unknown as ArrayBuffer)
    default:
      throw new Error(UNSUPPORTED_FORMAT(format))
  }
}

function deserializeFromBytes(format: PersistenceFormat, bytes: Uint8Array): any {
  switch (format) {
    case 'json':
      return JSON.parse(new TextDecoder().decode(bytes))
    case 'dpack':
      return dpack.parse(typeof Buffer !== 'undefined' ? Buffer.from(bytes) : (bytes as any))
    case 'binary':
      return decode(bytes)
    case 'seqproto':
      return deserializeZBSearchInstance(toArrayBuffer(bytes))
    default:
      throw new Error(UNSUPPORTED_FORMAT(format))
  }
}

/**
 * Persist a database snapshot into any {@link PersistenceStorage} backend
 * (IndexedDB, S3/R2, or a custom KV store) under `key`.
 *
 * The whole index is serialized and written as one compact byte payload; the
 * in-memory database is untouched and remains fully queryable. Use
 * {@link restoreFromStorage} to rebuild it later.
 */
export async function persistToStorage<T extends AnyZBSearch>(
  db: T,
  storage: PersistenceStorage,
  key: string,
  options: PersistToStorageOptions = {}
): Promise<void> {
  const format = options.format ?? 'binary'
  const bytes = await serializeToBytes(db, format)
  await storage.put(key, bytes, options.contentType ? { contentType: options.contentType } : undefined)
}

/**
 * Rebuild a database from a snapshot previously written with
 * {@link persistToStorage}. The `format` must match the one used to persist.
 * Throws if `key` does not exist in the backend.
 */
export async function restoreFromStorage<T extends AnyZBSearch>(
  storage: PersistenceStorage,
  key: string,
  options: RestoreFromStorageOptions = {}
): Promise<T> {
  const format = options.format ?? 'binary'
  const result = await storage.get(key)

  if (!result) {
    throw new Error(STORAGE_KEY_NOT_FOUND(key))
  }

  const deserialized = deserializeFromBytes(format, toUint8Array(result.body))

  const db = create({
    schema: {
      __placeholder: 'string'
    }
  })
  load(db, deserialized)

  return db as unknown as T
}
