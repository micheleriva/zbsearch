import { describe, expect, it } from 'vitest'
import { index as defaultIndex } from '../src/components.js'
import type { Index } from '../src/components/index.js'
import type { AVLTree } from '../src/trees/avl.js'
import type { BKDTree } from '../src/trees/bkd.js'
import type { BoolNode } from '../src/trees/bool.js'
import type { FlatTree } from '../src/trees/flat.js'
import type { RadixTree } from '../src/trees/radix.js'
import {
  AnyDocument,
  AnyZBSearch,
  RawData,
  count,
  create,
  getByID,
  insert,
  insertMultiple,
  insertMultipleAsync,
  load,
  loadAsync,
  loadBinary,
  loadBinarySync,
  remove,
  removeMultiple,
  save,
  saveBinary,
  saveBinarySync,
  search,
  update,
  updateMultiple,
  upsert
} from '../src/index.js'

const fullSchema = {
  text: 'string',
  title: 'string',
  tags: 'string[]',
  year: 'number',
  pages: 'number[]',
  collection: 'enum',
  labels: 'enum[]',
  published: 'boolean',
  flags: 'boolean[]',
  location: 'geopoint',
  embedding: 'vector[4]',
  meta: {
    abstract: 'string',
    rating: 'number'
  }
} as const

const allSearchablePaths = [
  'text',
  'title',
  'tags',
  'year',
  'pages',
  'collection',
  'labels',
  'published',
  'flags',
  'location',
  'embedding',
  'meta'
]

const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet']

function makeDoc(i: number): AnyDocument {
  const word = (n: number) => words[(i * 7 + n * 3) % words.length]
  return {
    id: `doc-${i}`,
    text: `${word(0)} ${word(1)} ${word(2)} the ${word(3)} ${word(1)} ${i}`,
    title: `Title ${word(4)}`,
    tags: [`${word(5)} ${word(6)}`, word(7), `${word(8)} ${word(0)}`],
    year: 2000 + (i % 7),
    pages: [i % 5, (i % 5) + 10],
    collection: `c${i % 3}`,
    labels: [`l${i % 2}`, `l${(i % 4) + 2}`],
    published: i % 2 === 0,
    flags: [i % 3 === 0, true],
    location: { lat: 45 + (i % 4), lon: 9 + (i % 5) },
    embedding: [1 + (i % 3), i % 2, 2, (i % 5) - 2],
    meta: { abstract: `abstract ${word(9)} ${word(2)}`, rating: i % 5 }
  }
}

function createFullDb(store?: Parameters<typeof create>[0]['store']) {
  return create({ schema: fullSchema, store })
}

function indexOf(db: AnyZBSearch): Index {
  return db.data.index as Index
}

// The saved index without the data kept for unstored values
function comparableIndex(db: AnyZBSearch) {
  const { unstoredValues: _values, unstoredTerms: _terms, ...rest } = save(db).index as Record<string, unknown>
  return JSON.parse(JSON.stringify(rest))
}

type AVLNodeLike = { v: Set<number>; l: AVLNodeLike | null; r: AVLNodeLike | null } | null

function collectAVLDocuments(node: AVLNodeLike): number[] {
  return node ? [...node.v, ...collectAVLDocuments(node.l), ...collectAVLDocuments(node.r)] : []
}

// Asserts that no internal structure of the index references a document anymore
function expectIndexIsEmpty(db: AnyZBSearch) {
  const index = indexOf(db)

  for (const [prop, { type, node }] of Object.entries(index.indexes)) {
    switch (type) {
      case 'Radix':
        expect((node as RadixTree).postings.size, prop).toBe(0)
        for (const value of Object.values(index.frequencies[prop])) {
          expect(value, prop).toBeUndefined()
        }
        for (const value of Object.values(index.fieldLengths[prop])) {
          expect(value, prop).toBeUndefined()
        }
        break
      case 'AVL':
        // An empty tree may keep its initial root, without documents
        expect(collectAVLDocuments((node as AVLTree<number, number>).root), prop).toEqual([])
        break
      case 'Flat':
        expect((node as FlatTree).numberToDocumentId.size, prop).toBe(0)
        break
      case 'Bool':
        expect((node as BoolNode<number>).true.size, prop).toBe(0)
        expect((node as BoolNode<number>).false.size, prop).toBe(0)
        break
      case 'BKD':
        expect((node as BKDTree).nodeMap.size, prop).toBe(0)
        expect((node as BKDTree).root, prop).toBeNull()
        break
    }
  }

  for (const [prop, { node }] of Object.entries(index.vectorIndexes)) {
    expect((node.toJSON() as { vectors: unknown[] }).vectors, prop).toHaveLength(0)
  }

  for (const [prop, values] of Object.entries(index.unstoredValues)) {
    expect(Object.keys(values), prop).toHaveLength(0)
  }
  for (const [prop, { docs }] of Object.entries(index.unstoredTerms)) {
    expect(Object.keys(docs), prop).toHaveLength(0)
  }
}

