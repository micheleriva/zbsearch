// Synthetic passage corpus for the sharded benchmark, after the test setup of
// issues #79-#82: 150-250 word passages from a Zipf-distributed 40k-word
// vocabulary, item/collection metadata and random unit vectors.

export const COLLECTIONS = ['physics', 'biology', 'history', 'law', 'medicine', 'art', 'economics', 'chemistry']

export function shardedSchema(dims) {
  return {
    text: 'string',
    section: 'string',
    title: 'string',
    itemKey: 'string',
    page: 'number',
    year: 'number',
    collection: 'enum',
    embedding: `vector[${dims}]`
  }
}

export function rng(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

const SYLLABLES = ['ka', 'lo', 'mi', 'ne', 'ru', 'ta', 'vi', 'zo', 'pe', 'qua', 'shi', 'bro', 'den', 'fal', 'gor', 'it']

export function vocabulary(size, seed = 7) {
  const random = rng(seed)
  const words = new Set()
  while (words.size < size) {
    const syllables = 2 + Math.floor(random() * 4)
    let word = ''
    for (let i = 0; i < syllables; i++) word += SYLLABLES[Math.floor(random() * SYLLABLES.length)]
    words.add(word)
  }
  return [...words]
}

function zipf(words, random) {
  const cumulative = new Float64Array(words.length)
  let total = 0
  for (let i = 0; i < words.length; i++) cumulative[i] = total += 1 / (i + 1)
  return () => {
    const target = random() * total
    let low = 0
    let high = words.length - 1
    while (low < high) {
      const mid = (low + high) >> 1
      if (cumulative[mid] < target) low = mid + 1
      else high = mid
    }
    return words[low]
  }
}

/**
 * Yields passages in batches. About 80 passages per item (paper), as in the
 * issue's Zotero library; vectors are random unit vectors rounded to 6
 * decimals (the shard codec stores JSON; rounding only shortens it).
 */
export function* passages({ count, dims, batch = 1000, vocabSize = 40000, seed = 42 }) {
  const random = rng(seed)
  const pick = zipf(vocabulary(vocabSize), random)
  const sentence = (n) => {
    const out = new Array(n)
    for (let i = 0; i < n; i++) out[i] = pick()
    return out.join(' ')
  }

  let docs = []
  for (let i = 0; i < count; i++) {
    const item = Math.floor(i / 80)
    const vector = new Array(dims)
    let norm = 0
    for (let d = 0; d < dims; d++) {
      const x = random() * 2 - 1
      vector[d] = x
      norm += x * x
    }
    norm = Math.sqrt(norm)
    for (let d = 0; d < dims; d++) vector[d] = Math.round((vector[d] / norm) * 1e6) / 1e6

    docs.push({
      id: `p${i}`,
      text: sentence(150 + Math.floor(random() * 101)),
      section: sentence(2 + Math.floor(random() * 3)),
      title: sentence(6),
      itemKey: `ITEM${item}`,
      page: 1 + (i % 80),
      year: 1980 + (item % 45),
      collection: COLLECTIONS[item % COLLECTIONS.length],
      embedding: vector
    })
    if (docs.length === batch) {
      yield docs
      docs = []
    }
  }
  if (docs.length) yield docs
}
