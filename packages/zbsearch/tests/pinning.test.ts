import { describe, expect, it } from 'vitest'
import {
  create,
  insert,
  insertMultiple,
  insertPin,
  updatePin,
  deletePin,
  getPin,
  getAllPins,
  search
} from '../src/index.js'
import type { PinRule } from '../src/components/pinning.js'
import type { TokenScore } from '../src/types.js'
import { applyPinningRules } from '../src/components/pinning-manager.js'

describe('pinning public API', () => {
  it('should add a pin rule', async () => {
    const db = create({
      schema: {
        title: 'string',
        description: 'string'
      } as const
    })

    const rule: PinRule = {
      id: 'test_rule',
      conditions: [
        {
          anchoring: 'is',
          pattern: 'test'
        }
      ],
      consequence: {
        promote: [
          {
            doc_id: 'doc1',
            position: 0
          }
        ]
      }
    }

    insertPin(db, rule)

    const retrieved = getPin(db, 'test_rule')
    expect(retrieved).toStrictEqual(rule)
  })

  it('should remove a pin rule', async () => {
    const db = create({
      schema: {
        title: 'string',
        description: 'string'
      } as const
    })

    const rule: PinRule = {
      id: 'test_rule',
      conditions: [
        {
          anchoring: 'is',
          pattern: 'test'
        }
      ],
      consequence: {
        promote: [
          {
            doc_id: 'doc1',
            position: 0
          }
        ]
      }
    }

    insertPin(db, rule)
    expect(getPin(db, 'test_rule')).toBeTruthy()

    const removed = deletePin(db, 'test_rule')
    expect(removed).toBe(true)
    expect(getPin(db, 'test_rule')).toBe(undefined)
  })

  it('should return all pin rules', async () => {
    const db = create({
      schema: {
        title: 'string',
        description: 'string'
      } as const
    })

    const rule1: PinRule = {
      id: 'rule1',
      conditions: [{ anchoring: 'is', pattern: 'test' }],
      consequence: { promote: [{ doc_id: 'doc1', position: 0 }] }
    }

    const rule2: PinRule = {
      id: 'rule2',
      conditions: [{ anchoring: 'starts_with', pattern: 'hello' }],
      consequence: { promote: [{ doc_id: 'doc2', position: 0 }] }
    }

    insertPin(db, rule1)
    insertPin(db, rule2)

    const allRules = getAllPins(db)
    expect(allRules.length).toBe(2)
    expect(allRules.find((r) => r.id === 'rule1')).toBeTruthy()
    expect(allRules.find((r) => r.id === 'rule2')).toBeTruthy()
  })

  it('should throw error when inserting duplicate rule ID', async () => {
    const db = create({
      schema: {
        title: 'string',
        description: 'string'
      } as const
    })

    const rule: PinRule = {
      id: 'duplicate_rule',
      conditions: [{ anchoring: 'is', pattern: 'test' }],
      consequence: { promote: [{ doc_id: 'doc1', position: 0 }] }
    }

    insertPin(db, rule)

    // Attempting to insert the same rule ID should throw
    expect(() => {
      insertPin(db, rule)
    }).toThrow(/PINNING_RULE_ALREADY_EXISTS/)
  })

  it('should update existing pin rule with updatePin', async () => {
    const db = create({
      schema: {
        title: 'string',
        description: 'string'
      } as const
    })

    const rule: PinRule = {
      id: 'update_rule',
      conditions: [{ anchoring: 'is', pattern: 'test' }],
      consequence: { promote: [{ doc_id: 'doc1', position: 0 }] }
    }

    insertPin(db, rule)

    // Update the rule
    const updatedRule: PinRule = {
      id: 'update_rule',
      conditions: [{ anchoring: 'contains', pattern: 'updated' }],
      consequence: { promote: [{ doc_id: 'doc2', position: 1 }] }
    }

    updatePin(db, updatedRule)

    const retrieved = getPin(db, 'update_rule')
    expect(retrieved).toStrictEqual(updatedRule)
    expect(retrieved?.conditions[0].pattern).toBe('updated')
    expect(retrieved?.consequence.promote[0].doc_id).toBe('doc2')
  })

  it('should throw error when updating non-existent rule', async () => {
    const db = create({
      schema: {
        title: 'string',
        description: 'string'
      } as const
    })

    const rule: PinRule = {
      id: 'non_existent',
      conditions: [{ anchoring: 'is', pattern: 'test' }],
      consequence: { promote: [{ doc_id: 'doc1', position: 0 }] }
    }

    // Attempting to update a non-existent rule should throw
    expect(() => {
      updatePin(db, rule)
    }).toThrow(/PINNING_RULE_NOT_FOUND/)
  })
})

