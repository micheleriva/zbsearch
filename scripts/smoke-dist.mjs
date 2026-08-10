#!/usr/bin/env node
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function targets(pkg) {
  const out = new Set()
  const visit = (node, trail) => {
    if (typeof node === 'string') {
      if (!node.endsWith('.global.js') && !trail.includes('browser') && !trail.includes('deno')) out.add(node)
      return
    }
    if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) visit(v, [...trail, k])
  }
  visit(pkg.exports ?? {}, [])
  for (const f of ['main', 'module']) if (typeof pkg[f] === 'string') out.add(pkg[f])
  return [...out].filter((t) => /\.(js|cjs|mjs)$/.test(t))
}

function isCjs(file) {
  if (file.endsWith('.cjs')) return true
  if (file.endsWith('.mjs')) return false
  let dir = dirname(file)
  for (let i = 0; i < 6; i++) {
    const pj = join(dir, 'package.json')
    if (existsSync(pj)) {
      try {
        return JSON.parse(readFileSync(pj, 'utf8')).type !== 'module'
      } catch {
        return false
      }
    }
    dir = dirname(dir)
  }
  return false
}

let failures = 0
let checked = 0

for (const dir of process.argv.slice(2)) {
  const pkgDir = dir.replace(/\/$/, '')
  const pkgPath = join(pkgDir, 'package.json')
  if (!existsSync(pkgPath)) continue
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const problems = []

  for (const target of targets(pkg)) {
    const file = resolve(pkgDir, target)
    if (!existsSync(file)) {
      problems.push(`  MISSING ${target}`)
      continue
    }
    checked++
    try {
      if (isCjs(file)) {
        createRequire(`${resolve(pkgDir)}/`)(file)
      } else {
        await import(pathToFileURL(file).href)
      }
    } catch (err) {
      problems.push(`  ${target}: ${String(err.message).split('\n')[0].slice(0, 120)}`)
    }
  }

  if (problems.length) {
    failures++
    console.log(`FAIL     ${pkg.name}`)
    for (const p of problems) console.log(p)
  } else {
    console.log(`ok       ${pkg.name}`)
  }
}

console.log(`\n${checked} entry point(s) loaded, ${failures} package(s) failing`)
process.exit(failures ? 1 : 0)
