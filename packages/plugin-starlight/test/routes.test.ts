import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RouteOptions } from '../src/options.js'
import { createPathFormatter, slugToPathname } from '../src/routes.js'

const defaults: RouteOptions = { base: '/', format: 'directory', trailingSlash: 'ignore' }

test('slugToPathname maps the root index to the site root', () => {
  assert.equal(slugToPathname('index'), '/')
  assert.equal(slugToPathname(''), '/')
  assert.equal(slugToPathname('/'), '/')
})

test('slugToPathname turns a slug into a directory path', () => {
  assert.equal(slugToPathname('guides/vector-search'), '/guides/vector-search/')
})

test('slugToPathname collapses a nested index', () => {
  assert.equal(slugToPathname('guides/index'), '/guides/')
})

test('the formatter leaves a root-based directory path alone', () => {
  const format = createPathFormatter(defaults)

  assert.equal(format('/guides/example/'), '/guides/example/')
  assert.equal(format('/'), '/')
})

test('the formatter prefixes the configured base', () => {
  const format = createPathFormatter({ ...defaults, base: '/docs' })

  assert.equal(format('/guides/example/'), '/docs/guides/example/')
  assert.equal(format('/'), '/docs/')
})

test('the formatter tolerates a base with a trailing slash', () => {
  const format = createPathFormatter({ ...defaults, base: '/docs/' })

  assert.equal(format('/guides/example/'), '/docs/guides/example/')
})

test('the formatter honours trailingSlash never', () => {
  const format = createPathFormatter({ ...defaults, trailingSlash: 'never' })

  assert.equal(format('/guides/example/'), '/guides/example')
  assert.equal(format('/'), '/')
})

test('the formatter honours trailingSlash always', () => {
  const format = createPathFormatter({ ...defaults, trailingSlash: 'always' })

  assert.equal(format('/guides/example'), '/guides/example/')
})

test('the formatter emits html files for build.format file', () => {
  const format = createPathFormatter({ ...defaults, format: 'file' })

  assert.equal(format('/guides/example/'), '/guides/example.html')
  assert.equal(format('/'), '/index.html')
})

test('the formatter combines a base with html files', () => {
  const format = createPathFormatter({ base: '/docs', format: 'file', trailingSlash: 'ignore' })

  assert.equal(format('/guides/example/'), '/docs/guides/example.html')
})
