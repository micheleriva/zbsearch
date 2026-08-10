#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { glob } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { createRequire } from 'node:module'

const { transformSync } = createRequire(`${process.cwd()}/`)('oxc-transform')

const SRC = process.env.OXC_SRC ?? 'src'
const OUT = process.env.OXC_OUT ?? 'dist'
const TARGET = process.env.OXC_TARGET ?? 'es2022'
const GLOB = process.env.OXC_GLOB ?? '**/*.ts'
const SOURCEMAP = process.env.OXC_SOURCEMAP === '1'
const CLEAN = process.env.OXC_CLEAN !== '0'

if (CLEAN) rmSync(OUT, { recursive: true, force: true })

const files = []
for (const pattern of GLOB.split(',')) {
  for await (const f of glob(`${SRC}/${pattern.trim()}`)) files.push(f)
}
files.sort()

let failed = 0
for (const file of files) {
  const result = transformSync(file, readFileSync(file, 'utf8'), {
    target: TARGET,
    sourcemap: SOURCEMAP
  })

  if (result.errors.length) {
    failed++
    console.error(`${file}:`)
    for (const e of result.errors) console.error(`  ${e.message ?? e}`)
    continue
  }

  const out = join(OUT, relative(SRC, file).replace(/\.tsx?$/, '.js'))
  mkdirSync(dirname(out), { recursive: true })

  if (SOURCEMAP && result.map) {
    const name = out.split('/').pop()
    writeFileSync(out, `${result.code}\n//# sourceMappingURL=${name}.map\n`)
    writeFileSync(`${out}.map`, JSON.stringify(result.map))
  } else {
    writeFileSync(out, result.code)
  }
}

if (failed) process.exit(1)
console.log(`oxc: ${files.length} file(s) -> ${OUT}`)
