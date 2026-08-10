#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { transpile } from './lib/oxc.mjs'
import { declarationConfig, tsc } from './lib/tsc.mjs'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}

const esmTarget = option('esm-target', 'es2022')
const copies = option('copies', '').split(',').filter(Boolean)

rmSync('dist', { recursive: true, force: true })

await transpile({ out: 'dist/esm', target: esmTarget, sourcemap: true, clean: false })
tsc('-p', declarationConfig(), '--emitDeclarationOnly', '--outDir', 'dist/esm')

writeFileSync('src/package.json', `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`)

try {
  tsc('-p', 'tsconfig.cjs.json')
} finally {
  rmSync('src/package.json', { force: true })
}

for (const [dir, type] of [
  ['dist/esm', 'module'],
  ['dist/commonjs', 'commonjs']
]) {
  writeFileSync(`${dir}/package.json`, `${JSON.stringify({ type }, null, 2)}\n`)
}

for (const dialect of copies) {
  mkdirSync(`dist/${dialect}`, { recursive: true })
  cpSync('dist/esm', `dist/${dialect}`, { recursive: true })
}
