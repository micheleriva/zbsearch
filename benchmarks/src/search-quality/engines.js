// Engine adapters for the search-quality benchmark.
//
// Each adapter has the shape:
//   { key, label, build(docs) → engine, search(engine, term, limit) → string[] }
// where `docs` is [{ id, text }] with the BEIR corpus ids, and `search` returns
// corpus ids ranked best-first.
//
// Every engine is configured for its BEST relevance using only the features
// its own ecosystem provides — nothing is bolted on from outside:
//   - ZBSearch / Orama: English stopwords + Porter stemmer from their official
//     packages (@zbsearch/stemmers+stopwords, @orama/stemmers+stopwords).
//   - MiniSearch: ships no stemmer/stopwords → plain default tokenization.
//   - FlexSearch: ships no stemmer/stopwords → `score` preset (its
//     relevance-oriented preset), raw query tokens.
//   - Lunr: full default pipeline (it ships a trimmer, stopword filter and
//     stemmer).
//   - Fuse.js: threshold 0 (exact substring) — its fuzzy mode is unusably
//     slow at BEIR scale; see FUSE_NOTE below.
//
// ZBSearch runs with `prefix: false` and Orama with `exact: true`: Lucene-style
// exact token matching, the right mode for full-text relevance evaluation
// (ZBSearch's default prefix expansion is a search-as-you-type feature).

import FlexSearch from 'flexsearch'
import Fuse from 'fuse.js'
import lunr from 'lunr'
import MiniSearch from 'minisearch'
import * as orama from '@orama/orama'
import { stemmer as oramaStemmer } from '@orama/stemmers/english'
import { stopwords as oramaStopwords } from '@orama/stopwords/english'
import * as zbsearch from 'zbsearch'
import { pluginPT15 } from '@zbsearch/plugin-pt15'
import { pluginQPS } from '@zbsearch/plugin-qps'
import { stemmer as zbsearchStemmer } from '@zbsearch/stemmers/english'
import { stopwords as zbsearchStopwords } from '@zbsearch/stopwords/english'

const schema = { text: 'string' }

// insertMultiple returns generated ids in insertion order; zip them with the corpus ids so hits can be mapped back (same trick as multilingual-quality.js).
async function buildOramaLike(engine, docs, tokenizer, plugins = []) {
  const db = engine.create({ schema, plugins, components: { tokenizer } })
  const generatedIds = await engine.insertMultiple(db, docs)
  const corpusIdByGenerated = new Map(generatedIds.map((generated, i) => [String(generated), docs[i].id]))
  return { db, corpusIdByGenerated }
}

async function searchOramaLike(engine, { db, corpusIdByGenerated }, term, limit, extraParams = {}) {
  const results = await engine.search(db, { term, limit, ...extraParams })
  return results.hits.map((hit) => corpusIdByGenerated.get(String(hit.id)))
}

const zbsearchTokenizer = {
  language: 'english',
  stemmer: zbsearchStemmer,
  stopWords: zbsearchStopwords,
  // Keep duplicate tokens so the index stores real term frequencies for BM25.
  allowDuplicates: true
}

const oramaTokenizer = {
  language: 'english',
  stemmer: oramaStemmer,
  stopWords: oramaStopwords
}

function buildZbsearch(plugins = []) {
  return (docs) => buildOramaLike(zbsearch, docs, zbsearchTokenizer, plugins)
}

function searchZbsearch(engineState, term, limit) {
  // Lucene-style exact token matching for the benchmark (prefix expansion is
  // ZBSearch's default for search-as-you-type; `prefix: false` disables it).
  return searchOramaLike(zbsearch, engineState, term, limit, { prefix: false })
}

// FlexSearch's `score` preset is its relevance-oriented configuration (per-field scoring, strict tokenization, no partial-match noise).
function buildFlexSearch(docs) {
  const index = new FlexSearch.Document({
    preset: 'score',
    document: { id: 'id', index: ['text'] }
  })
  for (const doc of docs) {
    index.add(doc)
  }
  return index
}

