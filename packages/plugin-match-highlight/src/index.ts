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

export async function afterInsert<T extends AnyZBSearch>(zbsearch: T, id: string): Promise<void> {
  if (!('positions' in zbsearch.data)) {
    Object.assign(zbsearch.data, { positions: {} })
  }

  await recursivePositionInsertion(
    zbsearch as ZBSearchWithHighlight<T>,
    (await zbsearch.documentsStore.get(zbsearch.data.docs, id))!,
    id
  )
}

const wordRegEx = /[\p{L}0-9_'-]+/gimu

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
    zbsearch.data.positions[id][propName] = Object.create(null)
    const text = doc[key] as string
    let regExResult: RegExpExecArray | null
    while ((regExResult = wordRegEx.exec(text)) !== null) {
      const word = regExResult[0].toLowerCase()
      const start = regExResult.index
      const length = regExResult[0].length
      // A matched word can yield more than one token: CJK text has no word
      // spaces, so a whole run is one word here that the tokenizer splits into
      // many. Record every token instead of only the first one, otherwise the
      // other tokens have no position and cannot be highlighted even though
      // search matches them. This mirrors searchWithHighlight, which already
      // iterates the full token array.
      const tokens = zbsearch.tokenizer.tokenize(word)
      for (const token of tokens) {
        if (!token) continue
        if (!Array.isArray(zbsearch.data.positions[id][propName][token])) {
          zbsearch.data.positions[id][propName][token] = []
        }
        zbsearch.data.positions[id][propName][token].push({ start, length })
      }
    }
  }
}

export async function searchWithHighlight<T extends AnyZBSearch, ResultDocument = TypedDocument<T>>(
  zbsearch: T,
  params: SearchParamsFullText<T, ResultDocument>,
  language?: Language
): Promise<SearchResultWithHighlight<ResultDocument>> {
  const result = await search(zbsearch, params, language)
  const queryTokens: string[] = zbsearch.tokenizer.tokenize(params.term ?? '', language)

  const hitsWithPosition: ResultWithPositions<ResultDocument>[] = []
  for (const hit of result.hits) {
    const hitPositions = Object.entries<any>((zbsearch as ZBSearchWithHighlight<T>).data.positions[hit.id])

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
