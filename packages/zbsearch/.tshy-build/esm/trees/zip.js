export class ZipNode {
    // Node key
    k;
    // Node value
    v;
    // Node rank
    n;
    // Left child
    l;
    // Right child
    r;
    // Parent node
    p;
    constructor(key, value, rank) {
        this.k = key;
        this.v = value;
        this.n = rank;
        this.l = null;
        this.r = null;
        this.p = null;
    }
}
export class ZipTree {
    root;
    constructor() {
        this.root = null;
    }
    randomRank() {
        const r = Math.random();
        return Math.floor(Math.log(1 - r) / Math.log(1 - 0.5));
    }
    insert(key, value) {
        const newNode = new ZipNode(key, value, this.randomRank());
        if (!this.root) {
            this.root = newNode;
            return;
        }
        let currentNode = this.root;
        let parent = null;
        while (currentNode != null) {
            parent = currentNode;
            if (key < currentNode.k) {
                currentNode = currentNode.l;
            }
            else if (key > currentNode.k) {
                currentNode = currentNode.r;
            }
            else {
                currentNode.v = value;
                return;
            }
        }
        newNode.p = parent;
        if (parent != null) {
            if (key < parent.k) {
                parent.l = newNode;
            }
            else {
                parent.r = newNode;
            }
        }
        // Bubble up the new node to maintain heap property
        this.bubbleUp(newNode);
    }
    bubbleUp(node) {
        while (node.p != null && node.p.n < node.n) {
            if (node === node.p.l) {
                this.rotateRight(node.p);
            }
            else {
                this.rotateLeft(node.p);
            }
        }
        if (node.p == null) {
            this.root = node;
        }
    }
    rotateLeft(node) {
        const r = node.r;
        node.r = r.l;
        if (r.l != null) {
            r.l.p = node;
        }
        r.l = node;
        r.p = node.p;
        if (node.p == null) {
            this.root = r;
        }
        else if (node === node.p.l) {
            node.p.l = r;
        }
        else {
            node.p.r = r;
        }
        node.p = r;
    }
    rotateRight(node) {
        const l = node.l;
        node.l = l.r;
        if (l.r != null) {
            l.r.p = node;
        }
        l.r = node;
        l.p = node.p;
        if (node.p == null) {
            this.root = l;
        }
        else if (node === node.p.l) {
            node.p.l = l;
        }
        else {
            node.p.r = l;
        }
        node.p = l;
    }
    remove(key) {
        const node = this.getNodeByKey(key);
        if (node == null) {
            return;
        }
        this.removeNode(node);
    }
    removeNode(node) {
        while (node.l != null || node.r != null) {
            if (node.l == null) {
                this.rotateLeft(node);
            }
            else if (node.r == null) {
                this.rotateRight(node);
            }
            else if (node.l.n > node.r.n) {
                this.rotateRight(node);
            }
            else {
                this.rotateLeft(node);
            }
        }
        if (node.p != null) {
            if (node === node.p.l) {
                node.p.l = null;
            }
            else {
                node.p.r = null;
            }
        }
        else {
            this.root = null;
        }
    }
    find(key) {
        const node = this.getNodeByKey(key);
        return node ? node.v : null;
    }
    contains(key) {
        return this.getNodeByKey(key) != null;
    }
    getNodeByKey(key) {
        let currentNode = this.root;
        while (currentNode !== null) {
            if (currentNode.k === key) {
                return currentNode;
            }
            currentNode = key < currentNode.k ? currentNode.l : currentNode.r;
        }
        return null;
    }
    rangeSearch(min, max) {
        const results = [];
        this.inOrderTraversal(this.root, (node) => {
            if (node.k >= min && node.k <= max) {
                results.push(node.v);
            }
        });
        return results;
    }
    greaterThan(key) {
        const results = [];
        this.inOrderTraversal(this.root, (node) => {
            if (node.k > key) {
                results.push(node.v);
            }
        });
        return results;
    }
    lessThan(key) {
        const results = [];
        this.inOrderTraversal(this.root, (node) => {
            if (node.k < key) {
                results.push(node.v);
            }
        });
        return results;
    }
    getSize() {
        let count = 0;
        this.inOrderTraversal(this.root, () => {
            count++;
        });
        return count;
    }
    inOrderTraversal(node, callback) {
        if (node == null) {
            return;
        }
        this.inOrderTraversal(node.l, callback);
        callback(node);
        this.inOrderTraversal(node.r, callback);
    }
    removeDocument(id, key) {
        const node = this.getNodeByKey(key);
        if (node == null)
            return;
        if (Array.isArray(node.v)) {
            const index = node.v.indexOf(id);
            if (index !== -1) {
                node.v.splice(index, 1);
                if (node.v.length === 0) {
                    this.remove(key);
                }
            }
        }
        else {
            if (node.v === id) {
                this.remove(key);
            }
        }
    }
    toJSON() {
        return {
            root: this.nodeToJSON(this.root)
        };
    }
    nodeToJSON(node) {
        if (node == null) {
            return null;
        }
        return {
            k: node.k,
            v: node.v,
            n: node.n,
            l: this.nodeToJSON(node.l),
            r: this.nodeToJSON(node.r)
        };
    }
    static fromJSON(json) {
        const tree = new ZipTree();
        tree.root = tree.nodeFromJSON(json.root, null);
        return tree;
    }
    nodeFromJSON(jsonNode, parent) {
        if (jsonNode == null) {
            return null;
        }
        const node = new ZipNode(jsonNode.k, jsonNode.v, jsonNode.n);
        node.p = parent;
        node.l = this.nodeFromJSON(jsonNode.l, node);
        node.r = this.nodeFromJSON(jsonNode.r, node);
        return node;
    }
}
//# sourceMappingURL=zip.js.map