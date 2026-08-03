import { buildIndex } from '@zbsearch/docs-index/node'
import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'
import options from 'virtual:zbsearch-starlight/options'
import { collectRecords, type DocsEntry } from './collect.js'

export const prerender = true

export const GET: APIRoute = async () => {
  const entries = (await getCollection('docs')) as unknown as DocsEntry[]
  const records = collectRecords(entries, options.runtime, options.route)
  const payload = await buildIndex(records, options.runtime.language)

  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json;charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate'
    }
  })
}