describe('pinning in search results', () => {
  it('should pin a document to position 0 in search results', async () => {
    const db = create({
      schema: {
        title: 'string',
        description: 'string'
      } as const
    })

    await insertMultiple(db, [
      { id: '1', title: 'Red Shirt', description: 'A red shirt' },
      { id: '2', title: 'Blue Jeans', description: 'Blue denim jeans' },
      { id: '3', title: 'Green Hat', description: 'A green hat' }
    ])

    insertPin(db, {
      id: 'pin_blue_jeans',
      conditions: [{ anchoring: 'contains', pattern: 'shirt' }],
      consequence: {
        promote: [{ doc_id: '3', position: 0 }]
      }
    })

    const results = await search(db, { term: 'shirt' })

    // Document '3' should be at position 0 even though it doesn't match 'shirt'
    expect(results.hits[0].id).toBe('3')
    expect(results.hits[1].id).toBe('1') // Original match
  })

  it('should pin multiple documents to different positions', async () => {
    const db = create({
      schema: {
        title: 'string',
        description: 'string'
      } as const
    })

    await insertMultiple(db, [
      { id: '1', title: 'Product 1', description: 'First product' },
      { id: '2', title: 'Product 2', description: 'Second product' },
      { id: '3', title: 'Product 3', description: 'Third product' },
      { id: '4', title: 'Product 4', description: 'Fourth product' },
      { id: '5', title: 'Product 5', description: 'Fifth product' }
    ])

    insertPin(db, {
      id: 'featured_products',
      conditions: [{ anchoring: 'contains', pattern: 'product' }],
      consequence: {
        promote: [
          { doc_id: '5', position: 0 },
          { doc_id: '3', position: 1 },
          { doc_id: '1', position: 2 }
        ]
      }
    })

    const results = await search(db, { term: 'product' })

    // Check pinned positions
    expect(results.hits[0].id).toBe('5') // Position 0
    expect(results.hits[1].id).toBe('3') // Position 1
    expect(results.hits[2].id).toBe('1') // Position 2
    // Unpinned documents should follow
    expect(results.count).toBe(5)
  })

  it('should pin document from outside the result set', async () => {
    const db = create({
      schema: {
        title: 'string',
        description: 'string'
      } as const
    })

    await insertMultiple(db, [
      { id: '1', title: 'Red Shirt', description: 'A red shirt' },
      { id: '2', title: 'Blue Jeans', description: 'Blue denim jeans' },
      { id: '3', title: 'Featured Product', description: 'Special promotion' }
    ])

    insertPin(db, {
      id: 'promote_featured',
      conditions: [{ anchoring: 'contains', pattern: 'shirt' }],
      consequence: {
        promote: [
          { doc_id: '3', position: 0 } // This document doesn't match "shirt" search
        ]
      }
    })

    const results = await search(db, { term: 'shirt' })

    // Document 3 should be promoted to position 0 with score 0
    expect(results.count).toBe(2)
    expect(results.hits[0].id).toBe('3')
    expect(results.hits[0].score).toBe(0) // Score should be 0 for promoted docs outside result set
    expect(results.hits[1].id).toBe('1')
  })

  it('should not apply pinning when no rules match', async () => {
    const db = create({
      schema: {
        title: 'string'
      } as const
    })

    await insertMultiple(db, [
      { id: '1', title: 'Product 1' },
      { id: '2', title: 'Product 2' },
      { id: '3', title: 'Product 3' }
    ])

    insertPin(db, {
      id: 'no_match_rule',
      conditions: [{ anchoring: 'is', pattern: 'shoes' }],
      consequence: {
        promote: [{ doc_id: '3', position: 0 }]
      }
    })

    const results = await search(db, { term: 'product' })

    // Results should be in natural order (no pinning applied)
    expect(results.count).toBe(3)
  })

  it('should handle empty search results', async () => {
    const db = create({
      schema: {
        title: 'string'
      } as const
    })

    await insert(db, { id: 'existing-doc', title: 'Existing' })

    insertPin(db, {
      id: 'test_rule',
      conditions: [{ anchoring: 'is', pattern: 'nonexistent' }],
      consequence: { promote: [{ doc_id: 'non-existent-doc', position: 0 }] }
    })

    const results = await search(db, { term: 'nonexistent' })

    // Should remain empty since the term doesn't match and the pinned document doesn't exist
    expect(results.count).toBe(0)
  })
})

