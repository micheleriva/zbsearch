import { decode } from '@msgpack/msgpack'
import type { AnyZBSearch, SaveBinaryOptions } from 'zbsearch'
import { saveBinary } from 'zbsearch'

/**
 * Decodes the hex text that `persist(db, 'binary')` returned before it returned bytes, so old payloads still load.
 */
export function legacyHexToBytes(hex: string | Uint8Array): Uint8Array {
  if (typeof hex === 'string' && typeof Buffer !== 'undefined') {
    return Buffer.from(hex, 'hex')
  }

  const codes = typeof hex === 'string' ? undefined : hex
  const length = Math.floor((codes ? codes.length : (hex as string).length) / 2)
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    const high = hexValue(codes ? codes[i * 2] : (hex as string).charCodeAt(i * 2))
    const low = hexValue(codes ? codes[i * 2 + 1] : (hex as string).charCodeAt(i * 2 + 1))
    if (high < 0 || low < 0) {
      return bytes.subarray(0, i)
    }
    bytes[i] = (high << 4) | low
  }
  return bytes
}

function hexValue(code: number): number {
  if (code >= 48 && code <= 57) return code - 48
  if (code >= 97 && code <= 102) return code - 87
  if (code >= 65 && code <= 70) return code - 55
  return -1
}

function isHexDigit(code: number | undefined): boolean {
  return code !== undefined && hexValue(code) >= 0
}

export function toBytes(data: string | Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) {
    return data
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  return new TextEncoder().encode(data)
}

/**
 * Decodes a `'binary'` payload: raw msgpack bytes, or the hex text (as a string or as bytes) written by versions
 * that returned hex. A msgpack-encoded snapshot starts with a map header (0x80-0x8f, 0xde or 0xdf), never with an
 * ASCII hex digit, so the two cannot be confused.
 */
export function decodeMsgpackPayload(data: string | Uint8Array | ArrayBuffer | ArrayBufferView): unknown {
  if (typeof data === 'string') {
    return decode(legacyHexToBytes(data))
  }

  const bytes = toBytes(data)
  if (isHexDigit(bytes[0]) && isHexDigit(bytes[1])) {
    return decode(legacyHexToBytes(bytes))
  }
  return decode(bytes)
}

/** Collects a binary snapshot stream into one Uint8Array. */
export async function snapshotToBytes<T extends AnyZBSearch>(db: T, options?: SaveBinaryOptions): Promise<Uint8Array> {
  const segments: Uint8Array[] = []
  let length = 0
  for await (const segment of saveBinary(db, options)) {
    segments.push(segment)
    length += segment.length
  }

  const out = new Uint8Array(length)
  let offset = 0
  for (const segment of segments) {
    out.set(segment, offset)
    offset += segment.length
  }
  return out
}
