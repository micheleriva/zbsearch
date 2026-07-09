import type { AnyZBSearch, PartialSchemaDeep, TypedDocument } from '../types.js';
import { type InsertOptions } from './insert.js';
export declare function upsert<T extends AnyZBSearch>(zbsearch: T, doc: PartialSchemaDeep<TypedDocument<T>>, language?: string, skipHooks?: boolean, options?: InsertOptions): Promise<string> | string;
export declare function upsertMultiple<T extends AnyZBSearch>(zbsearch: T, docs: PartialSchemaDeep<TypedDocument<T>>[], batchSize?: number, language?: string, skipHooks?: boolean): Promise<string[]> | string[];
