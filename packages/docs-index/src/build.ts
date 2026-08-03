import { create, insertMultiple, save } from 'zbsearch'
import { PAYLOAD_VERSION, RECORD_SCHEMA, type SearchIndexPayload, type SearchRecord } from './records.js'

export async function buildIndex(records: SearchRecord[], language: string): Promise<SearchIndexPayload> {
  const db = create({ schema: RECORD_SCHEMA, language, inferSchema: false })

  if (records.length > 0) {
    await insertMultiple(db, records)
  }

  return {
    version: PAYLOAD_VERSION,
    language,
    recordCount: records.length,
    index: save(db)
  }
}
