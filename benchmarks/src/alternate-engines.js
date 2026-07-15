import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import FlexSearch from 'flexsearch'
import Fuse from 'fuse.js'
import lunr from 'lunr'
import MiniSearch from 'minisearch'
import dataset from './dataset.json' with { type: 'json' }
import {
  SEARCH_LIMIT,
  stopWordSet,
  toSearchRecord,
  searchParams,
  tokenizeSearchTerm
} from './benchmark-config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function pkgVersion(name) {
  return JSON.parse(readFileSync(join(__dirname, '../node_modules', name, 'package.json'), 'utf8')).version
}

export const alternateVersions = {
  flexsearch: pkgVersion('flexsearch'),
  fusejs: pkgVersion('fuse.js'),
  lunr: pkgVersion('lunr'),
  minisearch: pkgVersion('minisearch')
}

const flexSearchDocumentConfig = {
  preset: 'score',
  document: {
    id: 'id',
    index: ['content'],
    store: ['title', 'description', 'rating', 'genres']
  }
}

const miniSearchOptions = {
  fields: ['title', 'description'],
  storeFields: ['title', 'description', 'rating', 'genres'],
  processTerm: (term) => (stopWordSet.has(term) ? null : term.toLowerCase())
}

const fuseSearchOptions = {
  keys: ['title', 'description'],
  useTokenSearch: true,
  tokenMatch: 'all',
  threshold: 0,
  ignoreLocation: true,
  includeScore: false
}

const customStopWordFilter = lunr.generateStopWordFilter([...stopWordSet])

function configureLunrFields(builder) {
  builder.ref('id')
  builder.field('title')
  builder.field('description')
  builder.pipeline.remove(lunr.stopWordFilter)
  builder.pipeline.remove(lunr.stemmer)
  builder.pipeline.add(customStopWordFilter)
  builder.searchPipeline.remove(lunr.stopWordFilter)
  builder.searchPipeline.remove(lunr.stemmer)
  builder.searchPipeline.add(customStopWordFilter)
}

function createLunrIndexFromRecords(records, docsById) {
  return lunr(function () {
    configureLunrFields(this)

    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      docsById.set(i, { id: i, ...record })
      this.add({
        id: String(i),
        title: record.title,
        description: record.description
      })
    }
  })
}

function createFlexSearch() {
  return new FlexSearch.Document(flexSearchDocumentConfig)
}

function createMiniSearch() {
  return new MiniSearch(miniSearchOptions)
}

function createFuseIndex(records) {
  return new Fuse(
    records.map((record, id) => ({ id, ...record })),
    fuseSearchOptions
  )
}

function createFuseSearch() {
  return createFuseIndex(dataset)
}

function addToFlexSearch(index, record, id) {
  index.add(toSearchRecord(record, id))
}

function addAllToFlexSearch(index, records) {
  for (let i = 0; i < records.length; i++) {
    addToFlexSearch(index, records[i], i)
  }
}

function addAllToMiniSearch(index, records) {
  index.addAll(records.map((record, i) => ({ id: i, ...record })))
}

function intersectSets(a, b) {
  const result = new Set()
  for (const value of a) {
    if (b.has(value)) {
      result.add(value)
    }
  }
  return result
}

function flexSearchAndHits(index, term) {
  const tokens = tokenizeSearchTerm(term)
  if (tokens.length === 0) {
    return []
  }

  let candidateIds
  const docsById = new Map()

  for (const token of tokens) {
    const results = index.search(token, { enrich: true, limit: 1000 })
    const tokenIds = new Set()

    for (const { result } of results) {
      for (const item of result) {
        const id = item.id ?? item
        tokenIds.add(id)
        if (item.doc) {
          docsById.set(id, item.doc)
        }
      }
    }

    if (tokenIds.size === 0) {
      return []
    }

    candidateIds = candidateIds ? intersectSets(candidateIds, tokenIds) : tokenIds
    if (candidateIds.size === 0) {
      return []
    }
  }

  const hits = []
  for (const id of candidateIds) {
    hits.push(docsById.get(id) ?? index.get(id))
    if (hits.length >= SEARCH_LIMIT) {
      break
    }
  }

  return hits
}

function flexSearchOrHits(index, term) {
  const tokens = tokenizeSearchTerm(term)
  if (tokens.length === 0) {
    return []
  }

  const hitsById = new Map()

  for (const token of tokens) {
    const results = index.search(token, { enrich: true, limit: 1000 })

    for (const { result } of results) {
      for (const item of result) {
        const id = item.id ?? item
        if (!hitsById.has(id)) {
          hitsById.set(id, item.doc ?? item)
        }
      }
    }
  }

  return [...hitsById.values()].slice(0, SEARCH_LIMIT)
}

function miniSearchHits(index, term, options = {}) {
  return index.search(term, options).slice(0, SEARCH_LIMIT)
}

function fuseAndHits(index, term) {
  return index.search(term, { limit: SEARCH_LIMIT }).map(({ item }) => item)
}

function fuseOrHits(index, term) {
  const tokens = tokenizeSearchTerm(term)
  if (tokens.length === 0) {
    return []
  }

  const hitsById = new Map()

  for (const token of tokens) {
    for (const { item } of index.search(token, { limit: 1000 })) {
      if (!hitsById.has(item.id)) {
        hitsById.set(item.id, item)
      }
    }
  }

  return [...hitsById.values()].slice(0, SEARCH_LIMIT)
}

