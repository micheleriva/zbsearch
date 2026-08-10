#!/usr/bin/env node
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, lstatSync } from 'node:fs'
import { join, relative } from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const GOLDEN_DIR = 'scripts/dist-contract'

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (lstatSync(full).isSymbolicLink()) continue
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue
      walk(full, base, out)
    } else {
      out.push(relative(base, full))
    }
  }
  return out
}

function dtsSurface(file) {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const names = new Set()
  const isExported = (n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

  for (const node of src.statements) {
    if (ts.isExportDeclaration(node)) {
      const from = node.moduleSpecifier?.text
      if (!node.exportClause) {
        names.add(`*:${from}`)
      } else if (ts.isNamespaceExport(node.exportClause)) {
        names.add(node.exportClause.name.text)
      } else if (ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) names.add(el.name.text)
      }
    } else if (ts.isExportAssignment(node)) {
      names.add('default')
    } else if (isExported(node)) {
      if (node.name?.text) names.add(node.name.text)
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) if (d.name?.text) names.add(d.name.text)
      }
      if (node.modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) names.add('default')
    }
  }
  return [...names].sort()
}

function exportTargets(pkg) {
  const out = []
  const visit = (node, trail) => {
    if (typeof node === 'string') return out.push({ condition: trail.join('.'), target: node })
    if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) visit(v, [...trail, k])
  }
  visit(pkg.exports ?? {}, [])
  for (const field of ['main', 'module', 'types', 'browser']) {
    if (typeof pkg[field] === 'string') out.push({ condition: `#${field}`, target: pkg[field] })
  }
  return out
}

function contractFor(pkgDir) {
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  const outDirs = ['dist', 'lib'].filter((d) => existsSync(join(pkgDir, d)))

  const files = []
  for (const d of outDirs) for (const f of walk(join(pkgDir, d))) files.push(`${d}/${f}`)

  const types = {}
  for (const f of files) {
    if (!f.endsWith('.d.ts') && !f.endsWith('.d.cts') && !f.endsWith('.d.mts')) continue
    types[f] = dtsSurface(join(pkgDir, f))
  }

  const targets = exportTargets(pkg)
    .map(({ condition, target }) => ({
      condition,
      target,
      exists: existsSync(join(pkgDir, target.replace(/^\.\//, '')))
    }))
    .sort((a, b) => (a.condition + a.target).localeCompare(b.condition + b.target))

  const markers = {}
  for (const f of files) {
    if (f.endsWith('/package.json')) markers[f] = JSON.parse(readFileSync(join(pkgDir, f), 'utf8'))
  }

  return { name: pkg.name, files: files.sort(), types, targets, markers }
}

function diff(golden, current, _label) {
  const problems = []
  const gf = new Set(golden.files)
  const cf = new Set(current.files)
  const missing = [...gf].filter((f) => !cf.has(f))
  const added = [...cf].filter((f) => !gf.has(f))
  if (missing.length)
    problems.push(
      `  ${missing.length} MISSING file(s): ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`
    )
  if (added.length)
    problems.push(`  ${added.length} ADDED file(s): ${added.slice(0, 8).join(', ')}${added.length > 8 ? ' …' : ''}`)

  for (const [f, want] of Object.entries(golden.types)) {
    const got = current.types[f]
    if (!got) continue
    const lost = want.filter((n) => !got.includes(n))
    const gained = got.filter((n) => !want.includes(n))
    if (lost.length || gained.length) {
      problems.push(
        `  TYPE DRIFT ${f}: ${lost.length ? `-${lost.join(',')}` : ''} ${gained.length ? `+${gained.join(',')}` : ''}`.trimEnd()
      )
    }
  }

  const key = (t) => `${t.condition} -> ${t.target}`
  const gt = new Set(golden.targets.map(key))
  const ct = new Set(current.targets.map(key))
  for (const k of gt) if (!ct.has(k)) problems.push(`  EXPORTS DRIFT lost: ${k}`)
  for (const k of ct) if (!gt.has(k)) problems.push(`  EXPORTS DRIFT added: ${k}`)
  for (const t of current.targets) if (!t.exists) problems.push(`  DANGLING export target: ${key(t)}`)

  for (const [f, want] of Object.entries(golden.markers)) {
    const got = current.markers[f]
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`  MARKER DRIFT ${f}: expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`)
    }
  }

  return problems
}

const [mode, ...dirs] = process.argv.slice(2)
if (!mode || !['snapshot', 'verify'].includes(mode)) {
  console.error('usage: dist-contract.mjs <snapshot|verify> <package-dir...>')
  process.exit(1)
}

mkdirSync(GOLDEN_DIR, { recursive: true })
let failed = 0

for (const dir of dirs) {
  const pkgDir = dir.replace(/\/$/, '')
  if (!existsSync(join(pkgDir, 'package.json'))) continue
  const current = contractFor(pkgDir)
  const goldenPath = join(GOLDEN_DIR, `${current.name.replace(/[@/]/g, '_')}.json`)

  if (mode === 'snapshot') {
    writeFileSync(goldenPath, `${JSON.stringify(current, null, 2)}\n`)
    console.log(
      `snapshot ${current.name.padEnd(34)} ${current.files.length} files, ${Object.keys(current.types).length} d.ts`
    )
    continue
  }

  if (!existsSync(goldenPath)) {
    failed++
    console.log(`MISSING  ${current.name} (no baseline: run \`node scripts/dist-contract.mjs snapshot ${pkgDir}\`)`)
    continue
  }
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))
  const problems = diff(golden, current)
  if (problems.length) {
    failed++
    console.log(`FAIL     ${current.name}`)
    for (const p of problems) console.log(p)
  } else {
    console.log(`ok       ${current.name.padEnd(34)} ${current.files.length} files`)
  }
}

process.exit(failed ? 1 : 0)
