import { describe, expect, it } from 'vitest'
import { DocumentsStore } from '../src/components/documents-store.js'
import { Index } from '../src/components/index.js'
import { getInternalDocumentId } from '../src/components/internal-document-id-store.js'
import { Result, create, insert, load, save, search } from '../src/index.js'
import { RadixTree } from '../src/trees/radix.js'
import type { AnyDocument } from '../src/types.js'

function extractOriginalDoc(result: Result<AnyDocument>[]): AnyDocument[] {
  return result.map(({ document }: AnyDocument) => document)
}

describe('Edge getters', () => {
  it('should correctly enable edge index getter', async () => {
    const db = create({
      schema: {
        name: 'string',
        age: 'number'
      } as const
    })

    await insert(db, {
      name: 'John',
      age: 30
    })

    await insert(db, {
      name: 'Jane',
      age: 25
    })

    const { index } = save(db)
    const nameIndex = (index as Index).indexes['name']
    const newNameIndex = RadixTree.fromJSON(nameIndex.node)

    // Remember that tokenizers an stemmers sets content to lowercase
    expect(newNameIndex.contains('john')).toBeTruthy()
    expect(newNameIndex.contains('jane')).toBeTruthy()
  })

  it('should correctly enable edge docs getter', async () => {
    const db = create({
      schema: {
        name: 'string',
        age: 'number'
      } as const
    })

    const doc1 = await insert(db, {
      name: 'John',
      age: 30
    })

    const doc2 = await insert(db, {
      name: 'Jane',
      age: 25
    })

    const { docs } = save(db)

    expect((docs as DocumentsStore).docs[getInternalDocumentId(db.internalDocumentIDStore, doc1)]).toStrictEqual({
      name: 'John',
      age: 30
    })
    expect((docs as DocumentsStore).docs[getInternalDocumentId(db.internalDocumentIDStore, doc2)]).toStrictEqual({
      name: 'Jane',
      age: 25
    })
  })

  it('should correctly enable index setter', async () => {
    const db = create({
      schema: {
        name: 'string',
        age: 'number'
      } as const
    })

    const jonh = {
      name: 'John',
      age: 30
    }

    const jane = {
      name: 'Jane',
      age: 25
    }

    const michele = {
      name: 'Michele',
      age: 27
    }

    const paolo = {
      name: 'Paolo',
      age: 37
    }

    await insert(db, jonh)
    await insert(db, jane)

    const db2 = create({
      schema: {
        name: 'string',
        age: 'number'
      } as const
    })

    await insert(db2, michele)
    await insert(db2, paolo)

    const dbData = save(db2)
    load(db, dbData)

    const search1 = await search(db, { term: 'Jane' })
    const search2 = await search(db, { term: 'John' })
    const search3 = await search(db, { term: 'Paolo' })
    const search4 = await search(db, { term: 'Michele' })

    expect(search1.count).toBe(0)
    expect(search2.count).toBe(0)
    expect(search3.count).toBe(1)
    expect(search4.count).toBe(1)

    expect(extractOriginalDoc(search3.hits)).toStrictEqual([paolo])
    expect(extractOriginalDoc(search4.hits)).toStrictEqual([michele])
  })

  it('should correctly save and load data', async () => {
    const originalDB = await create({
      schema: {
        name: 'string',
        age: 'number'
      } as const
    })

    await insert(originalDB, {
      name: 'Michele',
      age: 27
    })

    await insert(originalDB, {
      name: 'Paolo',
      age: 37
    })

    const DBData = save(originalDB)

    const newDB = create({
      schema: {
        name: 'string',
        age: 'number'
      }
    })

    load(newDB, DBData)

    const search1 = await search(originalDB, { term: 'Michele' })
    const search2 = await search(newDB, { term: 'Michele' })

    const search3 = await search(originalDB, { term: 'P' })
    const search4 = await search(newDB, { term: 'P' })

    expect(search1.hits).toStrictEqual(search2.hits)
    expect(search3.hits).toStrictEqual(search4.hits)
  })
})
