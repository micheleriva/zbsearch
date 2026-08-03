import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsup'

const root = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(root, 'src')
const outDir = path.join(root, 'lib')

function walk(dir, extensions) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      return walk(full, extensions)
    }

    return extensions.includes(path.extname(entry.name)) ? [full] : []
  })
}

const sources = ['theme', 'client', 'shared'].flatMap((dir) => walk(path.join(srcDir, dir), ['.ts', '.tsx']))

export default defineConfig({
  entry: sources,
  outDir,
  format: ['esm'],
  platform: 'browser',
  target: 'es2020',
  bundle: false,
  splitting: false,
  sourcemap: true,
  minify: false,
  dts: false,
  clean: false,
  onSuccess: async () => {
    for (const stylesheet of walk(path.join(srcDir, 'theme'), ['.css'])) {
      const destination = path.join(outDir, path.relative(srcDir, stylesheet))
      mkdirSync(path.dirname(destination), { recursive: true })
      copyFileSync(stylesheet, destination)
    }
  }
})
