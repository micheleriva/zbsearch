import type { SearchRuntimeOptions } from '@zbsearch/docs-index'

export const PLUGIN_NAME = 'zbsearch-docusaurus'

export const GENERATED_DIR = 'zbsearch-index'

export const PAYLOAD_FILE = 'search-index.json'

export interface ZBSearchGlobalData extends SearchRuntimeOptions {
  hasIndex: boolean
  recordCount: number
}
