import { copyFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const entry = new URL('src/index.ts', import.meta.url).pathname
const outDir = new URL('dist', import.meta.url).pathname
const styles = new URL('src/styles.css', import.meta.url).pathname

export default defineConfig({
  entry: [entry],
  outDir,
  format: ['esm', 'cjs'],
  splitting: false,
  sourcemap: true,
  minify: false,
  dts: false,
  clean: true,
  bundle: true,
  onSuccess: async () => {
    copyFileSync(styles, `${outDir}/styles.css`)
  }
})
