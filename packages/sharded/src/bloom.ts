export interface BloomFilterJSON {
  /** Number of hash functions. */
  k: number
  /** Number of keys added. */
  n: number
  /** Bit array, base64. */
  bits: string
}

function hash32(key: string, seed: number): number {
  // FNV-1a over UTF-16 code units with a murmur3 finalizer for avalanche.
  let h = (0x811c9dc5 ^ seed) >>> 0
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/**
 * A compact set membership test with false positives and no false negatives:
 * it tells which shards can hold a term without keeping their dictionaries
 * resident. Sized for a target number of keys; past it the false positive rate
 * grows, which costs extra shard loads but never wrong results.
 */
export class BloomFilter {
  private constructor(
    readonly bits: Uint8Array,
    readonly k: number,
    public n: number
  ) {}

  static create(capacity: number, bitsPerKey = 10): BloomFilter {
    const size = Math.max(8, Math.ceil((Math.max(capacity, 1) * bitsPerKey) / 8))
    const k = Math.min(16, Math.max(1, Math.round(bitsPerKey * Math.LN2)))
    return new BloomFilter(new Uint8Array(size), k, 0)
  }

  static fromJSON(json: BloomFilterJSON): BloomFilter {
    return new BloomFilter(decodeBase64(json.bits), json.k, json.n)
  }

  /** Keys the filter was sized for at `bitsPerKey`; adding more raises the false positive rate. */
  capacity(bitsPerKey = 10): number {
    return Math.floor((this.bits.length * 8) / bitsPerKey)
  }

  add(key: string): void {
    const m = this.bits.length * 8
    const h1 = hash32(key, 0)
    const h2 = hash32(key, 0x9e3779b9) | 1
    for (let i = 0; i < this.k; i++) {
      const bit = (h1 + Math.imul(i, h2)) >>> 0
      const index = bit % m
      this.bits[index >>> 3] |= 1 << (index & 7)
    }
    this.n++
  }

  has(key: string): boolean {
    const m = this.bits.length * 8
    const h1 = hash32(key, 0)
    const h2 = hash32(key, 0x9e3779b9) | 1
    for (let i = 0; i < this.k; i++) {
      const bit = (h1 + Math.imul(i, h2)) >>> 0
      const index = bit % m
      if ((this.bits[index >>> 3] & (1 << (index & 7))) === 0) {
        return false
      }
    }
    return true
  }

  toJSON(): BloomFilterJSON {
    return { k: this.k, n: this.n, bits: encodeBase64(this.bits) }
  }
}
