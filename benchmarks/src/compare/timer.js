/**
 * Lightweight micro-benchmark helpers for CI-friendly comparisons.
 * Prefer duration-based sampling for fast ops; fixed iterations for slow ones.
 */

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * @param {() => void} fn
 * @param {{ durationMs?: number, warmupMs?: number }} [options]
 */
export function benchOps(fn, options = {}) {
  const { durationMs = 800, warmupMs = 150 } = options

  const warmupEnd = performance.now() + warmupMs
  while (performance.now() < warmupEnd) {
    fn()
  }

  let iterations = 0
  const start = performance.now()
  const end = start + durationMs
  while (performance.now() < end) {
    fn()
    iterations++
  }
  const elapsedMs = performance.now() - start

  return {
    kind: 'ops',
    iterations,
    elapsedMs,
    opsPerSec: (iterations / elapsedMs) * 1000,
    msPerOp: elapsedMs / iterations
  }
}

/**
 * @param {() => void} fn
 * @param {{ iterations?: number, warmup?: number }} [options]
 */
export function benchTime(fn, options = {}) {
  const { iterations = 12, warmup = 2 } = options

  for (let i = 0; i < warmup; i++) {
    fn()
  }

  const samples = []
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    fn()
    samples.push(performance.now() - start)
  }

  const medianMs = median(samples)
  return {
    kind: 'time',
    iterations,
    samples,
    medianMs,
    meanMs: mean(samples),
    opsPerSec: 1000 / medianMs,
    msPerOp: medianMs
  }
}
