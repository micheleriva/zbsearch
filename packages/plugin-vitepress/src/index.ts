import { buildIndex } from '@zbsearch/docs-index/node'
import type { Plugin, ResolvedConfig } from 'vite'
import { collectRecords, type ContentEntry, withBase } from './collect.js'
import { resolveOptions, type VirtualOptions, type ZBSearchVitePressOptions } from './options.js'

export const INDEX_FILE = 'zbsearch-index.json'

const VIRTUAL_ID = 'virtual:zbsearch-vitepress/options'
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`

interface VitePressGlobalConfig {
  srcDir: string
  site?: { base?: string }
}

async function loadEntries(): Promise<ContentEntry[]> {
  const { createContentLoader } = await import('vitepress')

  return (await createContentLoader('**/*.md', { includeSrc: true }).load()) as unknown as ContentEntry[]
}

/**
 * Makes ZBSearch the search engine of a VitePress site.
 *
 * The index is built from VitePress's own content loader, so routes honour
 * `srcDir`, `cleanUrls` and `base` exactly as the router does.
 */
export default function zbsearchVitePress(userOptions: ZBSearchVitePressOptions = {}): Plugin {
  const runtime = resolveOptions(userOptions)

  let config: ResolvedConfig
  let base = '/'
  let cached: string | undefined

  const buildPayload = async (): Promise<string> => {
    const entries = await loadEntries()
    const records = collectRecords(entries, runtime, base)

    if (records.length === 0) {
      config.logger.warn('[zbsearch] no content was indexed; the search box will stay empty')
    }

    return JSON.stringify(await buildIndex(records, runtime.language))
  }

  return {
    name: 'zbsearch-vitepress',

    configResolved(resolved) {
      config = resolved
      // VitePress resolves its own config before Vite's, so the global is set.
      const site = (globalThis as { VITEPRESS_CONFIG?: VitePressGlobalConfig }).VITEPRESS_CONFIG
      base = site?.site?.base ?? resolved.base ?? '/'
    },

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : undefined
    },

    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) {
        return undefined
      }

      const options: VirtualOptions = { runtime, indexUrl: withBase(`/${INDEX_FILE}`, base) }

      return `export default ${JSON.stringify(options)}`
    },

    configureServer(server) {
      const route = withBase(`/${INDEX_FILE}`, base)

      // Rebuilt on every request: a dev server edit must show up in search
      // without restarting, and the cost is a few milliseconds.
      server.middlewares.use(async (request, response, next) => {
        if (!request.url || request.url.split('?')[0] !== route) {
          next()
          return
        }

        try {
          response.setHeader('content-type', 'application/json;charset=utf-8')
          response.setHeader('cache-control', 'no-store')
          response.end(await buildPayload())
        } catch (error) {
          next(error)
        }
      })
    },

    async buildStart() {
      // Only the client build emits assets; the SSR pass would duplicate it.
      if (config.build.ssr) {
        return
      }

      cached = await buildPayload()
    },

    generateBundle() {
      if (config.build.ssr || cached === undefined) {
        return
      }

      this.emitFile({ type: 'asset', fileName: INDEX_FILE, source: cached })
    }
  }
}

export type { ZBSearchVitePressOptions } from './options.js'
export type { SearchRecord } from '@zbsearch/docs-index'
