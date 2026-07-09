export const KEY_COUNT = 10_000

const MIN_KEY = 0
const MAX_KEY = 1_000_000

/** @returns {number[]} */
export function generateKeys(count = KEY_COUNT) {
  const keys = new Set()
  while (keys.size < count) {
    keys.add(MIN_KEY + Math.floor(Math.random() * (MAX_KEY - MIN_KEY)))
  }
  return Array.from(keys)
}

/** @param {number[]} keys */
export function getSearchBounds(keys) {
  const sorted = keys.slice().sort((a, b) => a - b)
  return {
    narrowMin: sorted[Math.floor(sorted.length * 0.45)],
    narrowMax: sorted[Math.floor(sorted.length * 0.55)],
    wideMin: sorted[Math.floor(sorted.length * 0.2)],
    wideMax: sorted[Math.floor(sorted.length * 0.8)],
    median: sorted[Math.floor(sorted.length / 2)]
  }
}

/** Deferred rebalance threshold used by insertMultiple */
export const BATCH_REBALANCE_THRESHOLD = 1_000
