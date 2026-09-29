/**
 * Hashes the artifacts of a build into a short, URL-safe id. SHA-256 through
 * Web Crypto keeps the builder free of Node-only modules, so it runs wherever
 * the client does. The first 8 bytes are plenty to tell builds apart.
 */
export async function buildIdFor(parts: Uint8Array[]): Promise<string> {
  let total = 0
  for (const part of parts) {
    total += part.length + 4
  }

  // Length-prefix every part so shifting bytes between artifacts changes the hash.
  const joined = new Uint8Array(total)
  const view = new DataView(joined.buffer)
  let offset = 0
  for (const part of parts) {
    view.setUint32(offset, part.length)
    offset += 4
    joined.set(part, offset)
    offset += part.length
  }

  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', joined))

  let hex = ''
  for (let i = 0; i < 8; i++) {
    hex += digest[i].toString(16).padStart(2, '0')
  }

  return hex
}
