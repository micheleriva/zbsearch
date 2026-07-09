/* eslint-disable no-extra-semi */
/* eslint-disable @typescript-eslint/no-this-alias */
import { Nullable } from '../types.js'

export class AVLNode<K, V> {
  public k: K
  public v: Set<V>
  public l: Nullable<AVLNode<K, V>> = null
  public r: Nullable<AVLNode<K, V>> = null
  public h: number = 1

  constructor(key: K, value: V[]) {
    this.k = key
    this.v = new Set(value)
  }

  public updateHeight(): void {
    const leftHeight = this.l ? this.l.h : 0
    const rightHeight = this.r ? this.r.h : 0
    this.h = leftHeight >= rightHeight ? leftHeight + 1 : rightHeight + 1
  }

  public static getHeight<K, V>(node: Nullable<AVLNode<K, V>>): number {
    return node ? node.h : 0
  }

  public getBalanceFactor(): number {
    return (this.l ? this.l.h : 0) - (this.r ? this.r.h : 0)
  }

  public rotateLeft(): AVLNode<K, V> {
    const newRoot = this.r as AVLNode<K, V>
    this.r = newRoot.l
    newRoot.l = this
    this.updateHeight()
    newRoot.updateHeight()
    return newRoot
  }

  public rotateRight(): AVLNode<K, V> {
    const newRoot = this.l as AVLNode<K, V>
    this.l = newRoot.r
    newRoot.r = this
    this.updateHeight()
    newRoot.updateHeight()
    return newRoot
  }

  public toJSON(): object {
    return {
      k: this.k,
      v: Array.from(this.v),
      l: this.l ? this.l.toJSON() : null,
      r: this.r ? this.r.toJSON() : null,
      h: this.h
    }
  }

  public static fromJSON<K, V>(json: any): AVLNode<K, V> {
    const node = new AVLNode<K, V>(json.k, json.v)
    node.l = json.l ? AVLNode.fromJSON<K, V>(json.l) : null
    node.r = json.r ? AVLNode.fromJSON<K, V>(json.r) : null
    node.h = json.h
    return node
  }
}

export class AVLTree<K, V> {
  public root: Nullable<AVLNode<K, V>> = null
  private insertCount = 0

  constructor(key?: K, value?: V[]) {
    if (key !== undefined && value !== undefined) {
      this.root = new AVLNode(key, value)
    }
  }

  public insert(key: K, value: V, rebalanceThreshold = 1000): void {
    this.root = this.insertNode(this.root, key, value, rebalanceThreshold)
  }

  public insertMultiple(key: K, value: V[], rebalanceThreshold = 1000): void {
    for (let i = 0; i < value.length; i++) {
      this.insert(key, value[i], rebalanceThreshold)
    }
  }

  // Rebalance the tree if the insert count reaches the threshold.
  // This will improve insertion performance since we won't be rebalancing the tree on every insert.
  // When inserting docs using `insertMultiple`, the threshold will be set to the number of docs being inserted.
  // We can force rebalancing the tree by setting the threshold to 1 (default).
  public rebalance() {
    if (this.root) {
      this.root = this.rebalanceNode(this.root!)
    }
  }

  public toJSON(): object {
    return {
      root: this.root ? this.root.toJSON() : null,
      insertCount: this.insertCount
    }
  }

  public static fromJSON<K, V>(json: any): AVLTree<K, V> {
    const tree = new AVLTree<K, V>()
    tree.root = json.root ? AVLNode.fromJSON<K, V>(json.root) : null
    tree.insertCount = json.insertCount || 0
    return tree
  }

