import { InternalDocumentID } from '../components/internal-document-id-store.js';
export type Magnitude = number;
export type VectorType = Float32Array;
export type VectorTypeLike = number[] | VectorType;
export type SimilarVector = [number, number];
export declare const DEFAULT_SIMILARITY = 0.8;
export declare class VectorIndex {
    size: number;
    private vectors;
    constructor(size: number);
    add(internalDocumentId: InternalDocumentID, value: VectorTypeLike): void;
    remove(internalDocumentId: InternalDocumentID): void;
    find(vector: VectorTypeLike, similarity: number, whereFiltersIDs: Set<InternalDocumentID> | undefined): SimilarVector[];
    toJSON(): {
        size: number;
        vectors: [InternalDocumentID, [Magnitude, number[]]][];
    };
    static fromJSON(json: any): VectorIndex;
}
export declare function getMagnitude(vector: Float32Array, vectorLength: number): number;
export declare function findSimilarVectors(targetVector: Float32Array, keys: Set<InternalDocumentID> | undefined, vectors: Map<InternalDocumentID, [Magnitude, VectorType]>, length: number, threshold: any): SimilarVector[];
