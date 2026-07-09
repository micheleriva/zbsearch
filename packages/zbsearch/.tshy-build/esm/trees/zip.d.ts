import { Nullable } from '../types.js';
export declare class ZipNode<V = unknown> {
    k: number;
    v: V;
    n: number;
    l: Nullable<ZipNode<V>>;
    r: Nullable<ZipNode<V>>;
    p: Nullable<ZipNode<V>>;
    constructor(key: number, value: V, rank: number);
}
export declare class ZipTree<V = unknown> {
    root: Nullable<ZipNode<V>>;
    constructor();
    private randomRank;
    insert(key: number, value: V): void;
    private bubbleUp;
    private rotateLeft;
    private rotateRight;
    remove(key: number): void;
    private removeNode;
    find(key: number): Nullable<V>;
    contains(key: number): boolean;
    private getNodeByKey;
    rangeSearch(min: number, max: number): V[];
    greaterThan(key: number): V[];
    lessThan(key: number): V[];
    getSize(): number;
    private inOrderTraversal;
    removeDocument(id: V, key: number): void;
    toJSON(): any;
    private nodeToJSON;
    static fromJSON<V>(json: any): ZipTree<V>;
    private nodeFromJSON;
}
