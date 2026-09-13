import { search as coreSearch, internals } from 'zbsearch'
import type { AnyZBSearch, Results, TokenScore } from 'zbsearch'
import { decodeFragment, fragmentIndexFor } from './fragments.js'
import {
  DICTIONARY_FILE,
  MANIFEST_FILE,
  assertSupportedManifest,
  fragmentFile,
  shardForTerm,
  type StaticManifest
} from './manifest.js'
import { decodeShard } from './shard.js'
import { createShell, mergeDocuments, mergeTermPostings, type StaticShell } from './shell.js'
import { decodeJSON } from './varint.js'

export interface StaticSearchParams {
  term?: string
  properties?: string[] | '*'
  exact?: boolean
  tolerance?: number
  prefix?: boolean
  threshold?: number
  boost?: Record<string, number>
  relevance?: { k?: number; b?: number; d?: number }
  limit?: number
  offset?: number
  where?: Record<string, unknown>
  preflight?: boolean
}

const UNSUPPORTED_PARAMS = ['facets', 'groupBy', 'distinctOn', 'sortBy', 'mode'] as const

export interface StaticClientOptions {
  /** Base URL the index artifacts are served from, e.g. "/zbsearch/". */
  baseUrl?: string
  /** Override transport, e.g. to serve from memory in tests. Receives a path relative to baseUrl. */
  fetchBytes?: (path: string) => Promise<Uint8Array>
}

export interface StaticClientStats {
  requests: number
  bytesFetched: number
  shardsFetched: number
  fragmentsFetched: number
}

export interface StaticSearchClient {
  /** Fetches manifest and dictionary; call it on focus/hover to hide latency. */
  preload(): Promise<void>
  search<Doc = Record<string, unknown>>(params: StaticSearchParams): Promise<Results<Doc>>
  stats(): StaticClientStats
}

function defaultFetchBytes(baseUrl: string) {
  return async (path: string): Promise<Uint8Array> => {
    const response = await fetch(baseUrl + path)
    if (!response.ok) {
      throw new Error(`[zbsearch-static] failed to fetch "${baseUrl + path}": HTTP ${response.status}`)
    }
    return new Uint8Array(await response.arrayBuffer())
  }
}

