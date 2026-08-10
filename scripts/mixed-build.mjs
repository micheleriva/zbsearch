#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const run = (cmd, args, env) => execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } })
const TSC = '../../node_modules/.bin/tsc'

rmSync('dist', { recursive: true, force: true })

run(process.execPath, ['../../scripts/oxc-build.mjs'], {
  OXC_SRC: 'src',
  OXC_OUT: 'dist',
  OXC_TARGET: process.env.MIXED_ESM_TARGET ?? 'esnext',
  OXC_SOURCEMAP: '1'
})

run(TSC, ['-p', 'tsconfig.json', '--emitDeclarationOnly'])
run(TSC, ['-p', 'tsconfig.cjs.json'])
