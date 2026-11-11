export type WalOp = { op: 'insert'; id: string; doc: Record<string, unknown> } | { op: 'remove'; id: string }

export interface WalRecord {
  seq: number
  ops: WalOp[]
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

export function encodeJSON(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

export function decodeJSON<T>(bytes: Uint8Array): T {
  return JSON.parse(decoder.decode(bytes)) as T
}
