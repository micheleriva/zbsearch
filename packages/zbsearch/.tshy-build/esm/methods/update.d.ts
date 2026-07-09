import type { AnyZBSearch, PartialSchemaDeep, TypedDocument } from '../types.js';
export declare function update<T extends AnyZBSearch>(zbsearch: T, id: string, doc: PartialSchemaDeep<TypedDocument<T>>, language?: string, skipHooks?: boolean): Promise<string> | string;
export declare function updateMultiple<T extends AnyZBSearch>(zbsearch: T, ids: string[], docs: PartialSchemaDeep<TypedDocument<T>>[], batchSize?: number, language?: string, skipHooks?: boolean): Promise<string[]> | string[];
