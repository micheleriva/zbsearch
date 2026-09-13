import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@astrojs/react'
import type { StarlightPlugin } from '@astrojs/starlight/types'
import type { AstroIntegration } from 'astro'
import { STATIC_DIR } from '@zbsearch/docs-index'
import { shardBuiltPayload } from '@zbsearch/docs-index/node'
import { resolveOptions, type VirtualOptions, type ZBSearchStarlightOptions } from './options.js'

export const INDEX_ROUTE = '/zbsearch-index.json'

const VIRTUAL_ID = 'virtual:zbsearch-starlight/options'
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`

function virtualOptionsPlugin(options: VirtualOptions) {
  return {
    name: 'zbsearch-starlight-options',
    resolveId(id: string) {
      return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : undefined
    },
    load(id: string) {
      return id === RESOLVED_VIRTUAL_ID ? `export default ${JSON.stringify(options)}` : undefined
    }
  }
}

export default function zbsearchStarlight(userOptions: ZBSearchStarlightOptions = {}): StarlightPlugin {
  const runtime = resolveOptions(userOptions)

  return {
    name: '@zbsearch/plugin-starlight',
    hooks: {
      'config:setup'({ config, updateConfig, addIntegration, astroConfig, logger }) {
        updateConfig({
          pagefind: false,
          components: {
            ...config.components,
            Search: '@zbsearch/plugin-starlight/Search.astro'
          }
        })

        if (!astroConfig.integrations.some((integration) => integration.name === '@astrojs/react')) {
          addIntegration(react())
        }

        let base = '/'

        const integration: AstroIntegration = {
          name: '@zbsearch/plugin-starlight',
          hooks: {
            'astro:config:setup': ({ config: resolvedConfig, injectRoute, updateConfig: updateAstroConfig }) => {
              base = resolvedConfig.base ?? '/'

              const options: VirtualOptions = {
                runtime,
                route: {
                  base,
                  format: resolvedConfig.build?.format ?? 'directory',
                  trailingSlash: resolvedConfig.trailingSlash ?? 'ignore'
                }
              }

              updateAstroConfig({ vite: { plugins: [virtualOptionsPlugin(options)] } })

              injectRoute({
                pattern: INDEX_ROUTE,
                entrypoint: '@zbsearch/plugin-starlight/endpoint',
                prerender: true
              })
            },
            'astro:build:done': async ({ dir, logger: buildLogger }) => {
              // Large sites switch to the sharded index: the prerendered
              // payload is replaced by a sentinel, and the file set is
              // written next to it. Small sites keep the single-file payload.
              const distDir = fileURLToPath(dir)
              const indexPath = path.join(distDir, INDEX_ROUTE.replace(/^\//, ''))

              const payloadJson = await readFile(indexPath, 'utf8').catch(() => undefined)
              if (payloadJson === undefined) {
                buildLogger.warn(`could not read ${INDEX_ROUTE}; leaving the search index as built`)
                return
              }

              const baseUrl = `${base.replace(/\/+$/, '')}/${STATIC_DIR}/`
              const result = await shardBuiltPayload(payloadJson, {
                baseUrl,
                inlineLimitBytes: userOptions.inlineLimitBytes
              })

              if (!result.staticFiles) {
                buildLogger.info(`search index available at ${INDEX_ROUTE}`)
                return
              }

              const staticRoot = path.join(distDir, STATIC_DIR)
              for (const [file, bytes] of result.staticFiles) {
                const target = path.join(staticRoot, file)
                await mkdir(path.dirname(target), { recursive: true })
                await writeFile(target, bytes)
              }
              await writeFile(indexPath, result.payloadJson, 'utf8')

              buildLogger.info(
                `sharded search index: ${result.staticFiles.size} files under ${baseUrl} (payload sentinel at ${INDEX_ROUTE})`
              )
            }
          }
        }

        addIntegration(integration)

        logger.info('ZBSearch is handling search; Pagefind has been disabled.')
      }
    }
  }
}

export type { ZBSearchStarlightOptions } from './options.js'
export type { SearchRecord } from '@zbsearch/docs-index'
