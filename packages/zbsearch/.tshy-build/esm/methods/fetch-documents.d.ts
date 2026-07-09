import { InternalDocumentID } from '../components/internal-document-id-store.js';
import type { AnyZBSearch, LiteralUnion, Result, TypedDocument } from '../types.js';
export declare function fetchDocumentsWithDistinct<T extends AnyZBSearch, ResultDocument extends TypedDocument<T>>(zbsearch: T, uniqueDocsArray: [InternalDocumentID, number][], offset: number, limit: number, distinctOn: LiteralUnion<T['schema']>): Result<ResultDocument>[];
export declare function fetchDocuments<T extends AnyZBSearch, ResultDocument extends TypedDocument<T>>(zbsearch: T, uniqueDocsArray: [InternalDocumentID, number][], offset: number, limit: number): Result<ResultDocument>[];
