import { defineConfig } from 'tsup'

const entry = new URL('src/index.ts', import.meta.url).pathname
const outDir = new URL('lib', import.meta.url).pathname

export default defineConfig({
  entry: [entry],
  outDir,
  format: ['esm', 'cjs'],
  platform: 'node',
  target: 'node20',
  splitting: false,
  sourcemap: true,
  minify: false,
  dts: false,
  clean: true,
  bundle: true,
  noExternal: ['github-slugger'],
  shims: true
})
