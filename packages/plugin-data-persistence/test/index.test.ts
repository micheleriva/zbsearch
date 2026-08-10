import { describe, expect, it, onTestFinished } from 'vitest'
import { create, insert, search, insertPin, getAllPins } from 'zbsearch'
import { UNSUPPORTED_FORMAT, METHOD_MOVED } from '../src/errors.js'
import {
  persist,
  restore,
  persistToFile as deprecatedPersistToFile,
  restoreFromFile as deprecatedRestoreFromFile
} from '../src/index.js'
import { persistToFile, restoreFromFile } from '../src/server.js'

// Allow referencing Deno in cross-runtime tests without type errors
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Deno: any

function hitsApproxEqual(a: any[], b: any[], epsilon = 1e-5): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const ha = a[i]
    const hb = b[i]
    if (ha.id !== hb.id) return false
    if (JSON.stringify(ha.document) !== JSON.stringify(hb.document)) return false
    if (typeof ha.score === 'number' && typeof hb.score === 'number') {
      if (Math.abs(ha.score - hb.score) > epsilon) return false
    }
  }
  return true
}

let _rm

async function rm(path: string): Promise<void> {
  if (!_rm) {
    _rm = typeof Deno !== 'undefined' ? Deno.remove : (await import('node:fs/promises')).rm
  }

  return _rm(path)
}

async function generateTestDBInstance() {
  const db = await create({
    schema: {
      quote: 'string',
      author: 'string',
      genre: 'enum',
      colors: 'enum[]'
    } as const
  })

  await insert(db, {
    quote: 'I am a great programmer',
    author: 'Bill Gates',
    genre: 'tech',
    colors: ['red', 'blue']
  })

  await insert(db, {
    quote: 'Be yourself; everyone else is already taken.',
    author: 'Oscar Wilde',
    genre: 'life',
    colors: ['red', 'green']
  })

  await insert(db, {
    quote: "I have not failed. I've just found 10,000 ways that won't work.",
    author: 'Thomas A. Edison',
    genre: 'tech',
    colors: ['red', 'blue']
  })

  await insert(db, {
    quote: 'The only way to do great work is to love what you do.',
    author: 'Steve Jobs'
  })

  return db
}