describe('pin condition matching', () => {
  it('should match exact pattern with "is" anchoring', async () => {
    const db = create({
      schema: {
        title: 'string'
      } as const
    })

    await insertMultiple(db, [
      { id: '1', title: 'Blue Jeans' },
      { id: '2', title: 'Red Shirt' }
    ])

    insertPin(db, {
      id: 'exact_match',
      conditions: [{ anchoring: 'is', pattern: 'blue jeans' }],
      consequence: { promote: [{ doc_id: '2', position: 0 }] }
    })

    const results1 = await search(db, { term: 'blue jeans' })
    const results2 = await search(db, { term: 'Blue Jeans' }) // case insensitive
    const results3 = await search(db, { term: 'blue' })

    // Should apply pinning for exact match
    expect(results1.hits[0].id).toBe('2')
    expect(results2.hits[0].id).toBe('2')
    // Should not apply pinning for partial match
    expect(results3.hits[0].id).toBe('1')
  })

  it('should match pattern with "starts_with" anchoring', async () => {
    const db = create({
      schema: {
        title: 'string'
      } as const
    })

    await insertMultiple(db, [
      { id: '1', title: 'Headphones' },
      { id: '2', title: 'Wireless Headphones' },
      { id: '3', title: 'Speaker' }
    ])

    insertPin(db, {
      id: 'starts_with_match',
      conditions: [{ anchoring: 'starts_with', pattern: 'headphone' }],
      consequence: { promote: [{ doc_id: '3', position: 0 }] }
    })

    const results1 = await search(db, { term: 'headphones' })
    const results2 = await search(db, { term: 'headphone jack' })
    const results3 = await search(db, { term: 'wireless headphones' })

    // Should apply pinning for starts_with match
    expect(results1.hits[0].id).toBe('3')
    expect(results2.hits[0].id).toBe('3')
    // Should not apply pinning when term doesn't start with pattern
    expect(results3.hits[0].id === '3').not.toBe('should not pin when term does not start with pattern')
  })

  it('should match pattern with "contains" anchoring', async () => {
    const db = create({
      schema: {
        title: 'string'
      } as const
    })

    await insertMultiple(db, [
      { id: '1', title: 'Wireless Headphones' },
      { id: '2', title: 'Best Wireless Earbuds' },
      { id: '3', title: 'Wired Headphones' }
    ])

    insertPin(db, {
      id: 'contains_match',
      conditions: [{ anchoring: 'contains', pattern: 'wireless' }],
      consequence: { promote: [{ doc_id: '3', position: 0 }] }
    })

    const results1 = await search(db, { term: 'wireless' })
    const results2 = await search(db, { term: 'wireless headphones' })
    const results3 = await search(db, { term: 'best wireless earbuds' })

    // Should apply pinning for contains match
    expect(results1.hits[0].id).toBe('3')
    expect(results2.hits[0].id).toBe('3')
    expect(results3.hits[0].id).toBe('3')
  })

  it('should match rule with multiple conditions (AND logic)', async () => {
    const db = create({
      schema: {
        title: 'string'
      } as const
    })

    await insertMultiple(db, [
      { id: '1', title: 'Winter Jacket' },
      { id: '2', title: 'Winter Coat' },
      { id: '3', title: 'Jacket' }
    ])

    insertPin(db, {
      id: 'multi_condition',
      conditions: [
        { anchoring: 'contains', pattern: 'winter' },
        { anchoring: 'contains', pattern: 'jacket' }
      ],
      consequence: { promote: [{ doc_id: '3', position: 0 }] }
    })

    const results1 = await search(db, { term: 'winter jacket' })
    const results2 = await search(db, { term: 'winter coat' })
    const results3 = await search(db, { term: 'jacket' })

    // Should apply pinning only when all conditions match
    expect(results1.hits[0].id).toBe('3')
    // Should not apply when one condition doesn't match
    expect(results2.hits[0].id === '3').not.toBe('should not pin when one condition does not match')
    expect(results3.hits[0].id === '3').not.toBe('should not pin when one condition does not match')
  })
})

