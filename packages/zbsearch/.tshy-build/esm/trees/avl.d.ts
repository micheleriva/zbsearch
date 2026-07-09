import { Nullable } from '../types.js';
export declare class AVLNode<K, V> {
    k: K;
    v: Set<V>;
    l: Nullable<AVLNode<K, V>>;
    r: Nullable<AVLNode<K, V>>;
    h: number;
    constructor(key: K, value: V[]);
    updateHeight(): void;
    static getHeight<K, V>(node: Nullable<AVLNode<K, V>>): number;
    getBalanceFactor(): number;
    rotateLeft(): AVLNode<K, V>;
    rotateRight(): AVLNode<K, V>;
    toJSON(): object;
    static fromJSON<K, V>(json: any): AVLNode<K, V>;
}
export declare class AVLTree<K, V> {
    root: Nullable<AVLNode<K, V>>;
    private insertCount;
    constructor(key?: K, value?: V[]);
    insert(key: K, value: V, rebalanceThreshold?: number): void;
    insertMultiple(key: K, value: V[], rebalanceThreshold?: number): void;
    rebalance(): void;
    toJSON(): object;
    static fromJSON<K, V>(json: any): AVLTree<K, V>;
    private insertNode;
    private rebalanceNode;
    find(key: K): Nullable<Set<V>>;
    contains(key: K): boolean;
    getSize(): number;
    isBalanced(): boolean;
    remove(key: K): void;
    removeDocument(key: K, id: V): void;
    private findNodeByKey;
    private removeNode;
    rangeSearch(min: K, max: K): Set<V>;
    greaterThan(key: K, inclusive?: boolean): Set<V>;
    lessThan(key: K, inclusive?: boolean): Set<V>;
}
