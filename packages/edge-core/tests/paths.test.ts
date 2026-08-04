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
  snapshotKey,
  walEntryFileName,
  walEntryKey,
  walHeadKey
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

  it('builds WAL keys', () => {
    assert.equal(walHeadKey('products'), 'wal/products/head.json')
    assert.equal(walEntryKey('products', 'entry.ndjson'), 'wal/products/entries/entry.ndjson')
    assert.equal(
      walEntryFileName(42, '2020-01-01T00:00:00.000Z', 'chg_abc'),
      '0000000042_2020-01-01T00-00-00-000Z_chg_abc.ndjson'
    )
  })

  it('increments segment names with padding', () => {
    assert.equal(nextSegmentName(null), '000001.ndjson')
    assert.equal(nextSegmentName('000001.ndjson'), '000002.ndjson')
    assert.equal(nextSegmentName('000099.ndjson'), '000100.ndjson')
  })

  it('generates version ids without colons or dots', () => {
    const version = newVersionId()
    assert.match(version, /^[\dT-]+Z-[0-9a-f]+$/)
    assert.equal(version.includes(':'), false)
    assert.equal(version.includes('.'), false)
  })

  it('generates unique version ids within the same millisecond', () => {
    assert.notEqual(newVersionId(), newVersionId())
  })

  it('generates change ids with prefix', () => {
    assert.match(newChangeId(), /^chg_[a-f0-9]{16}$/)
  })
})
