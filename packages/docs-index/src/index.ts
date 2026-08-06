export {
  DEFAULT_BOOST,
  HIERARCHY_SEPARATOR,
  PAYLOAD_VERSION,
  RECORD_SCHEMA,
  SEARCHABLE_PROPERTIES,
  type SearchBoost,
  type SearchIndexPayload,
  type SearchRecord,
  type SearchRuntimeOptions
} from './records.js'

export {
  assertPayloadVersion,
  createIndexLoader,
  createSearcher,
  hydrateIndex,
  type LoadedIndex,
  type SearcherOptions
} from './client.js'
