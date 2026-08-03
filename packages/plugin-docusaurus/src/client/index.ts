import { createIndexLoader, type SearchIndexPayload } from '@zbsearch/docs-index'

export { createSearcher, type LoadedIndex, type SearcherOptions } from '@zbsearch/docs-index'

async function importPayload(): Promise<SearchIndexPayload> {
  const imported = await import('@generated/zbsearch-index/search-index.json')

  return ((imported as { default?: SearchIndexPayload }).default ?? imported) as unknown as SearchIndexPayload
}

export function createDocusaurusIndexLoader() {
  return createIndexLoader(importPayload)
}
