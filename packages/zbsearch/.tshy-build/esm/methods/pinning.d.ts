import type { AnyZBSearch } from '../types.js';
import type { PinRule } from '../components/pinning.js';
/**
 * Insert a new pinning rule into the database.
 * Pinning rules allow you to promote specific documents to specific positions in search results
 * based on conditional matching of the search term.
 *
 * @example
 * ```typescript
 * import { create, insert, insertPin } from 'zbsearch'
 *
 * const db = await create({
 *   schema: {
 *     title: 'string',
 *     description: 'string'
 *   }
 * })
 *
 * await insert(db, { id: '1', title: 'Product A' })
 * await insert(db, { id: '2', title: 'Product B' })
 *
 * // When searching for "featured", pin Product B to position 0
 * insertPin(db, {
 *   id: 'featured-products',
 *   conditions: [
 *     { anchoring: 'contains', pattern: 'featured' }
 *   ],
 *   consequence: {
 *     promote: [
 *       { doc_id: '2', position: 0 }
 *     ]
 *   }
 * })
 * ```
 */
export declare function insertPin<T extends AnyZBSearch>(zbsearch: T, rule: PinRule): void;
/**
 * Update an existing pinning rule in the database.
 * If the rule does not exist, an error will be thrown.
 *
 * @example
 * ```typescript
 * import { updatePin } from 'zbsearch'
 *
 * // Update the rule to pin to a different position
 * updatePin(db, {
 *   id: 'featured-products',
 *   conditions: [
 *     { anchoring: 'contains', pattern: 'featured' }
 *   ],
 *   consequence: {
 *     promote: [
 *       { doc_id: '3', position: 0 }  // Changed doc_id
 *     ]
 *   }
 * })
 * ```
 */
export declare function updatePin<T extends AnyZBSearch>(zbsearch: T, rule: PinRule): void;
/**
 * Remove a pinning rule from the database by its ID.
 *
 * @example
 * ```typescript
 * deletePin(db, 'featured-products')
 * ```
 */
export declare function deletePin<T extends AnyZBSearch>(zbsearch: T, ruleId: string): boolean;
/**
 * Get a specific pinning rule by its ID.
 *
 * @example
 * ```typescript
 * const rule = getPin(db, 'featured-products')
 * console.log(rule)
 * ```
 */
export declare function getPin<T extends AnyZBSearch>(zbsearch: T, ruleId: string): PinRule | undefined;
/**
 * Get all pinning rules in the database.
 *
 * @example
 * ```typescript
 * const allRules = getAllPins(db)
 * console.log(`Total rules: ${allRules.length}`)
 * ```
 */
export declare function getAllPins<T extends AnyZBSearch>(zbsearch: T): PinRule[];