  private insertNode(node: Nullable<AVLNode<K, V>>, key: K, value: V, rebalanceThreshold: number): AVLNode<K, V> {
    if (node === null) {
      return new AVLNode(key, [value])
    }

    const willRebalance = rebalanceThreshold === 1 || (this.insertCount + 1) % rebalanceThreshold === 0
    const pathNodes: AVLNode<K, V>[] = []
    const pathParents: Array<Nullable<AVLNode<K, V>>> = willRebalance ? [] : []
    let current = node
    let parent: Nullable<AVLNode<K, V>> = null

    while (current !== null) {
      pathNodes.push(current)
      if (willRebalance) {
        pathParents.push(parent)
      }

      const currentKey = current.k
      if (key < currentKey) {
        const left = current.l
        if (left === null) {
          const newNode = new AVLNode(key, [value])
          current.l = newNode
          pathNodes.push(newNode)
          if (willRebalance) {
            pathParents.push(current)
          }
          break
        }
        parent = current
        current = left
      } else if (key > currentKey) {
        const right = current.r
        if (right === null) {
          const newNode = new AVLNode(key, [value])
          current.r = newNode
          pathNodes.push(newNode)
          if (willRebalance) {
            pathParents.push(current)
          }
          break
        }
        parent = current
        current = right
      } else {
        current.v.add(value)
        return node
      }
    }

    this.insertCount++

    if (willRebalance) {
      for (let i = pathNodes.length - 1; i >= 0; i--) {
        const currentNode = pathNodes[i]
        const nodeParent = pathParents[i]
        currentNode.updateHeight()

        const balanceFactor = currentNode.getBalanceFactor()
        if (balanceFactor > 1 || balanceFactor < -1) {
          const rebalancedNode = this.rebalanceNode(currentNode)
          if (nodeParent) {
            if (nodeParent.l === currentNode) {
              nodeParent.l = rebalancedNode
            } else {
              nodeParent.r = rebalancedNode
            }
          } else {
            node = rebalancedNode
          }
        }
      }
    } else {
      for (let i = pathNodes.length - 1; i >= 0; i--) {
        pathNodes[i].updateHeight()
      }
    }

    return node
  }

  private rebalanceNode(node: AVLNode<K, V>): AVLNode<K, V> {
    const balanceFactor = node.getBalanceFactor()

    if (balanceFactor > 1) {
      const left = node.l
      if (left && left.getBalanceFactor() >= 0) {
        return node.rotateRight()
      }
      if (left) {
        node.l = left.rotateLeft()
        return node.rotateRight()
      }
    }

    if (balanceFactor < -1) {
      const right = node.r
      if (right && right.getBalanceFactor() <= 0) {
        return node.rotateLeft()
      }
      if (right) {
        node.r = right.rotateRight()
        return node.rotateLeft()
      }
    }

    return node
  }

  public find(key: K): Nullable<Set<V>> {
    const node = this.findNodeByKey(key)
    return node ? node.v : null
  }

  public contains(key: K): boolean {
    let node = this.root
    while (node !== null) {
      const nodeKey = node.k
      if (key < nodeKey) {
        node = node.l
      } else if (key > nodeKey) {
        node = node.r
      } else {
        return true
      }
    }
    return false
  }

  public getSize(): number {
    let count = 0
    const stack: AVLNode<K, V>[] = []
    let current = this.root

    while (current || stack.length > 0) {
      while (current) {
        stack.push(current)
        current = current.l
      }
      current = stack.pop()!
      count++
      current = current.r
    }

    return count
  }

  public isBalanced(): boolean {
    if (!this.root) return true

    const stack: AVLNode<K, V>[] = [this.root]

    while (stack.length > 0) {
      const node = stack.pop()!
      const balanceFactor = node.getBalanceFactor()
      if (balanceFactor > 1 || balanceFactor < -1) {
        return false
      }

      if (node.l) stack.push(node.l)
      if (node.r) stack.push(node.r)
    }

    return true
  }

  public remove(key: K): void {
    this.root = this.removeNode(this.root, key)
  }

  public removeDocument(key: K, id: V) {
    const node = this.findNodeByKey(key)

    if (!node) {
      return
    }

    if (node.v.size === 1) {
      this.root = this.removeNode(this.root, key)
    } else {
      node.v.delete(id)
    }
  }

