export const DEFAULT_SIMILARITY = 0.8;
export class VectorIndex {
    size;
    vectors = new Map();
    constructor(size) {
        this.size = size;
    }
    add(internalDocumentId, value) {
        if (!(value instanceof Float32Array)) {
            value = new Float32Array(value);
        }
        const magnitude = getMagnitude(value, this.size);
        this.vectors.set(internalDocumentId, [magnitude, value]);
    }
    remove(internalDocumentId) {
        this.vectors.delete(internalDocumentId);
    }
    find(vector, similarity, whereFiltersIDs) {
        if (!(vector instanceof Float32Array)) {
            vector = new Float32Array(vector);
        }
        const results = findSimilarVectors(vector, whereFiltersIDs, this.vectors, this.size, similarity);
        return results;
    }
    toJSON() {
        const vectors = [];
        for (const [id, [magnitude, vector]] of this.vectors) {
            vectors.push([id, [magnitude, Array.from(vector)]]);
        }
        return {
            size: this.size,
            vectors
        };
    }
    static fromJSON(json) {
        const raw = json;
        const index = new VectorIndex(raw.size);
        for (const [id, [magnitude, vector]] of raw.vectors) {
            index.vectors.set(id, [magnitude, new Float32Array(vector)]);
        }
        return index;
    }
}
export function getMagnitude(vector, vectorLength) {
    let magnitude = 0;
    for (let i = 0; i < vectorLength; i++) {
        magnitude += vector[i] * vector[i];
    }
    return Math.sqrt(magnitude);
}
// @todo: Write plugins for Node and Browsers to use parallel computation for this function
export function findSimilarVectors(targetVector, keys, vectors, length, threshold) {
    const targetMagnitude = getMagnitude(targetVector, length);
    const similarVectors = [];
    const base = keys ? keys : vectors.keys();
    for (const vectorId of base) {
        const entry = vectors.get(vectorId);
        if (!entry) {
            continue;
        }
        const magnitude = entry[0];
        const vector = entry[1];
        let dotProduct = 0;
        for (let i = 0; i < length; i++) {
            dotProduct += targetVector[i] * vector[i];
        }
        const similarity = dotProduct / (targetMagnitude * magnitude);
        if (similarity >= threshold) {
            similarVectors.push([vectorId, similarity]);
        }
    }
    return similarVectors;
}
//# sourceMappingURL=vector.js.map