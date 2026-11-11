import {
  AnyDocument,
  AnyZBSearch,
  Language,
  RawData,
  Result,
  Results,
  SearchParamsFullText,
  TypedDocument,
  load,
  save,
  search
} from 'zbsearch'
import { boundedLevenshtein } from 'zbsearch/internals'

export interface Position {
  start: number
  length: number
}

export type ZBSearchWithHighlight<T extends AnyZBSearch> = T & {
  data: { positions: Record<string, Record<string, Record<string, Position[]>>> }
}

export type ResultWithPositions<ResultDocument> = Result<ResultDocument> & {
  positions: Record<string, Record<string, Position[]>>
}

export type SearchResultWithHighlight<ResultDocument> = Omit<Results<ResultDocument>, 'hits'> & {
  hits: ResultWithPositions<ResultDocument>[]
}

export type RawDataWithPositions = RawData & {
  positions: Record<string, Record<string, Record<string, Position[]>>>
}

export type SourceTextGetter = (id: string, property: string) => string | undefined | Promise<string | undefined>

export interface HighlightOptions {
  /**
   * Returns the text of a property that is not in the documents store (see the `store.exclude` option of
   * `create`), so that its positions can be computed when searching. Called once per hit and property.
   */
  getSourceText?: SourceTextGetter
}

export async function afterInsert<T extends AnyZBSearch>(zbsearch: T, id: string, doc?: AnyDocument): Promise<void> {
  if (!('positions' in zbsearch.data)) {
    Object.assign(zbsearch.data, { positions: {} })
  }

  // The inserted document, rather than the stored one, also has the properties excluded from the documents store
  await recursivePositionInsertion(
    zbsearch as ZBSearchWithHighlight<T>,
    doc ?? (await zbsearch.documentsStore.get(zbsearch.data.docs, id))!,
    id
  )
}

const wordRegEx = /[\p{L}0-9_'-]+/gimu

function getTextPositions<T extends AnyZBSearch>(zbsearch: T, text: string): Record<string, Position[]> {
  const positions: Record<string, Position[]> = Object.create(null)
  let regExResult: RegExpExecArray | null
  while ((regExResult = wordRegEx.exec(text)) !== null) {
    const word = regExResult[0].toLowerCase()
    const start = regExResult.index
    const length = regExResult[0].length
    for (const token of zbsearch.tokenizer.tokenize(word)) {
      if (!token) continue
      if (!Array.isArray(positions[token])) {
        positions[token] = []
      }
      positions[token].push({ start, length })
    }
  }
  return positions
}

function getNestedValue(doc: unknown, path: string): unknown {
  let value = doc
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object') {
      return undefined
    }
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

// Computes the positions of a hit when searching, from its stored document and, for the properties the documents
// store does not have, from `getSourceText`
async function computeHitPositions<T extends AnyZBSearch>(
  zbsearch: T,
  id: string,
  doc: unknown,
  getSourceText: SourceTextGetter | undefined
): Promise<Record<string, Record<string, Position[]>>> {
  const types = zbsearch.index.getSearchablePropertiesWithTypes(zbsearch.data.index)
  const positions: Record<string, Record<string, Position[]>> = Object.create(null)

  for (const [property, type] of Object.entries(types)) {
    if (type !== 'string') {
      continue
    }

    let text = getNestedValue(doc, property)
    if (typeof text !== 'string' && getSourceText) {
      text = await getSourceText(id, property)
    }
    if (typeof text === 'string') {
      positions[property] = getTextPositions(zbsearch, text)
    }
  }

  return positions
}

async function recursivePositionInsertion<T extends AnyZBSearch, ResultDocument = TypedDocument<T>>(
  zbsearch: ZBSearchWithHighlight<T>,
  doc: ResultDocument,
  id: string,
  prefix = '',
  schema: T['schema'] = zbsearch.schema
): Promise<void> {
  zbsearch.data.positions[id] = Object.create(null)
  for (const key of Object.keys(doc as object) as Array<keyof ResultDocument>) {
    const isNested = typeof doc[key] === 'object'
    const isSchemaNested = typeof schema[key] === 'object'
    const propName = `${prefix}${String(key)}`
    if (isNested && key in schema && isSchemaNested) {
      recursivePositionInsertion(zbsearch, doc[key], id, propName + '.', schema[key])
    }
    if (!(typeof doc[key] === 'string' && key in schema && !isSchemaNested)) {
      continue
    }
    // A matched word can yield more than one token: CJK text has no word
    // spaces, so a whole run is one word here that the tokenizer splits into
    // many. getTextPositions records every token instead of only the first one,
    // otherwise the other tokens have no position and cannot be highlighted
    // even though search matches them.
    zbsearch.data.positions[id][propName] = getTextPositions(zbsearch, doc[key] as string)
  }
}

/**
 * Searches and returns the positions of the matched tokens in each hit. The positions recorded by `afterInsert` are
 * used when there are some; otherwise they are computed from the stored document, and from `options.getSourceText`
 * for the properties that are not in the documents store.
 */
export async function searchWithHighlight<T extends AnyZBSearch, ResultDocument = TypedDocument<T>>(
  zbsearch: T,
  params: SearchParamsFullText<T, ResultDocument>,
  language?: Language,
  options: HighlightOptions = {}
): Promise<SearchResultWithHighlight<ResultDocument>> {
  const result = await search(zbsearch, params, language)
  const queryTokens: string[] = zbsearch.tokenizer.tokenize(params.term ?? '', language)
  const recordedPositions = (zbsearch as unknown as Partial<ZBSearchWithHighlight<T>>).data?.positions

  const hitsWithPosition: ResultWithPositions<ResultDocument>[] = []
  for (const hit of result.hits) {
    const hitPositions = Object.entries<any>(
      recordedPositions?.[hit.id] ?? (await computeHitPositions(zbsearch, hit.id, hit.document, options.getSourceText))
    )

    const hits: AnyDocument[] = []
    for (const [propName, tokens] of hitPositions) {
      const matchWithSearchTokens: [string, unknown][] = []

      const tokenEntries = Object.entries(tokens)
      for (const tokenEntry of tokenEntries) {
        const [token] = tokenEntry

        for (const queryToken of queryTokens) {
          if (params.tolerance) {
            const distance = boundedLevenshtein(token, queryToken, params.tolerance)
            if (distance.isBounded) {
              matchWithSearchTokens.push(tokenEntry)
              break
            }
          } else if (token.startsWith(queryToken)) {
            matchWithSearchTokens.push(tokenEntry)
            break
          }
        }
      }
      hits.push([propName, Object.fromEntries(matchWithSearchTokens)])
    }

    hitsWithPosition.push(Object.assign(hit, { positions: Object.fromEntries(hits) }))
  }

  result.hits = hitsWithPosition

  return result as SearchResultWithHighlight<ResultDocument>
}

export function saveWithHighlight<T extends AnyZBSearch>(zbsearch: T): RawDataWithPositions {
  const data = save(zbsearch)

  return {
    ...data,
    positions: (zbsearch as ZBSearchWithHighlight<T>).data.positions
  }
}

export function loadWithHighlight<T extends AnyZBSearch>(zbsearch: T, raw: RawDataWithPositions): void {
  load(zbsearch, raw)
  ;(zbsearch as ZBSearchWithHighlight<T>).data.positions = raw.positions
}
