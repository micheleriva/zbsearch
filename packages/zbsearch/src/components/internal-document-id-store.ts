import { AnyZBSearch } from '../types.js'

export type DocumentID = string | number
export type InternalDocumentID = number

export type InternalDocumentIDStore = {
  idToInternalId: Map<string, number>
  internalIdToId: string[]
  save: (store: InternalDocumentIDStore) => unknown
  load: <T extends AnyZBSearch>(zbsearch: T, raw: unknown) => void
}

export function createInternalDocumentIDStore(): InternalDocumentIDStore {
  return {
    idToInternalId: new Map(),
    internalIdToId: [],
    save,
    load
  }
}

export function save(store: InternalDocumentIDStore): unknown {
  return {
    internalIdToId: store.internalIdToId
  }
}

export function load<T extends AnyZBSearch>(zbsearch: T, raw: unknown): void {
  const { internalIdToId } = raw as InternalDocumentIDStore

  zbsearch.internalDocumentIDStore.idToInternalId.clear()
  zbsearch.internalDocumentIDStore.internalIdToId = []
  const internalIdToIdLength = internalIdToId.length

  for (let i = 0; i < internalIdToIdLength; i++) {
    const internalIdItem = internalIdToId[i]
    zbsearch.internalDocumentIDStore.idToInternalId.set(internalIdItem, i + 1)
    zbsearch.internalDocumentIDStore.internalIdToId.push(internalIdItem)
  }
}

export function getInternalDocumentId(store: InternalDocumentIDStore, id: DocumentID): InternalDocumentID {
  if (typeof id === 'string') {
    const internalId = store.idToInternalId.get(id)

    if (internalId) {
      return internalId
    }

    const currentId = store.idToInternalId.size + 1

    store.idToInternalId.set(id, currentId)
    store.internalIdToId.push(id)

    return currentId
  }

  if (id > store.internalIdToId.length) {
    return getInternalDocumentId(store, id.toString())
  }

  return id
}

export function getDocumentIdFromInternalId(store: InternalDocumentIDStore, internalId: InternalDocumentID): string {
  if (store.internalIdToId.length < internalId) {
    throw new Error(`Invalid internalId ${internalId}`)
  }

  return store.internalIdToId[internalId - 1]
}
