import type { AnyZBSearch, TokenScore } from '../types.js';
import type { PinningStore } from './pinning.js';
/**
 * Apply pinning rules to search results.
 * This function modifies the uniqueDocsArray by:
 * 1. Finding matching pin rules based on the search term
 * 2. Inserting pinned documents at their specified positions
 * 3. Assigning high scores to pinned documents to maintain their positions
 */
export declare function applyPinningRules<T extends AnyZBSearch>(zbsearch: T, pinningStore: PinningStore, uniqueDocsArray: TokenScore[], searchTerm: string | undefined): TokenScore[];
