/** @typedef {{ lon: number; lat: number }} Point */

export const POINT_COUNT = 10_000

// San Francisco Bay Area bounding box
const MIN_LON = -122.55
const MAX_LON = -122.35
const MIN_LAT = 37.70
const MAX_LAT = 37.85

/** @returns {Point[]} */
export function generatePoints(count = POINT_COUNT) {
  const points = new Array(count)
  for (let i = 0; i < count; i++) {
    points[i] = {
      lon: MIN_LON + Math.random() * (MAX_LON - MIN_LON),
      lat: MIN_LAT + Math.random() * (MAX_LAT - MIN_LAT)
    }
  }
  return points
}

export const SEARCH_CENTER = { lon: -122.45, lat: 37.78 }

/** 500m radius - selective query with few matches */
export const SMALL_RADIUS = 500

/** 5km radius - broader query with more matches */
export const LARGE_RADIUS = 5_000

/** Polygon covering most of the generated point cloud */
export const SEARCH_POLYGON = [
  { lon: -122.53, lat: 37.84 },
  { lon: -122.53, lat: 37.71 },
  { lon: -122.36, lat: 37.71 },
  { lon: -122.36, lat: 37.84 },
  { lon: -122.53, lat: 37.84 }
]
