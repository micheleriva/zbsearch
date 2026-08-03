import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Highlight, highlightStrategy } from '../src/index.js'

const TEXT = 'The quick brown fox jumps over the lazy dog'

test('wraps every match in a mark tag with the default class', () => {
  const result = new Highlight().highlight(TEXT, 'quick')

  assert.equal(result.HTML, 'The <mark class="zbsearch-highlight">quick</mark> brown fox jumps over the lazy dog')
})

test('reports the position of every match, with an inclusive end', () => {
  assert.deepEqual(new Highlight().highlight(TEXT, 'quick').positions, [{ start: 4, end: 8 }])
})

test('matches several terms at once', () => {
  assert.deepEqual(new Highlight().highlight(TEXT, 'quick fox').positions, [
    { start: 4, end: 8 },
    { start: 16, end: 18 }
  ])
})

test('ignores case by default', () => {
  assert.deepEqual(new Highlight().highlight(TEXT, 'QUICK').positions, [{ start: 4, end: 8 }])
})

test('honours caseSensitive', () => {
  assert.deepEqual(new Highlight({ caseSensitive: true }).highlight(TEXT, 'QUICK').positions, [])
  assert.deepEqual(new Highlight({ caseSensitive: true }).highlight(TEXT, 'quick').positions, [{ start: 4, end: 8 }])
})

test('accepts a custom tag and class', () => {
  const result = new Highlight({ HTMLTag: 'span', CSSClass: 'hit' }).highlight('a fox', 'fox')

  assert.equal(result.HTML, 'a <span class="hit">fox</span>')
})

test('partial match finds a term inside a word', () => {
  assert.deepEqual(new Highlight().highlight('the vector store', 'vec').positions, [{ start: 4, end: 6 }])
})

test('whole word match requires the whole word', () => {
  const options = { strategy: highlightStrategy.WHOLE_WORD_MATCH }

  assert.deepEqual(new Highlight(options).highlight('the vector store', 'vec').positions, [])
  assert.deepEqual(new Highlight(options).highlight('the vector store', 'vector').positions, [{ start: 4, end: 9 }])
})

test('whole word match anchors every term, not just the first and last', () => {
  const result = new Highlight({ strategy: highlightStrategy.WHOLE_WORD_MATCH }).highlight(
    'vectors and cats',
    'vector cat'
  )

  assert.deepEqual(result.positions, [])
})

test('partial match full word extends a match to the whole word', () => {
  const result = new Highlight({ strategy: highlightStrategy.PARTIAL_MATCH_FULL_WORD }).highlight(
    'the vectorised store',
    'vector'
  )

  assert.deepEqual(result.positions, [{ start: 4, end: 13 }])
})

test('an unknown strategy is rejected', () => {
  assert.throws(
    () => new Highlight({ strategy: 'nope' as never }).highlight(TEXT, 'quick'),
    /Invalid highlighter strategy/
  )
})

test('a term with regex metacharacters is matched literally', () => {
  const result = new Highlight().highlight('use a.b() here', 'a.b()')

  assert.deepEqual(result.positions, [{ start: 4, end: 8 }])
})

test('an empty search term leaves the text untouched', () => {
  const result = new Highlight().highlight(TEXT, '')

  assert.deepEqual(result.positions, [])
  assert.equal(result.HTML, TEXT)
})

test('a whitespace-only search term leaves the text untouched', () => {
  const result = new Highlight().highlight(TEXT, '   ')

  assert.deepEqual(result.positions, [])
  assert.equal(result.HTML, TEXT)
})

test('an empty text produces no matches', () => {
  const result = new Highlight().highlight('', 'quick')

  assert.deepEqual(result.positions, [])
  assert.equal(result.HTML, '')
})

test('a term that never occurs leaves the text untouched', () => {
  const result = new Highlight().highlight(TEXT, 'unicorn')

  assert.deepEqual(result.positions, [])
  assert.equal(result.HTML, TEXT)
})

test('trim returns the whole text when it already fits', () => {
  const result = new Highlight().highlight('short text', 'text')

  assert.equal(result.trim(100), 'short <mark class="zbsearch-highlight">text</mark>')
})

test('trim crops around the first match', () => {
  const text = `${'lorem ipsum '.repeat(20)}needle${' dolor sit'.repeat(20)}`
  const trimmed = new Highlight().highlight(text, 'needle').trim(40)

  assert.ok(trimmed.includes('<mark class="zbsearch-highlight">needle</mark>'), trimmed)
  assert.ok(trimmed.startsWith('...'), trimmed)
  assert.ok(trimmed.endsWith('...'), trimmed)
})

test('trim can be asked not to add an ellipsis', () => {
  const text = `${'lorem ipsum '.repeat(20)}needle${' dolor sit'.repeat(20)}`
  const trimmed = new Highlight().highlight(text, 'needle').trim(40, false)

  assert.ok(!trimmed.startsWith('...'), trimmed)
  assert.ok(!trimmed.endsWith('...'), trimmed)
})

test('trim keeps the head of the text when nothing matched', () => {
  const text = 'a'.repeat(100)
  const trimmed = new Highlight().highlight(text, 'unicorn').trim(10)

  assert.equal(trimmed, `${'a'.repeat(10)}...`)
})

test('trim does not cut when the match sits at the start', () => {
  const text = `needle${' dolor sit'.repeat(20)}`
  const trimmed = new Highlight().highlight(text, 'needle').trim(40)

  assert.ok(trimmed.startsWith('<mark class="zbsearch-highlight">needle</mark>'), trimmed)
})
