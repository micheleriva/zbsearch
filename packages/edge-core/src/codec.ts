const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

export function decodeJson<T>(bytes: Uint8Array): T {
  return JSON.parse(decoder.decode(bytes)) as T
}

export function encodeNdjsonLine(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value)}\n`)
}

export function parseNdjson(content: string): unknown[] {
  const lines = content.split('\n').filter((line) => line.trim().length > 0)
  return lines.map((line) => JSON.parse(line) as unknown)
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
