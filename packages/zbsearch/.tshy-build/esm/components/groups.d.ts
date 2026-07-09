import type { AnyZBSearch, GroupByParams, GroupResult, TokenScore, TypedDocument } from '../types.js';
export declare function getGroups<T extends AnyZBSearch, ResultDocument = TypedDocument<T>>(zbsearch: T, results: TokenScore[], groupBy: GroupByParams<T, ResultDocument>): GroupResult<ResultDocument>;
