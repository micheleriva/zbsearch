import assert from 'node:assert/strict'
import { test } from 'node:test'
import { highlight, snippetAround } from '../src/highlight.js'

test('highlight returns a single unmatched segment when nothing matches', () => {
  assert.deepEqual(highlight('Getting started', 'vector'), [{ text: 'Getting started', match: false }])
})

test('highlight returns an empty array for empty text', () => {
  assert.deepEqual(highlight('', 'vector'), [])
})

test('highlight extends a match to the whole word it sits in', () => {
  assert.deepEqual(highlight('vector store', 'vec'), [
    { text: 'vector', match: true },
    { text: ' store', match: false }
  ])
})

test('highlight is case insensitive but preserves the original casing', () => {
  assert.deepEqual(highlight('Vector Search', 'vector'), [
    { text: 'Vector', match: true },
    { text: ' Search', match: false }
  ])
})

test('highlight never truncates a match past the end of the word', () => {
  assert.deepEqual(highlight('vec', 'vector'), [{ text: 'vec', match: false }])
})

test('highlight marks a whole word once when several terms hit it', () => {
  assert.deepEqual(highlight('vectors', 'vec vector'), [{ text: 'vectors', match: true }])
})

test('highlight handles several terms across the text', () => {
  assert.deepEqual(highlight('hybrid vector search', 'search hybrid'), [
    { text: 'hybrid', match: true },
    { text: ' vector ', match: false },
    { text: 'search', match: true }
  ])
})

test('highlight segments always reassemble into the original text', () => {
  const text = 'Install ZBSearch, then run `npm test` — twice.'

  for (const query of ['', 'install npm', 'zbsearch', 'nope', 'test twice']) {
    assert.equal(
      highlight(text, query)
        .map((segment) => segment.text)
        .join(''),
      text
    )
  }
})

test('highlight ignores an empty query', () => {
  assert.deepEqual(highlight('vector search', '   '), [{ text: 'vector search', match: false }])
})

test('snippetAround collapses whitespace and keeps short text intact', () => {
  assert.equal(snippetAround('  Install\n  ZBSearch  ', 'install'), 'Install ZBSearch')
})

test('snippetAround crops around the first match', () => {
  const text = `${'lorem ipsum '.repeat(20)}vector search ${'dolor sit '.repeat(20)}`
  const snippet = snippetAround(text, 'vector', 60)

  assert.ok(snippet.includes('vector search'), snippet)
  assert.ok(snippet.length <= 62, `snippet too long: ${snippet.length}`)
  assert.ok(snippet.startsWith('…'), snippet)
  assert.ok(snippet.endsWith('…'), snippet)
})

test('snippetAround keeps the opening words when nothing matches', () => {
  const snippet = snippetAround('alpha bravo charlie delta echo foxtrot golf hotel', 'zulu', 24)

  assert.ok(snippet.startsWith('alpha bravo'), snippet)
  assert.ok(!snippet.startsWith('…'), snippet)
  assert.ok(snippet.endsWith('…'), snippet)
})

test('snippetAround does not cut words in half', () => {
  const text = `${'alpha '.repeat(30)}vector ${'omega '.repeat(30)}`

  for (const word of snippetAround(text, 'vector', 80).replaceAll('…', '').trim().split(' ')) {
    assert.ok(['alpha', 'vector', 'omega'].includes(word), `unexpected fragment: ${word}`)
  }
})
