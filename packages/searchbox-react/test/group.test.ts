import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SearchHit } from '../src/types.js'
import { flattenGroups, groupHits, wrapIndex } from '../src/utils/group.js'

function hit(id: string, url: string, title: string, category?: string): SearchHit {
  return { id, url, title, category }
}

test('groupHits buckets hits that share a page', () => {
  const groups = groupHits([
    hit('1', '/docs/intro', 'Introduction'),
    hit('2', '/docs/intro#install', 'Introduction'),
    hit('3', '/docs/search', 'Search')
  ])

  assert.deepEqual(
    groups.map((group) => [group.id, group.hits.length]),
    [
      ['/docs/intro', 2],
      ['/docs/search', 1]
    ]
  )
})

test('groupHits preserves relevance order across and within groups', () => {
  const groups = groupHits([
    hit('1', '/b#one', 'B'),
    hit('2', '/a#one', 'A'),
    hit('3', '/b#two', 'B'),
    hit('4', '/a#two', 'A')
  ])

  assert.deepEqual(
    groups.map((group) => group.id),
    ['/b', '/a']
  )
  assert.deepEqual(
    flattenGroups(groups).map((item) => item.id),
    ['1', '3', '2', '4']
  )
})

test('groupHits takes the title and category from the best hit of each page', () => {
  const [group] = groupHits([
    hit('1', '/docs/intro#a', 'Introduction', 'Docs'),
    hit('2', '/docs/intro#b', 'Something else', 'Blog')
  ])

  assert.equal(group.title, 'Introduction')
  assert.equal(group.category, 'Docs')
})

test('groupHits returns nothing for no hits', () => {
  assert.deepEqual(groupHits([]), [])
})

test('wrapIndex moves forward and backward', () => {
  assert.equal(wrapIndex(0, 1, 3), 1)
  assert.equal(wrapIndex(2, -1, 3), 1)
})

test('wrapIndex wraps around both ends', () => {
  assert.equal(wrapIndex(2, 1, 3), 0)
  assert.equal(wrapIndex(0, -1, 3), 2)
})

test('wrapIndex reports no selection for an empty list', () => {
  assert.equal(wrapIndex(0, 1, 0), -1)
})
