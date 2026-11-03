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

  it('remove keeps heights and balance correct when the successor is several levels deep', async () => {
    const tree = new AVLTree<number, number>()
    for (let key = 1; key <= 15; key++) {
      tree.insert(key, key, 1)
    }
    // Perfect tree rooted at 8. Trimming the right side means unlinking the successor shrinks 12.
    tree.remove(11)
    tree.remove(13)
    tree.remove(15)

    // 8 has two children and its successor 9 sits three levels down (8 -> 12 -> 10 -> 9),
    // so every node on that path must get its height updated and be rebalanced if needed.
    tree.remove(8)

    expect(checkTree(tree)).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 9, 10, 12, 14])
    expect(tree.root!.k).toBe(9)
    expect(tree.root!.r!.k).toBe(12)
    expect(tree.root!.r!.h).toBe(2)
  })

  it('remove keeps the tree valid while removing every key', async () => {
    const tree = new AVLTree<number, number>()
    const keys = Array.from({ length: 63 }, (_, i) => i + 1)
    for (const key of keys) {
      tree.insert(key, key, 1)
    }

    // A fixed scrambled order, so roots, inner nodes and leaves are all removed along the way.
    const order = keys.map((key) => (key * 37) % 64)
    const remaining = new Set(keys)
    for (const key of order) {
      tree.remove(key)
      remaining.delete(key)

      expect(checkTree(tree)).toStrictEqual([...remaining].sort((a, b) => a - b))
      expect(tree.contains(key)).toBe(false)
    }
    expect(tree.root).toBe(null)
  })
})

// Recomputes every node's height instead of trusting the stored one, checks it matches and that
// the node is balanced, and returns the keys in order.
function checkTree(tree: AVLTree<number, number>): number[] {
  const keys: number[] = []

  function visit(node: AVLTree<number, number>['root']): number {
    if (!node) {
      return 0
    }
    const leftHeight = visit(node.l)
    keys.push(node.k)
    const rightHeight = visit(node.r)
    const height = Math.max(leftHeight, rightHeight) + 1

    expect(node.h).toBe(height)
    expect(Math.abs(leftHeight - rightHeight)).toBeLessThanOrEqual(1)
    return height
  }

  visit(tree.root)
  expect(keys).toStrictEqual([...keys].sort((a, b) => a - b))
  return keys
}
