import type { AnyZBSearch, ZBSearch, SearchParams } from 'zbsearch'
import { create as createZBSearchDB, insert as insertIntoZBSearchDB, save as saveZBSearchDB } from 'zbsearch'
import type { AstroIntegration } from 'astro'
import { compile } from 'html-to-text'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

interface AstroPage {
  pathname: string
}

const isWindows = process.platform === 'win32'
const joinPath = (isWindows ? path.win32 : path).join

export const defaultSchema = {
  path: 'string',
  title: 'string',
  h1: 'string',
  content: 'string'
} as const

export type PageIndexSchema = typeof defaultSchema

export interface ZBSearchOptions {
  language: string
  /**
   * Controls whether generatedFilePath is filter
   * using case sensitive or case insensitive comparison
   * @default false
   *
   */
  caseSensitive?: boolean
  pathMatcher: RegExp
  contentSelectors?: string[]
  searchOptions?: Omit<SearchParams<AnyZBSearch, any>, 'term'> | undefined
}

const PKG_NAME = '@zbsearch/plugin-astro'

const titleConverter = compile({
  baseElements: { selectors: ['title'] }
})
const h1Converter = compile({
  baseElements: { selectors: ['h1'] }
})

async function prepareZBSearchDb(
  dbConfig: ZBSearchOptions,
  pages: AstroPage[],
  assets: Map<string, (URL | string)[]>,
  dir: URL
): Promise<ZBSearch<PageIndexSchema, any, any, any>> {
  const contentConverter = compile({
    baseElements: {
      selectors: dbConfig.contentSelectors?.length ? dbConfig.contentSelectors : ['body']
    }
  })

  // All routes are in the same folder, we can use the first one to get the basePath
  const basePath = dir.pathname.slice(isWindows ? 1 : 0)
  // Collect all asset file paths from the assets map (values may be URL objects or strings)
  const assetPaths = [...assets.values()].flat().map((p) => (typeof p === 'string' ? p : p.pathname))
  const pathsToBeIndexed = pages
    .filter(({ pathname }) => dbConfig.pathMatcher.test(`/${pathname}`))
    .map(({ pathname }) => {
      // Some pages like 404 are generated as 404.html while others are usually pageName/index.html
      const matchingPath = assetPaths
        .find((p) => p.endsWith(pathname.replace(/\/$/, '') + '.html'))
      return {
        pathname,
        generatedFilePath: matchingPath ?? `${basePath}${pathname.replace(/\/+$/, '')}/index.html`
      }
    })
    .filter(({ generatedFilePath }) => !!generatedFilePath)

  const zbsearchDB = createZBSearchDB({
    schema: defaultSchema,
    ...(dbConfig.language ? { language: dbConfig.language } : undefined)
  })

  for (const { pathname, generatedFilePath } of pathsToBeIndexed) {
    const htmlContent = readFileSync(generatedFilePath, { encoding: 'utf8' })

    const title = titleConverter(htmlContent) ?? ''
    const h1 = h1Converter(htmlContent) ?? ''
    const content = contentConverter(htmlContent)

    insertIntoZBSearchDB(
      zbsearchDB,
      {
        path: `/${pathname}`,
        title,
        h1,
        content
      },
      dbConfig.language
    )
  }

  return zbsearchDB
}

export function createPlugin(options: Record<string, ZBSearchOptions>): AstroIntegration {
  return {
    name: PKG_NAME,
    hooks: {
      'astro:build:done': async function ({ pages, assets, dir }): Promise<void> {
        const assetsDir = joinPath(dir.pathname, 'assets').slice(isWindows ? 1 : 0)
        if (!existsSync(assetsDir)) {
          mkdirSync(assetsDir)
        }

        for (const [dbName, dbConfig] of Object.entries(options)) {
          const namedDb = await prepareZBSearchDb(dbConfig, pages, assets, dir)

          writeFileSync(joinPath(assetsDir, `zbsearchDB_${dbName}.json`), JSON.stringify(saveZBSearchDB(namedDb)), {
            encoding: 'utf8'
          })
        }
      }
    }
  }
}

export default createPlugin
