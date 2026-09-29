export const CORPUS_SCHEMA = {
  title: 'string',
  section: 'string',
  content: 'string'
} as const

const TOPICS = [
  ['getting started', 'installation', 'install the package with your favorite manager and create the first index'],
  ['query syntax', 'search basics', 'a query can combine prefix matching fuzzy matching and exact matching'],
  ['typo tolerance', 'fuzzy search', 'bounded levenshtein distance recovers from common typos in the query'],
  ['ranking', 'relevance', 'results are ranked with bm25 using field lengths and average field length'],
  ['sharding', 'index layout', 'postings are split into shards so the browser fetches only what a query needs'],
  ['fragments', 'documents', 'document fragments are fetched lazily for the results that are displayed'],
  ['dictionary', 'index layout', 'the term dictionary stays resident so typo correction never touches the network'],
  ['boosting', 'relevance', 'per field boosts multiply the score of title matches over content matches'],
  ['thresholds', 'search basics', 'the threshold option balances full matches against partial keyword matches'],
  ['performance', 'benchmarks', 'a warm shard cache answers queries instantly without extra requests'],
  ['stemming', 'languages', 'stemmers normalize words so searching runs also matches running and ran'],
  ['highlighting', 'user interface', 'snippets around the matched terms are computed from the stored content'],
  ['facets', 'filtering', 'facet counts group results by category for quick refinement'],
  ['geosearch', 'filtering', 'documents with coordinates can be filtered by radius or polygon'],
  ['vectors', 'semantic search', 'embedding vectors enable hybrid search that blends lexical and semantic scores'],
  ['pagination', 'search basics', 'limit and offset page through the ranked result list deterministically'],
  ['serialization', 'persistence', 'the whole database serializes to a compact payload for later restore'],
  ['workers', 'performance', 'search can run inside a web worker to keep the main thread responsive'],
  ['manifest', 'index layout', 'the manifest carries global statistics like document count and average field length'],
  ['migration', 'guides', 'moving from another search library takes a single command and a rebuild']
]

export interface CorpusRecord {
  title: string
  section: string
  content: string
  url: string
}

export function makeCorpus(copies = 2): CorpusRecord[] {
  const records: CorpusRecord[] = []

  for (let copy = 0; copy < copies; copy++) {
    for (let i = 0; i < TOPICS.length; i++) {
      const [title, section, content] = TOPICS[i]
      records.push({
        title: copy === 0 ? title : `${title} advanced ${copy}`,
        section,
        content: copy === 0 ? content : `${content} revisited with practical examples part ${copy}`,
        url: `/docs/${copy}/${i}`
      })
    }
  }

  return records
}

export function corpusVocabulary(records: CorpusRecord[]): string[] {
  const words = new Set<string>()
  for (const record of records) {
    for (const field of [record.title, record.section, record.content]) {
      for (const word of field.split(/\s+/)) {
        if (word.length > 2) {
          words.add(word.toLowerCase())
        }
      }
    }
  }
  return Array.from(words).sort()
}
