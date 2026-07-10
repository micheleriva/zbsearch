import { decodeJson, encodeJson } from './codec.js'
import { notFound } from './errors.js'
import { indexMetaKey, registryKey } from './paths.js'
import type { ObjectStorage } from './storage.js'
import type { IndexMeta, Registry } from './types.js'

async function readJson<T>(storage: ObjectStorage, key: string): Promise<T | null> {
  const obj = await storage.get(key)
  if (!obj) {
    return null
  }
  return decodeJson<T>(obj.body)
}

async function writeJson(storage: ObjectStorage, key: string, value: unknown): Promise<void> {
  await storage.put(key, encodeJson(value), { contentType: 'application/json' })
}

export async function loadRegistry(storage: ObjectStorage): Promise<Registry> {
  const registry = await readJson<Registry>(storage, registryKey())
  return registry ?? { indexes: [] }
}

export async function saveRegistry(storage: ObjectStorage, registry: Registry): Promise<void> {
  await writeJson(storage, registryKey(), registry)
}

export async function getIndexMeta(storage: ObjectStorage, indexId: string): Promise<IndexMeta> {
  const meta = await readJson<IndexMeta>(storage, indexMetaKey(indexId))
  if (!meta) {
    throw notFound(`Index ${indexId} not found`)
  }
  return meta
}

export async function saveIndexMeta(storage: ObjectStorage, meta: IndexMeta): Promise<void> {
  meta.updatedAt = new Date().toISOString()
  await writeJson(storage, indexMetaKey(meta.id), meta)
}

export async function listIndexMetas(storage: ObjectStorage): Promise<IndexMeta[]> {
  const registry = await loadRegistry(storage)
  const metas: IndexMeta[] = []
  for (const id of registry.indexes) {
    const meta = await readJson<IndexMeta>(storage, indexMetaKey(id))
    if (meta) {
      metas.push(meta)
    }
  }
  return metas
}

export async function registerIndex(storage: ObjectStorage, meta: IndexMeta): Promise<void> {
  const registry = await loadRegistry(storage)
  if (!registry.indexes.includes(meta.id)) {
    registry.indexes.push(meta.id)
    await saveRegistry(storage, registry)
  }
  await saveIndexMeta(storage, meta)
}

export async function deleteIndexMeta(storage: ObjectStorage, indexId: string): Promise<void> {
  const registry = await loadRegistry(storage)
  registry.indexes = registry.indexes.filter((id) => id !== indexId)
  await saveRegistry(storage, registry)
  await storage.delete(indexMetaKey(indexId))
}
