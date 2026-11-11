export type WalOp = { op: 'insert'; id: string; doc: Record<string, unknown> } | { op: 'remove'; id: string }

export interface WalRecord {
  seq: number
  ops: WalOp[]
  /**
   * Indexes in `ops` of the ops that failed when they were applied live: the caller got an error for them, and the
   * replay skips them. Any other op that fails when replayed makes opening fail.
   */
  failed?: number[]
}

export const WAL_PREFIX = 'wal/'
export const STATE_KEY = 'state.json'
export const SHARDS_PREFIX = 'shards/'

// Fixed width keeps lexicographic and numeric order identical, as in edge-core's WAL entry names.
export function walKey(seq: number): string {
  return `${WAL_PREFIX}${String(seq).padStart(16, '0')}`
}

export function walSeqFromKey(key: string): number {
  return Number(key.slice(WAL_PREFIX.length))
}

export function shardKey(ordinal: number, generation: number): string {
  return `${SHARDS_PREFIX}${ordinal}/${generation}`
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// WAL records and the state are JSON, with the numbers JSON cannot represent, which documents can hold (core indexes
// and stores them as they are) and so the shard summaries, written as tagged objects: `{ "$wal": "-Infinity" }`.
// Object keys made of `$`s followed by `wal` get one more `$`, so that a tag is never confused with an object of a
// document.
const TAG = '$wal'
const ESCAPED_KEY = /^\$+wal$/
const ESCAPED_ENCODED = /^\$\$+wal$/

const taggedNumbers: Record<string, number> = { NaN, Infinity, '-Infinity': -Infinity, '-0': -0 }

function numberTag(value: number): string | undefined {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return 'Infinity'
  if (value === -Infinity) return '-Infinity'
  if (Object.is(value, -0)) return '-0'
  return undefined
}

// Copies `object` with the keys matching `pattern` renamed by `rename`, in the same order. Keys are defined, not
// assigned, so that an own `__proto__` stays an own property.
function renameKeys(
  object: Record<string, unknown>,
  pattern: RegExp,
  rename: (key: string) => string
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(object)) {
    const target = pattern.test(key) ? rename(key) : key
    Object.defineProperty(out, target, { value: object[key], writable: true, enumerable: true, configurable: true })
  }
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function taggedReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'number') {
    const tag = numberTag(value)
    return tag === undefined ? value : { [TAG]: tag }
  }
  if (isRecord(value) && Object.keys(value).some((key) => ESCAPED_KEY.test(key))) {
    return renameKeys(value, ESCAPED_KEY, (key) => `$${key}`)
  }
  return value
}

function taggedReviver(_key: string, value: unknown): unknown {
  if (!isRecord(value)) {
    return value
  }
  if (Object.hasOwn(value, TAG)) {
    const tag = value[TAG]
    if (typeof tag !== 'string' || !Object.hasOwn(taggedNumbers, tag) || Object.keys(value).length !== 1) {
      throw new Error(`[zbsearch-sharded] unknown value ${JSON.stringify(value)} in the write-ahead log`)
    }
    return taggedNumbers[tag]
  }
  return Object.keys(value).some((key) => ESCAPED_ENCODED.test(key))
    ? renameKeys(value, ESCAPED_ENCODED, (key) => key.slice(1))
    : value
}

/** Encodes `value` as JSON, keeping the numbers JSON cannot represent (NaN, ±Infinity and -0). */
export function encodeJSON(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value, taggedReplacer))
}

export function decodeJSON<T>(bytes: Uint8Array): T {
  return JSON.parse(decoder.decode(bytes), taggedReviver) as T
}
