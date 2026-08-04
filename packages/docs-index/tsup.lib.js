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
  noExternal: [
    'github-slugger',
    /^mdast-util-/,
    /^micromark/,
    /^unist-util-/,
    /^ccount$/,
    /^devlop$/,
    /^escape-string-regexp$/,
    /^longest-streak$/,
    /^markdown-table$/,
    /^parse-entities$/,
    /^character-entities/,
    /^decode-named-character-reference$/,
    /^stringify-entities$/,
    /^zwitch$/,
    /^trim-lines$/,
    /^vfile-message$/,
    /^unist-util-stringify-position$/
  ]
})
