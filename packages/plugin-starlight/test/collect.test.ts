import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectRecords, type DocsEntry } from '../src/collect.js'
import { resolveOptions, type RouteOptions } from '../src/options.js'

const route: RouteOptions = { base: '/', format: 'directory', trailingSlash: 'ignore' }
const options = resolveOptions()

function entry(id: string, body: string, data: DocsEntry['data'] = {}): DocsEntry {
  return { id, body, data }
}

test('a page becomes one record per section', () => {
  const records = collectRecords(
    [
      entry(
        'guides/search',
        ['Intro prose.', '', '## Vector search', '', 'Embeddings and cosine similarity.'].join('\n'),
        { title: 'Search' }
      )
    ],
    options,
    route
  )

  assert.deepEqual(
    records.map((record) => [record.section, record.url]),
    [
      ['', '/guides/search/'],
      ['Vector search', '/guides/search/#vector-search']
    ]
  )
})

test('the record carries the title and category from the entry', () => {
  const [record] = collectRecords([entry('a', 'Body.', { title: 'Alpha' })], options, route)

  assert.equal(record.title, 'Alpha')
  assert.equal(record.category, 'Docs')
})

test('the category label can be overridden', () => {
  const [record] = collectRecords(
    [entry('a', 'Body.', { title: 'A' })],
    resolveOptions({ categoryLabel: 'Guide' }),
    route
  )

  assert.equal(record.category, 'Guide')
})

test('directories become the breadcrumb of the hierarchy', () => {
  const [record] = collectRecords([entry('guides/deploy-targets/vercel', 'Body.', { title: 'Vercel' })], options, route)

  assert.equal(record.hierarchy, 'Guides › Deploy Targets › Vercel')
})

test('nested headings are recorded as the display path', () => {
  const records = collectRecords(
    [entry('a', ['## Parent', '', 'a', '', '### Child', '', 'b'].join('\n'), { title: 'A' })],
    options,
    route
  )

  assert.deepEqual(
    records.map((record) => [record.section, record.path]),
    [
      ['Parent', ''],
      ['Child', 'Parent']
    ]
  )
})

test('the root index is indexed at the site root', () => {
  const [record] = collectRecords([entry('index', 'Welcome.', { title: 'Home' })], options, route)

  assert.equal(record.url, '/')
})

test('drafts are skipped unless asked for', () => {
  const entries = [entry('a', 'Body.', { title: 'A', draft: true })]

  assert.equal(collectRecords(entries, options, route).length, 0)
  assert.equal(collectRecords(entries, resolveOptions({ indexDrafts: true }), route).length, 1)
})

test('excludeRoutes removes a whole subtree', () => {
  const entries = [
    entry('public', 'Body.', { title: 'Public' }),
    entry('internal/secret', 'Body.', { title: 'Secret' }),
    entry('internal/deep/secret', 'Body.', { title: 'Deeper' })
  ]

  assert.deepEqual(
    collectRecords(entries, resolveOptions({ excludeRoutes: ['/internal/**'] }), route).map((record) => record.url),
    ['/public/']
  )
})

test('a base path is applied to every record', () => {
  const [record] = collectRecords([entry('guides/a', 'Body.', { title: 'A' })], options, { ...route, base: '/docs' })

  assert.equal(record.url, '/docs/guides/a/')
})

test('a page with no prose still produces its headings', () => {
  const records = collectRecords([entry('a', '## Reference', { title: 'A' })], options, route)

  assert.deepEqual(
    records.map((record) => record.section),
    ['Reference']
  )
})

test('an entry with no body is skipped', () => {
  assert.deepEqual(collectRecords([{ id: 'a', data: { title: 'A' } }], options, route), [])
})

test('the title falls back to a heading inside the body', () => {
  const [record] = collectRecords([entry('a', '# From the heading\n\nBody.')], options, route)

  assert.equal(record.title, 'From the heading')
})
