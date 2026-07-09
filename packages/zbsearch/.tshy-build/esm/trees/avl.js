export class AVLNode {
    k;
    v;
    l = null;
    r = null;
    h = 1;
    constructor(key, value) {
        this.k = key;
        this.v = new Set(value);
    }
    updateHeight() {
        this.h = Math.max(AVLNode.getHeight(this.l), AVLNode.getHeight(this.r)) + 1;
    }
    static getHeight(node) {
        return node ? node.h : 0;
    }
    getBalanceFactor() {
        return AVLNode.getHeight(this.l) - AVLNode.getHeight(this.r);
    }
    rotateLeft() {
        const newRoot = this.r;
        this.r = newRoot.l;
        newRoot.l = this;
        this.updateHeight();
        newRoot.updateHeight();
        return newRoot;
    }
    rotateRight() {
        const newRoot = this.l;
        this.l = newRoot.r;
        newRoot.r = this;
        this.updateHeight();
        newRoot.updateHeight();
        return newRoot;
    }
    toJSON() {
        return {
            k: this.k,
            v: Array.from(this.v),
            l: this.l ? this.l.toJSON() : null,
            r: this.r ? this.r.toJSON() : null,
            h: this.h
        };
    }
    static fromJSON(json) {
        const node = new AVLNode(json.k, json.v);
        node.l = json.l ? AVLNode.fromJSON(json.l) : null;
        node.r = json.r ? AVLNode.fromJSON(json.r) : null;
        node.h = json.h;
        return node;
    }
}
export class AVLTree {
    root = null;
    insertCount = 0;
    constructor(key, value) {
        if (key !== undefined && value !== undefined) {
            this.root = new AVLNode(key, value);
        }
    }
    insert(key, value, rebalanceThreshold = 1000) {
        this.root = this.insertNode(this.root, key, value, rebalanceThreshold);
    }
    insertMultiple(key, value, rebalanceThreshold = 1000) {
        for (const v of value) {
            this.insert(key, v, rebalanceThreshold);
        }
    }
    // Rebalance the tree if the insert count reaches the threshold.
    // This will improve insertion performance since we won't be rebalancing the tree on every insert.
    // When inserting docs using `insertMultiple`, the threshold will be set to the number of docs being inserted.
    // We can force rebalancing the tree by setting the threshold to 1 (default).
    rebalance() {
        if (this.root) {
            this.root = this.rebalanceNode(this.root);
        }
    }
    toJSON() {
        return {
            root: this.root ? this.root.toJSON() : null,
            insertCount: this.insertCount
        };
    }
    static fromJSON(json) {
        const tree = new AVLTree();
        tree.root = json.root ? AVLNode.fromJSON(json.root) : null;
        tree.insertCount = json.insertCount || 0;
        return tree;
    }
    insertNode(node, key, value, rebalanceThreshold) {
        if (node === null) {
            return new AVLNode(key, [value]);
        }
        const path = [];
        let current = node;
        let parent = null;
        while (current !== null) {
            path.push({ parent, node: current });
            if (key < current.k) {
                if (current.l === null) {
                    current.l = new AVLNode(key, [value]);
                    path.push({ parent: current, node: current.l });
                    break;
                }
                else {
                    parent = current;
                    current = current.l;
                }
            }
            else if (key > current.k) {
                if (current.r === null) {
                    current.r = new AVLNode(key, [value]);
                    path.push({ parent: current, node: current.r });
                    break;
                }
                else {
                    parent = current;
                    current = current.r;
                }
            }
            else {
                // Key already exists
                current.v.add(value);
                /*
                if (Array.isArray(current.v)) {
                  if (Array.isArray(value)) {
                    ;(current.v as any[]).push(...(value as V[]))
                  } else {
                    ;(current.v as any[]).push(value)
                  }
                } else {
                  current.v = new Set([value])
                }
                */
                return node;
            }
        }
        // Update heights and rebalance if necessary
        let needRebalance = false;
        if (this.insertCount++ % rebalanceThreshold === 0) {
            needRebalance = true;
        }
        for (let i = path.length - 1; i >= 0; i--) {
            const { parent, node: currentNode } = path[i];
            currentNode.updateHeight();
            if (needRebalance) {
                const rebalancedNode = this.rebalanceNode(currentNode);
                if (parent) {
                    if (parent.l === currentNode) {
                        parent.l = rebalancedNode;
                    }
                    else if (parent.r === currentNode) {
                        parent.r = rebalancedNode;
                    }
                }
                else {
                    // This is the root node
                    node = rebalancedNode;
                }
            }
        }
        return node;
    }
    rebalanceNode(node) {
        const balanceFactor = node.getBalanceFactor();
        if (balanceFactor > 1) {
            // Left heavy
            if (node.l && node.l.getBalanceFactor() >= 0) {
                // Left Left Case
                return node.rotateRight();
            }
            else if (node.l) {
                // Left Right Case
                node.l = node.l.rotateLeft();
                return node.rotateRight();
            }
        }
        if (balanceFactor < -1) {
            // Right heavy
            if (node.r && node.r.getBalanceFactor() <= 0) {
                // Right Right Case
                return node.rotateLeft();
            }
            else if (node.r) {
                // Right Left Case
                node.r = node.r.rotateRight();
                return node.rotateLeft();
            }
        }
        return node;
    }
    find(key) {
        const node = this.findNodeByKey(key);
        return node ? node.v : null;
    }
    contains(key) {
        return this.find(key) !== null;
    }
    getSize() {
        let count = 0;
        const stack = [];
        let current = this.root;
        while (current || stack.length > 0) {
            while (current) {
                stack.push(current);
                current = current.l;
            }
            current = stack.pop();
            count++;
            current = current.r;
        }
        return count;
    }
    isBalanced() {
        if (!this.root)
            return true;
        const stack = [this.root];
        while (stack.length > 0) {
            const node = stack.pop();
            const balanceFactor = node.getBalanceFactor();
            if (Math.abs(balanceFactor) > 1) {
                return false;
            }
            if (node.l)
                stack.push(node.l);
            if (node.r)
                stack.push(node.r);
        }
        return true;
    }
    remove(key) {
        this.root = this.removeNode(this.root, key);
    }
    removeDocument(key, id) {
        const node = this.findNodeByKey(key);
        if (!node) {
            return;
        }
        if (node.v.size === 1) {
            this.root = this.removeNode(this.root, key);
        }
        else {
            node.v = new Set([...node.v.values()].filter((v) => v !== id));
        }
    }
    findNodeByKey(key) {
        let node = this.root;
        while (node) {
            if (key < node.k) {
                node = node.l;
            }
            else if (key > node.k) {
                node = node.r;
            }
            else {
                return node;
            }
        }
        return null;
    }
    removeNode(node, key) {
        if (node === null)
            return null;
        const path = [];
        let current = node;
        while (current !== null && current.k !== key) {
            path.push(current);
            if (key < current.k) {
                current = current.l;
            }
            else {
                current = current.r;
            }
        }
        if (current === null) {
            // Key not found
            return node;
        }
        // Node with only one child or no child
        if (current.l === null || current.r === null) {
            const child = current.l ? current.l : current.r;
            if (path.length === 0) {
                // Node to be deleted is root
                node = child;
            }
            else {
                const parent = path[path.length - 1];
                if (parent.l === current) {
                    parent.l = child;
                }
                else {
                    parent.r = child;
                }
            }
        }
        else {
            // Node with two children: Get the inorder successor
            let successorParent = current;
            let successor = current.r;
            while (successor.l !== null) {
                successorParent = successor;
                successor = successor.l;
            }
            // Copy the successor's content to current node
            current.k = successor.k;
            current.v = successor.v;
            // Delete the successor
            if (successorParent.l === successor) {
                successorParent.l = successor.r;
            }
            else {
                successorParent.r = successor.r;
            }
            current = successorParent;
        }
        // Update heights and rebalance
        path.push(current);
        for (let i = path.length - 1; i >= 0; i--) {
            const currentNode = path[i];
            currentNode.updateHeight();
            const rebalancedNode = this.rebalanceNode(currentNode);
            if (i > 0) {
                const parent = path[i - 1];
                if (parent.l === currentNode) {
                    parent.l = rebalancedNode;
                }
                else if (parent.r === currentNode) {
                    parent.r = rebalancedNode;
                }
            }
            else {
                // Root node
                node = rebalancedNode;
            }
        }
        return node;
    }
    rangeSearch(min, max) {
        const result = new Set();
        const stack = [];
        let current = this.root;
        while (current || stack.length > 0) {
            while (current) {
                stack.push(current);
                current = current.l;
            }
            current = stack.pop();
            if (current.k >= min && current.k <= max) {
                for (const value of current.v) {
                    result.add(value);
                }
            }
            if (current.k > max) {
                break;
            }
            current = current.r;
        }
        return result;
    }
    greaterThan(key, inclusive = false) {
        const result = new Set();
        const stack = [];
        let current = this.root;
        while (current || stack.length > 0) {
            while (current) {
                stack.push(current);
                current = current.r; // Traverse right subtree first
            }
            current = stack.pop();
            if ((inclusive && current.k >= key) || (!inclusive && current.k > key)) {
                for (const value of current.v) {
                    result.add(value);
                }
            }
            else if (current.k <= key) {
                break; // Since we're traversing in descending order, we can break early
            }
            current = current.l;
        }
        return result;
    }
    lessThan(key, inclusive = false) {
        const result = new Set();
        const stack = [];
        let current = this.root;
        while (current || stack.length > 0) {
            while (current) {
                stack.push(current);
                current = current.l;
            }
            current = stack.pop();
            if ((inclusive && current.k <= key) || (!inclusive && current.k < key)) {
                for (const value of current.v) {
                    result.add(value);
                }
            }
            else if (current.k > key) {
                break; // Since we're traversing in ascending order, we can break early
            }
            current = current.r;
        }
        return result;
    }
}
//# sourceMappingURL=avl.js.map