function lunrHits(index, docsById, term, operator) {
  const tokens = tokenizeSearchTerm(term)
  if (tokens.length === 0) {
    return []
  }

  const query =
    operator === 'AND' ? tokens.map((token) => `+${token}`).join(' ') : tokens.join(' ')

  return index
    .search(query)
    .slice(0, SEARCH_LIMIT)
    .map(({ ref }) => docsById.get(Number(ref)))
}

function createPopulatedIndexes() {
  const flexIndex = createFlexSearch()
  const miniIndex = createMiniSearch()
  const fuseIndex = createFuseSearch()
  const lunrDocsById = new Map()
  const lunrIndex = createLunrIndexFromRecords(dataset, lunrDocsById)

  addAllToFlexSearch(flexIndex, dataset)
  addAllToMiniSearch(miniIndex, dataset)

  return { flexIndex, miniIndex, fuseIndex, lunrIndex, lunrDocsById }
}

const { flexIndex, miniIndex, fuseIndex, lunrIndex, lunrDocsById } = createPopulatedIndexes()

export function buildFlexSearchIndex() {
  const index = createFlexSearch()
  addAllToFlexSearch(index, dataset)
  return index
}

export function buildMiniSearchIndex() {
  const index = createMiniSearch()
  addAllToMiniSearch(index, dataset)
  return index
}

export function buildFuseIndex() {
  return createFuseSearch()
}

export function buildLunrIndex() {
  const docsById = new Map()
  return {
    index: createLunrIndexFromRecords(dataset, docsById),
    docsById
  }
}

export function runFlexSearchPlain(index) {
  flexSearchAndHits(index, searchParams.plain.term)
}

export function runMiniSearchPlain(index) {
  miniSearchHits(index, searchParams.plain.term, { combineWith: 'AND' })
}

export function runFusePlain(index) {
  fuseAndHits(index, searchParams.plain.term)
}

export function runLunrPlain({ index, docsById }) {
  lunrHits(index, docsById, searchParams.plain.term, 'AND')
}

export function serializeFlexSearchIndex(index) {
  let bytes = 0

  index.export((key, data) => {
    bytes += Buffer.byteLength(String(key)) + Buffer.byteLength(String(data))
    return true
  })

  return bytes
}

export function serializeMiniSearchIndex(index) {
  return Buffer.byteLength(JSON.stringify(index.toJSON()))
}

export function serializeFuseIndex(index) {
  return Buffer.byteLength(JSON.stringify(index.getIndex().docs))
}

export function serializeLunrIndex(index) {
  return Buffer.byteLength(JSON.stringify(index.toJSON()))
}

export const insert = {
  flexsearch: () => {
    const index = createFlexSearch()

    for (let i = 0; i < dataset.length; i++) {
      addToFlexSearch(index, dataset[i], i)
    }
  },
  minisearch: () => {
    const index = createMiniSearch()

    for (let i = 0; i < dataset.length; i++) {
      index.add({ id: i, ...dataset[i] })
    }
  },
  fusejs: () => {
    const docs = []

    for (let i = 0; i < dataset.length; i++) {
      docs.push({ id: i, ...dataset[i] })
      createFuseIndex(docs)
    }
  }
}

export const insertMultiple = {
  flexsearch: () => {
    const index = createFlexSearch()
    addAllToFlexSearch(index, dataset)
  },
  minisearch: () => {
    const index = createMiniSearch()
    addAllToMiniSearch(index, dataset)
  },
  fusejs: () => {
    createFuseSearch()
  },
  lunr: () => {
    createLunrIndexFromRecords(dataset, new Map())
  }
}

export const searchPlain = {
  flexsearch: () => {
    flexSearchAndHits(flexIndex, searchParams.plain.term)
  },
  minisearch: () => {
    miniSearchHits(miniIndex, searchParams.plain.term, { combineWith: 'AND' })
  },
  fusejs: () => {
    fuseAndHits(fuseIndex, searchParams.plain.term)
  },
  lunr: () => {
    lunrHits(lunrIndex, lunrDocsById, searchParams.plain.term, 'AND')
  }
}

function filterHits(hits, predicate) {
  return hits.filter(predicate).slice(0, SEARCH_LIMIT)
}

export const searchWithFilters = {
  flexsearch: () => {
    filterHits(flexSearchOrHits(flexIndex, searchParams.filters.term), (doc) => doc.rating >= 4)
  },
  minisearch: () => {
    filterHits(miniSearchHits(miniIndex, searchParams.filters.term), (doc) => doc.rating >= 4)
  },
  fusejs: () => {
    filterHits(fuseOrHits(fuseIndex, searchParams.filters.term), (doc) => doc.rating >= 4)
  },
  lunr: () => {
    filterHits(
      lunrHits(lunrIndex, lunrDocsById, searchParams.filters.term, 'OR'),
      (doc) => doc.rating >= 4
    )
  }
}

export const searchWithLongTextAndComplexFilters = {
  flexsearch: () => {
    filterHits(flexSearchOrHits(flexIndex, searchParams.complex.term), (doc) =>
      doc.rating >= 4 && doc.genres.includes('Shooter')
    )
  },
  minisearch: () => {
    filterHits(miniSearchHits(miniIndex, searchParams.complex.term), (doc) =>
      doc.rating >= 4 && doc.genres.includes('Shooter')
    )
  },
  fusejs: () => {
    filterHits(fuseOrHits(fuseIndex, searchParams.complex.term), (doc) =>
      doc.rating >= 4 && doc.genres.includes('Shooter')
    )
  },
  lunr: () => {
    filterHits(
      lunrHits(lunrIndex, lunrDocsById, searchParams.complex.term, 'OR'),
      (doc) => doc.rating >= 4 && doc.genres.includes('Shooter')
    )
  }
}
