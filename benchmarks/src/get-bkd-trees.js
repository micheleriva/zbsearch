import { createRequire } from 'node:module'
import { bkd as oramaBkd } from '@orama/orama/trees'
import { bkd as zbsearchBkd } from 'zbsearch/trees'
import {
  generatePoints,
  SEARCH_CENTER,
  SMALL_RADIUS,
  LARGE_RADIUS,
  SEARCH_POLYGON,
  POINT_COUNT
} from './bkd-data.js'

const require = createRequire(import.meta.url)

export const versions = {
  orama: require('@orama/orama/package.json').version,
  zbsearch: require('zbsearch/package.json').version
}

const points = generatePoints(POINT_COUNT)

function buildTree(BKDTree) {
  const tree = new BKDTree()
  for (let i = 0; i < points.length; i++) {
    tree.insert(points[i], [i])
  }
  return tree
}

export const treeOrama = buildTree(oramaBkd.BKDTree)
export const treeZBSearch = buildTree(zbsearchBkd.BKDTree)

export const insert = {
  orama: () => {
    const tree = new oramaBkd.BKDTree()
    for (let i = 0; i < points.length; i++) {
      tree.insert(points[i], [i])
    }
  },
  zbsearch: () => {
    const tree = new zbsearchBkd.BKDTree()
    for (let i = 0; i < points.length; i++) {
      tree.insert(points[i], [i])
    }
  }
}

export const searchByRadiusSmall = {
  orama: () => {
    treeOrama.searchByRadius(SEARCH_CENTER, SMALL_RADIUS, true, null)
  },
  zbsearch: () => {
    treeZBSearch.searchByRadius(SEARCH_CENTER, SMALL_RADIUS, true, null)
  }
}

export const searchByRadiusLarge = {
  orama: () => {
    treeOrama.searchByRadius(SEARCH_CENTER, LARGE_RADIUS, true, null)
  },
  zbsearch: () => {
    treeZBSearch.searchByRadius(SEARCH_CENTER, LARGE_RADIUS, true, null)
  }
}

export const searchByRadiusSorted = {
  orama: () => {
    treeOrama.searchByRadius(SEARCH_CENTER, LARGE_RADIUS, true, 'asc')
  },
  zbsearch: () => {
    treeZBSearch.searchByRadius(SEARCH_CENTER, LARGE_RADIUS, true, 'asc')
  }
}

export const searchByPolygon = {
  orama: () => {
    treeOrama.searchByPolygon(SEARCH_POLYGON, true, null)
  },
  zbsearch: () => {
    treeZBSearch.searchByPolygon(SEARCH_POLYGON, true, null)
  }
}

export const contains = {
  orama: () => {
    for (let i = 0; i < points.length; i++) {
      treeOrama.contains(points[i])
    }
  },
  zbsearch: () => {
    for (let i = 0; i < points.length; i++) {
      treeZBSearch.contains(points[i])
    }
  }
}
