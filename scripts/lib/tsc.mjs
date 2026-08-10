import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BIN = join(ROOT, 'node_modules', '.bin', 'tsc')

export function tsc(...args) {
  execFileSync(BIN, args, { stdio: 'inherit' })
}

export function declarationConfig() {
  return existsSync('tsconfig.build.json') ? 'tsconfig.build.json' : 'tsconfig.json'
}