describe('binary persistence', () => {
  it('should generate a persistence file on the disk with random name', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, {
      mode: 'fulltext',
      term: 'way'
    })

    const q2 = await search(db, {
      mode: 'fulltext',
      term: 'i'
    })

    // Persist database on disk in binary format
    const path = await persistToFile(db, 'binary')
    onTestFinished(rmTeardown(path))

    // Load database from disk in binary format
    const db2 = await restoreFromFile('binary')

    const qp1 = await search(db2, {
      mode: 'fulltext',
      term: 'way'
    })

    const qp2 = await search(db2, {
      mode: 'fulltext',
      term: 'i'
    })

    // Queries on the loaded database should match the original database
    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
    expect(q2.hits).toEqual(qp2.hits)
  })

  it('should generate a persistence file on the disk with a given name', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, {
      mode: 'fulltext',
      term: 'way'
    })

    const q2 = await search(db, {
      mode: 'fulltext',
      term: 'i'
    })

    // Persist database on disk in binary format
    const path = await persistToFile(db, 'binary', 'test.dpack')
    onTestFinished(rmTeardown(path))

    // Load database from disk in binary format
    const db2 = await restoreFromFile('binary', 'test.dpack')

    const qp1 = await search(db2, {
      mode: 'fulltext',
      term: 'way'
    })

    const qp2 = await search(db2, {
      mode: 'fulltext',
      term: 'i'
    })

    // Queries on the loaded database should match the original database
    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
    expect(q2.hits).toEqual(qp2.hits)
  })

  it('should generate a persistence file on the disk using ZBSEARCH_DB_NAME env', async () => {
    let currentZBSearchDBNameValue: string | undefined

    if (typeof Deno !== 'undefined') {
      currentZBSearchDBNameValue = Deno.env.get('ZBSEARCH_DB_NAME')
      Deno.env.set('ZBSEARCH_DB_NAME', 'example_db_dump')
    } else {
      currentZBSearchDBNameValue = process.env.ZBSEARCH_DB_NAME
      process.env.ZBSEARCH_DB_NAME = 'example_db_dump'
    }

    const db = await generateTestDBInstance()
    const q1 = await search(db, {
      mode: 'fulltext',
      term: 'way'
    })

    const q2 = await search(db, {
      mode: 'fulltext',
      term: 'i'
    })

    // Persist database on disk in binary format
    const path = await persistToFile(db, 'binary')
    onTestFinished(rmTeardown(path))
    expect(path).toMatch('example_db_dump')

    // Load database from disk in binary format
    const db2 = await restoreFromFile('binary', path)

    const qp1 = await search(db2, {
      mode: 'fulltext',
      term: 'way'
    })

    const qp2 = await search(db2, {
      mode: 'fulltext',
      term: 'i'
    })

    // Queries on the loaded database should match the original database
    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
    expect(q2.hits).toEqual(qp2.hits)

    if (currentZBSearchDBNameValue) {
      if (typeof Deno !== 'undefined') {
        Deno.env.set('ZBSEARCH_DB_NAME', currentZBSearchDBNameValue)
      } else {
        process.env.ZBSEARCH_DB_NAME = currentZBSearchDBNameValue
      }
    }
  })

  it('should continue to work with `enum`', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, {
      mode: 'fulltext',
      where: {
        genre: { eq: 'way' }
      }
    })

    const path = await persistToFile(db, 'binary', 'test.dpack')
    onTestFinished(rmTeardown(path))

    const db2 = await restoreFromFile('binary', 'test.dpack')

    const qp1 = await search(db2, {
      mode: 'fulltext',
      where: {
        genre: { eq: 'way' }
      }
    })

    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
  })

  it('should continue to work with `enum[]`', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, {
      mode: 'fulltext',
      where: {
        colors: { containsAll: ['green'] }
      }
    })

    const path = await persistToFile(db, 'binary', 'test.dpack')
    onTestFinished(rmTeardown(path))

    const db2 = await restoreFromFile('binary', 'test.dpack')

    const qp1 = await search(db2, {
      mode: 'fulltext',
      where: {
        colors: { containsAll: ['green'] }
      }
    })

    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
  })
})

describe('json persistence', () => {
  it('should generate a persistence file on the disk with random name and json format', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, {
      mode: 'fulltext',
      term: 'way'
    })

    const q2 = await search(db, {
      mode: 'fulltext',
      term: 'i'
    })

    // Persist database on disk in json format
    const path = await persistToFile(db, 'json')
    onTestFinished(rmTeardown(path))

    // Load database from disk in json format
    const db2 = await restoreFromFile('json')

    const qp1 = await search(db2, {
      mode: 'fulltext',
      term: 'way'
    })

    const qp2 = await search(db2, {
      mode: 'fulltext',
      term: 'i'
    })

    // Queries on the loaded database should match the original database
    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
    expect(q2.hits).toEqual(qp2.hits)
  })

  it('should generate a persistence file on the disk with support for vectors', async () => {
    const db1 = await create({
      schema: {
        text: 'string',
        vector: 'vector[5]'
      } as const
    })

    await insert(db1, { text: 'vector 1', vector: [1, 0, 0, 0, 0] })
    await insert(db1, { text: 'vector 2', vector: [1, 1, 0, 0, 0] })
    await insert(db1, { text: 'vector 3', vector: [0, 0, 0, 0, 0] })

    // Persist database on disk in json format
    const path = await persistToFile(db1, 'json', 'test.json')
    onTestFinished(rmTeardown(path))

    // Load database from disk in json format
    const db2 = await restoreFromFile('json', 'test.json')

    const qp1 = await search(db1, {
      mode: 'vector',
      vector: {
        value: [1, 0, 0, 0, 0],
        property: 'vector'
      }
    })

    const qp2 = await search(db2, {
      mode: 'vector',
      vector: {
        value: [1, 0, 0, 0, 0],
        property: 'vector'
      }
    })

    // Queries on the loaded database should match the original database
    expect(qp1.hits).toEqual(qp2.hits)
  })

  it('should generate a persistence file on the disk with a given name and json format', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, {
      mode: 'fulltext',
      term: 'way'
    })

    const q2 = await search(db, {
      mode: 'fulltext',
      term: 'i'
    })

    // Persist database on disk in json format
    const path = await persistToFile(db, 'json', 'test.json')
    onTestFinished(rmTeardown(path))

    // Load database from disk in json format
    const db2 = await restoreFromFile('json', 'test.json')

    const qp1 = await search(db2, {
      mode: 'fulltext',
      term: 'way'
    })

    const qp2 = await search(db2, {
      mode: 'fulltext',
      term: 'i'
    })

    // Queries on the loaded database should match the original database
    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
    expect(q2.hits).toEqual(qp2.hits)
  })

  it('should continue to work with `enum`', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, {
      mode: 'fulltext',
      where: {
        genre: { eq: 'way' }
      }
    })

    const path = await persistToFile(db, 'json', 'test.json')
    onTestFinished(rmTeardown(path))

    const db2 = await restoreFromFile('json', 'test.json')

    const qp1 = await search(db2, {
      mode: 'fulltext',
      where: {
        genre: { eq: 'way' }
      }
    })

    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
  })

  it('should continue to work with `enum[]`', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, {
      mode: 'fulltext',
      where: {
        colors: { containsAll: ['green'] }
      }
    })

    const path = await persistToFile(db, 'json', 'test.json')
    onTestFinished(rmTeardown(path))

    const db2 = await restoreFromFile('json', 'test.json')

    const qp1 = await search(db2, {
      mode: 'fulltext',
      where: {
        colors: { containsAll: ['green'] }
      }
    })

    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
  })
})