export function createStaticSearchClient(options: StaticClientOptions = {}): StaticSearchClient {
  const baseUrl = options.baseUrl ? (options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`) : ''
  const rawFetch = options.fetchBytes ?? defaultFetchBytes(baseUrl)

  const stats: StaticClientStats = { requests: 0, bytesFetched: 0, shardsFetched: 0, fragmentsFetched: 0 }

  const fetchBytes = async (path: string): Promise<Uint8Array> => {
    stats.requests++
    const bytes = await rawFetch(path)
    stats.bytesFetched += bytes.length
    return bytes
  }

  let shellPromise: Promise<StaticShell> | undefined
  const shardPromises = new Map<string, Promise<void>>()
  const fragmentPromises = new Map<string, Promise<void>>()

  function ensureShell(): Promise<StaticShell> {
    shellPromise ??= (async () => {
      const [manifestBytes, dictionaryBytes] = await Promise.all([
        fetchBytes(MANIFEST_FILE),
        fetchBytes(DICTIONARY_FILE)
      ])
      const manifest = assertSupportedManifest(decodeJSON<StaticManifest>(manifestBytes))
      return createShell(manifest, dictionaryBytes)
    })().catch((error: unknown) => {
      shellPromise = undefined
      throw error
    })

    return shellPromise
  }

  function fetchShard(shell: StaticShell, file: string): Promise<void> {
    let pending = shardPromises.get(file)
    if (!pending) {
      pending = fetchBytes(file)
        .then((bytes) => {
          mergeTermPostings(shell, decodeShard(bytes))
          stats.shardsFetched++
        })
        .catch((error: unknown) => {
          shardPromises.delete(file)
          throw error
        })
      shardPromises.set(file, pending)
    }
    return pending
  }

  function fetchFragment(shell: StaticShell, group: number): Promise<void> {
    const file = fragmentFile(group)
    let pending = fragmentPromises.get(file)
    if (!pending) {
      pending = fetchBytes(file)
        .then((bytes) => {
          mergeDocuments(shell, decodeFragment(bytes))
          stats.fragmentsFetched++
        })
        .catch((error: unknown) => {
          fragmentPromises.delete(file)
          throw error
        })
      fragmentPromises.set(file, pending)
    }
    return pending
  }

  /**
   * Resolves every dictionary word the engine's own term resolution would
   * touch for this query — a superset prefetch. Core search() then re-resolves
   * against the same tries, so anything it needs is guaranteed to be merged.
   */
  function neededTerms(shell: StaticShell, params: StaticSearchParams): Set<string> {
    const term = params.term ?? ''
    const tolerance = params.tolerance ?? 0
    const prefix = params.prefix ?? true
    const exact = params.exact ?? false
    const radixExact = term ? exact || (!prefix && !tolerance) : false

    const props =
      params.properties && params.properties !== '*'
        ? (params.properties as string[])
        : shell.manifest.props

    const tokens = shell.db.tokenizer.tokenize(term, undefined)
    const needed = new Set<string>()

    for (const prop of props) {
      const tree = shell.tries[prop]
      if (!tree) {
        continue
      }

      for (const token of tokens) {
        const matched = tree.find({ term: token, exact: radixExact, tolerance })
        for (const word of Object.keys(matched)) {
          if (!shell.mergedTerms.has(word)) {
            needed.add(word)
          }
        }
      }
    }

    // String `where` filters resolve through exact trie lookups. Logical
    // clauses (`and`, `or`, `not`) nest arbitrarily, so the walk recurses the
    // same way core's searchByWhereClause does.
    const collectWhereTerms = (clause: Record<string, unknown> | undefined): void => {
      if (!clause) {
        return
      }

      for (const [prop, value] of Object.entries(clause)) {
        if (prop === 'and' || prop === 'or') {
          for (const sub of Array.isArray(value) ? value : [value]) {
            collectWhereTerms(sub as Record<string, unknown>)
          }
          continue
        }
        if (prop === 'not') {
          collectWhereTerms(value as Record<string, unknown>)
          continue
        }

        const tree = shell.tries[prop]
        if (!tree) {
          continue
        }

        const values = Array.isArray(value) ? value : [value]
        for (const item of values) {
          if (typeof item !== 'string') {
            continue
          }
          for (const token of shell.db.tokenizer.tokenize(item, undefined, prop)) {
            const matched = tree.find({ term: token, exact: true, tolerance: 0 })
            for (const word of Object.keys(matched)) {
              if (!shell.mergedTerms.has(word)) {
                needed.add(word)
              }
            }
          }
        }
      }
    }
    collectWhereTerms(params.where)

    return needed
  }

  async function prefetchPostings(shell: StaticShell, params: StaticSearchParams): Promise<void> {
    const terms = neededTerms(shell, params)
    if (terms.size === 0) {
      return
    }

    const files = new Set<string>()
    for (const term of terms) {
      const shard = shardForTerm(shell.manifest.shards, term)
      if (shard) {
        files.add(shard.file)
      }
    }

    await Promise.all(Array.from(files, (file) => fetchShard(shell, file)))
  }

  async function prefetchDocuments(shell: StaticShell, internalIds: number[]): Promise<void> {
    const groups = new Set<number>()
    for (const id of internalIds) {
      if (!shell.presentDocs.has(id)) {
        groups.add(fragmentIndexFor(id, shell.manifest.fragments.groupSize))
      }
    }

    await Promise.all(Array.from(groups, (group) => fetchFragment(shell, group)))
  }

  async function search<Doc = Record<string, unknown>>(params: StaticSearchParams): Promise<Results<Doc>> {
    for (const key of UNSUPPORTED_PARAMS) {
      if (key in params && (params as Record<string, unknown>)[key] !== undefined) {
        throw new Error(`[zbsearch-static] the "${key}" search option is not supported by the static client yet`)
      }
    }

    const shell = await ensureShell()
    await prefetchPostings(shell, params)

    // Browsing with no term, filters, or properties means "all documents":
    // the engine walks the documents store directly, so the displayed page of
    // documents must be resident and the total count comes from the manifest.
    // An empty filter object is no filter, exactly as core treats it.
    const hasFilters = params.where !== undefined && Object.keys(params.where).length > 0
    const isBrowseAll = !params.term && !hasFilters && !params.properties

    if (isBrowseAll) {
      if (!params.preflight) {
        const end = Math.min((params.offset ?? 0) + (params.limit ?? 10), shell.manifest.docsCount)
        const ids = Array.from({ length: end }, (_, i) => i + 1)
        await prefetchDocuments(shell, ids)
      }

      const results = (await coreSearch(shell.db, params as never)) as Results<Doc>
      results.count = shell.manifest.docsCount
      return results
    }

    const isExact = Boolean(params.exact && params.term)

    if (!params.preflight || isExact) {
      // First pass scores against the merged postings to learn which documents
      // will be displayed; only their fragments are fetched. Core implements
      // `exact` with a document-level text check, so that pass runs without it
      // (same trie walk via prefix:false/tolerance:0) and every candidate's
      // document is fetched - the check can reject candidates, which would
      // otherwise pull unfetched ones into the displayed page.
      const scoringParams = isExact ? { ...params, exact: false, prefix: false, tolerance: 0 } : params
      const scored = internals.innerFullTextSearch(
        shell.db as AnyZBSearch,
        scoringParams as Parameters<typeof internals.innerFullTextSearch>[1],
        undefined
      ) as TokenScore[]
      scored.sort(internals.sortTokenScorePredicate)

      const end = isExact ? scored.length : (params.offset ?? 0) + (params.limit ?? 10)
      await prefetchDocuments(
        shell,
        scored.slice(0, end).map(([id]) => id)
      )
    }

    // Second pass is the engine's own search, end to end: same trie, now-live
    // postings, manifest stats. Semantics and scores are core's, not ours.
    return (await coreSearch(shell.db, params as never)) as Results<Doc>
  }

  return {
    preload: async () => {
      await ensureShell()
    },
    search,
    stats: () => ({ ...stats })
  }
}
