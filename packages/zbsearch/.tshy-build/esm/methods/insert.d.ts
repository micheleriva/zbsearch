import type { AnyZBSearch, PartialSchemaDeep, TypedDocument } from '../types.js';
export type InsertOptions = {
    avlRebalanceThreshold?: number;
};
export declare function insert<T extends AnyZBSearch>(zbsearch: T, doc: PartialSchemaDeep<TypedDocument<T>>, language?: string, skipHooks?: boolean, options?: InsertOptions): string | Promise<string>;
export declare function insertMultiple<T extends AnyZBSearch>(zbsearch: T, docs: PartialSchemaDeep<TypedDocument<T>>[], batchSize?: number, language?: string, skipHooks?: boolean, timeout?: number): Promise<string[]> | string[];
export declare function innerInsertMultiple<T extends AnyZBSearch>(zbsearch: T, docs: PartialSchemaDeep<TypedDocument<T>>[], batchSize?: number, language?: string, skipHooks?: boolean, timeout?: number): Promise<string[]> | string[];
