import { copyFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const entry = new URL('src/index.ts', import.meta.url).pathname
const outDir = new URL('dist', import.meta.url).pathname
const styles = new URL('src/styles.css', import.meta.url).pathname

export default defineConfig({
  entry: [entry],
  splitting: false,
  sourcemap: true,
  minify: false,
  format: ['cjs', 'esm'],
  dts: false,
  clean: true,
  bundle: true,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  outDir,
  onSuccess: async () => {
    copyFileSync(styles, `${outDir}/styles.css`)
  }
})
