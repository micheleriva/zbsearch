import { readFile } from 'node:fs/promises'
import type { ImportDocument } from '@zbsearch/edge-core'

export function slugifyDocId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function assignDocIds(
  records: Record<string, unknown>[],
  options: { idField?: string; nameField?: string } = {}
): ImportDocument[] {
  const idField = options.idField ?? 'id'
  const nameField = options.nameField ?? 'company_name'
  const seen = new Map<string, number>()
  const documents: ImportDocument[] = []

  for (const record of records) {
    let docId: string
    const explicitId = record[idField]
    if (explicitId != null && String(explicitId).length > 0) {
      docId = String(explicitId)
    } else {
      const baseName = String(record[nameField] ?? 'document')
      const base = slugifyDocId(baseName) || 'document'
      const count = seen.get(base) ?? 0
      seen.set(base, count + 1)
      docId = count === 0 ? base : `${base}-${count + 1}`
    }
    documents.push({ id: docId, doc: record })
  }

  return documents
}

export async function loadImportDocuments(filePath: string): Promise<ImportDocument[]> {
  const raw = await readFile(filePath, 'utf8')
  const trimmed = raw.trim()

  if (trimmed.startsWith('[')) {
    const records = JSON.parse(trimmed) as Record<string, unknown>[]
    return assignDocIds(records)
  }

  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as { data?: Record<string, unknown>[] }
    if (Array.isArray(parsed.data)) {
      return assignDocIds(parsed.data)
    }
    throw new Error('JSON object must contain a "data" array')
  }

  const records: Record<string, unknown>[] = []
  for (const line of trimmed.split('\n')) {
    const row = line.trim()
    if (!row) {
      continue
    }
    records.push(JSON.parse(row) as Record<string, unknown>)
  }
  return assignDocIds(records)
}
