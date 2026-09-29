/**
 * Hashes the artifacts of a build into a short, URL-safe id. SHA-256 through
 * Web Crypto keeps the builder free of Node-only modules, so it runs wherever
 * the client does. The first 8 bytes are plenty to tell builds apart.
 *
 * Every part is digested on its own and the digests are hashed together, so
 * a build never holds a second copy of its dictionary, shards and fragments
 * just to compute the id: the only extra allocation is 32 bytes per part.
 */
export async function buildIdFor(parts: Uint8Array[]): Promise<string> {
  const { subtle } = globalThis.crypto
  const digests = new Uint8Array(parts.length * 32)

  for (let i = 0; i < parts.length; i++) {
    digests.set(new Uint8Array(await subtle.digest('SHA-256', parts[i] as Uint8Array<ArrayBuffer>)), i * 32)
  }

  const digest = new Uint8Array(await subtle.digest('SHA-256', digests))

  let hex = ''
  for (let i = 0; i < 8; i++) {
    hex += digest[i].toString(16).padStart(2, '0')
  }

  return hex
}
