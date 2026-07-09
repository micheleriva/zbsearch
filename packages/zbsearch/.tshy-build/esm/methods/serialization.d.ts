import { Language } from '../index.js';
import { AnyZBSearch } from '../types.js';
export interface RawData {
    internalDocumentIDStore: unknown;
    index: unknown;
    docs: unknown;
    sorting: unknown;
    pinning: unknown;
    language: Language;
}
export declare function load<T extends AnyZBSearch>(zbsearch: T, raw: RawData): void;
export declare function save<T extends AnyZBSearch>(zbsearch: T): RawData;
