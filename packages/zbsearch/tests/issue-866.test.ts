import { describe, expect, it } from 'vitest'
import { create, insert, search } from '../src/index.js'

describe('issue-866: exact search should only match exact terms', () => {
  it('should not match partial words when exact is true', async () => {
    const db = create({
      schema: {
        path: 'string',
        title: 'string'
      }
    })

    await insert(db, { path: 'First Note.md', title: 'First Note' })
    await insert(db, { path: 'Second Note.md', title: 'Second Note' })

    // Without exact, should match because "first" is a prefix
    const noExact = await search(db, {
      term: 'first',
      properties: ['path']
    })

    // With exact: true, should NOT match "First Note.md" because "first" !== "First"
    const withExact = await search(db, {
      term: 'first',
      properties: ['path'],
      exact: true
    })

    expect(noExact.count >= 1, 'Without exact, should find results with prefix match').toBeTruthy()
    expect(withExact.count, 'With exact: true, should not match "first" with "First"').toBe(0)
  })

  it('should match exact terms when exact is true', async () => {
    const db = create({
      schema: {
        path: 'string',
        title: 'string'
      }
    })

    await insert(db, { path: 'First Note.md', title: 'First Note' })
    await insert(db, { path: 'first note.md', title: 'first note' })
    await insert(db, { path: 'another first file.md', title: 'another' })

    // With exact: true, searching for "first" should only match documents with lowercase "first"
    const result = await search(db, {
      term: 'first',
      properties: ['path'],
      exact: true
    })

    expect(result.count, 'Should match exactly two documents with lowercase "first"').toBe(2)
    const paths = result.hits.map((h) => h.document.path).sort()
    expect(paths, 'Should match only lowercase versions').toStrictEqual(['another first file.md', 'first note.md'])
  })

  it('should not match prefix when exact is true', async () => {
    const db = create({
      schema: {
        name: 'string'
      }
    })

    await insert(db, { name: 'apple' })
    await insert(db, { name: 'application' })
    await insert(db, { name: 'app' })

    const noExact = await search(db, {
      term: 'app',
      prefix: true
    })

    // With exact: true, "app" should only match the document with "app"
    const withExact = await search(db, {
      term: 'app',
      exact: true
    })

    expect(noExact.count, 'With prefix: true, should match all prefix matches').toBe(3)
    expect(withExact.count, 'With exact: true, should only match exact term').toBe(1)
    expect(withExact.hits[0].document.name, 'Should match only "app"').toBe('app')
  })

  it('should handle case sensitivity with exact match', async () => {
    const db = create({
      schema: {
        name: 'string'
      }
    })

    await insert(db, { name: 'Test' })
    await insert(db, { name: 'test' })
    await insert(db, { name: 'testing' })
    await insert(db, { name: 'test again' })

    // With exact: true, searching for "test" should match only documents with lowercase "test"
    const result = await search(db, {
      term: 'test',
      exact: true
    })

    expect(result.count, 'Should match two documents with lowercase "test"').toBe(2)
    const names = result.hits.map((h) => h.document.name).sort()
    expect(names, 'Should match only lowercase versions').toStrictEqual(['test', 'test again'])
  })
})
