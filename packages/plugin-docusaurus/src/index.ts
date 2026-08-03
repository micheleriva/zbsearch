import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LoadContext, Plugin } from '@docusaurus/types'
import { PLUGIN_NAME, type ZBSearchGlobalData } from './shared/index.js'
import { buildIndex, writePayload } from './node/build-index.js'
import { type AllContent, collectRecords } from './node/collect.js'
import { resolveOptions, type ZBSearchDocusaurusOptions } from './node/options.js'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

export default function zbsearchDocusaurus(
  context: LoadContext,
  options: ZBSearchDocusaurusOptions = {}
): Plugin<void> {
  const resolved = resolveOptions(options)

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

      const payload = await buildIndex(records, resolved.language)

      await writePayload(context.generatedFilesDir, payload)

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
    }
  }
}

export type { ZBSearchDocusaurusOptions } from './node/options.js'
export type { SearchRecord, ZBSearchGlobalData } from './shared/index.js'
