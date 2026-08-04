import react from '@astrojs/react'
import type { StarlightPlugin } from '@astrojs/starlight/types'
import type { AstroIntegration } from 'astro'
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

        const integration: AstroIntegration = {
          name: '@zbsearch/plugin-starlight',
          hooks: {
            'astro:config:setup': ({ config: resolvedConfig, injectRoute, updateConfig: updateAstroConfig }) => {
              const options: VirtualOptions = {
                runtime,
                route: {
                  base: resolvedConfig.base ?? '/',
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
            'astro:build:done': ({ logger: buildLogger }) => {
              buildLogger.info(`search index available at ${INDEX_ROUTE}`)
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