  private findNodeByKey(key: K): Nullable<AVLNode<K, V>> {
    let node = this.root
    while (node !== null) {
      const nodeKey = node.k
      if (key < nodeKey) {
        node = node.l
      } else if (key > nodeKey) {
        node = node.r
      } else {
        return node
      }
    }
    return null
  }

  private removeNode(node: Nullable<AVLNode<K, V>>, key: K): Nullable<AVLNode<K, V>> {
    if (node === null) return null

    const path: AVLNode<K, V>[] = []
    let current = node

    while (current !== null && current.k !== key) {
      path.push(current)
      if (key < current.k) {
        current = current.l!
      } else {
        current = current.r!
      }
    }

    if (current === null) {
      return node
    }

    if (current.l === null || current.r === null) {
      const child = current.l ?? current.r

      if (path.length === 0) {
        node = child
      } else {
        const parent = path[path.length - 1]
        if (parent.l === current) {
          parent.l = child
        } else {
          parent.r = child
        }
      }
    } else {
      let successorParent = current
      let successor = current.r!

      while (successor.l !== null) {
        successorParent = successor
        successor = successor.l
      }

      current.k = successor.k
      current.v = successor.v

      if (successorParent.l === successor) {
        successorParent.l = successor.r
      } else {
        successorParent.r = successor.r
      }

      current = successorParent
    }

    path.push(current)
    for (let i = path.length - 1; i >= 0; i--) {
      const currentNode = path[i]
      currentNode.updateHeight()
      const balanceFactor = currentNode.getBalanceFactor()
      if (balanceFactor > 1 || balanceFactor < -1) {
        const rebalancedNode = this.rebalanceNode(currentNode)
        if (i > 0) {
          const parent = path[i - 1]
          if (parent.l === currentNode) {
            parent.l = rebalancedNode
          } else {
            parent.r = rebalancedNode
          }
        } else {
          node = rebalancedNode
        }
      }
    }

    return node
  }

  public rangeSearch(min: K, max: K): Set<V> {
    const result = new Set<V>()
    const stack: AVLNode<K, V>[] = []
    let current = this.root

    while (current || stack.length > 0) {
      while (current) {
        if (current.k < min) {
          current = current.r
        } else {
          stack.push(current)
          current = current.l
        }
      }
      current = stack.pop()!
      if (current.k > max) {
        break
      }
      for (const value of current.v) {
        result.add(value)
      }
      current = current.r
    }

    return result
  }

  public greaterThan(key: K, inclusive = false): Set<V> {
    const result = new Set<V>()
    const stack: AVLNode<K, V>[] = []
    let current = this.root

    while (current || stack.length > 0) {
      while (current) {
        if (inclusive ? current.k < key : current.k <= key) {
          current = current.r
        } else {
          stack.push(current)
          current = current.r
        }
      }
      if (stack.length === 0) {
        break
      }
      current = stack.pop()!
      if ((inclusive && current.k >= key) || (!inclusive && current.k > key)) {
        for (const value of current.v) {
          result.add(value)
        }
        current = current.l
      } else {
        break
      }
    }

    return result
  }

  public lessThan(key: K, inclusive = false): Set<V> {
    const result = new Set<V>()
    const stack: AVLNode<K, V>[] = []
    let current = this.root

    while (current || stack.length > 0) {
      while (current) {
        if (inclusive ? current.k > key : current.k >= key) {
          current = current.l
        } else {
          stack.push(current)
          current = current.l
        }
      }
      if (stack.length === 0) {
        break
      }
      current = stack.pop()!
      if ((inclusive && current.k <= key) || (!inclusive && current.k < key)) {
        for (const value of current.v) {
          result.add(value)
        }
        current = current.r
      } else {
        break
      }
    }

    return result
  }
}
