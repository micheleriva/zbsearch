// Deterministic synthetic embeddings for quantization tests: clustered, anisotropic and with a shared mean
// direction, which are the properties of sentence-embedding models that matter for quantization.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12)
  const v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export interface SyntheticSet {
  vectors: number[][]
  queries: number[][]
}

export function clusteredVectors(options: {
  count: number
  queries: number
  dim: number
  clusters: number
  seed?: number
  spread?: number
}): SyntheticSet {
  const random = mulberry32(options.seed ?? 42)
  const { dim, clusters } = options
  const spread = options.spread ?? 0.6

  const mean = Array.from({ length: dim }, () => gaussian(random) * 0.5)
  const scales = Array.from({ length: dim }, (_, d) => 1 / Math.sqrt(1 + d / 8))
  const centers = Array.from({ length: clusters }, () =>
    Array.from({ length: dim }, (_, d) => mean[d]! + gaussian(random) * scales[d]!)
  )

  const sample = () => {
    const center = centers[Math.floor(random() * clusters)]!
    return center.map((value, d) => value + gaussian(random) * spread * scales[d]!)
  }

  return {
    vectors: Array.from({ length: options.count }, sample),
    queries: Array.from({ length: options.queries }, sample)
  }
}

export function recallAtK(expected: string[][], actual: string[][], k: number): number {
  let hits = 0
  let total = 0
  for (let i = 0; i < expected.length; i++) {
    const truth = new Set(expected[i]!.slice(0, k))
    for (const id of actual[i]!.slice(0, k)) {
      if (truth.has(id)) hits++
    }
    total += truth.size
  }
  return total === 0 ? 1 : hits / total
}
