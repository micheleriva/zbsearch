import type {
  AnyZBSearch,
  AnyDocument,
  FacetResult,
  FacetSorting,
  FacetsParams,
  NumberFacetDefinition,
  SearchableValue,
  StringFacetDefinition,
  TokenScore
} from '../types.js'
import { createError } from '../errors.js'

type FacetValue = string | boolean | number

interface PreparedRange {
  from: number
  to: number
  key: string
}

interface PreparedFacet {
  process: (doc: AnyDocument) => void
  finalize: () => { count: number; values: Record<string, number> }
}

interface ValueCounter {
  count: number
  // Index of the last processed document that incremented this value, used to count array values once per document
  lastDoc: number
}

function sortAsc(a: [string, number], b: [string, number]) {
  return a[1] - b[1]
}

function sortDesc(a: [string, number], b: [string, number]) {
  return b[1] - a[1]
}

function sortingPredicateBuilder(order: FacetSorting = 'desc') {
  return order.toLowerCase() === 'asc' ? sortAsc : sortDesc
}

function getValueAtPath(doc: AnyDocument, pathParts: string[]): SearchableValue | undefined {
  let value: unknown = doc
  for (let i = 0; i < pathParts.length; i++) {
    if (value === null || value === undefined || typeof value !== 'object') {
      return undefined
    }
    value = (value as Record<string, unknown>)[pathParts[i]!]
  }
  return value as SearchableValue | undefined
}

function toFacetKey(facetValue: unknown, defaultValue: string): string {
  if (typeof facetValue === 'string') {
    return facetValue
  }
  return (facetValue as FacetValue | undefined)?.toString() ?? defaultValue
}

function prepareRanges(ranges: NumberFacetDefinition['ranges']): PreparedRange[] {
  const prepared: PreparedRange[] = Array.from({ length: ranges.length })
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!
    prepared[i] = {
      from: range.from,
      to: range.to,
      key: `${range.from}-${range.to}`
    }
  }
  return prepared
}

function finalizeRangeCounts(
  ranges: PreparedRange[],
  counts: number[]
): { count: number; values: Record<string, number> } {
  const values: Record<string, number> = {}
  for (let i = 0; i < ranges.length; i++) {
    values[ranges[i]!.key] = 0
  }
  for (let i = 0; i < ranges.length; i++) {
    const key = ranges[i]!.key
    values[key] += counts[i]!
  }
  return { count: Object.keys(values).length, values }
}

