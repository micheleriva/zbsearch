import { AnyZBSearch, TypedDocument, Optional } from '../types.js'

export function getByID<T extends AnyZBSearch, ResultDocument extends TypedDocument<T>>(
  db: T,
  id: string
): Optional<ResultDocument> {
  return db.documentsStore.get(db.data.docs, id)
}

export function count<T extends AnyZBSearch>(db: T): number {
  return db.documentsStore.count(db.data.docs)
}
