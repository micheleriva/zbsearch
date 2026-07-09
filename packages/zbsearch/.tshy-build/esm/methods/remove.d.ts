import type { AnyZBSearch } from '../types.js';
import { DocumentID } from '../components/internal-document-id-store.js';
export declare function remove<T extends AnyZBSearch>(zbsearch: T, id: DocumentID, language?: string, skipHooks?: boolean): Promise<boolean> | boolean;
export declare function removeMultiple<T extends AnyZBSearch>(zbsearch: T, ids: DocumentID[], batchSize?: number, language?: string, skipHooks?: boolean): Promise<number> | number;
