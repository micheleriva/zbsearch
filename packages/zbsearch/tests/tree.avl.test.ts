import { describe, expect, it } from 'vitest'
import { AVLTree } from '../src/trees/avl.js'

describe('AVL Tree', () => {
  it('create', async () => {
    const tree = new AVLTree<number, string>(1, ['foo'])
    expect(tree.getSize()).toBe(1)
    expect(tree.find(1)).toStrictEqual(new Set(['foo']))
    expect(tree.find(4)).toBe(null)
  })

  it('insert', async () => {
    const tree = new AVLTree(1, ['foo'])

    tree.insert(2, 'bar')
    tree.insert(10, 'baz')
    tree.insert(25, 'qux')
    tree.insert(5, 'quux')
    tree.insert(20, 'quuz')
    tree.insert(12, 'corge')

    expect(tree.getSize()).toBe(7)
  })

  it('find', async () => {
    const tree = new AVLTree(1, [1, 2, 3])

    tree.insertMultiple(2, [4, 5, 6])
    tree.insertMultiple(10, [7, 8, 9])
    tree.insertMultiple(25, [10, 11, 12])
    tree.insertMultiple(5, [13, 14, 15])
    tree.insertMultiple(20, [16, 17, 18])
    tree.insertMultiple(12, [19, 20, 21])

    expect(tree.contains(20)).toEqual(true)
    expect(tree.find(20)).toStrictEqual(new Set([16, 17, 18]))
  })

  it('remove', async () => {
    const tree = new AVLTree(1, ['foo'])

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
    const tree = new AVLTree(1, ['foo'])

    tree.insertMultiple(2, ['bar'])
    tree.insertMultiple(10, ['baz'])
    tree.insertMultiple(25, ['qux'])
    tree.insertMultiple(5, ['quux'])
    tree.insertMultiple(20, ['quuz'])
    tree.insertMultiple(12, ['corge'])

    expect(tree.rangeSearch(5, 20)).toStrictEqual(new Set(['quux', 'baz', 'corge', 'quuz']))
  })

  it('greaterThan', async () => {
    const tree = new AVLTree(1, ['foo'])

    tree.insertMultiple(2, ['bar'])
    tree.insertMultiple(10, ['baz'])
    tree.insertMultiple(25, ['qux'])
    tree.insertMultiple(5, ['quux'])
    tree.insertMultiple(20, ['quuz'])
    tree.insertMultiple(12, ['corge'])

    expect(tree.greaterThan(10)).toStrictEqual(new Set(['qux', 'quuz', 'corge']))
  })

  it('lessThan', async () => {
    const tree = new AVLTree(1, ['foo'])

    tree.insertMultiple(2, ['bar'])
    tree.insertMultiple(10, ['baz'])
    tree.insertMultiple(25, ['qux'])
    tree.insertMultiple(5, ['quux'])
    tree.insertMultiple(20, ['quuz'])
    tree.insertMultiple(12, ['corge'])

    expect(tree.lessThan(10)).toStrictEqual(new Set(['foo', 'bar', 'quux']))
  })
})