describe('dpack persistence', () => {
  it('should generate a persistence file on the disk with random name and dpack format', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, {
      mode: 'fulltext',
      term: 'way'
    })

    const q2 = await search(db, {
      mode: 'fulltext',
      term: 'i'
    })

    // Persist database on disk in dpack format
    const path = await persistToFile(db, 'dpack')
    onTestFinished(rmTeardown(path))

    // Load database from disk in dpack format
    const db2 = await restoreFromFile('dpack')

    const qp1 = await search(db2, {
      mode: 'fulltext',
      term: 'way'
    })

    const qp2 = await search(db2, {
      mode: 'fulltext',
      term: 'i'
    })

    // Queries on the loaded database should match the original database
    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
    expect(q2.hits).toEqual(qp2.hits)
  })

  it('should generate a persistence file on the disk with a given name and dpack format', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, {
      mode: 'fulltext',
      term: 'way'
    })

    const q2 = await search(db, {
      mode: 'fulltext',
      term: 'i'
    })

    // Persist database on disk in json format
    const path = await persistToFile(db, 'dpack', 'test.dpack')
    onTestFinished(rmTeardown(path))

    // Load database from disk in json format
    const db2 = await restoreFromFile('dpack', 'test.dpack')

    const qp1 = await search(db2, {
      mode: 'fulltext',
      term: 'way'
    })

    const qp2 = await search(db2, {
      mode: 'fulltext',
      term: 'i'
    })

    // Queries on the loaded database should match the original database
    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
    expect(q2.hits).toEqual(qp2.hits)
  })

  it('should continue to work with `enum`', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, {
      mode: 'fulltext',
      where: {
        genre: { eq: 'way' }
      }
    })

    const path = await persistToFile(db, 'dpack', 'test.dpack')
    onTestFinished(rmTeardown(path))

    const db2 = await restoreFromFile('dpack', 'test.dpack')

    const qp1 = await search(db2, {
      mode: 'fulltext',
      where: {
        genre: { eq: 'way' }
      }
    })

    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
  })

  it('should continue to work with `enum[]`', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, {
      mode: 'fulltext',
      where: {
        colors: { containsAll: ['green'] }
      }
    })

    const path = await persistToFile(db, 'dpack', 'test.dpack')
    onTestFinished(rmTeardown(path))

    const db2 = await restoreFromFile('dpack', 'test.dpack')

    const qp1 = await search(db2, {
      mode: 'fulltext',
      where: {
        colors: { containsAll: ['green'] }
      }
    })

    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
  })
})

