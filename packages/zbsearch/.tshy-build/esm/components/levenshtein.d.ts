export type BoundedMetric = {
    isBounded: boolean;
    distance: number;
};
/**
 * Computes the Levenshtein distance between two strings (a, b), returning early with -1 if the distance
 * is greater than the given tolerance.
 * It assumes that:
 * - tolerance >= ||a| - |b|| >= 0
 */
export declare function boundedLevenshtein(term: string, w: string, tolerance: number): BoundedMetric;
export declare function syncBoundedLevenshtein(term: string, w: string, tolerance: number): BoundedMetric;
export declare function levenshtein(a: string, b: string): number;
