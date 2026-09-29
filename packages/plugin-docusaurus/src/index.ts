import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LoadContext, Plugin } from '@docusaurus/types'
import { STATIC_DIR } from '@zbsearch/docs-index'
import { buildIndex, buildIndexAuto } from '@zbsearch/docs-index/node'
import { GENERATED_DIR, PLUGIN_NAME, type ZBSearchGlobalData } from './shared/index.js'
import { writePayload } from './node/build-index.js'
import { type AllContent, collectRecords } from './node/collect.js'
import { resolveOptions, type ZBSearchDocusaurusOptions } from './node/options.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

async function writeStaticFiles(root: string, files: Map<string, Uint8Array>): Promise<void> {
  for (const [file, bytes] of files) {
    const target = path.join(root, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
}

export default function zbsearchDocusaurus(
  context: LoadContext,
  options: ZBSearchDocusaurusOptions = {}
): Plugin<void> {
  const resolved = resolveOptions(options)

  // Sharded artifacts are staged here, next to the payload. `postBuild` copies
  // them into the site output; the dev server serves them straight from here.
  const generatedStaticRoot = path.join(context.generatedFilesDir, GENERATED_DIR, STATIC_DIR)
  const shardingEnabled = process.env.NODE_ENV === 'production'

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

      // Production builds shard once the payload outgrows the limit. The dev
      // server keeps the inline payload, which is bundled as a JSON module and
      // rebuilt on every content change, so sharding there would be wasted
      // work. `docusaurus build` forces NODE_ENV=production; a dev server
      // started with it set still works because `configureWebpack` serves the
      // staged shard files.
      if (shardingEnabled) {
        const auto = await buildIndexAuto(records, resolved.language, {
          baseUrl: `${context.baseUrl}${STATIC_DIR}/`,
          inlineLimitBytes: options.inlineLimitBytes
        })
        staticFiles = auto.staticFiles
        await writePayload(context.generatedFilesDir, auto.payload)
        await mkdir(generatedStaticRoot, { recursive: true })
        if (staticFiles) {
          await writeStaticFiles(generatedStaticRoot, staticFiles)
        }
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

    configureWebpack(_config, isServer) {
      if (isServer || !shardingEnabled) {
        return undefined
      }

      // Only `docusaurus start` reads `devServer`; the entry lets a sharded
      // payload fetch its manifest, dictionary, shards and fragments from the
      // staged files instead of failing on a route no server provides.
      return {
        devServer: {
          static: [{ directory: generatedStaticRoot, publicPath: `${context.baseUrl}${STATIC_DIR}` }]
        }
      } as ReturnType<NonNullable<Plugin<void>['configureWebpack']>>
    },

    async postBuild({ outDir }) {
      if (!staticFiles) {
        return
      }

      await writeStaticFiles(path.join(outDir, STATIC_DIR), staticFiles)

      console.log(`[${PLUGIN_NAME}] sharded search index: ${staticFiles.size} files under ${context.baseUrl}${STATIC_DIR}/`)
    }
  }
}

export type { ZBSearchDocusaurusOptions } from './node/options.js'
export type { SearchRecord } from '@zbsearch/docs-index'
export type { ZBSearchGlobalData } from './shared/index.js'
