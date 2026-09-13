import { buildStaticIndex } from '@zbsearch/static'
import { buildIndex } from './build.js'
import {
  PAYLOAD_VERSION,
  RECORD_SCHEMA,
  isShardedPayload,
  type InlineIndexPayload,
  type SearchIndexPayload,
  type SearchRecord
} from './records.js'

/**
 * Inline payloads up to this JSON size ship as a single file — one request
 * beats the sharded protocol's extra round trips on small sites. Above it,
 * the index is sharded so the browser only fetches what each query needs.
 */
export const DEFAULT_INLINE_LIMIT_BYTES = 256 * 1024

export interface AutoIndexOptions {
  /** Public URL prefix the sharded artifacts are served from, e.g. "/zbsearch-static/". */
  baseUrl: string
  inlineLimitBytes?: number
}

export interface AutoIndexResult {
  payload: SearchIndexPayload
  payloadJson: string
  /** Present only in sharded mode: artifacts to write next to the payload, keyed by relative path. */
  staticFiles?: Map<string, Uint8Array>
}

async function shardRecords(
  records: SearchRecord[],
  language: string,
  options: AutoIndexOptions
): Promise<AutoIndexResult> {
  const fileSet = await buildStaticIndex({
    records: records as unknown as Array<Record<string, unknown>>,
    schema: { ...RECORD_SCHEMA },
    language
  })

  const payload: SearchIndexPayload = {
    version: PAYLOAD_VERSION,
    language,
    recordCount: records.length,
    mode: 'sharded',
    baseUrl: options.baseUrl
  }

  return { payload, payloadJson: JSON.stringify(payload), staticFiles: fileSet.files }
}

/**
 * Builds the search index in whichever mode fits the content size: a single
 * inline payload below the limit, a sharded file set above it.
 */
export async function buildIndexAuto(
  records: SearchRecord[],
  language: string,
  options: AutoIndexOptions
): Promise<AutoIndexResult> {
  const inline = await buildIndex(records, language)
  const payloadJson = JSON.stringify(inline)

  if (payloadJson.length <= (options.inlineLimitBytes ?? DEFAULT_INLINE_LIMIT_BYTES)) {
    return { payload: inline, payloadJson }
  }

  return shardRecords(records, language, options)
}

/**
 * Post-build variant of {@link buildIndexAuto} for integrations that only see
 * the already-serialized inline payload (e.g. a prerendered route in the build
 * output). The original records ride inside the payload's documents store.
 */
export async function shardBuiltPayload(payloadJson: string, options: AutoIndexOptions): Promise<AutoIndexResult> {
  const payload = JSON.parse(payloadJson) as SearchIndexPayload

  if (isShardedPayload(payload) || payloadJson.length <= (options.inlineLimitBytes ?? DEFAULT_INLINE_LIMIT_BYTES)) {
    return { payload, payloadJson }
  }

  const docs = ((payload as InlineIndexPayload).index as { docs: { docs: Record<string, SearchRecord> } }).docs.docs
  const records = Object.keys(docs)
    .map(Number)
    .sort((a, b) => a - b)
    .map((internalId) => docs[internalId])

  return shardRecords(records, payload.language, options)
}
