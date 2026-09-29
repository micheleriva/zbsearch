import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** The games dataset: 1,512 real English records with titles and descriptions. */
export function gamesCorpus() {
  const raw = JSON.parse(readFileSync(join(__dirname, '..', 'dataset.json'), 'utf8'))

  return raw.map((game, i) => ({
    url: `/games/${i}/`,
    title: game.title,
    content: game.description
  }))
}

/**
 * Deterministic docs-like corpus for the scale run. Zipf-distributed
 * vocabulary of unique words, so document frequencies resemble prose.
 */
export function syntheticCorpus(pages) {
  let seed = 42
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }

  const syllables = ['con', 'fig', 'ser', 'ver', 'in', 'dex', 'que', 'ry', 'sha', 'rd', 'to', 'ken', 'se', 'arch', 'ran', 'king', 'do', 'cu', 'ment', 'la', 'zy', 'fe', 'tch', 'ca', 'che', 'pre', 'fix', 'sta', 'tic', 'bu', 'ild']
  const vocab = []
  for (let i = 0; i < 30000; i++) {
    let word = ''
    const parts = 2 + Math.floor(rand() * 3)
    for (let p = 0; p < parts; p++) word += syllables[Math.floor(rand() * syllables.length)]
    vocab.push(word + i.toString(36))
  }

  const zipfWord = () => vocab[Math.min(Math.floor(30000 * Math.pow(rand(), 3)), 29999)]
  const sentence = (words) => Array.from({ length: words }, zipfWord).join(' ')

  const records = []
  for (let i = 0; i < pages; i++) {
    records.push({
      url: `/docs/page-${i}/`,
      title: sentence(4),
      content: sentence(80)
    })
  }
  return records
}

/**
 * Builds a query battery with known target documents.
 *
 * A target's anchor is a token unique to its title, so the expected best hit
 * is unambiguous. Each anchor yields one query per category: the exact token,
 * a one-edit typo, a 4-character prefix, and the token paired with a rare
 * word from the same document's content.
 */
export function buildBattery(records, maxTargets = 60) {
  const df = new Map()
  for (const record of records) {
    for (const token of new Set(tokenize(`${record.title} ${record.content}`))) {
      df.set(token, (df.get(token) ?? 0) + 1)
    }
  }

  const battery = []
  for (const record of records) {
    if (battery.length >= maxTargets * 4) break

    const anchor = tokenize(record.title).find((t) => t.length >= 6 && df.get(t) === 1)
    if (!anchor) continue

    // One deleted character: Levenshtein distance 1 from the anchor, the kind
    // of typo a tolerance of 1 is meant to absorb.
    const typo = anchor.slice(0, 3) + anchor.slice(4)
    if (typo === anchor || df.has(typo)) continue

    const companion = tokenize(record.content).find((t) => t.length >= 5 && t !== anchor && (df.get(t) ?? 0) <= 20)

    battery.push({ category: 'exact', term: anchor, target: record.url })
    battery.push({ category: 'typo', term: typo, target: record.url })
    battery.push({ category: 'prefix', term: anchor.slice(0, 4), target: record.url })
    if (companion) battery.push({ category: 'two words', term: `${anchor} ${companion}`, target: record.url })
  }

  return battery
}
