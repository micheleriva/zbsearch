import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  bufferHeadKey,
  bufferSegmentKey,
  indexMetaKey,
  newChangeId,
  newVersionId,
  nextSegmentName,
  registryKey,
  snapshotKey
} from '../src/paths.js'

describe('paths', () => {
  it('builds registry key', () => {
    assert.equal(registryKey(), 'registry.json')
  })

  it('builds index meta key', () => {
    assert.equal(indexMetaKey('my-index'), 'indexes/my-index/meta.json')
  })

  it('builds snapshot key', () => {
    assert.equal(snapshotKey('products', 'v1'), 'indexes/products/v1/snapshot.msgpack')
  })

  it('builds buffer keys', () => {
    assert.equal(bufferHeadKey('products'), 'buffer/products/head.json')
    assert.equal(bufferSegmentKey('products', '000001.ndjson'), 'buffer/products/segments/000001.ndjson')
  })

  it('increments segment names with padding', () => {
    assert.equal(nextSegmentName(null), '000001.ndjson')
    assert.equal(nextSegmentName('000001.ndjson'), '000002.ndjson')
    assert.equal(nextSegmentName('000099.ndjson'), '000100.ndjson')
  })

  it('generates version ids without colons or dots', () => {
    const version = newVersionId()
    assert.match(version, /^[\dT-]+Z?$/)
    assert.equal(version.includes(':'), false)
    assert.equal(version.includes('.'), false)
  })

  it('generates change ids with prefix', () => {
    assert.match(newChangeId(), /^chg_[a-f0-9]{16}$/)
  })
})
