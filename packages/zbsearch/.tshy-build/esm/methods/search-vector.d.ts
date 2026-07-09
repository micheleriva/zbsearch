import type { AnyZBSearch, Results, SearchParamsVector, TypedDocument } from '../types.js';
import { Language } from '../index.js';
export declare function innerVectorSearch<T extends AnyZBSearch, ResultDocument = TypedDocument<T>>(zbsearch: T, params: Pick<SearchParamsVector<T, ResultDocument>, 'vector' | 'similarity' | 'where'>, language: Language | undefined): import("../trees/vector.js").SimilarVector[];
export declare function searchVector<T extends AnyZBSearch, ResultDocument = TypedDocument<T>>(zbsearch: T, params: SearchParamsVector<T, ResultDocument>, language?: Language): Results<ResultDocument> | Promise<Results<ResultDocument>>;
