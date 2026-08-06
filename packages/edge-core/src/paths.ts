export function registryKey(): string {
  return 'registry.json'
}

export function indexMetaKey(indexId: string): string {
  return `indexes/${indexId}/meta.json`
}

export function snapshotKey(indexId: string, version: string): string {
  return `indexes/${indexId}/${version}/snapshot.msgpack`
}

/** Append-only WAL head (replaces in-place buffer segments). */
export function walHeadKey(indexId: string): string {
  return `wal/${indexId}/head.json`
}

export function walEntriesPrefix(indexId: string): string {
  return `wal/${indexId}/entries/`
}

export function walEntryKey(indexId: string, entryFile: string): string {
  return `${walEntriesPrefix(indexId)}${entryFile}`
}

/** @deprecated Legacy buffer paths - still read during migration. */
export function bufferHeadKey(indexId: string): string {
  return `buffer/${indexId}/head.json`
}

/** @deprecated Legacy in-place segment files. */
export function bufferSegmentKey(indexId: string, segment: string): string {
  return `buffer/${indexId}/segments/${segment}`
}

export function legacyBufferSegmentsPrefix(indexId: string): string {
  return `buffer/${indexId}/segments/`
}

export function walEntryFileName(seq: number, ts: string, changeId: string): string {
  return `${String(seq).padStart(10, '0')}_${ts.replace(/[:.]/g, '-')}_${changeId}.ndjson`
}

export function walSegmentsPrefix(indexId: string): string {
  return `wal/${indexId}/segments/`
}

export function walSegmentFileName(firstSeq: number, lastSeq: number, changeId: string): string {
  return `${String(firstSeq).padStart(10, '0')}-${String(lastSeq).padStart(10, '0')}_${changeId}.ndjson`
}

export function walSegmentKey(indexId: string, firstSeq: number, lastSeq: number, changeId: string): string {
  return `${walSegmentsPrefix(indexId)}${walSegmentFileName(firstSeq, lastSeq, changeId)}`
}

export function walOpenSegmentKey(indexId: string): string {
  return `${walSegmentsPrefix(indexId)}open.ndjson`
}

export function nextSegmentName(current: string | null): string {
  if (!current) {
    return '000001.ndjson'
  }
  const num = Number.parseInt(current.split('.')[0] ?? '0', 10)
  return `${String(num + 1).padStart(6, '0')}.ndjson`
}

export function newVersionId(): string {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${suffix}`
}

export function newChangeId(): string {
  return `chg_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}
