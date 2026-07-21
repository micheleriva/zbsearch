import dataset from '../dataset.json' with { type: 'json' }

const MIN_LON = -122.55
const MAX_LON = -122.35
const MIN_LAT = 37.7
const MAX_LAT = 37.85

function hashIndex(i) {
  let x = (i + 1) * 2654435761
  x ^= x >>> 16
  x = Math.imul(x, 2246822519)
  x ^= x >>> 13
  return (x >>> 0) / 0xffffffff
}

export function withGeoPoints(records = dataset) {
  return records.map((record, i) => ({
    ...record,
    location: {
      lon: MIN_LON + hashIndex(i) * (MAX_LON - MIN_LON),
      lat: MIN_LAT + hashIndex(i + 997) * (MAX_LAT - MIN_LAT)
    }
  }))
}

export const GEO_SEARCH_CENTER = { lon: -122.45, lat: 37.78 }

export const GEO_RADIUS_KM = 3
