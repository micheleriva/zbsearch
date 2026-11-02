export type BoundedMetric = {
  isBounded: boolean
  distance: number
}

/**
 * Inspired by:
 * https://github.com/Yomguithereal/talisman/blob/86ae55cbd040ff021d05e282e0e6c71f2dde21f8/src/metrics/levenshtein.js#L218-L340
 */
function _boundedLevenshtein(term: string, word: string, tolerance: number): number {
  // Handle base cases
  if (tolerance < 0) return -1
  if (term === word) return 0

  const m = term.length
  const n = word.length

  // Special case for empty strings
  if (m === 0) return n <= tolerance ? n : -1
  if (n === 0) return m <= tolerance ? m : -1

  // term = term.toLowerCase()
  // word = word.toLowerCase()

  const diff = Math.abs(m - n)
  // Special case for prefixes
  // If the searching word starts with the indexed word, return early.
  if (term.startsWith(word)) {
    // We just check if the remaining characters are within the tolerance
    return diff <= tolerance ? diff : -1
  }
  // If the indexed word starts with the searching word, return early.
  if (word.startsWith(term)) {
    // any prefixed word is within the tolerance
    return 0
  }

  // If the length difference is greater than the tolerance, return early
  if (diff > tolerance) return -1

  // Two rolling rows of the matrix are enough
  let previousRow = new Array<number>(n + 1)
  let currentRow = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) {
    previousRow[j] = j
  }

  // Fill the matrix
  for (let i = 1; i <= m; i++) {
    const termChar = term.charCodeAt(i - 1)
    let rowMin = Infinity
    currentRow[0] = i
    for (let j = 1; j <= n; j++) {
      let value: number
      if (termChar === word.charCodeAt(j - 1)) {
        value = previousRow[j - 1]
      } else {
        value = Math.min(
          previousRow[j] + 1, // deletion
          currentRow[j - 1] + 1, // insertion
          previousRow[j - 1] + 1 // substitution
        )
      }
      currentRow[j] = value
      if (value < rowMin) {
        rowMin = value
      }
    }

    // Early termination if all values in this row exceed tolerance
    if (rowMin > tolerance) {
      return -1
    }

    const swap = previousRow
    previousRow = currentRow
    currentRow = swap
  }

  return previousRow[n] <= tolerance ? previousRow[n] : -1
}

/**
 * Computes the Levenshtein distance between two strings (a, b), returning early with -1 if the distance
 * is greater than the given tolerance.
 * It assumes that:
 * - tolerance >= ||a| - |b|| >= 0
 */
export function boundedLevenshtein(term: string, w: string, tolerance: number): BoundedMetric {
  const distance = _boundedLevenshtein(term, w, tolerance)
  return {
    distance,
    isBounded: distance >= 0
  }
}

// This is only used internally, keep in sync with the previous one
export function syncBoundedLevenshtein(term: string, w: string, tolerance: number): BoundedMetric {
  const distance = _boundedLevenshtein(term, w, tolerance)
  return {
    distance,
    isBounded: distance >= 0
  }
}

export function levenshtein(a: string, b: string): number {
  /* c8 ignore next 3 */
  if (!a.length) {
    return b.length
  }

  /* c8 ignore next 3 */
  if (!b.length) {
    return a.length
  }

  const swap = a
  if (a.length > b.length) {
    a = b
    b = swap
  }

  const row = new Array<number>(a.length + 1)
  for (let i = 0; i <= a.length; i++) {
    row[i] = i
  }
  let val = 0

  for (let i = 1; i <= b.length; i++) {
    let prev = i
    const bChar = b.charCodeAt(i - 1)

    for (let j = 1; j <= a.length; j++) {
      if (bChar === a.charCodeAt(j - 1)) {
        val = row[j - 1]
      } else {
        val = Math.min(row[j - 1] + 1, Math.min(prev + 1, row[j] + 1))
      }

      row[j - 1] = prev
      prev = val
    }
    row[a.length] = prev
  }

  return row[a.length]
}