describe('seqproto persistence', () => {
  it('should generate a persistence file on the disk with random name (seqproto)', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, { mode: 'fulltext', term: 'way' })
    const q2 = await search(db, { mode: 'fulltext', term: 'i' })
    const path = await persistToFile(db, 'seqproto')
    onTestFinished(rmTeardown(path))
    const db2 = await restoreFromFile('seqproto')
    const qp1 = await search(db2, { mode: 'fulltext', term: 'way' })
    const qp2 = await search(db2, { mode: 'fulltext', term: 'i' })
    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
    expect(hitsApproxEqual(q2.hits, qp2.hits)).toBeTruthy()
  })

  it('should generate a persistence file on the disk with a given name (seqproto)', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, { mode: 'fulltext', term: 'way' })
    const q2 = await search(db, { mode: 'fulltext', term: 'i' })
    const path = await persistToFile(db, 'seqproto', 'test.seqp')
    onTestFinished(rmTeardown(path))
    const db2 = await restoreFromFile('seqproto', 'test.seqp')
    const qp1 = await search(db2, { mode: 'fulltext', term: 'way' })
    const qp2 = await search(db2, { mode: 'fulltext', term: 'i' })
    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
    expect(hitsApproxEqual(q2.hits, qp2.hits)).toBeTruthy()
  })

  it('should generate a persistence file on the disk using ZBSEARCH_DB_NAME env (seqproto)', async () => {
    let currentZBSearchDBNameValue: string | undefined
    if (typeof Deno !== 'undefined') {
      currentZBSearchDBNameValue = Deno.env.get('ZBSEARCH_DB_NAME')
      Deno.env.set('ZBSEARCH_DB_NAME', 'example_db_dump_seqproto')
    } else {
      currentZBSearchDBNameValue = process.env.ZBSEARCH_DB_NAME
      process.env.ZBSEARCH_DB_NAME = 'example_db_dump_seqproto'
    }
    const db = await generateTestDBInstance()
    const q1 = await search(db, { mode: 'fulltext', term: 'way' })
    const q2 = await search(db, { mode: 'fulltext', term: 'i' })
    const path = await persistToFile(db, 'seqproto')
    onTestFinished(rmTeardown(path))
    expect(path).toMatch('example_db_dump_seqproto')
    const db2 = await restoreFromFile('seqproto', path)
    const qp1 = await search(db2, { mode: 'fulltext', term: 'way' })
    const qp2 = await search(db2, { mode: 'fulltext', term: 'i' })
    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
    expect(hitsApproxEqual(q2.hits, qp2.hits)).toBeTruthy()
    if (currentZBSearchDBNameValue) {
      if (typeof Deno !== 'undefined') {
        Deno.env.set('ZBSEARCH_DB_NAME', currentZBSearchDBNameValue)
      } else {
        process.env.ZBSEARCH_DB_NAME = currentZBSearchDBNameValue
      }
    }
  })

  it('should continue to work with `enum` (seqproto)', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, { mode: 'fulltext', where: { genre: { eq: 'way' } } })
    const path = await persistToFile(db, 'seqproto', 'test_enum.seqp')
    onTestFinished(rmTeardown(path))
    const db2 = await restoreFromFile('seqproto', 'test_enum.seqp')
    const qp1 = await search(db2, { mode: 'fulltext', where: { genre: { eq: 'way' } } })
    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
  })

  it('should continue to work with `enum[]` (seqproto)', async () => {
    const db = await generateTestDBInstance()
    const q1 = await search(db, { mode: 'fulltext', where: { colors: { containsAll: ['green'] } } })
    const path = await persistToFile(db, 'seqproto', 'test_enum_arr.seqp')
    onTestFinished(rmTeardown(path))
    const db2 = await restoreFromFile('seqproto', 'test_enum_arr.seqp')
    const qp1 = await search(db2, { mode: 'fulltext', where: { colors: { containsAll: ['green'] } } })
    expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
  })
})

