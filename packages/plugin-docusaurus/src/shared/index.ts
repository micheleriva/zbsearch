import type { RawData } from 'zbsearch'

export const PAYLOAD_VERSION = 2

export const PLUGIN_NAME = 'zbsearch-docusaurus'

export const GENERATED_DIR = 'zbsearch-index'

export const PAYLOAD_FILE = 'search-index.json'

export const HIERARCHY_SEPARATOR = ' › '

export interface SearchRecord {
  title: string
  section: string
  hierarchy: string
  content: string
  url: string
  category: string
  path: string
}

export const RECORD_SCHEMA = {
  title: 'string',
  section: 'string',
  hierarchy: 'string',
  content: 'string'
} as const

export interface SearchBoost {
  title: number
  section: number
  hierarchy: number
  content: number
}

export const DEFAULT_BOOST: SearchBoost = {
  title: 4,
  section: 3,
  hierarchy: 1.5,
  content: 1
}

export interface SearchRuntimeOptions {
  maxResults: number
  boost: SearchBoost
  tolerance: number
  threshold: number
  snippetLength: number
  recentSearches: boolean
  hotkeys: boolean
  searchButtonLabel: string
  labels: Record<string, string>
}

export interface ZBSearchGlobalData extends SearchRuntimeOptions {
  hasIndex: boolean
  recordCount: number
}

export interface SearchIndexPayload {
  version: number
  language: string
  recordCount: number
  index: RawData
}
