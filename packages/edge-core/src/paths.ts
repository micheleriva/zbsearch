export function registryKey(): string {
  return 'registry.json'
}

export function indexMetaKey(indexId: string): string {
  return `indexes/${indexId}/meta.json`
}

export function snapshotKey(indexId: string, version: string): string {
  return `indexes/${indexId}/${version}/snapshot.msgpack`
}

export function bufferHeadKey(indexId: string): string {
  return `buffer/${indexId}/head.json`
}

export function bufferSegmentKey(indexId: string, segment: string): string {
  return `buffer/${indexId}/segments/${segment}`
}

export function nextSegmentName(current: string | null): string {
  if (!current) {
    return '000001.ndjson'
  }
  const num = Number.parseInt(current.split('.')[0] ?? '0', 10)
  return `${String(num + 1).padStart(6, '0')}.ndjson`
}

export function newVersionId(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export function newChangeId(): string {
  return `chg_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}