it('should persist data in-memory', async () => {
  const db = await generateTestDBInstance()

  const q1 = await search(db, {
    mode: 'fulltext',
    term: 'way'
  })

  const q2 = await search(db, {
    mode: 'fulltext',
    term: 'i'
  })

  // Persist database in-memory
  const binDB = await persist(db, 'binary')
  const jsonDB = await persist(db, 'json')
  const dpackDB = await persist(db, 'dpack')
  const seqprotoDB = await persist(db, 'seqproto')

  // Load database from in-memory
  const binDB2 = await restore('binary', binDB)
  const jsonDB2 = await restore('json', jsonDB)
  const dpackDB2 = await restore('dpack', dpackDB)
  const seqprotoDB2 = await restore('seqproto', seqprotoDB)

  const qp1 = await search(binDB2, {
    mode: 'fulltext',
    term: 'way'
  })

  const qp2 = await search(jsonDB2, {
    mode: 'fulltext',
    term: 'i'
  })

  const qp3 = await search(dpackDB2, {
    mode: 'fulltext',
    term: 'way'
  })

  const qp4 = await search(dpackDB2, {
    mode: 'fulltext',
    term: 'i'
  })

  const qp5 = await search(seqprotoDB2, {
    mode: 'fulltext',
    term: 'way'
  })

  // Queries on the loaded database should match the original database
  expect(hitsApproxEqual(q1.hits, qp1.hits)).toBeTruthy()
  expect(q2.hits).toEqual(qp2.hits)
  expect(hitsApproxEqual(q1.hits, qp3.hits)).toBeTruthy()
  expect(q2.hits).toEqual(qp4.hits)
  expect(hitsApproxEqual(q1.hits, qp5.hits)).toBeTruthy()
})

describe('errors', () => {
  it('should throw an error when trying to persist a database in an unsupported format', async () => {
    const db = await generateTestDBInstance()
    try {
      // @ts-expect-error - 'unsupported' is not a supported format
      await persistToFile(db, 'unsupported')
    } catch ({ message }) {
      expect(message).toMatch('Unsupported serialization format: unsupported')
    }
  })

  it('should throw an error when trying to restoreFromFile a database from an unsupported format', async () => {
    const format = 'unsupported'
    const db = await generateTestDBInstance()
    const path = await persistToFile(db, 'binary', 'supported')
    onTestFinished(rmTeardown(path))

    try {
      // @ts-expect-error - 'unsupported' is not a supported format
      await restoreFromFile(format, path)
    } catch ({ message }) {
      expect(message).toMatchObject(UNSUPPORTED_FORMAT(format))
    }
  })
})

it('should throw an error when trying to use a deprecated method', async () => {
  const db = await generateTestDBInstance()

  try {
    await deprecatedPersistToFile(db, 'binary')
  } catch ({ message }) {
    expect(message).toMatchObject(METHOD_MOVED('persistToFile'))
  }

  try {
    await deprecatedRestoreFromFile('binary', 'path')
  } catch ({ message }) {
    expect(message).toMatchObject(METHOD_MOVED('restoreFromFile'))
  }
})

