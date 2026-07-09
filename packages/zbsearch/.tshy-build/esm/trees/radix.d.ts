import { InternalDocumentID } from '../components/internal-document-id-store.js';
interface FindParams {
    term: string;
    exact?: boolean;
    tolerance?: number;
}
export type FindResult = Record<string, InternalDocumentID[]>;
export declare class RadixNode {
    k: string;
    s: string;
    c: Map<string, RadixNode>;
    d: Set<InternalDocumentID>;
    e: boolean;
    w: string;
    constructor(key: string, subWord: string, end: boolean);
    updateParent(parent: RadixNode): void;
    addDocument(docID: InternalDocumentID): void;
    removeDocument(docID: InternalDocumentID): boolean;
    findAllWords(output: FindResult, term: string, exact?: boolean, tolerance?: number): FindResult;
    insert(word: string, docId: InternalDocumentID): void;
    private _findLevenshtein;
    find(params: FindParams): FindResult;
    contains(term: string): boolean;
    removeWord(term: string): boolean;
    removeDocumentByWord(term: string, docID: InternalDocumentID, exact?: boolean): boolean;
    private static getCommonPrefix;
    toJSON(): object;
    static fromJSON(json: any): RadixNode;
}
export declare class RadixTree extends RadixNode {
    constructor();
    static fromJSON(json: any): RadixTree;
    toJSON(): object;
}
export {};
