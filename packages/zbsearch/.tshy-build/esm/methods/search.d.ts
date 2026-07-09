import type { AnyZBSearch, Results, SearchParams, TypedDocument } from '../types.js';
export declare function search<T extends AnyZBSearch, ResultDocument = TypedDocument<T>>(zbsearch: T, params: SearchParams<T, ResultDocument>, language?: string): Results<ResultDocument> | Promise<Results<ResultDocument>>;
