import { InternalDocumentID } from '../components/internal-document-id-store.js';
import { EnumArrComparisonOperator, EnumComparisonOperator, Nullable, ScalarSearchableValue } from '../types.js';
export declare class FlatTree {
    numberToDocumentId: Map<ScalarSearchableValue, Set<InternalDocumentID>>;
    constructor();
    insert(key: ScalarSearchableValue, value: InternalDocumentID): void;
    find(key: ScalarSearchableValue): Nullable<InternalDocumentID[]>;
    remove(key: ScalarSearchableValue): void;
    removeDocument(id: InternalDocumentID, key: ScalarSearchableValue): void;
    contains(key: ScalarSearchableValue): boolean;
    getSize(): number;
    filter(operation: EnumComparisonOperator): InternalDocumentID[];
    filterArr(operation: EnumArrComparisonOperator): InternalDocumentID[];
    static fromJSON(json: any): FlatTree;
    toJSON(): any;
}
