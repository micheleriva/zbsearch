import type { Nullable, GenericSorting } from '../types.js'
import type { InternalDocumentID } from '../components/internal-document-id-store.js'

export interface Point {
  lon: number
  lat: number
}

export interface GeoSearchResult {
  point: Point
  docIDs: InternalDocumentID[]
}

export type SortGeoPoints = Nullable<GenericSorting>

type SearchTask = {
  node: Nullable<BKDNode>
  depth: number
}

type PolygonBounds = {
  minLon: number
  maxLon: number
  minLat: number
  maxLat: number
}

const _K = 2 // 2D points
const EARTH_RADIUS = 6371e3 // Earth radius in meters

class BKDNode {
  point: Point
  docIDs: Set<InternalDocumentID>
  left: Nullable<BKDNode>
  right: Nullable<BKDNode>
  parent: Nullable<BKDNode>

  constructor(point: Point, docIDs?: InternalDocumentID[]) {
    this.point = point
    this.docIDs = new Set(docIDs)
    this.left = null
    this.right = null
    this.parent = null
  }

  toJSON(): any {
    return {
      point: this.point,
      docIDs: Array.from(this.docIDs),
      left: this.left ? this.left.toJSON() : null,
      right: this.right ? this.right.toJSON() : null
    }
  }

  static fromJSON(json: any, parent: Nullable<BKDNode> = null): BKDNode {
    const node = new BKDNode(json.point, json.docIDs)
    node.parent = parent
    if (json.left) {
      node.left = BKDNode.fromJSON(json.left, node)
    }
    if (json.right) {
      node.right = BKDNode.fromJSON(json.right, node)
    }
    return node
  }
}

export class BKDTree {
  root: Nullable<BKDNode>
  nodeMap: Map<string, BKDNode>

  constructor() {
    this.root = null
    this.nodeMap = new Map()
  }

  private getPointKey(point: Point): string {
    return point.lon + ',' + point.lat
  }

