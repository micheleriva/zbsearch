import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SearchIndexPayload } from '@zbsearch/docs-index'
import { GENERATED_DIR, PAYLOAD_FILE } from '../shared/index.js'

export async function writePayload(generatedFilesDir: string, payload: SearchIndexPayload): Promise<string> {
  const directory = path.join(generatedFilesDir, GENERATED_DIR)
  const file = path.join(directory, PAYLOAD_FILE)

  await mkdir(directory, { recursive: true })
  await writeFile(file, JSON.stringify(payload), 'utf8')

  return file
}
