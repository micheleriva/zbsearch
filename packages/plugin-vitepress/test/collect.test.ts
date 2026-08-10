import assert from 'node:assert/strict'
import { test } from 'vitest'
import { collectRecords, type ContentEntry, withBase } from '../src/collect.js'
import { resolveOptions } from '../src/options.js'

const options = resolveOptions()

function entry(url: string, src: string, frontmatter: Record<string, unknown> = {}): ContentEntry {
  return { url, src, frontmatter }
}

test('withBase leaves a root-based url alone', () => {
  assert.equal(withBase('/guides/a', '/'), '/guides/a')
})

test('withBase prefixes a configured base', () => {
  assert.equal(withBase('/guides/a', '/docs/'), '/docs/guides/a')
  assert.equal(withBase('/guides/a', '/docs'), '/docs/guides/a')
})

test('a page becomes one record per section', () => {
  const records = collectRecords(
    [
      entry(
        '/guides/search',
        ['Intro prose.', '', '## Vector search', '', 'Embeddings and cosine similarity.'].join('\n'),
        { title: 'Search' }
      )
    ],
    options
  )

  assert.deepEqual(
    records.map((record) => [record.section, record.url]),
    [
      ['', '/guides/search'],
      ['Vector search', '/guides/search#vector-search']
    ]
  )
})

test('the record carries the title and category', () => {
  const [record] = collectRecords([entry('/a', 'Body.', { title: 'Alpha' })], options)

  assert.equal(record.title, 'Alpha')
  assert.equal(record.category, 'Docs')
})

test('the category label can be overridden', () => {
  const [record] = collectRecords([entry('/a', 'Body.', { title: 'A' })], resolveOptions({ categoryLabel: 'Guide' }))

  assert.equal(record.category, 'Guide')
})

test('url segments become the breadcrumb of the hierarchy', () => {
  const [record] = collectRecords([entry('/guides/deploy-targets/vercel', 'Body.', { title: 'Vercel' })], options)

  assert.equal(record.hierarchy, 'Guides › Deploy Targets › Vercel')
})

test('the breadcrumb ignores a trailing .html', () => {
  const [record] = collectRecords([entry('/guides/vercel.html', 'Body.', { title: 'Vercel' })], options)

  assert.equal(record.hierarchy, 'Guides › Vercel')
})

test('nested headings are recorded as the display path', () => {
  const records = collectRecords(
    [entry('/a', ['## Parent', '', 'a', '', '### Child', '', 'b'].join('\n'), { title: 'A' })],
    options
  )

  assert.deepEqual(
    records.map((record) => [record.section, record.path]),
    [
      ['Parent', ''],
      ['Child', 'Parent']
    ]
  )
})

test('the site root is indexed at /', () => {
  const [record] = collectRecords([entry('/', 'Welcome.', { title: 'Home' })], options)

  assert.equal(record.url, '/')
  assert.equal(record.hierarchy, 'Home')
})

test('a base path is applied to every record', () => {
  const [record] = collectRecords([entry('/guides/a', 'Body.', { title: 'A' })], options, '/docs/')

  assert.equal(record.url, '/docs/guides/a')
})

test('drafts are skipped unless asked for', () => {
  const entries = [entry('/a', 'Body.', { title: 'A', draft: true })]

  assert.equal(collectRecords(entries, options).length, 0)
  assert.equal(collectRecords(entries, resolveOptions({ indexDrafts: true })).length, 1)
})

test('a page opting out with search: false is skipped', () => {
  assert.deepEqual(collectRecords([entry('/a', 'Body.', { title: 'A', search: false })], options), [])
})

test('the home layout is skipped', () => {
  assert.deepEqual(collectRecords([entry('/', 'Hero copy.', { layout: 'home' })], options), [])
})

test('excludeRoutes removes a whole subtree', () => {
  const entries = [
    entry('/public', 'Body.', { title: 'Public' }),
    entry('/internal/secret', 'Body.', { title: 'Secret' }),
    entry('/internal/deep/secret', 'Body.', { title: 'Deeper' })
  ]

  assert.deepEqual(
    collectRecords(entries, resolveOptions({ excludeRoutes: ['/internal/**'] })).map((record) => record.url),
    ['/public']
  )
})

test('a duplicated url is indexed once', () => {
  const entries = [entry('/a', 'Body.', { title: 'A' }), entry('/a', 'Other.', { title: 'A again' })]

  assert.equal(collectRecords(entries, options).length, 1)
})

test('the title falls back to a heading inside the body', () => {
  const [record] = collectRecords([entry('/a', '# From the heading\n\nBody.')], options)

  assert.equal(record.title, 'From the heading')
})

test('an entry with no source is skipped', () => {
  assert.deepEqual(collectRecords([{ url: '/a', frontmatter: { title: 'A' } }], options), [])
})
