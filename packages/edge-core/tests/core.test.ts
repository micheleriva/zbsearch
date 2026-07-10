import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { applyBufferOps, encodeNdjsonLine, parseNdjson } from '../src/index.js'
import { bufferSegmentKey, nextSegmentName, snapshotKey } from '../src/paths.js'

describe('paths', () => {
  it('builds storage keys', () => {
    assert.equal(snapshotKey('products', 'v1'), 'indexes/products/v1/snapshot.msgpack')
    assert.equal(bufferSegmentKey('products', '000001.ndjson'), 'buffer/products/segments/000001.ndjson')
  })

  it('increments segment names', () => {
    assert.equal(nextSegmentName('000001.ndjson'), '000002.ndjson')
  })
})

describe('buffer', () => {
  it('applies upsert and delete ops', () => {
    const docs = new Map<string, Record<string, unknown>>([['1', { title: 'A' }]])
    const next = applyBufferOps(docs, [
      { op: 'upsert', id: '2', ts: 't', doc: { title: 'B' } },
      { op: 'delete', id: '1', ts: 't' }
    ])
    assert.equal(next.size, 1)
    assert.deepEqual(next.get('2'), { title: 'B' })
  })

  it('roundtrips ndjson lines', () => {
    const line = encodeNdjsonLine({ op: 'upsert', id: '1', ts: 't', doc: { x: 1 } })
    const parsed = parseNdjson(new TextDecoder().decode(line))
    assert.equal(parsed.length, 1)
  })
})
