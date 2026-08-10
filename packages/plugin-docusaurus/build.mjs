#!/usr/bin/env node
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { transpile } from '../../scripts/lib/oxc.mjs'
import { bundle, readConfig } from '../../scripts/lib/rolldown.mjs'

function walk(dir, ext) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? walk(full, ext) : full.endsWith(ext) ? [full] : []
  })
}

await bundle(readConfig())

await transpile({
  out: 'lib',
  target: 'es2020',
  patterns: ['theme/**/*.ts', 'theme/**/*.tsx', 'client/**/*.ts', 'client/**/*.tsx', 'shared/**/*.ts', 'shared/**/*.tsx'],
  sourcemap: true,
  clean: false
})

for (const stylesheet of walk('src/theme', '.css')) {
  const dest = join('lib', relative('src', stylesheet))
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(stylesheet, dest)
}
