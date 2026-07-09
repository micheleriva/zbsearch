import { createRequire } from 'node:module'
import { avl as oramaAvl } from '@orama/orama/trees'
import { avl as zbsearchAvl } from 'zbsearch/trees'
import {
  generateKeys,
  getSearchBounds,
  KEY_COUNT,
  BATCH_REBALANCE_THRESHOLD
} from './avl-data.js'

const require = createRequire(import.meta.url)

export const versions = {
  orama: require('@orama/orama/package.json').version,
  zbsearch: require('zbsearch/package.json').version
}

const keys = generateKeys(KEY_COUNT)
const bounds = getSearchBounds(keys)

function buildTree(AVLTree, rebalanceThreshold = 1) {
  const tree = new AVLTree()
  for (let i = 0; i < keys.length; i++) {
    tree.insert(keys[i], i, rebalanceThreshold)
  }
  return tree
}

export const treeOrama = buildTree(oramaAvl.AVLTree)
export const treeZBSearch = buildTree(zbsearchAvl.AVLTree)

export const insert = {
  orama: () => {
    const tree = new oramaAvl.AVLTree()
    for (let i = 0; i < keys.length; i++) {
      tree.insert(keys[i], i, 1)
    }
  },
  zbsearch: () => {
    const tree = new zbsearchAvl.AVLTree()
    for (let i = 0; i < keys.length; i++) {
      tree.insert(keys[i], i, 1)
    }
  }
}

export const insertBatched = {
  orama: () => {
    const tree = new oramaAvl.AVLTree()
    for (let i = 0; i < keys.length; i++) {
      tree.insert(keys[i], i, BATCH_REBALANCE_THRESHOLD)
    }
  },
  zbsearch: () => {
    const tree = new zbsearchAvl.AVLTree()
    for (let i = 0; i < keys.length; i++) {
      tree.insert(keys[i], i, BATCH_REBALANCE_THRESHOLD)
    }
  }
}

export const find = {
  orama: () => {
    for (let i = 0; i < keys.length; i++) {
      treeOrama.find(keys[i])
    }
  },
  zbsearch: () => {
    for (let i = 0; i < keys.length; i++) {
      treeZBSearch.find(keys[i])
    }
  }
}

export const contains = {
  orama: () => {
    for (let i = 0; i < keys.length; i++) {
      treeOrama.contains(keys[i])
    }
  },
  zbsearch: () => {
    for (let i = 0; i < keys.length; i++) {
      treeZBSearch.contains(keys[i])
    }
  }
}

export const rangeSearchNarrow = {
  orama: () => {
    treeOrama.rangeSearch(bounds.narrowMin, bounds.narrowMax)
  },
  zbsearch: () => {
    treeZBSearch.rangeSearch(bounds.narrowMin, bounds.narrowMax)
  }
}

export const rangeSearchWide = {
  orama: () => {
    treeOrama.rangeSearch(bounds.wideMin, bounds.wideMax)
  },
  zbsearch: () => {
    treeZBSearch.rangeSearch(bounds.wideMin, bounds.wideMax)
  }
}

export const greaterThan = {
  orama: () => {
    treeOrama.greaterThan(bounds.median)
  },
  zbsearch: () => {
    treeZBSearch.greaterThan(bounds.median)
  }
}

export const lessThan = {
  orama: () => {
    treeOrama.lessThan(bounds.median)
  },
  zbsearch: () => {
    treeZBSearch.lessThan(bounds.median)
  }
}

export const remove = {
  orama: () => {
    const tree = buildTree(oramaAvl.AVLTree)
    for (let i = 0; i < keys.length / 2; i++) {
      tree.remove(keys[i])
    }
  },
  zbsearch: () => {
    const tree = buildTree(zbsearchAvl.AVLTree)
    for (let i = 0; i < keys.length / 2; i++) {
      tree.remove(keys[i])
    }
  }
}
