import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function loadEngineFromPackageRoot(packageRoot) {
  const root = resolve(packageRoot)
  const pkgPath = join(root, 'package.json')
  if (!existsSync(pkgPath)) {
    throw new Error(`Package not found at ${root}`)
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const require = createRequire(pkgPath)

  let lib

  try {
    lib = require(root)
  } catch {
    const cjs = join(root, 'dist', 'commonjs', 'index.js')
    if (!existsSync(cjs)) {
      throw new Error(`Could not load engine from ${root} (missing dist/commonjs)`)
    }
    lib = require(cjs)
  }

  const entryForBundle = (() => {
    const esm = join(root, 'dist', 'esm', 'index.js')
    if (existsSync(esm)) return esm
    const cjs = join(root, 'dist', 'commonjs', 'index.js')
    if (existsSync(cjs)) return cjs
    return root
  })()

  return {
    name: pkg.name,
    version: pkg.version,
    root,
    lib,
    entry: entryForBundle
  }
}

export function shortSha(sha) {
  if (!sha) return 'unknown'
  return sha.slice(0, 7)
}

export function resolveRepoPackage(repoRoot, packageName = 'zbsearch') {
  return join(repoRoot, 'packages', packageName)
}

export function thisRepoRootFromBenchmarks() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
}
