import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const entry = fileURLToPath(new URL('src/index.ts', import.meta.url))
const styles = fileURLToPath(new URL('../searchbox-core/src/styles.css', import.meta.url))
const outDir = fileURLToPath(new URL('dist', import.meta.url))

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'zbsearch-copy-styles',
      closeBundle() {
        copyFileSync(styles, `${outDir}/styles.css`)
      }
    }
  ],
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry,
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs')
    },
    rollupOptions: {
      external: ['vue', '@zbsearch/searchbox-core']
    }
  }
})
