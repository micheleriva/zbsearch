import { describe, expect, it } from 'vitest'
import { BKDTree } from '../src/trees/bkd.js'

const coordinates = [
  {
    name: 'Golden Gate Bridge',
    lat: 37.8207190397588,
    lon: -122.47838916631231
  },
  {
    name: 'Alcatraz Island',
    lat: 37.82900695513881,
    lon: -122.4231989875759
  },
  {
    name: 'Union Square',
    lat: 37.78816576971418,
    lon: -122.4055109069127
  }
]

describe('create', () => {
  it('should create a new, empty tree', async () => {
    const tree = new BKDTree()
    expect(tree.root).toBe(null)
  })
})

describe('insert', () => {
  it('should insert a new node into an empty tree', async () => {
    const tree = new BKDTree()
    const coordinatePoints = coordinates.map(({ lat, lon }) => ({ lat, lon }))

    for (const point of coordinatePoints) {
      tree.insert(point, [])
    }

    // Use the toJSON method to get a serializable representation
    const expectedTree = {
      root: {
        point: {
          lat: 37.8207190397588,
          lon: -122.47838916631231
        },
        docIDs: [],
        left: null,
        right: {
          point: {
            lat: 37.82900695513881,
            lon: -122.4231989875759
          },
          docIDs: [],
          left: {
            point: {
              lat: 37.78816576971418,
              lon: -122.4055109069127
            },
            docIDs: [],
            left: null,
            right: null
          },
          right: null
        }
      }
    }

    expect(tree.toJSON()).toEqual(expectedTree)
  })

  it('should merge docIDs if the point already exists', async () => {
    const tree = new BKDTree()

    tree.insert({ lat: 37.8207190397588, lon: -122.47838916631231 }, [1])
    tree.insert({ lat: 37.8207190397588, lon: -122.47838916631231 }, [2])
    tree.insert({ lat: 12.1234243234235, lon: -122.1293 }, [3])

    const docIDs = tree.getDocIDsByCoordinates({
      lat: 37.8207190397588,
      lon: -122.47838916631231
    })

    // Sort the arrays before comparison to handle unordered Sets
    expect(docIDs ? docIDs.sort() : null).toEqual([1, 2])
  })
})

describe('searchByRadius', () => {
  it('should return all points within a given radius', async () => {
    const tree = new BKDTree()
    const coordinatePoints = coordinates.map(({ lat, lon }) => ({ lat, lon }))

    for (const point of coordinatePoints) {
      tree.insert(point, [])
    }

    // Should return the coordinates of the Golden Gate Bridge.
    expect(tree.searchByRadius({ lat: 37.7909625, lon: -122.4700284 }, 5_000, true, null)).toEqual([
      {
        point: {
          lat: 37.8207190397588,
          lon: -122.47838916631231
        },
        docIDs: []
      }
    ])

    // Should return nothing as the center is on the east side.
    expect(tree.searchByRadius({ lat: 42.9195535, lon: -70.9817219 }, 10_000, true, null)).toEqual([])

    // Should return the coordinates of all the California locations as they're outside the radius.
    expect(tree.searchByRadius({ lat: 42.9195535, lon: -70.9817219 }, 10_000, false, null)).toEqual(
      coordinatePoints.map(({ lat, lon }) => ({
        point: {
          lat,
          lon
        },
        docIDs: []
      }))
    )
  })
})

describe('searchInsidePolygon', () => {
  it('should return all points inside a given polygon', async () => {
    const tree = new BKDTree()
    const coordinatePoints = coordinates.map(({ lat, lon }) => ({ lat, lon }))

    for (const point of coordinatePoints) {
      tree.insert(point, [])
    }

    const polygon = [
      {
        lon: -122.5305176,
        lat: 37.8247008
      },
      {
        lon: -122.5212479,
        lat: 37.7253794
      },
      {
        lon: -122.3574829,
        lat: 37.7509009
      },
      {
        lon: -122.3866653,
        lat: 37.8371743
      },
      {
        lon: -122.5305176,
        lat: 37.8247008
      }
    ]

    // Should return the coordinates of the points inside the polygon
    expect(tree.searchByPolygon(polygon, true)).toEqual(
      coordinatePoints.map(({ lat, lon }) => ({
        point: {
          lat,
          lon
        },
        docIDs: []
      }))
    )

    // Should return nothing as all the coordinates are inside the polygon, and the search is not inclusive
    expect(tree.searchByPolygon(polygon, false)).toEqual([])
  })
})

describe('contains', () => {
  it('should return true if the tree contains the given point', async () => {
    const tree = new BKDTree()
    const coordinatePoints = coordinates.map(({ lat, lon }) => ({ lat, lon }))

    for (const point of coordinatePoints) {
      tree.insert(point, [])
    }

    expect(tree.contains({ lat: 37.8207190397588, lon: -122.47838916631231 })).toBe(true)
    expect(tree.contains({ lat: 10.1927374719287, lon: -132.123 })).toBe(false)
  })
})

describe('removeDocByID', () => {
  it('should remove a document from the tree by its ID', async () => {
    const tree = new BKDTree()

    tree.insert({ lat: 37.8207190397588, lon: -122.47838916631231 }, [1])
    tree.insert({ lat: 37.8207190397588, lon: -122.47838916631231 }, [2])
    tree.insert({ lat: 37.8207190397588, lon: -122.47838916631231 }, [3])
    tree.insert({ lat: 10.1923018231231, lon: -102.01823819273723 }, [4])

    tree.removeDocByID({ lat: 37.8207190397588, lon: -122.47838916631231 }, 2)

    const docIDs = tree.getDocIDsByCoordinates({
      lat: 37.8207190397588,
      lon: -122.47838916631231
    })

    expect(docIDs ? docIDs.sort() : null).toEqual([1, 3])
  })

  it("If the node doesn't have any more docIDs, it should remove the node", async () => {
    const tree = new BKDTree()

    tree.insert({ lat: 37.8207190397588, lon: -122.47838916631231 }, [1])
    tree.insert({ lat: 37.8207190397588, lon: -122.47838916631231 }, [2])
    tree.insert({ lat: 37.8207190397588, lon: -122.47838916631231 }, [3])
    tree.insert({ lat: 10.1923018231231, lon: -102.01823819273723 }, [4])

    tree.removeDocByID({ lat: 37.8207190397588, lon: -122.47838916631231 }, 1)
    tree.removeDocByID({ lat: 37.8207190397588, lon: -122.47838916631231 }, 2)
    tree.removeDocByID({ lat: 37.8207190397588, lon: -122.47838916631231 }, 3)

    expect(tree.contains({ lat: 37.8207190397588, lon: -122.47838916631231 })).toBe(false)
  })
})