// This FlexSearch version intersects query tokens (AND) and ignores `bool`, so
// OR semantics are emulated: search each token separately and union the matches
// in first-seen rank order. No stopword removal or stemming — FlexSearch ships
// none, so it is tested on raw tokens.
function searchFlexSearch(index, term, limit) {
  const ranked = []
  const seen = new Set()
  for (const token of term.toLowerCase().split(/\s+/)) {
    if (!token) {
      continue
    }
    for (const { result } of index.search(token, { limit })) {
      for (const id of result) {
        if (!seen.has(id)) {
          seen.add(id)
          ranked.push(id)
          if (ranked.length >= limit) {
            return ranked
          }
        }
      }
    }
  }

  return ranked
}

// MiniSearch ships no stemmer or stopword list, so it runs with its default tokenization (lowercasing) and default OR term combination.
function buildMiniSearch(docs) {
  const index = new MiniSearch({ fields: ['text'] })
  index.addAll(docs)
  return index
}

function searchMiniSearch(index, term, limit) {
  return index.search(term).slice(0, limit).map((hit) => hit.id)
}

// Fuse.js runs with threshold 0 (exact substring matching). Its fuzzy mode
// (threshold 0.3, ignoreLocation) is a full bitap scan of every document per
// query — measured at ~39 s/query on ArguAna (~15 h for the dataset) — which
// makes fuzzy Fuse unusable at BEIR scale. The runner prints FUSE_NOTE under
// every table so the reported numbers are read with this caveat.
function buildFuse(docs) {
  return new Fuse(docs, {
    keys: ['text'],
    threshold: 0,
    ignoreLocation: true,
    includeScore: false
  })
}

function searchFuse(index, term, limit) {
  return index.search(term, { limit }).map(({ item }) => item.id)
}

export const FUSE_NOTE =
  'Note: Fuse.js runs with threshold 0 (exact substring match). Its fuzzy mode (threshold 0.3) costs ~39 s/query on ArguAna (~15 h for the dataset) and is unusable at this scale.'

// Lunr's full default pipeline (trimmer + stopWordFilter + stemmer) is its best relevance configuration.
function buildLunr(docs) {
  return lunr(function () {
    this.ref('id')
    this.field('text')
    for (const doc of docs) {
      this.add(doc)
    }
  })
}

// index.search() runs the full search pipeline (trimmer, stopword removal, stemming) but its query-string parser reserves some characters (:, ~, ^, *, leading +/-).
// Strip them from the raw BEIR query text; if parsing still fails, the query counts as an empty run.
function searchLunr(index, term, limit) {
  const sanitized = term
    .replace(/[:~^*]/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^[+-]+/, ''))
    .filter((token) => token.length > 0)
    .join(' ')
  if (sanitized.length === 0) {
    return []
  }

  try {
    return index.search(sanitized).slice(0, limit).map(({ ref }) => ref)
  } catch {
    return []
  }
}

export const engines = [
  {
    key: 'zbsearch-bm25',
    label: 'ZBSearch (BM25)',
    build: buildZbsearch(),
    search: searchZbsearch
  },
  {
    key: 'zbsearch-qps',
    label: 'ZBSearch (QPS)',
    build: buildZbsearch([pluginQPS()]),
    search: searchZbsearch
  },
  {
    key: 'zbsearch-pt15',
    label: 'ZBSearch (PT15)',
    build: buildZbsearch([pluginPT15()]),
    search: searchZbsearch
  },
  {
    key: 'orama',
    label: 'Orama',
    build: (docs) => buildOramaLike(orama, docs, oramaTokenizer),
    // Orama runs with its default behavior (prefix expansion): its exact: true
    // applies a case-sensitive verbatim post-filter requiring ALL query terms in
    // the raw text (issue-866 feature), which returns zero hits for
    // natural-language queries — it cannot do Lucene-style exact token matching.
    search: (engineState, term, limit) => searchOramaLike(orama, engineState, term, limit)
  },
  {
    key: 'minisearch',
    label: 'MiniSearch',
    build: buildMiniSearch,
    search: searchMiniSearch
  },
  {
    key: 'flexsearch',
    label: 'FlexSearch',
    build: buildFlexSearch,
    search: searchFlexSearch
  },
  {
    key: 'lunr',
    label: 'Lunr',
    build: buildLunr,
    search: searchLunr
  },
  {
    key: 'fusejs',
    label: 'Fuse.js',
    build: buildFuse,
    search: searchFuse
  }
]
