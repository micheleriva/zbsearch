#!/usr/bin/env node

// Deterministic synthetic corpus generator for HTTP load tests.
// Emits JSONL: {id, title, description, rating, genres[]} - same field style
// as benchmarks/src/dataset.json.
//
// Usage: node generate-corpus.mjs --docs 100000 --out data/corpus-100k.jsonl [--seed 42]
//
// Streams to disk; also writes a vocab.json next to the output file with
// common/rare word lists that the k6 scripts use for their query mix.

import { once } from 'node:events'
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const GENRES = [
  'RPG',
  'Adventure',
  'Action',
  'Indie',
  'Strategy',
  'Puzzle',
  'Shooter',
  'Simulation',
  'Sports',
  'Racing',
  'Horror',
  'Platformer',
  'Brawler',
  'Stealth',
  'Sandbox'
]

// Head of the vocabulary: real English words so common-term queries look natural.
const COMMON_WORDS = [
  'the', 'world', 'game', 'player', 'story', 'battle', 'quest', 'dragon', 'magic', 'kingdom',
  'hero', 'dark', 'light', 'war', 'legend', 'sword', 'forest', 'city', 'space', 'star',
  'ocean', 'island', 'monster', 'dungeon', 'castle', 'knight', 'wizard', 'shadow', 'fire', 'ice',
  'storm', 'mountain', 'river', 'ancient', 'lost', 'hidden', 'secret', 'power', 'soul', 'heart',
  'dream', 'night', 'day', 'time', 'journey', 'adventure', 'mystery', 'treasure', 'enemy', 'ally',
  'army', 'king', 'queen', 'prince', 'princess', 'empire', 'rebellion', 'freedom', 'destiny', 'fate',
  'blood', 'bone', 'steel', 'iron', 'gold', 'silver', 'crystal', 'stone', 'earth', 'wind',
  'sky', 'moon', 'sun', 'starlight', 'void', 'abyss', 'realm', 'gate', 'portal', 'rune',
  'spell', 'curse', 'blessing', 'spirit', 'ghost', 'demon', 'angel', 'god', 'titan', 'giant',
  'wolf', 'bear', 'eagle', 'serpent', 'phoenix', 'raven', 'crow', 'hawk', 'shark', 'tiger',
  'village', 'tower', 'bridge', 'cave', 'temple', 'shrine', 'ruins', 'desert', 'jungle', 'swamp',
  'ship', 'captain', 'pirate', 'sailor', 'hunter', 'ranger', 'rogue', 'thief', 'assassin', 'warrior',
  'mage', 'cleric', 'bard', 'paladin', 'necromancer', 'alchemist', 'merchant', 'blacksmith', 'farmer', 'bardic'
]

// Syllables for the long tail of generated rare words.
const SYLLABLES = [
  'zor', 'qua', 'bel', 'thor', 'mi', 'ash', 'vel', 'kar', 'un', 'dra',
  'gil', 'fae', 'nor', 'ith', 'om', 'pra', 'sil', 'tur', 'wyn', 'xe',
  'lo', 'gar', 'him', 'del', 'ra', 'kon', 'esh', 'bri', 'ta', 'mol',
  'vi', 'sarn', 'el', 'dun', 'ya', 'kor', 'lis', 'an', 'dro', 'phir'
]

const VOCAB_SIZE = 20000

function hashSeed(str) {
  let h = 2166136261
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildVocabulary(rng) {
  const vocab = [...COMMON_WORDS]
  const seen = new Set(vocab)
  while (vocab.length < VOCAB_SIZE) {
    const syllables = 2 + Math.floor(rng() * 3)
    let word = ''
    for (let i = 0; i < syllables; i++) {
      word += SYLLABLES[Math.floor(rng() * SYLLABLES.length)]
    }
    if (!seen.has(word)) {
      seen.add(word)
      vocab.push(word)
    }
  }
  return vocab
}

function parseArgs(argv) {
  const args = { docs: 100000, out: null, seed: 42 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--docs') args.docs = Number(argv[++i])
    else if (arg === '--out') args.out = argv[++i]
    else if (arg === '--seed') args.seed = argv[++i]
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node generate-corpus.mjs --docs <n> --out <file.jsonl> [--seed 42]')
      process.exit(0)
    } else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(1)
    }
  }
  if (!args.out) {
    console.error('Missing required --out <file.jsonl>')
    process.exit(1)
  }
  if (!Number.isFinite(args.docs) || args.docs <= 0) {
    console.error(`Invalid --docs value: ${args.docs}`)
    process.exit(1)
  }
  return args
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const rng = mulberry32(hashSeed(args.seed))
  const vocab = buildVocabulary(rng)

  // Zipfian-ish sampler: low ranks (common words) dominate, long tail is rare.
  const sampleWord = () => vocab[Math.min(vocab.length - 1, Math.floor(vocab.length * Math.pow(rng(), 2.2)))]

  const sampleGenres = () => {
    const count = 1 + Math.floor(rng() * 3)
    const picked = new Set()
    while (picked.size < count) {
      picked.add(GENRES[Math.floor(rng() * GENRES.length)])
    }
    return [...picked]
  }

  // Triangular distribution centered at 3.0, range [1.0, 5.0] - skews to 3-4.
  const sampleRating = () => {
    const t = (rng() + rng() + rng()) / 3
    return Math.round((1 + t * 4) * 10) / 10
  }

  mkdirSync(dirname(args.out), { recursive: true })
  const stream = createWriteStream(args.out)
  const started = performance.now()

  for (let i = 0; i < args.docs; i++) {
    const titleWords = 2 + Math.floor(rng() * 3)
    const title = Array.from({ length: titleWords }, () => capitalize(sampleWord())).join(' ')

    const descWords = 8 + Math.floor(rng() * 30)
    const description = `${Array.from({ length: descWords }, sampleWord).join(' ')}.`

    const doc = {
      id: `doc-${String(i).padStart(7, '0')}`,
      title,
      description,
      rating: sampleRating(),
      genres: sampleGenres()
    }

    if (!stream.write(`${JSON.stringify(doc)}\n`)) {
      await once(stream, 'drain')
    }

    if ((i + 1) % 100000 === 0) {
      console.error(`... ${i + 1} docs written`)
    }
  }

  stream.end()
  await once(stream, 'finish')

  const vocabFile = `${dirname(args.out)}/vocab.json`
  const rare = []
  for (let rank = 15000; rank < vocab.length && rare.length < 200; rank += 25) {
    rare.push(vocab[rank])
  }
  writeFileSync(vocabFile, `${JSON.stringify({ common: vocab.slice(0, 300), rare }, null, 2)}\n`)

  const seconds = (performance.now() - started) / 1000
  console.log(
    JSON.stringify({
      out: args.out,
      docs: args.docs,
      bytes: stream.bytesWritten,
      seconds: Math.round(seconds * 100) / 100,
      docsPerSecond: Math.round(args.docs / seconds),
      seed: args.seed,
      vocabFile
    })
  )
}

main().catch((err) => {
  console.error(`generate-corpus failed: ${err.message}`)
  process.exit(1)
})
