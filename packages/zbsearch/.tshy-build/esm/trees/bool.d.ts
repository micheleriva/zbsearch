export declare class BoolNode<V = unknown> {
    true: Set<V>;
    false: Set<V>;
    constructor();
    insert(value: V, bool: boolean): void;
    delete(value: V, bool: boolean): void;
    getSize(): number;
    toJSON(): any;
    static fromJSON<V>(json: any): BoolNode<V>;
}
