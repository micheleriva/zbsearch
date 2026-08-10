#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules') walk(full, out)
    } else if (name.endsWith('.map')) {
      out.push(full)
    }
  }
  return out
}

let checked = 0
let failures = 0

for (const dir of process.argv.slice(2)) {
  const pkgDir = dir.replace(/\/$/, '')
  const problems = []

  for (const out of ['dist', 'lib']) {
    const root = join(pkgDir, out)
    if (!existsSync(root)) continue

    for (const map of walk(root)) {
      checked++
      let m
      try {
        m = JSON.parse(readFileSync(map, 'utf8'))
      } catch (e) {
        problems.push(`  ${map}: unparseable (${e.message.slice(0, 40)})`)
        continue
      }

      if (!m.mappings || m.mappings.length === 0) {
        const emitted = map.replace(/\.map$/, '')
        const body = existsSync(emitted)
          ? readFileSync(emitted, 'utf8')
              .replace(/\/\/# sourceMappingURL=.*$/m, '')
              .replace(/^#!.*$/m, '')
              .replace(/["']use strict["'];?/, '')
              .replace(/export\s*\{\s*\};?/, '')
              .trim()
          : 'unknown'
        if (body.length > 0) problems.push(`  ${map}: empty mappings for non-empty output`)
      }
      if (!Array.isArray(m.sources) || m.sources.length === 0) {
        problems.push(`  ${map}: no sources`)
        continue
      }

      for (const [index, source] of m.sources.entries()) {
        const embedded = Array.isArray(m.sourcesContent) && typeof m.sourcesContent[index] === 'string'
        if (embedded) continue

        const target = resolve(dirname(map), m.sourceRoot ?? '', source)
        if (!existsSync(target)) problems.push(`  ${map}: source not found -> ${source}`)
      }
    }
  }

  if (problems.length) {
    failures++
    console.log(`FAIL     ${pkgDir}`)
    for (const p of problems.slice(0, 6)) console.log(p)
    if (problems.length > 6) console.log(`  … ${problems.length - 6} more`)
  }
}

console.log(`${checked} sourcemap(s) checked, ${failures} package(s) failing`)
process.exit(failures ? 1 : 0)
