import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { create, insertMultiple, save } from 'zbsearch'

import {
  GENERATED_DIR,
  PAYLOAD_FILE,
  PAYLOAD_VERSION,
  RECORD_SCHEMA,
  type SearchIndexPayload,
  type SearchRecord
} from '../shared/index.js'

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

export async function writePayload(generatedFilesDir: string, payload: SearchIndexPayload): Promise<string> {
  const directory = path.join(generatedFilesDir, GENERATED_DIR)
  const file = path.join(directory, PAYLOAD_FILE)
  await mkdir(directory, { recursive: true })
  await writeFile(file, JSON.stringify(payload), 'utf8')

  return file
}
