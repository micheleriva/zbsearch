// The documents of release-4.0.3.zbsb, a binary snapshot written by zbsearch 4.0.3 (the release before frozen
// segments) with:
//
//   node tests/fixtures/release-snapshot-docs.mjs /path/to/zbsearch-4.0.3/dist/esm/index.js
//
// tests/frozen-compat.test.ts loads them with the current build.
import { writeFileSync } from 'node:fs'

export const SCHEMA = {
  text: 'string',
  title: 'string',
  tags: 'string[]',
  year: 'number',
  kind: 'enum',
  open: 'boolean'
}

export const STORE = { exclude: ['text'] }

export function releaseSnapshotDocs() {
  let seed = 4003
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const syllables = ['ka', 'lo', 'mi', 'ne', 'ru', 'sa', 'ti', 'vo']
  const word = () => {
    // Skewed: short, common words come up more often
    const n = 1 + Math.floor(random() * random() * 4)
    let w = ''
    for (let i = 0; i < n; i++) w += syllables[Math.floor(random() * random() * syllables.length)]
    return w
  }
  const sentence = (n) => Array.from({ length: n }, word).join(' ')

  return Array.from({ length: 300 }, (_, i) => ({
    id: `r${i}`,
    text: sentence(5 + Math.floor(random() * 30)),
    title: sentence(1 + Math.floor(random() * 4)),
    tags: Array.from({ length: Math.floor(random() * 3) }, () => word()),
    year: 2000 + Math.floor(random() * 20),
    kind: `k${Math.floor(random() * 4)}`,
    open: random() < 0.5
  }))
}

if (process.argv[2]) {
  const zb = await import(process.argv[2])
  const db = zb.create({ schema: SCHEMA, store: STORE })
  zb.insertMultiple(db, releaseSnapshotDocs())
  // Some removals and updates, so that the snapshot holds updated postings
  for (let i = 0; i < 300; i += 13) zb.remove(db, `r${i}`)
  for (let i = 5; i < 300; i += 17) {
    if (i % 13 !== 0) zb.update(db, `r${i}`, { ...releaseSnapshotDocs()[(i * 7) % 300], id: `r${i}` })
  }
  const dir = new URL('.', import.meta.url)
  writeFileSync(new URL('release-4.0.3.zbsb', dir), zb.saveBinarySync(db))
}
