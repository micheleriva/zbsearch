#!/usr/bin/env node
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const run = (cmd, args, env) => execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } })

const TSC = '../../node_modules/.bin/tsc'
const ESM_TARGET = process.env.DIALECT_ESM_TARGET ?? 'es2022'
const COPIES = (process.env.DIALECT_COPIES ?? '').split(',').filter(Boolean)

rmSync('dist', { recursive: true, force: true })

run(process.execPath, ['../../scripts/oxc-build.mjs'], {
  OXC_SRC: 'src',
  OXC_OUT: 'dist/esm',
  OXC_TARGET: ESM_TARGET,
  OXC_SOURCEMAP: '1'
})
const DTS_CONFIG = existsSync('tsconfig.build.json') ? 'tsconfig.build.json' : 'tsconfig.json'
run(TSC, ['-p', DTS_CONFIG, '--emitDeclarationOnly', '--outDir', 'dist/esm'])

writeFileSync('src/package.json', `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`)
try {
  run(TSC, ['-p', 'tsconfig.cjs.json'])
} finally {
  rmSync('src/package.json', { force: true })
}

for (const [dir, type] of [
  ['dist/esm', 'module'],
  ['dist/commonjs', 'commonjs']
]) {
  writeFileSync(`${dir}/package.json`, `${JSON.stringify({ type }, null, 2)}\n`)
}

for (const dialect of COPIES) {
  mkdirSync(`dist/${dialect}`, { recursive: true })
  cpSync('dist/esm', `dist/${dialect}`, { recursive: true })
}
