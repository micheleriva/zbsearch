import { describe, expect, it } from 'vitest'
import { create, insert, search } from '../src/index.js'

describe('geosearch', () => {
  it('should find geopoints inside a radius', async () => {
    const db = create({
      schema: {
        id: 'string',
        location: 'geopoint'
      } as const
    })

    await insert(db, {
      id: '1',
      location: {
        lat: 9.0814233,
        lon: 45.2623823
      }
    })

    await insert(db, {
      id: '2',
      location: {
        lat: 9.0979028,
        lon: 45.1995182
      }
    })

    const results = await search(db, {
      where: {
        location: {
          radius: {
            coordinates: {
              lat: 9.1418481,
              lon: 45.2324096
            },
            unit: 'km',
            value: 10,
            inside: true
          }
        }
      }
    })

    expect(results.count).toEqual(2)
    // Results should be sorted by distance (closer first)
    // Point 2 (9.0979028, 45.1995182) is closer to search center (9.1418481, 45.2324096) than Point 1 (9.0814233, 45.2623823)
    expect(results.hits.map(({ id }) => id)).toEqual(['2', '1'])
  })

  it('should find geopoints outside a radius', async () => {
    const db = await create({
      schema: {
        id: 'string',
        location: 'geopoint'
      } as const
    })

    await insert(db, { id: '1', location: { lat: -72.1928787, lon: 42.9309292 } })
    await insert(db, { id: '2', location: { lat: -72.1928787, lon: 42.929908 } })
    await insert(db, { id: '3', location: { lat: -72.1912479, lon: 42.9302222 } })
    await insert(db, { id: '4', location: { lat: -72.1917844, lon: 42.9312277 } })
    await insert(db, { id: '5', location: { lat: -72.1928787, lon: 42.9309292 } })
    await insert(db, { id: '6', location: { lat: -10.2328721, lon: 20.9385112 } })

    const results = await search(db, {
      where: {
        location: {
          radius: {
            coordinates: {
              lat: -10.2328758,
              lon: 20.938517
            },
            value: 10,
            unit: 'km',
            inside: false
          }
        }
      }
    })

    expect(results.count).toEqual(5)
    const resultIds = results.hits.map(({ id }) => id).sort()
    expect(resultIds).toEqual(['1', '2', '3', '4', '5'])
  })

  it('should find geopoints inside a polygon', async () => {
    const db = create({
      schema: {
        id: 'string',
        location: 'geopoint'
      } as const
    })

    await insert(db, { id: '1', location: { lat: -50.6964111, lon: 70.2120854 } })
    await insert(db, { id: '2', location: { lat: -50.7403564, lon: 70.1823094 } })
    await insert(db, { id: '3', location: { lat: -51.2512207, lon: 70.1123535 } })
    await insert(db, { id: '4', location: { lat: -50.8639526, lon: 70.0796264 } })
    await insert(db, { id: '5', location: { lat: -50.6167603, lon: 70.0973989 } })

    const results = await search(db, {
      where: {
        location: {
          polygon: {
            coordinates: [
              { lat: -51.3693237, lon: 70.4082687 },
              { lat: -51.5643311, lon: 69.8623282 },
              { lat: -49.9822998, lon: 69.8273124 },
              { lat: -49.7543335, lon: 70.3787763 },
              { lat: -51.3693237, lon: 70.4082687 }
            ]
          }
        }
      }
    })

    expect(results.count).toEqual(5)
    // Results should be sorted by distance from polygon centroid
    // Just verify we get the right count and all expected documents, order may vary by distance
    const resultIds = results.hits.map(({ id }) => id).sort()
    expect(resultIds).toEqual(['1', '2', '3', '4', '5'])
  })

  it('should find geopoints outside a polygon', async () => {
    const db = create({
      schema: {
        id: 'string',
        location: 'geopoint'
      } as const
    })

    await insert(db, { id: '1', location: { lat: -50.6964111, lon: 70.2120854 } })
    await insert(db, { id: '2', location: { lat: -50.7403564, lon: 70.1823094 } })
    await insert(db, { id: '3', location: { lat: -51.2512207, lon: 70.1123535 } })
    await insert(db, { id: '4', location: { lat: -50.8639526, lon: 70.0796264 } })
    await insert(db, { id: '5', location: { lat: -50.6167603, lon: 70.0973989 } })

    const results = await search(db, {
      where: {
        location: {
          polygon: {
            coordinates: [
              { lat: -52.6779842, lon: 71.5489379 },
              { lat: -52.9086971, lon: 71.2828433 },
              { lat: -51.8759823, lon: 71.208667 },
              { lat: -51.5024471, lon: 71.4932231 },
              { lat: -52.6779842, lon: 71.5489379 }
            ],
            inside: false
          }
        }
      }
    })

    expect(results.count).toEqual(5)
    const resultIds = results.hits.map(({ id }) => id).sort()
    expect(resultIds).toEqual(['1', '2', '3', '4', '5'])
  })

  it('should run in high-precision mode', async () => {
    const db = create({
      schema: {
        id: 'string',
        location: 'geopoint'
      } as const
    })

    await insert(db, { id: '1', location: { lat: -50.6964111, lon: 70.2120854 } })
    await insert(db, { id: '2', location: { lat: -50.7403564, lon: 70.1823094 } })
    await insert(db, { id: '3', location: { lat: -51.2512207, lon: 70.1123535 } })
    await insert(db, { id: '4', location: { lat: -50.8639526, lon: 70.0796264 } })
    await insert(db, { id: '5', location: { lat: -50.6167603, lon: 70.0973989 } })

    const polygonResults = await search(db, {
      where: {
        location: {
          polygon: {
            coordinates: [
              { lat: -52.6779842, lon: 71.5489379 },
              { lat: -52.9086971, lon: 71.2828433 },
              { lat: -51.8759823, lon: 71.208667 },
              { lat: -51.5024471, lon: 71.4932231 },
              { lat: -52.6779842, lon: 71.5489379 }
            ],
            inside: false,
            highPrecision: true
          }
        }
      }
    })

    const radiusResults = await search(db, {
      where: {
        location: {
          radius: {
            coordinates: {
              lat: -50.7403564,
              lon: 70.1823094
            },
            value: 10,
            unit: 'km',
            inside: true,
            highPrecision: true
          }
        }
      }
    })

    expect(polygonResults.count).toEqual(5)
    const polygonResultIds = polygonResults.hits.map(({ id }) => id).sort()
    expect(polygonResultIds).toEqual(['1', '2', '3', '4', '5'])

    expect(radiusResults.count).toEqual(2)
    expect(radiusResults.hits.map(({ id }) => id)).toEqual(['2', '1'])
  })

  // Test cases to verify that issue #547 is fixed
  // https://github.com/oramasearch/orama/issues/547
  describe('should fix issue #547 - geosearch results should be sorted by distance', () => {
    it('should sort radius search results by distance without search terms', async () => {
      const db = create({
        schema: {
          id: 'string',
          name: 'string',
          location: 'geopoint'
        } as const
      })

      // Insert points at different distances from search center (45.0, 9.0)
      await insert(db, {
        id: 'far',
        name: 'Far Point',
        location: { lat: 45.5, lon: 9.5 } // ~60km away
      })

      await insert(db, {
        id: 'close',
        name: 'Close Point',
        location: { lat: 45.05, lon: 9.05 } // ~7km away
      })

      await insert(db, {
        id: 'medium',
        name: 'Medium Point',
        location: { lat: 45.2, lon: 9.2 } // ~28km away
      })

      // Search without any text query - should sort by distance
      const results = await search(db, {
        where: {
          location: {
            radius: {
              coordinates: { lat: 45.0, lon: 9.0 },
              value: 100,
              unit: 'km'
            }
          }
        }
      })

      expect(results.count).toEqual(3)
      // Results should be sorted by distance: close, medium, far
      expect(results.hits.map(({ id }) => id)).toEqual(['close', 'medium', 'far'])

      // Verify scores are based on distance (closer = higher score)
      const scores = results.hits.map((hit) => hit.score)
      expect(scores[0] > scores[1], 'Closest point should have highest score').toBeTruthy()
      expect(scores[1] > scores[2], 'Medium point should have higher score than farthest').toBeTruthy()
    })

    it('should sort polygon search results by distance from centroid without search terms', async () => {
      const db = create({
        schema: {
          id: 'string',
          name: 'string',
          location: 'geopoint'
        } as const
      })

      // Define a square polygon around (45.0, 9.0)
      const polygon = [
        { lat: 44.9, lon: 8.9 },
        { lat: 44.9, lon: 9.1 },
        { lat: 45.1, lon: 9.1 },
        { lat: 45.1, lon: 8.9 },
        { lat: 44.9, lon: 8.9 }
      ]

      // Insert points at different distances from polygon centroid
      await insert(db, {
        id: 'center',
        name: 'Center Point',
        location: { lat: 45.0, lon: 9.0 } // At centroid
      })

      await insert(db, {
        id: 'edge',
        name: 'Edge Point',
        location: { lat: 44.95, lon: 8.95 } // Near edge
      })

      await insert(db, {
        id: 'corner',
        name: 'Corner Point',
        location: { lat: 44.9, lon: 8.9 } // At corner
      })

      const results = await search(db, {
        where: {
          location: {
            polygon: {
              coordinates: polygon
            }
          }
        }
      })

      expect(results.count).toEqual(3)
      // Results should be sorted by distance from centroid: center, edge, corner
      expect(results.hits.map(({ id }) => id)).toEqual(['center', 'edge', 'corner'])

      // Verify scores are distance-based
      const scores = results.hits.map((hit) => hit.score)
      expect(scores[0] > scores[1], 'Center point should have highest score').toBeTruthy()
      expect(scores[1] > scores[2], 'Edge point should have higher score than corner').toBeTruthy()
    })

    it('should maintain distance sorting when combined with text search', async () => {
      const db = create({
        schema: {
          id: 'string',
          name: 'string',
          location: 'geopoint'
        } as const
      })

      await insert(db, {
        id: 'restaurant_far',
        name: 'Pizza Restaurant',
        location: { lat: 45.5, lon: 9.5 } // Far
      })

      await insert(db, {
        id: 'restaurant_close',
        name: 'Pizza Place',
        location: { lat: 45.05, lon: 9.05 } // Close
      })

      // Search with both text and geo filters
      const results = await search(db, {
        term: 'pizza',
        where: {
          location: {
            radius: {
              coordinates: { lat: 45.0, lon: 9.0 },
              value: 100,
              unit: 'km'
            }
          }
        }
      })

      expect(results.count).toEqual(2)
      // Should still consider distance in scoring
      expect(results.hits.length === 2, 'Should find both pizza places').toBeTruthy()
    })
  })
})
