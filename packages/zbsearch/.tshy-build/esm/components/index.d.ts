import type { AnyIndexStore, AnyZBSearch, BM25Params, IIndex, SearchableType, SearchableValue, Tokenizer, TokenScore, WhereCondition } from '../types.js';
import type { InsertOptions } from '../methods/insert.js';
import { RadixNode } from '../trees/radix.js';
import { AVLTree } from '../trees/avl.js';
import { FlatTree } from '../trees/flat.js';
import { BKDTree } from '../trees/bkd.js';
import { BoolNode } from '../trees/bool.js';
import { DocumentID, InternalDocumentID, InternalDocumentIDStore } from './internal-document-id-store.js';
import { VectorType } from '../trees/vector.js';
export type FrequencyMap = {
    [property: string]: {
        [documentID: InternalDocumentID]: {
            [token: string]: number;
        } | undefined;
    };
};
export type TreeType = 'AVL' | 'Radix' | 'Bool' | 'Flat' | 'BKD';
export type TTree<T = TreeType, N = unknown> = {
    type: T;
    node: N;
    isArray: boolean;
};
export type Tree = TTree<'Radix', RadixNode> | TTree<'AVL', AVLTree<number, InternalDocumentID>> | TTree<'Bool', BoolNode<InternalDocumentID>> | TTree<'Flat', FlatTree> | TTree<'BKD', BKDTree>;
export interface Index extends AnyIndexStore {
    sharedInternalDocumentStore: InternalDocumentIDStore;
    indexes: Record<string, Tree>;
    searchableProperties: string[];
    searchablePropertiesWithTypes: Record<string, SearchableType>;
    frequencies: FrequencyMap;
    tokenOccurrences: Record<string, Record<string, number>>;
    avgFieldLength: Record<string, number>;
    fieldLengths: Record<string, Record<InternalDocumentID, number | undefined>>;
}
export declare function insertDocumentScoreParameters(index: Index, prop: string, id: DocumentID, tokens: string[], docsCount: number): void;
export declare function insertTokenScoreParameters(index: Index, prop: string, id: DocumentID, tokens: string[], token: string): void;
export declare function removeDocumentScoreParameters(index: Index, prop: string, id: DocumentID, docsCount: number): void;
export declare function removeTokenScoreParameters(index: Index, prop: string, token: string): void;
export declare function create<T extends AnyZBSearch, TSchema extends T['schema']>(zbsearch: T, sharedInternalDocumentStore: T['internalDocumentIDStore'], schema: TSchema, index?: Index, prefix?: string): Index;
export declare function insert(implementation: IIndex<Index>, index: Index, prop: string, id: DocumentID, internalId: InternalDocumentID, value: SearchableValue, schemaType: SearchableType, language: string | undefined, tokenizer: Tokenizer, docsCount: number, options?: InsertOptions): void;
export declare function insertVector(index: AnyIndexStore, prop: string, value: number[] | VectorType, id: DocumentID, internalDocumentId: InternalDocumentID): void;
export declare function remove(implementation: IIndex<Index>, index: Index, prop: string, id: DocumentID, internalId: InternalDocumentID, value: SearchableValue, schemaType: SearchableType, language: string | undefined, tokenizer: Tokenizer, docsCount: number): boolean;
export declare function calculateResultScores(index: Index, prop: string, term: string, ids: InternalDocumentID[], docsCount: number, bm25Relevance: Required<BM25Params>, resultsMap: Map<number, number>, boostPerProperty: number, whereFiltersIDs: Set<InternalDocumentID> | undefined, keywordMatchesMap: Map<InternalDocumentID, Map<string, number>>): void;
export declare function search(index: Index, term: string, tokenizer: Tokenizer, language: string | undefined, propertiesToSearch: string[], exact: boolean, tolerance: number, boost: Record<string, number>, relevance: Required<BM25Params>, docsCount: number, whereFiltersIDs: Set<InternalDocumentID> | undefined, threshold?: number): TokenScore[];
export declare function searchByWhereClause<T extends AnyZBSearch>(index: Index, tokenizer: Tokenizer, filters: Partial<WhereCondition<T['schema']>>, language: string | undefined): Set<InternalDocumentID>;
export declare function getSearchableProperties(index: Index): string[];
export declare function getSearchablePropertiesWithTypes(index: Index): Record<string, SearchableType>;
export declare function load<R = unknown>(sharedInternalDocumentStore: InternalDocumentIDStore, raw: R): Index;
export declare function save<R = unknown>(index: Index): R;
export declare function createIndex(): IIndex<Index>;
export declare function searchByGeoWhereClause<T extends AnyZBSearch>(index: AnyIndexStore, filters: Partial<WhereCondition<T['schema']>>): TokenScore[] | null;
