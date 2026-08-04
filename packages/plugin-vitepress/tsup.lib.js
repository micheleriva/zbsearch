import { defineConfig } from 'tsup'

const entry = new URL('src/index.ts', import.meta.url).pathname
const outDir = new URL('dist', import.meta.url).pathname

/**
 * Only the Node half is compiled. VitePress loads `.vitepress/config` through
 * Node's ESM loader, which cannot resolve the `.js` specifiers of a TypeScript
 * source tree; the theme half stays as source because Vite compiles that.
 */
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
  external: ['vitepress', 'vite'],
  shims: true
})
