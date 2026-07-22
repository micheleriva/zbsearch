// Shared config and helpers for the k6 load-test scenarios.
// Run all k6 scripts from benchmarks/http/ so relative paths resolve.

import { SharedArray } from 'k6/data'

export const BASE_URL = (__ENV.BASE_URL || '').replace(/\/+$/, '')
export const API_KEY = __ENV.API_KEY || ''
export const INDEX_ID = __ENV.INDEX_ID || 'loadtest'

if (!BASE_URL) {
  throw new Error('BASE_URL env var is required (e.g. BASE_URL=https://your-worker.workers.dev)')
}

export function headers() {
  const h = { 'content-type': 'application/json' }
  // Local `wrangler dev` may run without an API key; only send the header when set.
  if (API_KEY) {
    h.authorization = `Bearer ${API_KEY}`
  }
  return h
}

export const searchUrl = `${BASE_URL}/v1/indexes/${INDEX_ID}/search`
export const batchUrl = `${BASE_URL}/v1/indexes/${INDEX_ID}/documents/batch`
export const statusUrl = `${BASE_URL}/v1/indexes/${INDEX_ID}/status`

// Head of generate-corpus.mjs's COMMON_WORDS, so common-term queries hit the corpus.
const FALLBACK_COMMON = [
  'world', 'game', 'player', 'story', 'battle', 'quest', 'dragon', 'magic', 'kingdom', 'hero',
  'dark', 'light', 'war', 'legend', 'sword', 'forest', 'city', 'space', 'star', 'ocean',
  'island', 'monster', 'dungeon', 'castle', 'knight', 'wizard', 'shadow', 'fire', 'storm',
  'mountain', 'river', 'ancient', 'lost', 'hidden', 'secret', 'power', 'soul', 'heart', 'dream'
]

// Generic-looking rare words; only used when data/vocab.json is unavailable.
const FALLBACK_RARE = [
  'zorquabel', 'thormiash', 'velkarun', 'dragilfae', 'norithom', 'prasiltur', 'wynxelo',
  'garhimde', 'rakonash', 'britamol', 'visarnel', 'dunyakor', 'lisandro', 'phirzor'
]

// Prefer the vocabulary the corpus was generated with (common words + real rare
// words that actually exist in the index). Fall back to the embedded lists so the
// scripts still run against a hand-built index. k6 resolves open() relative to
// the working directory, so this expects k6 to run from benchmarks/http/.
const vocab = (() => {
  try {
    const parsed = JSON.parse(open('data/vocab.json'))
    return { common: parsed.common, rare: parsed.rare }
  } catch {
    return { common: FALLBACK_COMMON, rare: FALLBACK_RARE }
  }
})()

const COMMON_TERMS = new SharedArray('common terms', () => vocab.common)
const RARE_TERMS = new SharedArray('rare terms', () => vocab.rare)

const GIBBERISH_CHARS = 'qxzjkvwbfpgy'

function gibberish() {
  let word = ''
  const len = 5 + Math.floor(Math.random() * 5)
  for (let i = 0; i < len; i++) {
    word += GIBBERISH_CHARS[Math.floor(Math.random() * GIBBERISH_CHARS.length)]
  }
  return word
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

// Query mix: ~70% common terms, ~20% rare terms, ~10% gibberish misses.
export function randomTerm() {
  const roll = Math.random()
  if (roll < 0.7) return pick(COMMON_TERMS)
  if (roll < 0.9) return pick(RARE_TERMS)
  return gibberish()
}

export function randomSearchBody() {
  return JSON.stringify({
    term: randomTerm(),
    limit: 5 + Math.floor(Math.random() * 16) // 5..20
  })
}

// Synthetic document for write scenarios; ids are unique per VU/iteration so
// repeated runs keep upserting fresh docs.
export function randomBatch(size, tag) {
  const operations = []
  for (let i = 0; i < size; i++) {
    operations.push({
      op: 'upsert',
      id: `load-${tag}-${__VU}-${__ITER}-${i}`,
      doc: {
        title: `${pick(COMMON_TERMS)} ${pick(COMMON_TERMS)}`,
        description: `${pick(COMMON_TERMS)} ${pick(RARE_TERMS)} ${pick(COMMON_TERMS)} ${gibberish()}`,
        rating: Math.round((1 + Math.random() * 4) * 10) / 10,
        genres: ['RPG']
      }
    })
  }
  return JSON.stringify({ operations })
}
