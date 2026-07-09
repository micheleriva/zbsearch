export class FlatTree {
    numberToDocumentId;
    constructor() {
        this.numberToDocumentId = new Map();
    }
    insert(key, value) {
        if (this.numberToDocumentId.has(key)) {
            this.numberToDocumentId.get(key).add(value);
        }
        else {
            this.numberToDocumentId.set(key, new Set([value]));
        }
    }
    find(key) {
        const idSet = this.numberToDocumentId.get(key);
        return idSet ? Array.from(idSet) : null;
    }
    remove(key) {
        this.numberToDocumentId.delete(key);
    }
    removeDocument(id, key) {
        const idSet = this.numberToDocumentId.get(key);
        if (idSet) {
            idSet.delete(id);
            if (idSet.size === 0) {
                this.numberToDocumentId.delete(key);
            }
        }
    }
    contains(key) {
        return this.numberToDocumentId.has(key);
    }
    getSize() {
        let size = 0;
        for (const idSet of this.numberToDocumentId.values()) {
            size += idSet.size;
        }
        return size;
    }
    filter(operation) {
        const operationKeys = Object.keys(operation);
        if (operationKeys.length !== 1) {
            throw new Error('Invalid operation');
        }
        const operationType = operationKeys[0];
        switch (operationType) {
            case 'eq': {
                const value = operation[operationType];
                const idSet = this.numberToDocumentId.get(value);
                return idSet ? Array.from(idSet) : [];
            }
            case 'in': {
                const values = operation[operationType];
                const resultSet = new Set();
                for (const value of values) {
                    const idSet = this.numberToDocumentId.get(value);
                    if (idSet) {
                        for (const id of idSet) {
                            resultSet.add(id);
                        }
                    }
                }
                return Array.from(resultSet);
            }
            case 'nin': {
                const excludeValues = new Set(operation[operationType]);
                const resultSet = new Set();
                for (const [key, idSet] of this.numberToDocumentId.entries()) {
                    if (!excludeValues.has(key)) {
                        for (const id of idSet) {
                            resultSet.add(id);
                        }
                    }
                }
                return Array.from(resultSet);
            }
            default:
                throw new Error('Invalid operation');
        }
    }
    filterArr(operation) {
        const operationKeys = Object.keys(operation);
        if (operationKeys.length !== 1) {
            throw new Error('Invalid operation');
        }
        const operationType = operationKeys[0];
        switch (operationType) {
            case 'containsAll': {
                const values = operation[operationType];
                const idSets = values.map((value) => this.numberToDocumentId.get(value) ?? new Set());
                if (idSets.length === 0)
                    return [];
                const intersection = idSets.reduce((prev, curr) => {
                    return new Set([...prev].filter((id) => curr.has(id)));
                });
                return Array.from(intersection);
            }
            case 'containsAny': {
                const values = operation[operationType];
                const idSets = values.map((value) => this.numberToDocumentId.get(value) ?? new Set());
                if (idSets.length === 0)
                    return [];
                const union = idSets.reduce((prev, curr) => {
                    return new Set([...prev, ...curr]);
                });
                return Array.from(union);
            }
            default:
                throw new Error('Invalid operation');
        }
    }
    static fromJSON(json) {
        if (!json.numberToDocumentId) {
            throw new Error('Invalid Flat Tree JSON');
        }
        const tree = new FlatTree();
        for (const [key, ids] of json.numberToDocumentId) {
            tree.numberToDocumentId.set(key, new Set(ids));
        }
        return tree;
    }
    toJSON() {
        return {
            numberToDocumentId: Array.from(this.numberToDocumentId.entries()).map(([key, idSet]) => [key, Array.from(idSet)])
        };
    }
}
//# sourceMappingURL=flat.js.map