describe('store.exclude', () => {
  it('indexes excluded properties without storing them', () => {
    const db = create({
      schema: { text: 'string', title: 'string', year: 'number' } as const,
      store: { exclude: ['text', 'year'] }
    })
    const doc = { id: '1', text: 'the quick brown fox', title: 'Foxes', year: 2020 }
    insert(db, doc)

    // The inserted document is not modified
    expect(doc).toEqual({ id: '1', text: 'the quick brown fox', title: 'Foxes', year: 2020 })
    expect(getByID(db, '1')).toEqual({ id: '1', title: 'Foxes' })

    const results = search(db, { term: 'quick', where: { year: { gte: 2020 } } })
    expect(results.count).toBe(1)
    expect(results.hits[0].id).toBe('1')
    expect(results.hits[0].document).toEqual({ id: '1', title: 'Foxes' })

    // The stored document is the inserted one when nothing is left out
    const plain = create({ schema: { text: 'string' } as const })
    const plainDoc = { id: 'a', text: 'hello' }
    insert(plain, plainDoc)
    expect(getByID(plain, 'a')).toBe(plainDoc)
  })

  it('excludes nested paths, whole objects and properties outside the schema', () => {
    const db = create({
      schema: { title: 'string', meta: { abstract: 'string', rating: 'number' } } as const,
      store: { exclude: ['meta.abstract', 'raw'] }
    })
    insert(db, { id: '1', title: 'one', meta: { abstract: 'nested words', rating: 3 }, raw: 'x'.repeat(100) } as any)
    expect(getByID(db, '1')).toEqual({ id: '1', title: 'one', meta: { rating: 3 } })
    expect(search(db, { term: 'nested' }).count).toBe(1)

    const db2 = create({
      schema: { title: 'string', meta: { abstract: 'string', rating: 'number' } } as const,
      store: { exclude: ['meta'] }
    })
    insert(db2, { id: '1', title: 'one', meta: { abstract: 'nested words', rating: 3 } })
    expect(getByID(db2, '1')).toEqual({ id: '1', title: 'one' })
    expect(search(db2, { term: 'nested' }).count).toBe(1)
    expect(search(db2, { where: { 'meta.rating': { eq: 3 } } }).count).toBe(1)
  })

  it('hides excluded properties that the document inherits, keeping its prototype and other properties', async () => {
    class Meta {
      constructor(private readonly n: number) {}
      get rating() {
        return this.n
      }
      get abstract() {
        return `nested secret ${this.n}`
      }
    }
    class Note {
      constructor(
        readonly id: string,
        private readonly n: number
      ) {}
      get title() {
        return `title ${this.n}`
      }
      get text() {
        return `hidden words ${this.n}`
      }
      get raw() {
        return 'raw secret'
      }
      get meta() {
        return new Meta(this.n)
      }
    }

    const db = create({
      schema: { title: 'string', text: 'string', meta: { abstract: 'string', rating: 'number' } } as const,
      store: { exclude: ['text', 'raw', 'meta.abstract'] }
    })
    const doc = new Note('1', 7)
    insert(db, doc as any)

    const check = (stored: any) => {
      expect(stored).toBeInstanceOf(Note)
      expect(stored.title).toBe('title 7')
      expect(stored.text).toBeUndefined()
      expect(stored.raw).toBeUndefined()
      expect(stored.meta).toBeInstanceOf(Meta)
      expect(stored.meta.rating).toBe(7)
      expect(stored.meta.abstract).toBeUndefined()
      expect(JSON.stringify(stored)).not.toMatch(/secret|hidden/)
    }

    check(getByID(db, '1'))
    check(search(db, { term: 'hidden' }).hits[0].document)
    check(search(db, { term: 'secret' }).hits[0].document)
    // The inserted document is not modified
    expect(doc.text).toBe('hidden words 7')
    expect(doc.raw).toBe('raw secret')
    expect(doc.meta.abstract).toBe('nested secret 7')

    // Snapshots never held inherited values, and the index still finds the excluded text
    for (const restore of [
      async () => {
        const restored = create({ schema: { title: 'string' } as const })
        load(restored, JSON.parse(JSON.stringify(save(db))) as RawData)
        return restored
      },
      async () => {
        const restored = create({ schema: { title: 'string' } as const })
        loadBinarySync(restored, saveBinarySync(db))
        return restored
      }
    ]) {
      const restored = await restore()
      expect(getByID(restored, '1')).toEqual({ id: '1', n: 7 })
      expect(search(restored, { term: 'hidden' }).count).toBe(1)
    }
  })

  it('keeps the index identical to a fully stored one through insert, remove, update and upsert', async () => {
    const stored = createFullDb({ vectors: true })
    const unstored = createFullDb({ exclude: allSearchablePaths })

    const docs = Array.from({ length: 40 }, (_, i) => makeDoc(i))
    for (const db of [stored, unstored]) {
      insertMultiple(db, docs.slice(0, 20))
      await insertMultipleAsync(db, docs.slice(20), { batchSize: 7 })
      removeMultiple(
        db,
        docs.filter((_, i) => i % 3 === 0).map((d) => d.id)
      )
      update(db, 'doc-1', { ...makeDoc(101), id: 'doc-1' })
      updateMultiple(db, ['doc-2', 'doc-4'], [makeDoc(102), makeDoc(104)])
      upsert(db, { ...makeDoc(105), id: 'doc-5' })
      upsert(db, makeDoc(106))
      remove(db, 'doc-7')
    }

    expect(count(unstored)).toBe(count(stored))
    expect(comparableIndex(unstored)).toEqual(comparableIndex(stored))
    expect(getByID(unstored, 'doc-1')).toEqual({ id: 'doc-1' })

    // Removing every document leaves nothing behind
    const ids = Object.values(stored.data.docs.docs).map((doc) => (doc as AnyDocument).id)
    removeMultiple(unstored, ids)
    removeMultiple(stored, ids)
    expect(count(unstored)).toBe(0)
    expectIndexIsEmpty(unstored)
    expectIndexIsEmpty(stored)
    expect(comparableIndex(unstored)).toEqual(comparableIndex(stored))
  })

  it('removes excluded values when the index component is async', async () => {
    const asyncIndex = {
      ...defaultIndex.createIndex(),
      removeUnstored: async (...args: Parameters<typeof defaultIndex.removeUnstored>) =>
        defaultIndex.removeUnstored(...args)
    }
    const db = create({
      schema: fullSchema,
      store: { exclude: allSearchablePaths },
      components: { index: asyncIndex as any }
    })
    await insertMultiple(
      db,
      Array.from({ length: 5 }, (_, i) => makeDoc(i))
    )
    await removeMultiple(db, ['doc-0', 'doc-1', 'doc-2', 'doc-3', 'doc-4'])
    expectIndexIsEmpty(db)
  })

  it('keeps the term dictionary of excluded string[] values compact', () => {
    const db = create({ schema: { tags: 'string[]' } as const, store: { exclude: ['tags'] } })
    insert(db, { id: '1', tags: ['red apple', 'green apple'] })
    insert(db, { id: '2', tags: ['red cherry'] })
    insert(db, { id: '3', tags: [] })

    const { terms, docs } = indexOf(db).unstoredTerms.tags
    expect(terms).toEqual(['red', 'apple', 'green', 'cherry'])
    expect(Array.from(docs[1])).toEqual([0, 1, 2])
    expect(docs[2]).toBeInstanceOf(Uint32Array)
    expect(Object.keys(docs)).toEqual(['1', '2'])

    remove(db, '1')
    expect(search(db, { term: 'apple' }).count).toBe(0)
    expect(search(db, { term: 'red' }).count).toBe(1)
  })

  it('scores excluded string[] values as one field, and removes them as if they were stored', async () => {
    const stored = create({ schema: { tags: 'string[]' } as const })
    const unstored = create({ schema: { tags: 'string[]' } as const, store: { exclude: ['tags'] } })

    for (const db of [stored, unstored]) {
      insert(db, { id: '1', tags: ['red apple', 'green apple', 'red'] })
      insert(db, { id: '2', tags: ['red cherry', 'cherry'] })
      insert(db, { id: '3', tags: [] })
      insert(db, { id: '4', tags: ['apple'] })
    }

    const internalId = unstored.internalDocumentIDStore.idToInternalId.get('1')!
    expect(indexOf(unstored).fieldLengths.tags[internalId]).toBe(5)
    expect(indexOf(unstored).frequencies.tags[internalId]).toEqual({ red: 2, apple: 2, green: 1 })
    expect(comparableIndex(unstored)).toEqual(comparableIndex(stored))
    expect(search(unstored, { term: 'red apple' }).hits).toEqual(
      search(stored, { term: 'red apple' }).hits.map((hit) => ({ ...hit, document: { id: hit.id } }))
    )

    for (const db of [stored, unstored]) {
      update(db, '1', { id: '1', tags: ['apple pie', 'apple'] })
      remove(db, '2')
      remove(db, '3')
    }
    expect(comparableIndex(unstored)).toEqual(comparableIndex(stored))
    expect(indexOf(unstored).avgFieldLength.tags).toBeCloseTo(2, 10)

    for (const db of [stored, unstored]) {
      removeMultiple(db, ['1', '4'])
    }
    expectIndexIsEmpty(unstored)
    expect(comparableIndex(unstored)).toEqual(comparableIndex(stored))
  })

  it('supports filters on excluded properties', () => {
    const db = createFullDb({ exclude: allSearchablePaths })
    insertMultiple(
      db,
      Array.from({ length: 10 }, (_, i) => makeDoc(i))
    )

    expect(search(db, { where: { year: { eq: 2003 } } }).count).toBe(1)
    expect(search(db, { where: { pages: { gt: 12 } } }).count).toBe(4)
    expect(search(db, { where: { collection: { eq: 'c1' } } }).count).toBe(3)
    expect(search(db, { where: { labels: { containsAll: ['l1'] } } }).count).toBe(5)
    expect(search(db, { where: { published: true } }).count).toBe(5)
    expect(
      search(db, { where: { location: { radius: { coordinates: { lat: 45, lon: 9 }, unit: 'km', value: 1 } } } }).count
    ).toBe(1)
    expect(search(db, { where: { 'meta.rating': { eq: 0 } } }).count).toBe(2)
  })

  it('keeps numbers and booleans sortable, but not excluded strings', () => {
    const db = create({
      schema: { title: 'string', text: 'string', year: 'number', published: 'boolean' } as const,
      store: { exclude: ['text', 'year', 'published'] }
    })
    insert(db, { id: '1', title: 'b', text: 'hello', year: 2001, published: true })
    insert(db, { id: '2', title: 'a', text: 'hello', year: 1999, published: false })

    expect(search(db, { term: 'hello', sortBy: { property: 'year', order: 'ASC' } }).hits.map((h) => h.id)).toEqual([
      '2',
      '1'
    ])
    expect(search(db, { term: 'hello', sortBy: { property: 'title', order: 'ASC' } }).hits.map((h) => h.id)).toEqual([
      '2',
      '1'
    ])
    expect(() => search(db, { term: 'hello', sortBy: { property: 'text' } })).toThrow(/Unable to sort on unknown field/)

    remove(db, '2')
    expect(search(db, { sortBy: { property: 'year', order: 'ASC' } }).hits.map((h) => h.id)).toEqual(['1'])
  })

  it('throws a clear error for facets, groupBy and distinctOn on excluded properties', () => {
    const db = create({
      schema: { title: 'string', year: 'number', collection: 'enum', published: 'boolean' } as const,
      store: { exclude: ['year', 'collection', 'published'] }
    })
    insert(db, { title: 'one', year: 2001, collection: 'a', published: true })

    expect(() => search(db, { term: 'one', facets: { collection: {} } })).toThrow(
      'Property "collection" is excluded from the documents store (store.exclude), so it cannot be used for facets.'
    )
    expect(() => search(db, { term: 'one', groupBy: { properties: ['published'] } })).toThrow(
      /"published" is excluded from the documents store .* groupBy/
    )
    expect(() => search(db, { term: 'one', distinctOn: 'year' })).toThrow(/"year" .* distinctOn/)

    // Stored properties keep working
    expect(search(db, { term: 'one', facets: { title: {} } }).facets?.title.count).toBe(1)
  })

  it('throws for distinctOn on excluded properties outside the schema', () => {
    const db = create({
      schema: { title: 'string' } as const,
      store: { exclude: ['raw', 'meta'] }
    })
    insert(db, { title: 'one', raw: 'a', meta: { kind: 'x' }, kept: 'b' } as any)
    insert(db, { title: 'one more', raw: 'a', meta: { kind: 'x' }, kept: 'b' } as any)

    expect(() => search(db, { term: 'one', distinctOn: 'raw' } as any)).toThrow(
      'Property "raw" is excluded from the documents store (store.exclude), so it cannot be used for distinctOn.'
    )
    expect(() => search(db, { term: 'one', distinctOn: 'meta.kind' } as any)).toThrow(/"meta.kind" .* distinctOn/)

    // Stored properties outside the schema keep working
    expect(search(db, { term: 'one', distinctOn: 'kept' } as any).hits).toHaveLength(1)
  })

  it('throws for distinctOn on vector properties the documents store does not keep', () => {
    const schema = { title: 'string', embedding: 'vector[2]' } as const
    const doc = { title: 'one', embedding: [1, 0] }

    const db = create({ schema })
    insert(db, doc)
    expect(() => search(db, { term: 'one', distinctOn: 'embedding' })).toThrow(
      'Vector property "embedding" is not in the documents store (store.vectors is off), so it cannot be used for distinctOn.'
    )

    const stored = create({ schema, store: { vectors: true } })
    insert(stored, doc)
    expect(search(stored, { term: 'one', distinctOn: 'embedding' }).hits).toHaveLength(1)
  })

  it('treats exact matches on excluded text as the index exact match', () => {
    const db = create({
      schema: { title: 'string', text: 'string' } as const,
      store: { exclude: ['text'] }
    })
    insert(db, { id: '1', title: 'Hello', text: 'Quick fox' })
    insert(db, { id: '2', title: 'hello', text: 'slow fox' })

    expect(search(db, { term: 'Quick', exact: true }).hits.map((h) => h.id)).toEqual(['1'])
    // Stored properties are still checked case-sensitively
    expect(search(db, { term: 'Hello', exact: true, properties: ['title'] }).hits.map((h) => h.id)).toEqual(['1'])
  })

  it('applies to properties added by schema inference', () => {
    const db = create({ store: { exclude: ['body'] } })
    insert(db, { id: '1', title: 'Doc', body: 'inferred and indexed text' })
    expect(getByID(db, '1')).toEqual({ id: '1', title: 'Doc' })
    expect(search(db, { term: 'inferred' }).count).toBe(1)
    expect(() => search(db, { sortBy: { property: 'body' } })).toThrow(/Unable to sort on unknown field/)
    remove(db, '1')
    expect(search(db, { term: 'inferred' }).count).toBe(0)
  })

  it('validates the configuration', () => {
    expect(() => create({ schema: { a: 'string' }, store: { exclude: 'a' as any } })).toThrow(/Invalid "store" option/)
    expect(() => create({ schema: { a: 'string' }, store: { exclude: [''] } })).toThrow(/Invalid "store" option/)
    expect(() => create({ schema: { a: 'string' }, store: { vectors: 'yes' as any } })).toThrow(
      /"vectors" must be a boolean/
    )
    expect(() => create({ schema: { a: 'string' }, store: [] as any })).toThrow(/expected an object/)
  })

  describe('prototype safety', () => {
    const protoKeys = ['polluted', 'x', 'y']

    function expectCleanPrototypes() {
      for (const key of protoKeys) {
        expect(Object.hasOwn(Object.prototype, key), key).toBe(false)
        expect(({} as Record<string, unknown>)[key], key).toBeUndefined()
      }
    }

    it('refuses "__proto__" segments in excluded paths, also in loaded snapshots', async () => {
      try {
        for (const path of ['__proto__', '__proto__.polluted', 'a.__proto__.x']) {
          expect(() => create({ schema: { title: 'string' }, store: { exclude: [path] } }), path).toThrow(
            /Invalid "store" option: "exclude" cannot name a "__proto__" property/
          )
        }

        const source = create({ schema: { title: 'string' }, store: { exclude: ['secret'] } })
        insert(source, { id: '1', title: 'one', secret: 'hidden' } as any)
        const raw = JSON.parse(JSON.stringify(save(source))) as RawData & { store: { exclude: string[] } }
        raw.store.exclude = ['__proto__.polluted']
        const target = create({ schema: { title: 'string' } })
        expect(() => load(target, raw)).toThrow(/cannot name a "__proto__" property/)
        await expect(loadAsync(target, raw)).rejects.toThrow(/cannot name a "__proto__" property/)
        expectCleanPrototypes()
      } finally {
        for (const key of protoKeys) delete (Object.prototype as Record<string, unknown>)[key]
      }
    })

    it('never writes to Object.prototype through inherited keys of excluded paths', () => {
      try {
        const db = create({
          schema: { title: 'string' },
          store: { exclude: ['constructor.prototype.polluted', 'constructor.x', 'toString.y', 'meta.constructor.y'] }
        })
        insert(db, { id: '1', title: 'one', meta: { a: 1 } } as any)
        expectCleanPrototypes()
        expect(getByID(db, '1')).toEqual({ id: '1', title: 'one', meta: { a: 1 } })
        expect(search(db, { term: 'one' }).count).toBe(1)

        // An own property with such a name is left out like any other
        const own = create({ schema: { title: 'string' }, store: { exclude: ['constructor.prototype'] } })
        insert(own, { id: '1', title: 'one', constructor: { prototype: 'hidden', kept: true } } as any)
        expect(getByID(own, '1')).toEqual({ id: '1', title: 'one', constructor: { kept: true } })
        expectCleanPrototypes()
      } finally {
        for (const key of protoKeys) delete (Object.prototype as Record<string, unknown>)[key]
      }
    })

    it('stores documents with an own "__proto__" property without reaching their prototype', () => {
      try {
        const db = create({ schema: { title: 'string', embedding: 'vector[2]' }, store: { exclude: ['secret'] } })
        const doc = JSON.parse('{"id":"1","title":"one","secret":"s","embedding":[1,0],"__proto__":{"x":1}}')
        insert(db, doc)
        const stored = getByID(db, '1')!
        expect(Object.getPrototypeOf(stored)).toBe(Object.prototype)
        expect(Object.hasOwn(stored, '__proto__')).toBe(true)
        expect(stored.secret).toBeUndefined()
        expect(search(db, { term: 'one' }).hits[0].document.embedding).toBeNull()
        expect(search(db, { term: 'one', includeVectors: true }).hits[0].document.embedding).toEqual([1, 0])
        expectCleanPrototypes()
      } finally {
        for (const key of protoKeys) delete (Object.prototype as Record<string, unknown>)[key]
      }
    })

    it('does not infer "__proto__" properties', () => {
      try {
        const db = create({ inferSchema: true })
        insert(db, JSON.parse('{"id":"1","title":"one","__proto__":{"polluted":"words"}}'))
        insert(db, JSON.parse('{"id":"2","title":"two","__proto__":"x"}'))
        expectCleanPrototypes()
        expect(db.schema).toEqual({ title: 'string' })
        expect(db.index.getSearchableProperties(db.data.index)).toEqual(['title'])
        expect(Object.getPrototypeOf(db.schema)).toBe(Object.prototype)
      } finally {
        for (const key of protoKeys) delete (Object.prototype as Record<string, unknown>)[key]
      }
    })
  })

  it('refuses excluded searchable properties with an index component that cannot remove them', () => {
    const { removeUnstored: _, ...legacyIndex } = defaultIndex.createIndex()
    expect(() =>
      create({ schema: { text: 'string' }, store: { exclude: ['text'] }, components: { index: legacyIndex as any } })
    ).toThrow(/cannot name the searchable property "text"/)

    // Vectors are removed by ID through the vector index, whatever the index component
    const db = create({
      schema: { title: 'string', embedding: 'vector[2]' },
      store: { exclude: ['embedding'] },
      components: { index: legacyIndex as any }
    })
    insert(db, { id: '1', title: 'one', embedding: [1, 0] })
    remove(db, '1')
    expectIndexIsEmpty(db)
  })

  it('refuses inferring an excluded searchable property with an index component that cannot remove it', () => {
    const { removeUnstored: _, ...legacyIndex } = defaultIndex.createIndex()
    const db = create({ store: { exclude: ['secret'] }, components: { index: legacyIndex as any } })
    insert(db, { id: '1', title: 'one' })

    expect(() => insert(db, { id: '2', title: 'two', extra: 'more', secret: 'hidden words' })).toThrow(
      /cannot name the searchable property "secret"/
    )
    // Nothing of the rejected document was registered.
    expect(db.index.getSearchableProperties(db.data.index)).toEqual(['title'])
    expect(db.index.getSearchablePropertiesWithTypes(db.data.index)).toEqual({ title: 'string' })
    expect(db.schema).toEqual({ title: 'string' })
    expect(count(db)).toBe(1)
  })

  it('refuses loading a snapshot with excluded searchable properties into an index component that cannot remove them', async () => {
    const source = create({ schema: { title: 'string', text: 'string' }, store: { exclude: ['text'] } })
    insert(source, { id: '1', title: 'one', text: 'hidden words' })
    const raw = save(source)
    const binary = saveBinarySync(source)

    const { removeUnstored: _, ...legacyIndex } = defaultIndex.createIndex()
    const target = () =>
      create({ schema: { title: 'string', text: 'string' }, components: { index: legacyIndex as any } })
    const refused = /cannot name the searchable property "text"/

    expect(() => load(target(), JSON.parse(JSON.stringify(raw)) as RawData)).toThrow(refused)
    await expect(loadAsync(target(), JSON.parse(JSON.stringify(raw)) as RawData)).rejects.toThrow(refused)
    expect(() => loadBinarySync(target(), binary)).toThrow(refused)
    await expect(loadBinary(target(), binary)).rejects.toThrow(refused)

    // The refused snapshot left the target's index untouched.
    const db = target()
    insert(db, { id: 'x', title: 'kept', text: 'kept text' })
    expect(() => load(db, JSON.parse(JSON.stringify(raw)) as RawData)).toThrow(refused)
    expect(search(db, { term: 'kept' }).hits.map((hit) => hit.id)).toEqual(['x'])

    // A snapshot that keeps every searchable property stored still loads.
    const stored = create({ schema: { title: 'string', text: 'string' } })
    insert(stored, { id: '1', title: 'one', text: 'stored words' })
    const restored = target()
    load(restored, JSON.parse(JSON.stringify(save(stored))) as RawData)
    expect(search(restored, { term: 'stored' }).hits.map((hit) => hit.id)).toEqual(['1'])
  })
})