  insert(point: Point, docIDs: InternalDocumentID[]): void {
    const lon = point.lon
    const lat = point.lat
    const pointKey = lon + ',' + lat
    const existingNode = this.nodeMap.get(pointKey)
    if (existingNode) {
      for (let i = 0; i < docIDs.length; i++) {
        existingNode.docIDs.add(docIDs[i])
      }
      return
    }

    const newNode = new BKDNode(point, docIDs)
    this.nodeMap.set(pointKey, newNode)

    const root = this.root
    if (root == null) {
      this.root = newNode
      return
    }

    let node = root
    let depth = 0

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const axis = depth & 1
      const nodePoint = node.point
      const goLeft = (axis ? lat : lon) < (axis ? nodePoint.lat : nodePoint.lon)

      if (goLeft) {
        const left = node.left
        if (left == null) {
          node.left = newNode
          newNode.parent = node
          return
        }
        node = left
      } else {
        const right = node.right
        if (right == null) {
          node.right = newNode
          newNode.parent = node
          return
        }
        node = right
      }

      depth++
    }
  }

  contains(point: Point): boolean {
    return this.nodeMap.has(point.lon + ',' + point.lat)
  }

  getDocIDsByCoordinates(point: Point): Nullable<InternalDocumentID[]> {
    const pointKey = this.getPointKey(point)
    const node = this.nodeMap.get(pointKey)
    if (node) {
      return Array.from(node.docIDs)
    }
    return null
  }

  removeDocByID(point: Point, docID: InternalDocumentID): void {
    const pointKey = this.getPointKey(point)
    const node = this.nodeMap.get(pointKey)
    if (node) {
      node.docIDs.delete(docID)
      if (node.docIDs.size === 0) {
        this.nodeMap.delete(pointKey)
        this.deleteNode(node)
      }
    }
  }

  private deleteNode(node: BKDNode): void {
    const parent = node.parent
    const child = node.left ? node.left : node.right
    if (child) {
      child.parent = parent
    }

    if (parent) {
      if (parent.left === node) {
        parent.left = child
      } else if (parent.right === node) {
        parent.right = child
      }
    } else {
      this.root = child
      if (this.root) {
        this.root.parent = null
      }
    }
  }

  searchByRadius(
    center: Point,
    radius: number,
    inclusive = true,
    sort: SortGeoPoints = 'asc',
    highPrecision = false
  ): GeoSearchResult[] {
    const root = this.root
    if (root == null) {
      return []
    }

    const distanceFn = highPrecision ? BKDTree.vincentyDistance : BKDTree.haversineDistance
    const axisDistanceFn = highPrecision ? BKDTree.vincentyAxisDistance : BKDTree.haversineAxisDistance
    const result: GeoSearchResult[] = []
    const sortedEntries: Array<[number, GeoSearchResult]> = []
    const isAsc = sort == null || sort.toLowerCase() === 'asc'

    if (inclusive) {
      const stack: BKDNode[] = [root]
      const depths: number[] = [0]

      while (stack.length > 0) {
        const node = stack.pop()!
        const depth = depths.pop()!

        const dist = distanceFn(center, node.point)
        if (dist <= radius) {
          const entry: GeoSearchResult = { point: node.point, docIDs: Array.from(node.docIDs) }
          if (sort) {
            sortedEntries.push([dist, entry])
          } else {
            result.push(entry)
          }
        }

        const axis = depth & 1
        const centerCoord = axis === 0 ? center.lon : center.lat
        const nodeCoord = axis === 0 ? node.point.lon : node.point.lat
        const searchLeft = centerCoord < nodeCoord

        const near = searchLeft ? node.left : node.right
        const far = searchLeft ? node.right : node.left

        if (near != null) {
          stack.push(near)
          depths.push(depth + 1)
        }

        if (far != null && axisDistanceFn(center, node.point, axis) <= radius) {
          stack.push(far)
          depths.push(depth + 1)
        }
      }
    } else {
      const stack: BKDNode[] = [root]

      while (stack.length > 0) {
        const node = stack.pop()!

        const dist = distanceFn(center, node.point)
        if (dist > radius) {
          const entry: GeoSearchResult = { point: node.point, docIDs: Array.from(node.docIDs) }
          if (sort) {
            sortedEntries.push([dist, entry])
          } else {
            result.push(entry)
          }
        }

        if (node.left != null) {
          stack.push(node.left)
        }
        if (node.right != null) {
          stack.push(node.right)
        }
      }
    }

    if (sort && sortedEntries.length > 0) {
      sortedEntries.sort((a, b) => (isAsc ? a[0] - b[0] : b[0] - a[0]))
      return sortedEntries.map(([, entry]) => entry)
    }

    return result
  }

  searchByPolygon(
    polygon: Point[],
    inclusive = true,
    sort: SortGeoPoints = null,
    highPrecision = false
  ): GeoSearchResult[] {
    const root = this.root
    if (root == null) {
      return []
    }

    const bounds = BKDTree.getPolygonBounds(polygon)
    const result: GeoSearchResult[] = []
    const sortedEntries: Array<[number, GeoSearchResult]> = []
    const isAsc = sort == null || sort.toLowerCase() === 'asc'
    const centroid = sort ? BKDTree.calculatePolygonCentroid(polygon) : null
    const distanceFn = sort != null ? (highPrecision ? BKDTree.vincentyDistance : BKDTree.haversineDistance) : null

    if (inclusive) {
      const stack: BKDNode[] = [root]
      const depths: number[] = [0]

      while (stack.length > 0) {
        const node = stack.pop()!
        const depth = depths.pop()!
        const axis = depth & 1

        if (axis === 0 ? bounds.minLon < node.point.lon : bounds.minLat < node.point.lat) {
          const left = node.left
          if (left != null) {
            stack.push(left)
            depths.push(depth + 1)
          }
        }

        if (axis === 0 ? bounds.maxLon >= node.point.lon : bounds.maxLat >= node.point.lat) {
          const right = node.right
          if (right != null) {
            stack.push(right)
            depths.push(depth + 1)
          }
        }

        const point = node.point
        if (
          point.lon >= bounds.minLon &&
          point.lon <= bounds.maxLon &&
          point.lat >= bounds.minLat &&
          point.lat <= bounds.maxLat &&
          BKDTree.isPointInPolygon(polygon, point)
        ) {
          const entry: GeoSearchResult = { point, docIDs: Array.from(node.docIDs) }
          if (sort && distanceFn && centroid) {
            sortedEntries.push([distanceFn(centroid, point), entry])
          } else {
            result.push(entry)
          }
        }
      }
    } else {
      const stack: SearchTask[] = [{ node: root, depth: 0 }]

      while (stack.length > 0) {
        const { node, depth } = stack.pop()!
        if (node == null) continue

        if (node.left != null) {
          stack.push({ node: node.left, depth: depth + 1 })
        }
        if (node.right != null) {
          stack.push({ node: node.right, depth: depth + 1 })
        }

        const point = node.point
        const inBounds =
          point.lon >= bounds.minLon &&
          point.lon <= bounds.maxLon &&
          point.lat >= bounds.minLat &&
          point.lat <= bounds.maxLat
        const isInsidePolygon = inBounds && BKDTree.isPointInPolygon(polygon, point)

        if (!isInsidePolygon) {
          const entry: GeoSearchResult = { point, docIDs: Array.from(node.docIDs) }
          if (sort && distanceFn && centroid) {
            sortedEntries.push([distanceFn(centroid, point), entry])
          } else {
            result.push(entry)
          }
        }
      }
    }

    if (sort && sortedEntries.length > 0) {
      sortedEntries.sort((a, b) => (isAsc ? a[0] - b[0] : b[0] - a[0]))
      return sortedEntries.map(([, entry]) => entry)
    }

    return result
  }

  toJSON(): any {
    return {
      root: this.root ? this.root.toJSON() : null
    }
  }

  static fromJSON(json: any): BKDTree {
    const tree = new BKDTree()
    if (json.root) {
      tree.root = BKDNode.fromJSON(json.root)
      tree.buildNodeMap(tree.root)
    }
    return tree
  }

  private buildNodeMap(node: Nullable<BKDNode>): void {
    if (node == null) return
    const pointKey = this.getPointKey(node.point)
    this.nodeMap.set(pointKey, node)
    if (node.left) {
      this.buildNodeMap(node.left)
    }
    if (node.right) {
      this.buildNodeMap(node.right)
    }
  }

  private static getPolygonBounds(polygon: Point[]): PolygonBounds {
    let minLon = polygon[0].lon
    let maxLon = polygon[0].lon
    let minLat = polygon[0].lat
    let maxLat = polygon[0].lat

    for (let i = 1; i < polygon.length; i++) {
      const p = polygon[i]
      if (p.lon < minLon) minLon = p.lon
      if (p.lon > maxLon) maxLon = p.lon
      if (p.lat < minLat) minLat = p.lat
      if (p.lat > maxLat) maxLat = p.lat
    }

    return { minLon, maxLon, minLat, maxLat }
  }

  static calculatePolygonCentroid(polygon: Point[]): Point {
    let totalArea = 0
    let centroidX = 0
    let centroidY = 0

    const polygonLength = polygon.length
    for (let i = 0, j = polygonLength - 1; i < polygonLength; j = i++) {
      const xi = polygon[i].lon
      const yi = polygon[i].lat
      const xj = polygon[j].lon
      const yj = polygon[j].lat

      const areaSegment = xi * yj - xj * yi
      totalArea += areaSegment

      centroidX += (xi + xj) * areaSegment
      centroidY += (yi + yj) * areaSegment
    }

    totalArea /= 2
    const centroidCoordinate = 6 * totalArea

    centroidX /= centroidCoordinate
    centroidY /= centroidCoordinate

    return { lon: centroidX, lat: centroidY }
  }

  static isPointInPolygon(polygon: Point[], point: Point): boolean {
    let isInside = false
    const x = point.lon
    const y = point.lat
    const polygonLength = polygon.length
    for (let i = 0, j = polygonLength - 1; i < polygonLength; j = i++) {
      const xi = polygon[i].lon
      const yi = polygon[i].lat
      const xj = polygon[j].lon
      const yj = polygon[j].lat

      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
      if (intersect) isInside = !isInside
    }

    return isInside
  }

  static haversineAxisDistance(center: Point, planePoint: Point, axis: number): number {
    if (axis === 0) {
      return BKDTree.haversineDistance(center, { lon: planePoint.lon, lat: center.lat })
    }
    return BKDTree.haversineDistance(center, { lon: center.lon, lat: planePoint.lat })
  }

  static vincentyAxisDistance(center: Point, planePoint: Point, axis: number): number {
    if (axis === 0) {
      return BKDTree.vincentyDistance(center, { lon: planePoint.lon, lat: center.lat })
    }
    return BKDTree.vincentyDistance(center, { lon: center.lon, lat: planePoint.lat })
  }

  static haversineDistance(coord1: Point, coord2: Point): number {
    const P = Math.PI / 180
    const lat1 = coord1.lat * P
    const lat2 = coord2.lat * P
    const deltaLat = (coord2.lat - coord1.lat) * P
    const deltaLon = (coord2.lon - coord1.lon) * P

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

    return EARTH_RADIUS * c
  }

  static vincentyDistance(coord1: Point, coord2: Point): number {
    const a = 6378137
    const f = 1 / 298.257223563
    const b = (1 - f) * a

    const P = Math.PI / 180
    const lat1 = coord1.lat * P
    const lat2 = coord2.lat * P
    const deltaLon = (coord2.lon - coord1.lon) * P

    const U1 = Math.atan((1 - f) * Math.tan(lat1))
    const U2 = Math.atan((1 - f) * Math.tan(lat2))

    const sinU1 = Math.sin(U1)
    const cosU1 = Math.cos(U1)
    const sinU2 = Math.sin(U2)
    const cosU2 = Math.cos(U2)

    let lambda = deltaLon
    let prevLambda
    let iterationLimit = 1000
    let sinSigma
    let cosSigma
    let sigma
    let sinAlpha
    let cos2Alpha
    let cos2SigmaM

    do {
      const sinLambda = Math.sin(lambda)
      const cosLambda = Math.cos(lambda)

      sinSigma = Math.sqrt(
        cosU2 * sinLambda * (cosU2 * sinLambda) +
          (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda)
      )

      if (sinSigma === 0) return 0 // co-incident points

      cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda
      sigma = Math.atan2(sinSigma, cosSigma)

      sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma
      cos2Alpha = 1 - sinAlpha * sinAlpha
      cos2SigmaM = cosSigma - (2 * sinU1 * sinU2) / cos2Alpha

      if (isNaN(cos2SigmaM)) cos2SigmaM = 0

      const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha))
      prevLambda = lambda
      lambda =
        deltaLon +
        (1 - C) *
          f *
          sinAlpha *
          (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)))
    } while (Math.abs(lambda - prevLambda) > 1e-12 && --iterationLimit > 0)

    if (iterationLimit === 0) {
      return NaN
    }

    const uSquared = (cos2Alpha * (a * a - b * b)) / (b * b)
    const A = 1 + (uSquared / 16384) * (4096 + uSquared * (-768 + uSquared * (320 - 175 * uSquared)))
    const B = (uSquared / 1024) * (256 + uSquared * (-128 + uSquared * (74 - 47 * uSquared)))

    const deltaSigma =
      B *
      sinSigma *
      (cos2SigmaM +
        (B / 4) *
          (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
            (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)))

    const s = b * A * (sigma - deltaSigma)

    return s
  }
}
