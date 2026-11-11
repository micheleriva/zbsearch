import type { internals } from 'zbsearch'
import { radix } from 'zbsearch/trees'

type RadixTree = InstanceType<typeof radix.RadixTree>
type CorpusStatistics = internals.CorpusStatistics

export interface GlobalStatisticsJSON {
  docsCount: number
  avgFieldLength: Record<string, number | null>
  /** Per string property: [terms, document frequencies]. */
  terms: Record<string, [string[], number[]]>
}

/** Above this many dictionary words a query token is not used to prune shards: checking them all costs more than it saves. */
const MAX_EXPANSION_FOR_PRUNING = 4096

/**
 * The resident global layer of a sharded database: corpus-wide BM25 statistics
 * (attached to every shard so that scores do not depend on the partitioning)
 * and a dictionary of every indexed term, which resolves prefix and typo
 * expansions of a query token without loading any shard.
 */
export class GlobalStatistics implements CorpusStatistics {
  docsCount = 0
  avgFieldLength: Record<string, number | undefined> = {}
  private readonly frequencies: Record<string, Map<string, number>> = {}
  private readonly dictionaries: Record<string, RadixTree> = {}
  private termCount = 0

  constructor(readonly stringProperties: string[]) {
    for (const prop of stringProperties) {
      this.frequencies[prop] = new Map()
      this.dictionaries[prop] = new radix.RadixTree()
    }
  }

  documentFrequency(prop: string, term: string): number {
    return this.frequencies[prop]?.get(term) ?? 0
  }

  addTerms(prop: string, terms: Iterable<string>): void {
    const frequencies = this.frequencies[prop]
    for (const term of terms) {
      const df = (frequencies.get(term) ?? 0) + 1
      frequencies.set(term, df)
      if (df === 1) {
        this.dictionaries[prop].insert(term, 1)
        this.termCount++
      }
    }
  }

  removeTerms(prop: string, terms: Iterable<string>): void {
    const frequencies = this.frequencies[prop]
    for (const term of terms) {
      const df = (frequencies.get(term) ?? 0) - 1
      if (df > 0) {
        frequencies.set(term, df)
      } else if (frequencies.delete(term)) {
        this.dictionaries[prop].removeWord(term)
        this.termCount--
      }
    }
  }

  /**
   * The dictionary words a query token resolves to, exactly as the engine's
   * own radix lookup resolves it, or undefined when there are too many of them
   * to be worth checking shard by shard.
   */
  expand(prop: string, token: string, exact: boolean, tolerance: number): string[] | undefined {
    const tree = this.dictionaries[prop]
    if (!tree) {
      return []
    }
    const words = Object.keys(tree.find({ term: token, exact, tolerance }))
    return words.length > MAX_EXPANSION_FOR_PRUNING ? undefined : words
  }

  /** Number of distinct (property, term) pairs. */
  get terms(): number {
    return this.termCount
  }

  toJSON(): GlobalStatisticsJSON {
    const avgFieldLength: Record<string, number | null> = {}
    for (const [prop, value] of Object.entries(this.avgFieldLength)) {
      // JSON has no NaN or undefined; null round-trips both as "no value".
      avgFieldLength[prop] = value === undefined || Number.isNaN(value) ? null : value
    }

    const terms: Record<string, [string[], number[]]> = {}
    for (const [prop, frequencies] of Object.entries(this.frequencies)) {
      terms[prop] = [[...frequencies.keys()], [...frequencies.values()]]
    }

    return { docsCount: this.docsCount, avgFieldLength, terms }
  }

  static fromJSON(stringProperties: string[], json: GlobalStatisticsJSON): GlobalStatistics {
    const stats = new GlobalStatistics(stringProperties)
    stats.docsCount = json.docsCount
    for (const [prop, value] of Object.entries(json.avgFieldLength)) {
      stats.avgFieldLength[prop] = value === null ? undefined : value
    }

    for (const [prop, [words, dfs]] of Object.entries(json.terms)) {
      const frequencies = stats.frequencies[prop]
      const tree = stats.dictionaries[prop]
      if (!frequencies) {
        continue
      }
      for (let i = 0; i < words.length; i++) {
        frequencies.set(words[i], dfs[i])
        tree.insert(words[i], 1)
      }
      stats.termCount += words.length
    }

    return stats
  }
}
