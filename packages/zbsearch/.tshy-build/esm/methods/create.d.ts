import { DocumentsStore } from '../components/documents-store.js';
import { Index } from '../components/index.js';
import { Sorter } from '../components/sorter.js';
import { AnySchema, Components, IDocumentsStore, IIndex, ISorter, ZBSearch, ZBSearchPlugin, SorterConfig } from '../types.js';
interface CreateArguments<ZBSearchSchema, TIndex, TDocumentStore, TSorter, TPinning> {
    schema: ZBSearchSchema;
    sort?: SorterConfig;
    language?: string;
    components?: Components<ZBSearch<ZBSearchSchema, TIndex, TDocumentStore, TSorter, TPinning>, ZBSearchSchema, TIndex, TDocumentStore, TSorter, TPinning>;
    plugins?: ZBSearchPlugin[];
    id?: string;
}
export declare function create<ZBSearchSchema extends AnySchema, TIndex = IIndex<Index>, TDocumentStore = IDocumentsStore<DocumentsStore>, TSorter = ISorter<Sorter>, TPinning = any>({ schema, sort, language, components, id, plugins }: CreateArguments<ZBSearchSchema, TIndex, TDocumentStore, TSorter, TPinning>): ZBSearch<ZBSearchSchema, TIndex, TDocumentStore, TSorter, TPinning>;
export {};
