import type { AnyZBSearch, FacetResult, FacetsParams, TokenScore } from '../types.js';
export declare function getFacets<T extends AnyZBSearch>(zbsearch: T, results: TokenScore[], facetsConfig: FacetsParams<T>): FacetResult;
