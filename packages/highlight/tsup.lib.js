import { defineConfig } from 'tsup'

const entry = new URL('src/index.ts', import.meta.url).pathname
const outDir = new URL('dist', import.meta.url).pathname

export default defineConfig({
  entry: [entry],
  outDir,
  format: ['cjs', 'esm'],
  splitting: false,
  sourcemap: true,
  minify: false,
  dts: false,
  clean: true,
  bundle: true
})
