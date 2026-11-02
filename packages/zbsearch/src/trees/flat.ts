import { InternalDocumentID } from '../components/internal-document-id-store.js'
import { EnumArrComparisonOperator, EnumComparisonOperator, Nullable, ScalarSearchableValue } from '../types.js'

export class FlatTree {
  numberToDocumentId: Map<ScalarSearchableValue, Set<InternalDocumentID>>

  constructor() {
    this.numberToDocumentId = new Map()
  }

  insert(key: ScalarSearchableValue, value: InternalDocumentID): void {
    if (this.numberToDocumentId.has(key)) {
      this.numberToDocumentId.get(key)!.add(value)
    } else {
      this.numberToDocumentId.set(key, new Set([value]))
    }
  }

  find(key: ScalarSearchableValue): Nullable<InternalDocumentID[]> {
    const idSet = this.numberToDocumentId.get(key)
    return idSet ? Array.from(idSet) : null
  }

  remove(key: ScalarSearchableValue): void {
    this.numberToDocumentId.delete(key)
  }

  removeDocument(id: InternalDocumentID, key: ScalarSearchableValue): void {
    const idSet = this.numberToDocumentId.get(key)
    if (idSet) {
      idSet.delete(id)
      if (idSet.size === 0) {
        this.numberToDocumentId.delete(key)
      }
    }
  }

  contains(key: ScalarSearchableValue): boolean {
    return this.numberToDocumentId.has(key)
  }

  getSize(): number {
    let size = 0
    for (const idSet of this.numberToDocumentId.values()) {
      size += idSet.size
    }
    return size
  }

  filter(operation: EnumComparisonOperator): InternalDocumentID[] {
    return Array.from(this.filterSet(operation))
  }

  filterArr(operation: EnumArrComparisonOperator): InternalDocumentID[] {
    return Array.from(this.filterArrSet(operation))
  }

  // Same as `filter`, but returns a Set. The returned Set may be owned by the tree (`eq`), so it must not be mutated.
  filterSet(operation: EnumComparisonOperator): Set<InternalDocumentID> {
    const operationKeys = Object.keys(operation)

    if (operationKeys.length !== 1) {
      throw new Error('Invalid operation')
    }

    const operationType = operationKeys[0] as keyof EnumComparisonOperator

    switch (operationType) {
      case 'eq': {
        const value = operation[operationType]!
        return this.numberToDocumentId.get(value) ?? new Set()
      }
      case 'in': {
        const values = operation[operationType]!
        const resultSet: Set<InternalDocumentID> = new Set()
        for (const value of values) {
          const idSet = this.numberToDocumentId.get(value)
          if (idSet) {
            for (const id of idSet) {
              resultSet.add(id)
            }
          }
        }
        return resultSet
      }
      case 'nin': {
        const excludeValues = new Set<ScalarSearchableValue>(operation[operationType]!)
        const resultSet: Set<InternalDocumentID> = new Set()
        for (const [key, idSet] of this.numberToDocumentId) {
          if (!excludeValues.has(key)) {
            for (const id of idSet) {
              resultSet.add(id)
            }
          }
        }
        return resultSet
      }
      default:
        throw new Error('Invalid operation')
    }
  }

  // Same as `filterArr`, but returns a Set. The returned Set may be owned by the tree, so it must not be mutated.
  filterArrSet(operation: EnumArrComparisonOperator): Set<InternalDocumentID> {
    const operationKeys = Object.keys(operation)

    if (operationKeys.length !== 1) {
      throw new Error('Invalid operation')
    }

    const operationType = operationKeys[0] as keyof EnumArrComparisonOperator

    switch (operationType) {
      case 'containsAll': {
        const values = operation[operationType]!
        const valuesLength = values.length
        if (valuesLength === 0) return new Set()
        const first = this.numberToDocumentId.get(values[0])
        if (!first) return new Set()
        if (valuesLength === 1) return first

        const others: Set<InternalDocumentID>[] = []
        for (let i = 1; i < valuesLength; i++) {
          const idSet = this.numberToDocumentId.get(values[i])
          if (!idSet) return new Set()
          others.push(idSet)
        }

        // Keep the iteration order of the first set
        const intersection: Set<InternalDocumentID> = new Set()
        const othersLength = others.length
        for (const id of first) {
          let inAll = true
          for (let i = 0; i < othersLength; i++) {
            if (!others[i].has(id)) {
              inAll = false
              break
            }
          }
          if (inAll) {
            intersection.add(id)
          }
        }
        return intersection
      }
      case 'containsAny': {
        const values = operation[operationType]!
        const union: Set<InternalDocumentID> = new Set()
        for (let i = 0; i < values.length; i++) {
          const idSet = this.numberToDocumentId.get(values[i])
          if (idSet) {
            for (const id of idSet) {
              union.add(id)
            }
          }
        }
        return union
      }
      default:
        throw new Error('Invalid operation')
    }
  }

  static fromJSON(json: any): FlatTree {
    if (!json.numberToDocumentId) {
      throw new Error('Invalid Flat Tree JSON')
    }

    const tree = new FlatTree()
    for (const [key, ids] of json.numberToDocumentId) {
      tree.numberToDocumentId.set(key, new Set(ids))
    }
    return tree
  }

  toJSON(): any {
    return {
      numberToDocumentId: Array.from(this.numberToDocumentId.entries()).map(([key, idSet]) => [key, Array.from(idSet)])
    }
  }
}
