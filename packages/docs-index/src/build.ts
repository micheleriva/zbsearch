import { create, insertMultiple, save } from 'zbsearch'
import { PAYLOAD_VERSION, RECORD_SCHEMA, type InlineIndexPayload, type SearchRecord } from './records.js'

export async function buildIndex(records: SearchRecord[], language: string): Promise<InlineIndexPayload> {
  const db = create({ schema: RECORD_SCHEMA, language, inferSchema: false, sort: { enabled: false } })

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
