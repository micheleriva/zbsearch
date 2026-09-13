import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LoadContext, Plugin } from '@docusaurus/types'
import { STATIC_DIR } from '@zbsearch/docs-index'
import { buildIndex, buildIndexAuto } from '@zbsearch/docs-index/node'
import { PLUGIN_NAME, type ZBSearchGlobalData } from './shared/index.js'
import { writePayload } from './node/build-index.js'
import { type AllContent, collectRecords } from './node/collect.js'
import { resolveOptions, type ZBSearchDocusaurusOptions } from './node/options.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

export default function zbsearchDocusaurus(
  context: LoadContext,
  options: ZBSearchDocusaurusOptions = {}
): Plugin<void> {
  const resolved = resolveOptions(options)

  let staticFiles: Map<string, Uint8Array> | undefined

  return {
    name: PLUGIN_NAME,

    getThemePath() {
      return path.join(currentDir, 'theme')
    },

    getTypeScriptThemePath() {
      return path.resolve(currentDir, '..', 'src', 'theme')
    },
    async allContentLoaded({ allContent, actions }) {
      const { records, failures } = await collectRecords(allContent as unknown as AllContent, context.siteDir, resolved)
      for (const failure of failures) {
        console.warn(`[${PLUGIN_NAME}] skipped ${failure.file}: ${failure.reason}`)
      }

      // The dev server always uses the inline payload (it is bundled as a
      // JSON module and there is no static file server for shards there);
      // production builds shard once the payload outgrows the limit.
      if (process.env.NODE_ENV === 'production') {
        const auto = await buildIndexAuto(records, resolved.language, {
          baseUrl: `${context.baseUrl}${STATIC_DIR}/`,
          inlineLimitBytes: options.inlineLimitBytes
        })
        staticFiles = auto.staticFiles
        await writePayload(context.generatedFilesDir, auto.payload)
      } else {
        staticFiles = undefined
        await writePayload(context.generatedFilesDir, await buildIndex(records, resolved.language))
      }

      if (records.length === 0) {
        console.warn(`[${PLUGIN_NAME}] no content was indexed; the search box will stay empty`)
      }

      const globalData: ZBSearchGlobalData = {
        hasIndex: records.length > 0,
        recordCount: records.length,
        maxResults: resolved.maxResults,
        boost: resolved.boost,
        tolerance: resolved.tolerance,
        threshold: resolved.threshold,
        snippetLength: resolved.snippetLength,
        recentSearches: resolved.recentSearches,
        hotkeys: resolved.hotkeys,
        searchButtonLabel: resolved.searchButtonLabel,
        labels: resolved.labels
      }

      actions.setGlobalData(globalData)
    },

    async postBuild({ outDir }) {
      if (!staticFiles) {
        return
      }

      const staticRoot = path.join(outDir, STATIC_DIR)
      for (const [file, bytes] of staticFiles) {
        const target = path.join(staticRoot, file)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, bytes)
      }

      console.log(`[${PLUGIN_NAME}] sharded search index: ${staticFiles.size} files under ${context.baseUrl}${STATIC_DIR}/`)
    }
  }
}

export type { ZBSearchDocusaurusOptions } from './node/options.js'
export type { SearchRecord } from '@zbsearch/docs-index'
export type { ZBSearchGlobalData } from './shared/index.js'