describe('vectors in the documents store', () => {
  const schema = { title: 'string', embedding: 'vector[2]', nested: { embedding: 'vector[2]' } } as const

  it('does not store vectors by default and rebuilds them, normalized, in results', () => {
    const db = create({ schema })
    insert(db, { id: '1', title: 'one', embedding: [3, 4], nested: { embedding: [0, 2] } })

    expect(getByID(db, '1')).toEqual({ id: '1', title: 'one', nested: {} })

    const withVectors = search(db, {
      mode: 'vector',
      vector: { value: [3, 4], property: 'embedding' },
      includeVectors: true
    })
    expect(withVectors.hits[0].document.embedding).toEqual([Math.fround(0.6), Math.fround(0.8)])
    expect(withVectors.hits[0].document.nested.embedding).toEqual([0, 1])

    const fulltext = search(db, { term: 'one', includeVectors: true })
    expect(fulltext.hits[0].document.embedding).toHaveLength(2)

    const hybrid = search(db, {
      mode: 'hybrid',
      term: 'one',
      vector: { value: [3, 4], property: 'embedding' },
      includeVectors: true
    })
    expect(hybrid.hits[0].document.nested.embedding).toEqual([0, 1])

    // Without includeVectors, vectors are null as before
    const withoutVectors = search(db, { term: 'one' })
    expect(withoutVectors.hits[0].document).toEqual({
      id: '1',
      title: 'one',
      embedding: null,
      nested: { embedding: null }
    })

    // Searching never modifies the stored document
    expect(getByID(db, '1')).toEqual({ id: '1', title: 'one', nested: {} })

    remove(db, '1')
    expectIndexIsEmpty(db)
  })

  it('does not store vectors the document inherits, and rebuilds them in results', () => {
    class Doc {
      constructor(
        readonly id: string,
        readonly title: string
      ) {}
      get embedding() {
        return [3, 4]
      }
      get nested() {
        return { embedding: [0, 2], label: 'n' }
      }
    }

    const db = create({ schema })
    insert(db, new Doc('1', 'one') as any)

    const stored = getByID(db, '1') as any
    expect(stored).toBeInstanceOf(Doc)
    expect(stored.embedding).toBeUndefined()
    expect(stored.nested).toEqual({ label: 'n' })

    const rebuilt = search(db, { term: 'one', includeVectors: true }).hits[0].document as any
    expect(rebuilt).toBeInstanceOf(Doc)
    expect(rebuilt).toEqual({
      id: '1',
      title: 'one',
      embedding: [Math.fround(0.6), Math.fround(0.8)],
      nested: { embedding: [0, 1], label: 'n' }
    })

    const nulled = search(db, { term: 'one' }).hits[0].document as any
    expect(nulled).toBeInstanceOf(Doc)
    expect(nulled).toEqual({ id: '1', title: 'one', embedding: null, nested: { embedding: null, label: 'n' } })

    // Searching never modifies the stored document
    expect(getByID(db, '1')).toBe(stored)
    expect(stored.embedding).toBeUndefined()

    // Snapshots keep the own enumerable properties: the inherited `nested` (and its label) is not saved
    const restored = create({ schema })
    loadBinarySync(restored, saveBinarySync(db))
    expect(search(restored, { term: 'one', includeVectors: true }).hits[0].document).toEqual({
      id: '1',
      title: 'one',
      embedding: [Math.fround(0.6), Math.fround(0.8)],
      nested: { embedding: [0, 1] }
    })
  })

  it('stores vectors with store.vectors', () => {
    const db = create({ schema, store: { vectors: true } })
    const doc = { id: '1', title: 'one', embedding: [3, 4], nested: { embedding: [0, 2] } }
    insert(db, doc)
    expect(getByID(db, '1')).toBe(doc)

    const results = search(db, { term: 'one', includeVectors: true })
    expect(results.hits[0].document.embedding).toEqual([3, 4])

    // Not including vectors returns a copy instead of nulling the stored vectors
    expect(search(db, { term: 'one' }).hits[0].document.embedding).toBeNull()
    expect(doc.embedding).toEqual([3, 4])
  })
})

