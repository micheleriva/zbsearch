import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import { concatBytes, decodeJson, encodeJson, encodeNdjsonLine, parseNdjson } from '../src/codec.js'

describe('codec', () => {
  it('roundtrips JSON', () => {
    const value = { a: 1, nested: { b: 'x' }, list: [1, 2] }
    assert.deepEqual(decodeJson(encodeJson(value)), value)
  })

  it('encodes empty object', () => {
    assert.equal(new TextDecoder().decode(encodeJson({})), '{}')
  })

  it('encodes ndjson lines with trailing newline', () => {
    const line = encodeNdjsonLine({ op: 'upsert', id: '1' })
    const text = new TextDecoder().decode(line)
    assert.equal(text.endsWith('\n'), true)
    assert.deepEqual(parseNdjson(text), [{ op: 'upsert', id: '1' }])
  })

  it('parses multiple ndjson lines', () => {
    const content = '{"a":1}\n{"b":2}\n\n{"c":3}\n'
    assert.deepEqual(parseNdjson(content), [{ a: 1 }, { b: 2 }, { c: 3 }])
  })

  it('concatenates byte arrays', () => {
    const a = new Uint8Array([1, 2])
    const b = new Uint8Array([3, 4, 5])
    assert.deepEqual([...concatBytes([a, b])], [1, 2, 3, 4, 5])
  })

  it('concatenates empty arrays', () => {
    assert.equal(concatBytes([]).byteLength, 0)
  })
})
