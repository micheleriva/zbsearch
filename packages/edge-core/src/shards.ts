import type { IndexMeta } from './types.js'

export const SHARD_ID_SEPARATOR = '--shard-'

export function shardIndexId(logicalId: string, shardIndex: number): string {
  return `${logicalId}${SHARD_ID_SEPARATOR}${shardIndex}`
}

export function shardIndexIds(logicalId: string, shardCount: number): string[] {
  const ids: string[] = []

  for (let i = 0; i < shardCount; i++) {
    ids.push(shardIndexId(logicalId, i))
  }

  return ids
}

export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function shardForDoc(docId: string, shardCount: number): number {
  return fnv1a32(docId) % shardCount
}

export function isShardGroupMeta(meta: IndexMeta | null | undefined): boolean {
  return !!meta && typeof meta.shards?.count === 'number' && meta.shards.count > 1
}

export function physicalShardIds(metas: IndexMeta[]): Set<string> {
  const hidden = new Set<string>()

  for (const meta of metas) {
    if (isShardGroupMeta(meta)) {
      for (const id of shardIndexIds(meta.id, meta.shards!.count)) {
        hidden.add(id)
      }
    }
  }

  return hidden
}
