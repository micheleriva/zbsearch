import { describe, expect, it } from 'vitest'
import { ZipTree } from '../src/trees/zip.js'

describe('ZIP Tree', () => {
  it('create', () => {
    const tree = new ZipTree()
    tree.insert(1, 'foo')
    expect(tree.getSize()).toBe(1)
    expect(tree.find(1)).toBe('foo')
    expect(tree.find(4)).toBe(null)
  })

  it('insert', () => {
    const tree = new ZipTree()

    tree.insert(1, 'foo')
    tree.insert(2, 'bar')
    tree.insert(10, 'baz')
    tree.insert(25, 'qux')
    tree.insert(5, 'quux')
    tree.insert(20, 'quuz')
    tree.insert(12, 'corge')

    expect(tree.getSize()).toBe(7)
  })

  it('find', async () => {
    const tree = new ZipTree()
    tree.insert(1, [1, 2, 3])

    tree.insert(2, [4, 5, 6])
    tree.insert(10, [7, 8, 9])
    tree.insert(25, [10, 11, 12])
    tree.insert(5, [13, 14, 15])
    tree.insert(20, [16, 17, 18])
    tree.insert(12, [19, 20, 21])

    expect(tree.contains(20)).toEqual(true)
    expect(tree.find(20)).toEqual([16, 17, 18])
  })

  it('remove', async () => {
    const tree = new ZipTree()
    tree.insert(1, 'foo')

    tree.insert(2, 'bar')
    tree.insert(10, 'baz')
    tree.insert(25, 'qux')
    tree.insert(5, 'quux')
    tree.insert(20, 'quuz')
    tree.insert(12, 'corge')

    tree.remove(20)

    expect(tree.getSize()).toBe(6)
    expect(tree.contains(20)).toBe(false)
  })

  it('rangeSearch', async () => {
    const tree = new ZipTree()
    tree.insert(1, 'foo')

    tree.insert(2, 'bar')
    tree.insert(10, 'baz')
    tree.insert(25, 'qux')
    tree.insert(5, 'quux')
    tree.insert(20, 'quuz')
    tree.insert(12, 'corge')

    expect(tree.rangeSearch(5, 20)).toEqual(['quux', 'baz', 'corge', 'quuz'])
  })

  it('greaterThan', async () => {
    const tree = new ZipTree()
    tree.insert(1, 'foo')

    tree.insert(2, 'bar')
    tree.insert(10, 'baz')
    tree.insert(25, 'qux')
    tree.insert(5, 'quux')
    tree.insert(20, 'quuz')
    tree.insert(12, 'corge')

    expect(tree.greaterThan(10)).toEqual(['corge', 'quuz', 'qux'])
  })

  it('lessThan', async () => {
    const tree = new ZipTree()
    tree.insert(1, 'foo')

    tree.insert(2, 'bar')
    tree.insert(10, 'baz')
    tree.insert(25, 'qux')
    tree.insert(5, 'quux')
    tree.insert(20, 'quuz')
    tree.insert(12, 'corge')

    expect(tree.lessThan(10)).toEqual(['foo', 'bar', 'quux'])
  })
})
