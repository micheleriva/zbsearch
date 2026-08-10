import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { glob } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, relative } from 'node:path'

export async function transpile({
  src = 'src',
  out = 'dist',
  target = 'es2022',
  patterns = ['**/*.ts'],
  sourcemap = false,
  clean = true
} = {}) {
  const { transformSync } = createRequire(`${process.cwd()}/`)('oxc-transform')

  if (clean) rmSync(out, { recursive: true, force: true })

  const files = []

  for (const pattern of patterns) {
    for await (const file of glob(join(src, pattern))) files.push(file)
  }

  files.sort()

  const failures = []

  for (const file of files) {
    const result = transformSync(file, readFileSync(file, 'utf8'), { target, sourcemap })

    if (result.errors.length > 0) {
      failures.push([file, result.errors])
      continue
    }

    const dest = join(out, relative(src, file).replace(/\.tsx?$/, '.js'))
    mkdirSync(dirname(dest), { recursive: true })

    if (sourcemap && result.map) {
      writeFileSync(dest, `${result.code}\n//# sourceMappingURL=${basename(dest)}.map\n`)
      writeFileSync(`${dest}.map`, JSON.stringify(result.map))
    } else {
      writeFileSync(dest, result.code)
    }
  }

  if (failures.length > 0) {
    for (const [file, errors] of failures) {
      console.error(file)
      for (const error of errors) console.error(`  ${error.message ?? error}`)
    }
    throw new Error(`oxc: ${failures.length} file(s) failed to transform`)
  }

  console.log(`oxc: ${files.length} file(s) -> ${out}`)
}
