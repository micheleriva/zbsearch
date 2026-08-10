import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function externals(config, pkg) {
  const bundled = (config.noExternal ?? []).map((source) => new RegExp(source))
  const declared = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...(config.external ?? [])
  ]

  return declared
    .filter((name) => !bundled.some((pattern) => pattern.test(name)))
    .map((name) => new RegExp(`^${escape(name)}(/|$)`))
}

function downlevel(config, outDir) {
  const { transformSync } = createRequire(`${process.cwd()}/`)('@swc/core')

  for (const ext of Object.values(config.formats)) {
    for (const name of Object.keys(config.entry)) {
      const file = `${outDir}/${name}${ext}`
      const { code } = transformSync(readFileSync(file, 'utf8'), {
        filename: file,
        jsc: { target: config.downlevel, parser: { syntax: 'ecmascript' } },
        minify: Boolean(config.minify),
        sourceMaps: false
      })
      writeFileSync(file, code)
    }
  }
}

export async function bundle(config) {
  const { build } = createRequire(`${process.cwd()}/`)('rolldown')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const outDir = config.outDir ?? 'dist'
  const external = externals(config, pkg)

  const groups = config.splitting
    ? [config.entry]
    : Object.entries(config.entry).map(([name, input]) => ({ [name]: input }))

  for (const [format, ext] of Object.entries(config.formats)) {
    for (const entry of groups) {
      await build({
        input: entry,
        external,
        platform: config.platform ?? 'node',
        ...(config.target ? { transform: { target: config.target } } : {}),
        output: {
          dir: outDir,
          format,
          entryFileNames: `[name]${ext}`,
          chunkFileNames: `[name]${ext}`,
          sourcemap: config.sourcemap ?? true,
          minify: config.minify ?? false,
          ...(config.name ? { name: config.name } : {})
        }
      })
    }
  }

  if (config.downlevel) downlevel(config, outDir)

  for (const [from, to] of config.copy ?? []) copyFileSync(from, to)

  const entries = Object.keys(config.entry).join(', ')
  const formats = Object.keys(config.formats).join(', ')
  console.log(`rolldown: ${entries} -> ${outDir} [${formats}]`)
}

export function readConfig(file = 'rolldown.lib.json') {
  return JSON.parse(readFileSync(file, 'utf8'))
}
