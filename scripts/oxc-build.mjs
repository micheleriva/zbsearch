#!/usr/bin/env node
import { transpile } from './lib/oxc.mjs'

await transpile({ sourcemap: process.argv.includes('--sourcemap') })
