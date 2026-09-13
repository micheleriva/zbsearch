import { mkdir, rm, writeFile } from 'node:fs/promises'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { buildStaticIndex } from '@zbsearch/static'
import * as pagefind from 'pagefind'
import esbuild from 'esbuild'

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function dirBytes(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { recursive: true })) {
    const full = path.join(dir, String(entry))
    const stat = statSync(full)
    if (stat.isFile()) total += stat.size
  }
  return total
}

/** Builds the ZBSearch sharded static index under www/zb/. */
export async function buildZb(records, wwwDir) {
  const outDir = path.join(wwwDir, 'zb')
  await rm(outDir, { recursive: true, force: true })

  const t0 = performance.now()
  const { files, stats } = await buildStaticIndex({
    records,
    schema: { title: 'string', content: 'string' },
    language: 'english'
  })
  const buildMs = performance.now() - t0

  for (const [file, bytes] of files) {
    const target = path.join(outDir, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }

  return { buildMs, bundleBytes: dirBytes(outDir), stats }
}

/**
 * Builds the Pagefind index under www/pagefind/ from synthesized HTML pages,
 * so Pagefind applies its own element weighting (h1 etc.) exactly as it would
 * on a real site.
 */
export async function buildPagefind(records, wwwDir) {
  const outDir = path.join(wwwDir, 'pagefind')
  await rm(outDir, { recursive: true, force: true })

  const t0 = performance.now()
  const { index, errors } = await pagefind.createIndex()
  if (errors?.length) throw new Error(`pagefind createIndex: ${errors.join(', ')}`)

  for (const record of records) {
    const { errors: addErrors } = await index.addHTMLFile({
      url: record.url,
      content: `<!DOCTYPE html><html lang="en"><head><title>${escapeHtml(record.title)}</title></head><body><h1>${escapeHtml(record.title)}</h1><p>${escapeHtml(record.content)}</p></body></html>`
    })
    if (addErrors?.length) throw new Error(`pagefind addHTMLFile: ${addErrors.join(', ')}`)
  }

  const { errors: writeErrors } = await index.writeFiles({ outputPath: outDir })
  if (writeErrors?.length) throw new Error(`pagefind writeFiles: ${writeErrors.join(', ')}`)
  const buildMs = performance.now() - t0

  await pagefind.close()

  return { buildMs, bundleBytes: dirBytes(outDir) }
}

/** Bundles the ZBSearch browser client (engine included) to www/zb-client.js. */
export async function buildZbClient(wwwDir) {
  const result = await esbuild.build({
    stdin: {
      contents: `import { createStaticSearchClient } from '@zbsearch/static'\nwindow.__zb = { createStaticSearchClient }`,
      resolveDir: path.dirname(new URL(import.meta.url).pathname)
    },
    bundle: true,
    minify: true,
    format: 'iife',
    write: false,
    logLevel: 'silent'
  })

  const bytes = result.outputFiles[0].contents
  await writeFile(path.join(wwwDir, 'zb-client.js'), bytes)
  return { clientBytes: bytes.length }
}

export async function writeDrivers(wwwDir) {
  await writeFile(
    path.join(wwwDir, 'zbsearch.html'),
    `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<script src="/zb-client.js"></script>
<script>
window.bench = (() => {
  let client
  return {
    async init() {
      client = window.__zb.createStaticSearchClient({ baseUrl: '/zb/' })
      await client.preload()
    },
    async query(term) {
      const t0 = performance.now()
      const results = await client.search({ term, limit: 5, tolerance: 1, threshold: 0, boost: { title: 4, content: 1 } })
      const ms = performance.now() - t0
      return { ms, urls: results.hits.map((hit) => hit.document.url) }
    }
  }
})()
</script></body></html>`
  )

  await writeFile(
    path.join(wwwDir, 'pagefind.html'),
    `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<script type="module">
window.bench = (() => {
  let pf
  return {
    async init() {
      pf = await import('/pagefind/pagefind.js')
      await pf.init()
    },
    async query(term) {
      const t0 = performance.now()
      const search = await pf.search(term)
      const top = await Promise.all(search.results.slice(0, 5).map((r) => r.data()))
      const ms = performance.now() - t0
      return { ms, urls: top.map((d) => d.url) }
    }
  }
})()
</script></body></html>`
  )
}
