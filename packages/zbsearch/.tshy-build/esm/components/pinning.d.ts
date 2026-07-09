import { DocumentID, InternalDocumentIDStore } from './internal-document-id-store.js';
export type PinAnchoring = 'is' | 'starts_with' | 'contains';
export interface PinCondition {
    anchoring: PinAnchoring;
    pattern: string;
}
export interface PinPromotion {
    doc_id: DocumentID;
    position: number;
}
export interface PinRule {
    id: string;
    conditions: PinCondition[];
    consequence: {
        promote: PinPromotion[];
    };
}
export interface PinningStore {
    sharedInternalDocumentStore: InternalDocumentIDStore;
    rules: Map<string, PinRule>;
}
export declare function getMatchingRules(store: PinningStore, term: string | undefined): PinRule[];
export declare function load<R = unknown>(sharedInternalDocumentStore: InternalDocumentIDStore, raw: R): PinningStore;
export declare function save<R = unknown>(store: PinningStore): R;
export interface IPinning {
    create(sharedInternalDocumentStore: InternalDocumentIDStore): PinningStore;
    addRule(store: PinningStore, rule: PinRule): void;
    updateRule(store: PinningStore, rule: PinRule): void;
    removeRule(store: PinningStore, ruleId: string): boolean;
    getRule(store: PinningStore, ruleId: string): PinRule | undefined;
    getAllRules(store: PinningStore): PinRule[];
    getMatchingRules(store: PinningStore, term: string | undefined): PinRule[];
    load<R = unknown>(sharedInternalDocumentStore: InternalDocumentIDStore, raw: R): PinningStore;
    save<R = unknown>(store: PinningStore): R;
}
export declare function createPinning(): IPinning;