describe('pinning serialization', () => {
  it('should persist pinning rules through save/load', async () => {
    const { save, load } = await import('../src/index.js')

    const db = create({
      schema: {
        title: 'string'
      } as const
    })

    await insertMultiple(db, [
      { id: '1', title: 'Product 1' },
      { id: '2', title: 'Product 2' },
      { id: '3', title: 'Product 3' }
    ])

    insertPin(db, {
      id: 'rule1',
      conditions: [{ anchoring: 'is', pattern: 'test' }],
      consequence: { promote: [{ doc_id: '1', position: 0 }] }
    })

    insertPin(db, {
      id: 'rule2',
      conditions: [
        { anchoring: 'starts_with', pattern: 'hello' },
        { anchoring: 'contains', pattern: 'world' }
      ],
      consequence: {
        promote: [
          { doc_id: '2', position: 0 },
          { doc_id: '3', position: 1 }
        ]
      }
    })

    // Save
    const saved = save(db)

    // Load into new db
    const db2 = create({
      schema: {
        title: 'string'
      } as const
    })

    load(db2, saved)

    // Verify loaded db has the same rules
    const allRules = getAllPins(db2)
    expect(allRules.length).toBe(2)

    const loadedRule1 = getPin(db2, 'rule1')
    const loadedRule2 = getPin(db2, 'rule2')

    expect(loadedRule1).toBeTruthy()
    expect(loadedRule2).toBeTruthy()
    expect(loadedRule1?.id).toBe('rule1')
    expect(loadedRule2?.id).toBe('rule2')
  })
})

describe('pinning edge cases', () => {
  it('should handle conflicting pin positions (first wins)', async () => {
    const db = create({
      schema: {
        title: 'string'
      } as const
    })

    await insertMultiple(db, [
      { id: '1', title: 'Product 1' },
      { id: '2', title: 'Product 2' },
      { id: '3', title: 'Product 3' }
    ])

    // Two documents trying to be pinned to position 0
    insertPin(db, {
      id: 'conflict_rule',
      conditions: [{ anchoring: 'contains', pattern: 'product' }],
      consequence: {
        promote: [
          { doc_id: '1', position: 0 },
          { doc_id: '2', position: 0 } // Same position!
        ]
      }
    })

    const results = await search(db, { term: 'product' })

    // First promotion in the list should take precedence
    expect(results.hits[0].id).toBe('1')
    expect(results.count).toBe(3)
  })

  it('should handle pin position beyond result set length', async () => {
    const db = create({
      schema: {
        title: 'string'
      } as const
    })

    await insertMultiple(db, [
      { id: '1', title: 'Product 1' },
      { id: '2', title: 'Product 2' }
    ])

    insertPin(db, {
      id: 'beyond_length',
      conditions: [{ anchoring: 'contains', pattern: 'product' }],
      consequence: {
        promote: [{ doc_id: '1', position: 10 }] // Position beyond array length
      }
    })

    const results = await search(db, { term: 'product' })

    // All documents should still be present
    expect(results.count).toBe(2)
  })

  it('should handle pinning the same document multiple times', async () => {
    const db = create({
      schema: {
        title: 'string'
      } as const
    })

    await insertMultiple(db, [
      { id: '1', title: 'Product 1' },
      { id: '2', title: 'Product 2' },
      { id: '3', title: 'Product 3' }
    ])

    insertPin(db, {
      id: 'duplicate_pin',
      conditions: [{ anchoring: 'contains', pattern: 'product' }],
      consequence: {
        promote: [
          { doc_id: '1', position: 0 },
          { doc_id: '1', position: 2 } // Same document, different position
        ]
      }
    })

    const results = await search(db, { term: 'product' })

    // Document should only appear once
    const doc1Count = results.hits.filter((hit) => hit.id === '1').length
    expect(doc1Count).toBe(1)
    expect(results.count).toBe(3)
  })
})

// Test internal applyPinningRules function for lower-level testing
describe('internal pinning logic', () => {
  it('should apply pinning rules to TokenScore array', async () => {
    const db = create({
      schema: {
        title: 'string'
      } as const
    })

    await insertMultiple(db, [
      { id: '1', title: 'Product 1' },
      { id: '2', title: 'Product 2' },
      { id: '3', title: 'Product 3' }
    ])

    insertPin(db, {
      id: 'test',
      conditions: [{ anchoring: 'contains', pattern: 'test' }],
      consequence: {
        promote: [{ doc_id: '3', position: 0 }]
      }
    })

    const mockResults: TokenScore[] = [
      [1, 10.0],
      [2, 9.0],
      [3, 8.0]
    ]

    const pinnedResults = applyPinningRules(db, db.data.pinning, mockResults, 'test')

    expect(pinnedResults[0][0]).toBe(3)
    expect(pinnedResults.length).toBe(3)
  })
})