describe('pinning rules persistence', () => {
  it('should persist and restore pinning rules (binary)', async () => {
    const db = create({
      schema: {
        quote: 'string',
        author: 'string'
      } as const
    })

    const _id1 = await insert(db, { id: '1', quote: 'I am a great programmer', author: 'Bill Gates' })
    const _id2 = await insert(db, {
      id: '2',
      quote: 'Be yourself; everyone else is already taken.',
      author: 'Oscar Wilde'
    })

    // When searching for "great", pin "Oscar Wilde" quote to position 0
    insertPin(db, {
      id: 'test-rule-1',
      conditions: [{ anchoring: 'contains', pattern: 'great' }],
      consequence: {
        promote: [{ doc_id: '2', position: 0 }]
      }
    })

    // Search - With pinning rule, Oscar Wilde quote should be at position 0
    const q1 = await search(db, { mode: 'fulltext', term: 'great' })
    expect(q1.hits[0].id, 'Pinned document should be first').toEqual('2')

    // Persist and restore
    const path = await persistToFile(db, 'binary', 'test_pinning.bin')
    onTestFinished(rmTeardown(path))
    const db2 = await restoreFromFile('binary', 'test_pinning.bin')

    // Search on restored database - pinning should still work
    const qp1 = await search(db2, { mode: 'fulltext', term: 'great' })
    expect(qp1.hits[0].id, 'Pinned document should be first after restore').toEqual('2')

    const rules = getAllPins(db2)
    expect(rules.length, 'Pinning rule should be persisted').toEqual(1)
  })

  it('should persist and restore pinning rules (json)', async () => {
    const db = create({
      schema: {
        quote: 'string',
        author: 'string'
      } as const
    })

    await insert(db, { id: '1', quote: 'I am a great programmer', author: 'Bill Gates' })
    await insert(db, {
      id: '3',
      quote: "I have not failed. I've just found 10,000 ways that won't work.",
      author: 'Thomas A. Edison'
    })

    insertPin(db, {
      id: 'test-rule-2',
      conditions: [{ anchoring: 'starts_with', pattern: 'i' }],
      consequence: {
        promote: [{ doc_id: '3', position: 0 }]
      }
    })

    const q1 = await search(db, { mode: 'fulltext', term: 'i have' })
    expect(q1.hits[0].id, 'Pinned document should be first').toEqual('3')

    const path = await persistToFile(db, 'json', 'test_pinning.json')
    onTestFinished(rmTeardown(path))
    const db2 = await restoreFromFile('json', 'test_pinning.json')

    const qp1 = await search(db2, { mode: 'fulltext', term: 'i have' })
    expect(qp1.hits[0].id, 'Pinned document should be first after restore').toEqual('3')

    const rules = getAllPins(db2)
    expect(rules.length, 'Pinning rule should be persisted').toEqual(1)
  })

  it('should persist and restore pinning rules (dpack)', async () => {
    const db = create({
      schema: {
        quote: 'string',
        author: 'string'
      } as const
    })

    await insert(db, { id: '4', quote: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' })

    insertPin(db, {
      id: 'test-rule-3',
      conditions: [{ anchoring: 'is', pattern: 'work' }],
      consequence: {
        promote: [{ doc_id: '4', position: 0 }]
      }
    })

    const q1 = await search(db, { mode: 'fulltext', term: 'work' })
    expect(q1.hits[0].id, 'Pinned document should be first').toEqual('4')

    const path = await persistToFile(db, 'dpack', 'test_pinning.dpack')
    onTestFinished(rmTeardown(path))
    const db2 = await restoreFromFile('dpack', 'test_pinning.dpack')

    const qp1 = await search(db2, { mode: 'fulltext', term: 'work' })
    expect(qp1.hits[0].id, 'Pinned document should be first after restore').toEqual('4')

    const rules = getAllPins(db2)
    expect(rules.length, 'Pinning rule should be persisted').toEqual(1)
  })

  it('should persist and restore pinning rules (seqproto)', async () => {
    const db = create({
      schema: {
        quote: 'string',
        author: 'string'
      } as const
    })

    await insert(db, { id: '1', quote: 'I am a great programmer', author: 'Bill Gates' })
    await insert(db, { id: '2', quote: 'Be yourself; everyone else is already taken.', author: 'Oscar Wilde' })
    await insert(db, { id: '3', quote: 'To be or not to be', author: 'Shakespeare' })

    insertPin(db, {
      id: 'test-rule-4',
      conditions: [{ anchoring: 'contains', pattern: 'programmer' }],
      consequence: {
        promote: [{ doc_id: '3', position: 0 }] // Pin doc 3, which doesn't match 'programmer'
      }
    })

    const q1 = await search(db, { mode: 'fulltext', term: 'programmer' })
    expect(q1.hits[0].id, 'Pinned document should be first').toEqual('3')

    const path = await persistToFile(db, 'seqproto', 'test_pinning.seqp')
    onTestFinished(rmTeardown(path))
    const db2 = await restoreFromFile('seqproto', 'test_pinning.seqp')

    const qp1 = await search(db2, { mode: 'fulltext', term: 'programmer' })
    expect(qp1.hits[0].id, 'Pinned document should be first after restore').toEqual('3')

    const rules = getAllPins(db2)
    expect(rules.length, 'Pinning rule should be persisted').toEqual(1)
  })
})

function rmTeardown(p: string) {
  return async () => {
    try {
      await rm(p)
    } catch {}
  }
}