describe('stored documents of classes with private fields', () => {
  // Real `#private` fields: only the instance itself passes their brand check, a copy of its own properties does not
  class Meta {
    #rating: number
    #abstract: string
    constructor(rating: number, abstract: string) {
      this.#rating = rating
      this.#abstract = abstract
    }
    get rating() {
      return this.#rating
    }
    get abstract() {
      return this.#abstract
    }
  }

  class Article {
    #id: string
    #title: string
    #body: string
    #embedding: number[]
    #meta: Meta
    // An own property, kept in the documents store
    category: string
    constructor(id: string, title: string, body: string, embedding: number[], category = 'news') {
      this.#id = id
      this.#title = title
      this.#body = body
      this.#embedding = embedding
      this.#meta = new Meta(title.length, `abstract of ${body}`)
      this.category = category
    }
    get id() {
      return this.#id
    }
    get title() {
      return this.#title
    }
    get body() {
      return this.#body
    }
    get embedding() {
      return this.#embedding
    }
    get meta() {
      return this.#meta
    }
    headline() {
      return `${this.#title} (${this.category})`
    }
  }

  const schema = {
    title: 'string',
    body: 'string',
    category: 'string',
    embedding: 'vector[2]',
    meta: { rating: 'number', abstract: 'string' }
  } as const

  function createArticles() {
    return create({ schema, store: { exclude: ['body', 'meta.abstract'] } })
  }

  function expectStored(stored: any, title: string) {
    expect(stored).toBeInstanceOf(Article)
    expect(stored.id).toBe('1')
    expect(stored.title).toBe(title)
    expect(stored.category).toBe('news')
    expect(stored.headline()).toBe(`${title} (news)`)
    expect(stored.body).toBeUndefined()
    expect('body' in stored ? stored.body : undefined).toBeUndefined()
    expect(stored.meta).toBeInstanceOf(Meta)
    expect(stored.meta.rating).toBe(title.length)
    expect(stored.meta.abstract).toBeUndefined()
    expect(JSON.stringify(stored)).not.toMatch(/secret/)
  }

  it('keeps the getters and methods of the class working, and hides the unstored ones', () => {
    const db = createArticles()
    const doc = new Article('1', 'hello', 'secret words', [3, 4])
    insert(db, doc as any)

    const stored = getByID(db, '1') as any
    expectStored(stored, 'hello')
    expect(stored.embedding).toBeUndefined()
    expect(Object.keys(stored)).toEqual(['category'])
    expect(getByID(db, '1')).toBe(stored)

    const hit = search(db, { term: 'secret' }).hits[0].document as any
    expectStored(hit, 'hello')
    expect(hit.embedding).toBeNull()

    const rebuilt = search(db, { term: 'hello', includeVectors: true }).hits[0].document as any
    expectStored(rebuilt, 'hello')
    expect(rebuilt.embedding).toEqual([Math.fround(0.6), Math.fround(0.8)])

    const vectorHit = search(db, { mode: 'vector', vector: { value: [3, 4], property: 'embedding' } }).hits[0]
      .document as any
    expectStored(vectorHit, 'hello')
    expect(vectorHit.embedding).toBeNull()

    // Neither inserting nor searching modifies the inserted document or the stored one
    expect(doc.body).toBe('secret words')
    expect(doc.embedding).toEqual([3, 4])
    expect(doc.meta.abstract).toBe('abstract of secret words')
    expect(Object.keys(doc)).toEqual(['category'])
    expect(stored.embedding).toBeUndefined()
    expect(stored.body).toBeUndefined()

    expect(search(db, { where: { 'meta.rating': { eq: 5 } } }).count).toBe(1)
    expect(search(db, { term: 'abstract', properties: ['meta.abstract'] }).count).toBe(1)
  })

  it('removes, updates and upserts such documents', async () => {
    const db = createArticles()
    insert(db, new Article('1', 'hello', 'secret words', [3, 4]) as any)

    update(db, '1', new Article('1', 'goodbye', 'secret phrase', [0, 2]) as any)
    expectStored(getByID(db, '1'), 'goodbye')
    expect(search(db, { term: 'words' }).count).toBe(0)
    expect(search(db, { term: 'phrase' }).count).toBe(1)

    upsert(db, new Article('1', 'again', 'secret letters', [1, 1]) as any)
    expectStored(getByID(db, '1'), 'again')
    expect(search(db, { term: 'phrase' }).count).toBe(0)
    expect(search(db, { term: 'letters' }).count).toBe(1)

    expect(remove(db, '1')).toBe(true)
    expect(count(db)).toBe(0)
    expectIndexIsEmpty(db)
  })

  it('saves and loads such documents without the unstored properties', async () => {
    const db = createArticles()
    insert(db, new Article('1', 'hello', 'secret words', [3, 4]) as any)

    for (const restore of [
      () => {
        const restored = createArticles()
        load(restored, JSON.parse(JSON.stringify(save(db))) as RawData)
        return restored
      },
      () => {
        const restored = createArticles()
        loadBinarySync(restored, saveBinarySync(db))
        return restored
      }
    ]) {
      const restored = restore()
      expect(getByID(restored, '1')).toEqual({ category: 'news' })
      expect(search(restored, { term: 'secret' }).hits.map((hit) => hit.id)).toEqual(['1'])
      expect(search(restored, { term: 'hello', includeVectors: true }).hits[0].document.embedding).toEqual([
        Math.fround(0.6),
        Math.fround(0.8)
      ])
      // Snapshots keep own enumerable properties only, as for any class instance: the loaded document is a plain one
      expect(remove(restored, '1')).toBe(true)
      expect(count(restored)).toBe(0)
    }

    // A JSON round trip of the stored document reads the same
    expect(JSON.parse(JSON.stringify(getByID(db, '1')))).toEqual({ category: 'news' })
  })

  it('keeps the getters working when only own vectors are left out, and on hits of stored vectors', () => {
    class Item {
      #name: string
      constructor(
        readonly id: string,
        name: string,
        public embedding: number[]
      ) {
        this.#name = name
      }
      get name() {
        return this.#name
      }
    }
    const itemSchema = { name: 'string', embedding: 'vector[2]' } as const

    for (const store of [undefined, { vectors: true }]) {
      const db = create({ schema: itemSchema, store })
      const doc = new Item('1', 'lamp', [3, 4])
      insert(db, doc as any)

      const stored = getByID(db, '1') as any
      expect(stored).toBeInstanceOf(Item)
      expect(stored.name).toBe('lamp')
      expect(stored.embedding).toEqual(store ? [3, 4] : undefined)

      const nulled = search(db, { term: 'lamp' }).hits[0].document as any
      expect(nulled).toBeInstanceOf(Item)
      expect(nulled.name).toBe('lamp')
      expect(nulled.embedding).toBeNull()

      const rebuilt = search(db, { term: 'lamp', includeVectors: true }).hits[0].document as any
      expect(rebuilt.name).toBe('lamp')
      expect(rebuilt.embedding).toEqual(store ? [3, 4] : [Math.fround(0.6), Math.fround(0.8)])

      expect(doc.embedding).toEqual([3, 4])
      expect(remove(db, '1')).toBe(true)
      expectIndexIsEmpty(db)
    }
  })

  describe('with a toJSON reading the unstored values', () => {
    class Source {
      #rating: number
      #abstract: string
      constructor(rating: number, abstract: string) {
        this.#rating = rating
        this.#abstract = abstract
      }
      get rating() {
        return this.#rating
      }
      get abstract() {
        return this.#abstract
      }
      toJSON() {
        return { rating: this.#rating, abstract: this.#abstract }
      }
    }

    class Note {
      #id: string
      #text: string
      #embedding: number[]
      #source: Source
      // Own properties: `vector` is a vector kept as an own property, `draft` is excluded
      tag: string
      vector: number[]
      draft: string
      constructor(id: string, text: string, embedding: number[]) {
        this.#id = id
        this.#text = text
        this.#embedding = embedding
        this.#source = new Source(text.length, `abstract of ${text}`)
        this.tag = 'memo'
        this.vector = [6, 8]
        this.draft = `draft of ${text}`
      }
      get id() {
        return this.#id
      }
      get text() {
        return this.#text
      }
      get embedding() {
        return this.#embedding
      }
      get source() {
        return this.#source
      }
      toJSON() {
        return {
          id: this.#id,
          text: this.#text,
          embedding: this.#embedding,
          source: this.#source,
          tag: this.tag,
          vector: this.vector,
          draft: this.draft
        }
      }
    }

    const noteSchema = {
      text: 'string',
      tag: 'string',
      draft: 'string',
      embedding: 'vector[2]',
      vector: 'vector[2]',
      source: { rating: 'number', abstract: 'string' }
    } as const

    function createNotes() {
      return create({ schema: noteSchema, store: { exclude: ['text', 'draft', 'source.abstract'] } })
    }

    const stored = { id: '1', source: { rating: 12 }, tag: 'memo' }
    const unit = [Math.fround(0.6), Math.fround(0.8)]

    function serialized(doc: unknown) {
      const json = JSON.stringify(doc)
      expect(json).not.toMatch(/secret/)
      return JSON.parse(json)
    }

    it('serializes the documents and the hits without the unstored values', () => {
      const db = createNotes()
      const doc = new Note('1', 'secret words', [3, 4])
      insert(db, doc as any)

      const storedDoc = getByID(db, '1') as any
      expect(storedDoc.text).toBeUndefined()
      expect(storedDoc.source.abstract).toBeUndefined()
      expect(serialized(storedDoc)).toEqual(stored)
      expect(serialized(storedDoc.toJSON())).toEqual(stored)

      const hit = search(db, { term: 'secret' }).hits[0].document as any
      expect(hit.embedding).toBeNull()
      expect(hit.vector).toBeNull()
      expect(serialized(hit)).toEqual({ ...stored, embedding: null, vector: null })

      const rebuilt = search(db, { term: 'secret', includeVectors: true }).hits[0].document as any
      expect(rebuilt.embedding).toEqual(unit)
      expect(rebuilt.vector).toEqual(unit)
      expect(serialized(rebuilt)).toEqual({ ...stored, embedding: unit, vector: unit })

      // The inserted document is not modified, and still serializes everything
      expect(JSON.parse(JSON.stringify(doc))).toEqual({
        id: '1',
        text: 'secret words',
        embedding: [3, 4],
        source: { rating: 12, abstract: 'abstract of secret words' },
        tag: 'memo',
        vector: [6, 8],
        draft: 'draft of secret words'
      })
    })

    it('keeps the stored vectors of the toJSON on hits when the store keeps vectors', () => {
      const db = create({ schema: noteSchema, store: { exclude: ['text', 'draft', 'source.abstract'], vectors: true } })
      insert(db, new Note('1', 'secret words', [3, 4]) as any)

      const all = { ...stored, embedding: [3, 4], vector: [6, 8] }
      expect(serialized(getByID(db, '1'))).toEqual(all)
      expect(serialized(search(db, { term: 'secret', includeVectors: true }).hits[0].document)).toEqual(all)
      expect(serialized(search(db, { term: 'secret' }).hits[0].document)).toEqual({
        ...stored,
        embedding: null,
        vector: null
      })
    })

    it('saves the documents without the unstored values', async () => {
      const db = createNotes()
      insert(db, new Note('1', 'secret words', [3, 4]) as any)

      const raw = JSON.parse(JSON.stringify(save(db))) as RawData
      expect(Object.values((raw.docs as any).docs)).toEqual([stored])

      const binary = saveBinarySync(db)
      const segments: Uint8Array[] = []
      for await (const segment of saveBinary(db)) {
        segments.push(segment)
      }

      for (const restore of [
        async (restored: AnyZBSearch) => load(restored, raw),
        async (restored: AnyZBSearch) => loadBinarySync(restored, binary),
        async (restored: AnyZBSearch) => loadBinary(restored, segments)
      ]) {
        const restored = createNotes()
        await restore(restored)
        expect(serialized(getByID(restored, '1'))).toEqual(stored)
        expect(serialized(search(restored, { term: 'secret' }).hits[0].document)).toEqual({
          ...stored,
          embedding: null,
          vector: null
        })
        expect(serialized(search(restored, { term: 'secret', includeVectors: true }).hits[0].document)).toEqual({
          ...stored,
          embedding: unit,
          vector: unit
        })
        expect(remove(restored, '1')).toBe(true)
        expectIndexIsEmpty(restored)
      }
    })
  })
})

describe('store serialization', () => {
  function populate(db: AnyZBSearch, n: number) {
    insertMultiple(
      db,
      Array.from({ length: n }, (_, i) => makeDoc(i))
    )
  }

  it('round-trips the configuration and the removal data', async () => {
    const db = createFullDb({ exclude: ['text', 'tags', 'year', 'labels', 'location'] })
    populate(db, 12)
    const raw = save(db)

    expect(raw.store).toEqual({ exclude: ['text', 'tags', 'year', 'labels', 'location'], vectors: false })
    expect(JSON.parse(JSON.stringify(raw))).toEqual(raw)

    for (const restore of [
      (target: AnyZBSearch) => load(target, JSON.parse(JSON.stringify(raw)) as RawData),
      (target: AnyZBSearch) => loadAsync(target, JSON.parse(JSON.stringify(raw)) as RawData),
      (target: AnyZBSearch) => load(target, save(db, { format: 'chunked', chunkSize: 1024 })),
      (target: AnyZBSearch) => loadAsync(target, save(db, { format: 'chunked', chunkSize: 1024 }))
    ]) {
      // Created without the option: the snapshot restores it
      const restored = create({ schema: { __placeholder: 'string' } })
      await restore(restored)

      expect(restored.store).toEqual(db.store)
      expect(indexOf(restored).unstoredTerms.tags.docs[1]).toBeInstanceOf(Uint32Array)
      expect(search(restored, { term: 'alpha' }).count).toBe(search(db, { term: 'alpha' }).count)

      // New documents follow the restored configuration
      insert(restored, makeDoc(50))
      expect(getByID(restored, 'doc-50')).not.toHaveProperty('text')
      expect(getByID(restored, 'doc-50')).not.toHaveProperty('embedding')
      expect(getByID(restored, 'doc-50')).toHaveProperty('title')

      removeMultiple(restored, [...Array.from({ length: 12 }, (_, i) => `doc-${i}`), 'doc-50'])
      expectIndexIsEmpty(restored)
    }
  })

  it('loads snapshots saved before the store option existed', () => {
    // A 4.0.x snapshot: vectors stored in the documents, no store configuration and no removal data
    const old = createFullDb({ vectors: true })
    populate(old, 6)
    const raw = JSON.parse(JSON.stringify(save(old)))
    delete raw.store
    delete raw.index.unstoredValues
    delete raw.index.unstoredTerms

    const db = createFullDb()
    load(db, raw)

    // The configuration given to create applies; the stored vectors are kept and returned as they were inserted
    expect(db.store).toEqual({ exclude: [], vectors: false })
    expect((getByID(db, 'doc-1') as AnyDocument).embedding).toEqual([2, 1, 2, -1])
    const results = search(db, {
      mode: 'vector',
      vector: { value: [2, 1, 2, -1], property: 'embedding' },
      includeVectors: true,
      similarity: 0.99
    })
    expect(results.hits.map((h) => h.document.embedding)).toContainEqual([2, 1, 2, -1])

    insert(db, makeDoc(20))
    expect(getByID(db, 'doc-20')).not.toHaveProperty('embedding')

    removeMultiple(db, ['doc-0', 'doc-1', 'doc-2', 'doc-3', 'doc-4', 'doc-5', 'doc-20'])
    expectIndexIsEmpty(db)
  })
})
