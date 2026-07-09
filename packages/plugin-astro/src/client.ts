import type { AnyZBSearch, RawData } from 'zbsearch'
import { create as createZBSearchDB, load as loadZBSearchDB } from 'zbsearch'

const dbs: Record<string, AnyZBSearch> = {}

export async function getZBSearchDB<T extends AnyZBSearch>(dbName: string): Promise<T> {
  if (dbName in dbs) {
    return dbs[dbName] as T
  }

  const db = createZBSearchDB({ schema: { _: 'string' } })

  const dbResponse = await fetch(`/assets/zbsearchDB_${dbName}.json`)
  const dbData = (await dbResponse.json()) as RawData

  loadZBSearchDB(db, dbData)
  dbs[dbName] = db

  return db as unknown as T
}

export { search } from 'zbsearch'
