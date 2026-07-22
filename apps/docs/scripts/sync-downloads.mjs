// Keeps the downloadable config templates in public/downloads in sync with the
// canonical templates shipped in @zbsearch/runtime-cloudflare.
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const templates = resolve(here, '../../../packages/runtime-cloudflare/deploy/templates')
const downloads = resolve(here, '../public/downloads')

mkdirSync(downloads, { recursive: true })

const files = [
  ['config.example.json', 'zbsearch.edge.config.example.json'],
  ['config.example.yaml', 'zbsearch.edge.config.example.yaml']
]

for (const [from, to] of files) {
  copyFileSync(resolve(templates, from), resolve(downloads, to))
  console.log(`synced ${from} -> public/downloads/${to}`)
}
