import { Language } from '../components/tokenizer/languages.js';
import type { AnyZBSearch, BM25Params, Results, SearchParamsFullText, TokenScore, TypedDocument } from '../types.js';
export declare function innerFullTextSearch<T extends AnyZBSearch>(zbsearch: T, params: Pick<SearchParamsFullText<T>, 'term' | 'properties' | 'where' | 'exact' | 'tolerance' | 'boost' | 'relevance' | 'threshold'>, language: Language | undefined): TokenScore[];
export declare function fullTextSearch<T extends AnyZBSearch, ResultDocument = TypedDocument<T>>(zbsearch: T, params: SearchParamsFullText<T, ResultDocument>, language?: string): Results<ResultDocument> | Promise<Results<ResultDocument>>;
export declare const defaultBM25Params: BM25Params;
