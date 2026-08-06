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
  values: Record<string, number>
  process: (doc: AnyDocument) => void
  finalize: () => Record<string, number>
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

function incrementNumberFacet(
  ranges: PreparedRange[],
  values: Record<string, number>,
  facetValue: number,
  alreadyInsertedValues?: Set<string>
) {
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!
    if (alreadyInsertedValues?.has(range.key)) {
      continue
    }

    if (facetValue >= range.from && facetValue <= range.to) {
      const current = values[range.key]
      if (current === undefined) {
        values[range.key] = 1
      } else {
        values[range.key] = current + 1
        alreadyInsertedValues?.add(range.key)
      }
    }
  }
}

function incrementBooleanStringOrEnumFacet(
  values: Record<string, number>,
  propertyType: 'string' | 'boolean' | 'enum',
  facetValue: FacetValue,
  alreadyInsertedValues?: Set<string>
) {
  const defaultValue = propertyType === 'boolean' ? 'false' : ''
  const value = facetValue?.toString() ?? defaultValue
  if (alreadyInsertedValues?.has(value)) {
    return
  }

  const current = values[value]
  values[value] = current === undefined ? 1 : current + 1
  alreadyInsertedValues?.add(value)
}

function prepareRangeValues(ranges: NumberFacetDefinition['ranges']): Record<string, number> {
  const values: Record<string, number> = {}
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!
    values[`${range.from}-${range.to}`] = 0
  }
  return values
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

function prepareFacet<T extends AnyZBSearch>(
  facet: string,
  facetsConfig: FacetsParams<T>,
  propertyType: string,
  pathParts: string[] | null
): PreparedFacet {
  const getFacetValue = pathParts
    ? (doc: AnyDocument) => getValueAtPath(doc, pathParts)
    : (doc: AnyDocument) => doc[facet]

  let values: Record<string, number> = {}
  let process: (doc: AnyDocument) => void
  let finalize: () => Record<string, number> = () => values

  switch (propertyType) {
    case 'number': {
      const { ranges } = facetsConfig[facet] as NumberFacetDefinition
      const preparedRanges = prepareRanges(ranges)
      values = prepareRangeValues(ranges)
      process = (doc) => {
        const facetValue = getFacetValue(doc)
        if (typeof facetValue === 'number') {
          incrementNumberFacet(preparedRanges, values, facetValue)
        }
      }
      break
    }
    case 'number[]': {
      const { ranges } = facetsConfig[facet] as NumberFacetDefinition
      const preparedRanges = prepareRanges(ranges)
      values = prepareRangeValues(ranges)
      process = (doc) => {
        const facetValue = getFacetValue(doc)
        if (!Array.isArray(facetValue)) {
          return
        }

        const alreadyInsertedValues = new Set<string>()
        for (let i = 0; i < facetValue.length; i++) {
          incrementNumberFacet(preparedRanges, values, facetValue[i] as number, alreadyInsertedValues)
        }
      }
      break
    }
    case 'boolean':
    case 'enum':
    case 'string': {
      const innerType = propertyType as 'string' | 'boolean' | 'enum'
      process = (doc) => {
        const facetValue = getFacetValue(doc)
        incrementBooleanStringOrEnumFacet(values, innerType, facetValue as FacetValue)
      }
      if (propertyType === 'string') {
        const stringFacetDefinition = facetsConfig[facet] as StringFacetDefinition
        const sortingPredicate = sortingPredicateBuilder(stringFacetDefinition.sort)
        const offset = stringFacetDefinition.offset ?? 0
        const limit = stringFacetDefinition.limit ?? 10
        finalize = () =>
          Object.fromEntries(
            Object.entries(values)
              .sort(sortingPredicate)
              .slice(offset, offset + limit)
          )
      }
      break
    }
    case 'boolean[]':
    case 'enum[]':
    case 'string[]': {
      const innerType = propertyType === 'boolean[]' ? 'boolean' : 'string'
      process = (doc) => {
        const facetValue = getFacetValue(doc)
        if (!Array.isArray(facetValue)) {
          return
        }

        const alreadyInsertedValues = new Set<string>()
        for (let i = 0; i < facetValue.length; i++) {
          incrementBooleanStringOrEnumFacet(values, innerType, facetValue[i] as FacetValue, alreadyInsertedValues)
        }
      }
      break
    }
    default:
      throw createError('FACET_NOT_SUPPORTED', propertyType)
  }

  return { values, process, finalize }
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
    facets[facet] = {
      count: 0,
      values: preparedFacets[i]!.values
    }
  }

  const resultsLength = results.length
  for (let i = 0; i < resultsLength; i++) {
    const doc = docs[results[i]![0]!]
    if (!doc) {
      continue
    }

    for (let j = 0; j < facetKeys.length; j++) {
      preparedFacets[j]!.process(doc)
    }
  }

  for (let i = 0; i < facetKeys.length; i++) {
    const facet = facetKeys[i]!
    const preparedFacet = preparedFacets[i]!
    facets[facet]!.count = Object.keys(preparedFacet.values).length
    facets[facet]!.values = preparedFacet.finalize()
  }

  return facets
}
