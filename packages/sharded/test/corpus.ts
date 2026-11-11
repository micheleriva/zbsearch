// Deterministic synthetic passages resembling the issue's test setup: Zipf
// distributed vocabulary, item/collection metadata and clustered vectors.

export const DIMS = 16

export const SCHEMA = {
  text: 'string',
  section: 'string',
  title: 'string',
  itemKey: 'string',
  page: 'number',
  year: 'number',
  collection: 'enum',
  tags: 'string[]',
  open: 'boolean',
  embedding: `vector[${DIMS}]`
} as const

export interface Passage {
  id: string
  text: string
  section: string
  title: string
  itemKey: string
  page: number
  year: number
  collection: string
  tags: string[]
  open: boolean
  embedding: number[]
}

export function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

const SYLLABLES = ['ka', 'lo', 'mi', 'ne', 'ru', 'ta', 'vi', 'zo', 'pe', 'qua', 'shi', 'bro', 'den', 'fal', 'gor']

export function vocabulary(size: number, random: () => number): string[] {
  const words = new Set<string>()
  while (words.size < size) {
    const syllables = 2 + Math.floor(random() * 3)
    let word = ''
    for (let i = 0; i < syllables; i++) word += SYLLABLES[Math.floor(random() * SYLLABLES.length)]
    words.add(word)
  }
  return [...words]
}

function zipfPicker(words: string[], random: () => number): () => string {
  const weights = words.map((_, i) => 1 / (i + 1))
  const cumulative: number[] = []
  let total = 0
  for (const weight of weights) cumulative.push((total += weight))
  return () => {
    const target = random() * total
    let low = 0
    let high = cumulative.length - 1
    while (low < high) {
      const mid = (low + high) >> 1
      if (cumulative[mid] < target) low = mid + 1
      else high = mid
    }
    return words[low]
  }
}

export const COLLECTIONS = ['physics', 'biology', 'history', 'law', 'art']

/** `tagsPerDoc` > 1 exercises core's per-element indexing of string[] values. */
export function makeCorpus(count: number, seed = 42, vocabSize = 800, tagsPerDoc = 2): Passage[] {
  const random = rng(seed)
  const words = vocabulary(vocabSize, random)
  const pick = zipfPicker(words, random)
  const centers = COLLECTIONS.map(() => Array.from({ length: DIMS }, () => random() * 2 - 1))
  const sentence = (n: number) => Array.from({ length: n }, pick).join(' ')

  const passages: Passage[] = []
  for (let i = 0; i < count; i++) {
    const item = Math.floor(i / 8)
    const c = item % COLLECTIONS.length
    passages.push({
      id: `p${i}`,
      text: sentence(15 + Math.floor(random() * 25)),
      section: sentence(1 + Math.floor(random() * 3)),
      title: `${sentence(3)} ${item}`,
      itemKey: `ITEM${item}`,
      page: 1 + (i % 8),
      year: 1990 + (item % 30),
      collection: COLLECTIONS[c],
      tags: Array.from({ length: tagsPerDoc }, (_, t) => sentence(t + 1)),
      open: i % 3 === 0,
      embedding: centers[c].map((x) => x + (random() * 2 - 1) * 0.6)
    })
  }
  return passages
}

/** Query terms drawn from the corpus' own vocabulary, rare and common. */
export function corpusWords(seed = 42, vocabSize = 800): string[] {
  return vocabulary(vocabSize, rng(seed))
}
