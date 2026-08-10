#!/usr/bin/env node
import { rmSync } from 'node:fs'
import { transpile } from './lib/oxc.mjs'
import { tsc } from './lib/tsc.mjs'

rmSync('dist', { recursive: true, force: true })

await transpile({ out: 'dist', target: 'esnext', sourcemap: true, clean: false })

tsc('-p', 'tsconfig.json', '--emitDeclarationOnly')
tsc('-p', 'tsconfig.cjs.json')