function prepareFacet<T extends AnyZBSearch>(
  facet: string,
  facetsConfig: FacetsParams<T>,
  propertyType: string,
  pathParts: string[] | null
): PreparedFacet {
  const getFacetValue = pathParts
    ? (doc: AnyDocument) => getValueAtPath(doc, pathParts)
    : (doc: AnyDocument) => doc[facet]

  switch (propertyType) {
    case 'number': {
      const { ranges } = facetsConfig[facet] as NumberFacetDefinition
      const preparedRanges = prepareRanges(ranges)
      const rangesLength = preparedRanges.length
      const counts: number[] = new Array(rangesLength).fill(0)
      return {
        process: (doc) => {
          const facetValue = getFacetValue(doc)
          if (typeof facetValue !== 'number') {
            return
          }
          for (let i = 0; i < rangesLength; i++) {
            const range = preparedRanges[i]!
            if (facetValue >= range.from && facetValue <= range.to) {
              counts[i]++
            }
          }
        },
        finalize: () => finalizeRangeCounts(preparedRanges, counts)
      }
    }
    case 'number[]': {
      const { ranges } = facetsConfig[facet] as NumberFacetDefinition
      const preparedRanges = prepareRanges(ranges)
      const rangesLength = preparedRanges.length
      const counts: number[] = new Array(rangesLength).fill(0)
      // Ranges sharing the same key are counted once per document, by the first of them
      const isDuplicateRange: boolean[] = new Array(rangesLength).fill(false)
      for (let i = 0; i < rangesLength; i++) {
        for (let j = 0; j < i; j++) {
          if (preparedRanges[j]!.key === preparedRanges[i]!.key) {
            isDuplicateRange[i] = true
            break
          }
        }
      }
      const lastDoc: number[] = new Array(rangesLength).fill(-1)
      let docIndex = 0
      return {
        process: (doc) => {
          const facetValue = getFacetValue(doc)
          if (!Array.isArray(facetValue)) {
            return
          }

          const currentDoc = docIndex++
          for (let i = 0; i < facetValue.length; i++) {
            const value = facetValue[i] as number
            for (let j = 0; j < rangesLength; j++) {
              const range = preparedRanges[j]!
              if (lastDoc[j] !== currentDoc && !isDuplicateRange[j] && value >= range.from && value <= range.to) {
                counts[j]++
                lastDoc[j] = currentDoc
              }
            }
          }
        },
        finalize: () => finalizeRangeCounts(preparedRanges, counts)
      }
    }
    case 'boolean':
    case 'enum':
    case 'string':
    case 'boolean[]':
    case 'enum[]':
    case 'string[]': {
      const isArrayType = propertyType.endsWith('[]')
      const defaultValue = propertyType === 'boolean' || propertyType === 'boolean[]' ? 'false' : ''
      const counters = new Map<string, ValueCounter>()
      let docIndex = 0

      const process = isArrayType
        ? (doc: AnyDocument) => {
            const facetValue = getFacetValue(doc)
            if (!Array.isArray(facetValue)) {
              return
            }

            const currentDoc = docIndex++
            for (let i = 0; i < facetValue.length; i++) {
              const key = toFacetKey(facetValue[i], defaultValue)
              const counter = counters.get(key)
              if (counter === undefined) {
                counters.set(key, { count: 1, lastDoc: currentDoc })
              } else if (counter.lastDoc !== currentDoc) {
                counter.count++
                counter.lastDoc = currentDoc
              }
            }
          }
        : (doc: AnyDocument) => {
            const key = toFacetKey(getFacetValue(doc), defaultValue)
            const counter = counters.get(key)
            if (counter === undefined) {
              counters.set(key, { count: 1, lastDoc: 0 })
            } else {
              counter.count++
            }
          }

      let sortingPredicate: ((a: [string, number], b: [string, number]) => number) | undefined
      let offset = 0
      let limit = 10
      if (propertyType === 'string') {
        const stringFacetDefinition = facetsConfig[facet] as StringFacetDefinition
        sortingPredicate = sortingPredicateBuilder(stringFacetDefinition.sort)
        offset = stringFacetDefinition.offset ?? 0
        limit = stringFacetDefinition.limit ?? 10
      }

      const finalize = () => {
        const values: Record<string, number> = {}
        for (const [key, counter] of counters) {
          values[key] = counter.count
        }
        const count = Object.keys(values).length
        if (sortingPredicate === undefined) {
          return { count, values }
        }
        return {
          count,
          values: Object.fromEntries(
            Object.entries(values)
              .sort(sortingPredicate)
              .slice(offset, offset + limit)
          )
        }
      }

      return { process, finalize }
    }
    default:
      throw createError('FACET_NOT_SUPPORTED', propertyType)
  }
}

export function getFacets<T extends AnyZBSearch>(
  zbsearch: T,
  results: TokenScore[],
  facetsConfig: FacetsParams<T>
): FacetResult {
  const facets: FacetResult = {}
  const facetKeys = Object.keys(facetsConfig!)
  const properties = zbsearch.index.getSearchablePropertiesWithTypes(zbsearch.data.index)
  const docs = zbsearch.data.docs.docs

  const preparedFacets: PreparedFacet[] = Array.from({ length: facetKeys.length })
  for (let i = 0; i < facetKeys.length; i++) {
    const facet = facetKeys[i]!
    const pathParts = facet.includes('.') ? facet.split('.') : null
    preparedFacets[i] = prepareFacet(facet, facetsConfig, properties[facet]!, pathParts)
  }

  const resultsLength = results.length
  const facetsLength = preparedFacets.length
  for (let i = 0; i < resultsLength; i++) {
    const doc = docs[results[i]![0]!]
    if (!doc) {
      continue
    }

    for (let j = 0; j < facetsLength; j++) {
      preparedFacets[j]!.process(doc)
    }
  }

  for (let i = 0; i < facetKeys.length; i++) {
    facets[facetKeys[i]!] = preparedFacets[i]!.finalize()
  }

  return facets
}
