import { defineConfig } from 'tsup'

const root = new URL('src/', import.meta.url).pathname
const outDir = new URL('dist', import.meta.url).pathname

export default defineConfig({
  entry: [`${root}index.ts`, `${root}node.ts`],
  outDir,
  format: ['esm', 'cjs'],
  splitting: false,
  sourcemap: true,
  minify: false,
  dts: false,
  clean: true,
  bundle: true,
  noExternal: ['github-slugger']
})
