import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'

const run = (script, env) =>
  execFileSync(process.execPath, [`../../scripts/${script}`], { stdio: 'inherit', env: { ...process.env, ...env } })

run('rolldown-build.mjs')

run('oxc-build.mjs', {
  OXC_SRC: 'src',
  OXC_OUT: 'lib',
  OXC_GLOB: 'theme/**/*.ts,theme/**/*.tsx,client/**/*.ts,client/**/*.tsx,shared/**/*.ts,shared/**/*.tsx',
  OXC_TARGET: 'es2020',
  OXC_SOURCEMAP: '1',
  OXC_CLEAN: '0'
})

for (const css of walk('src/theme', '.css')) {
  const dest = join('lib', relative('src', css))
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(css, dest)
}

function walk(dir, ext) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name)
    return e.isDirectory() ? walk(full, ext) : full.endsWith(ext) ? [full] : []
  })
}
