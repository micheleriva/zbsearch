#!/usr/bin/env node
import { copyFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const { build } = createRequire(`${process.cwd()}/`)('rolldown')

const cfg = JSON.parse(readFileSync('rolldown.lib.json', 'utf8'))
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const bundled = (cfg.noExternal ?? []).map((src) => new RegExp(src))
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...(cfg.external ?? [])
]
  .filter((name) => !bundled.some((re) => re.test(name)))
  .map((name) => new RegExp(`^${esc(name)}(/|$)`))

const outDir = cfg.outDir ?? 'dist'

const groups = cfg.splitting
  ? [cfg.entry]
  : Object.entries(cfg.entry).map(([name, input]) => ({ [name]: input }))

for (const [format, ext] of Object.entries(cfg.formats)) {
  for (const entry of groups) {
    await build({
      input: entry,
      external,
      platform: cfg.platform ?? 'node',
      ...(cfg.target ? { transform: { target: cfg.target } } : {}),
      output: {
        dir: outDir,
        format,
        entryFileNames: `[name]${ext}`,
        chunkFileNames: `[name]${ext}`,
        sourcemap: cfg.sourcemap ?? true,
        minify: cfg.minify ?? false,
        ...(cfg.name ? { name: cfg.name } : {})
      }
    })
  }
}

for (const [from, to] of cfg.copy ?? []) copyFileSync(from, to)

console.log(`rolldown: ${Object.keys(cfg.entry).join(', ')} -> ${outDir} [${Object.keys(cfg.formats).join(', ')}]`)
