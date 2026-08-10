import { describe, expect, it } from 'vitest'
import { AnyDocument, AnyZBSearch, create, search } from 'zbsearch'
import { populateFromGlob, defaultHtmlSchema as schema } from '../src/index.js'

function getDocs<T extends AnyZBSearch>(zbsearch: T): AnyDocument[] {
  return Object.values(zbsearch.data.docs.docs)
}

it('it should store the values', async () => {
  const db = await create({ schema })
  const filepath = 'test/fixtures/index.html'
  await populateFromGlob(db, filepath)
  expect((await search(db, { term: 'Test' })).hits.map(({ document }) => document)).toStrictEqual([
    { path: `${filepath}/root[1].html[0].head[1]`, content: 'Test', type: 'title', properties: {} }
  ])
})

describe('when there are multiple consecutive elements with text with the same tag', async () => {
  it('it should merge the values when the strategy is merge (default)', async () => {
    const db = await create({ schema })
    await populateFromGlob(db, 'test/fixtures/two-paragraphs.html')
    expect(getDocs(db).length).toBe(1)
  })

  it('it should keep records separated when the strategy is split', async () => {
    const db = await create({ schema })
    await populateFromGlob(db, 'test/fixtures/two-paragraphs.html', { mergeStrategy: 'split' })
    expect(getDocs(db).length).toBe(2)
  })

  it('it should keep separated and merged records when the strategy is both', async () => {
    const db = await create({ schema })
    await populateFromGlob(db, 'test/fixtures/two-paragraphs.html', { mergeStrategy: 'both' })
    expect(getDocs(db).length).toBe(3)
  })
})

it('it should not merge records when a different tag element goes in between', async () => {
  const db = await create({ schema })
  await populateFromGlob(db, 'test/fixtures/item-in-between.html')
  expect(getDocs(db).length).toBe(3)
})

it('it should not merge records when they belong to different containers', async () => {
  const db = await create({ schema })
  await populateFromGlob(db, 'test/fixtures/different-containers.html')
  expect(getDocs(db).length).toBe(2)
})

it('it should change tags when specified in a transformFn', async () => {
  const db = await create({ schema })
  const filepath = 'test/fixtures/h1.html'
  await populateFromGlob(db, filepath, {
    transformFn: (node) => (node.tag === 'h1' ? { ...node, tag: 'h2' } : node)
  })
  expect(getDocs(db)).toStrictEqual([
    { path: `${filepath}/root[0].html[1].body[0]`, content: 'Heading', type: 'h2', properties: {} }
  ])
})

it('it should change the content when specified in a transformFn', async () => {
  const db = await create({ schema })
  const filepath = 'test/fixtures/h1.html'
  await populateFromGlob(db, filepath, {
    transformFn: (node) => (node.tag === 'h1' ? { ...node, content: 'New content' } : node)
  })
  expect(getDocs(db)).toStrictEqual([
    { path: `${filepath}/root[0].html[1].body[0]`, content: 'New content', type: 'h1', properties: {} }
  ])
})

it('it should change the raw content when specified in a transformFn', async () => {
  const db = await create({ schema })
  const filepath = 'test/fixtures/h1.html'
  await populateFromGlob(db, filepath, {
    transformFn: (node) => (node.tag === 'h1' ? { ...node, raw: '<div><p>Hello</p></div>' } : node)
  })
  expect(getDocs(db)).toStrictEqual([
    { path: `${filepath}/root[0].html[1].body[0].div[0]`, content: 'Hello', type: 'p', properties: {} }
  ])
})

it('it should prioritize raw change over tag and content changes when both are specified', async () => {
  const db = await create({ schema })
  const filepath = 'test/fixtures/h1.html'
  await populateFromGlob(db, filepath, {
    transformFn: (node) =>
      node.tag === 'h1' ? { tag: 'h2', content: 'New content', raw: '<div><p>Hello</p></div>' } : node
  })
  expect(getDocs(db)).toStrictEqual([
    { path: `${filepath}/root[0].html[1].body[0].div[0]`, content: 'Hello', type: 'p', properties: {} }
  ])
})

it('it should parse markdown files', async () => {
  const db = await create({ schema })
  const filepath = 'test/fixtures/markdown.md'
  await populateFromGlob(db, filepath)
  expect(getDocs(db)).toStrictEqual([
    { path: `${filepath}/root[1].html[1].body[0]`, content: 'Title', type: 'h1', properties: {} },
    { path: `${filepath}/root[1].html[1].body[1]`, content: 'Some content', type: 'p', properties: {} },
    { path: `${filepath}/root[1].html[1].body[2]`, content: 'Subtitle', type: 'h2', properties: {} },
    { path: `${filepath}/root[1].html[1].body[3]`, content: 'Some more content', type: 'p', properties: {} }
  ])
})

it('should preserve the first property when there are multiple properties with the same name', async () => {
  const db = await create({ schema })
  const filepath = 'test/fixtures/merge-properties.html'
  await populateFromGlob(db, filepath, { mergeStrategy: 'merge' })
  expect(getDocs(db)).toStrictEqual([
    {
      path: `${filepath}/root[0].html[1].body[0]`,
      content: 'First Second',
      type: 'p',
      properties: { id: 'first' }
    }
  ])
})
