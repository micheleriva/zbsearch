/*
 * The index schema and the defaults every search starts from.
 *
 * Plain JavaScript for the same reason as embedding-text.mjs: the offline evaluation
 * script and the browser app both build the index, and a demo whose evaluation measures a
 * different index from the one on screen is worse than no evaluation at all.
 */

import { stopwords } from '@zbsearch/stopwords/english'

export const EMBEDDING_DIMENSIONS = 384

/**
 * Tokeniser configuration, shared with the evaluation script.
 *
 * Stop words matter more here than in most demos. Half the curated queries are written the
 * way a person actually types — "i can't log in", "how do I get all our data out" — and
 * almost every word in those is a stop word. Left in, they match nearly every document and
 * bury the real hit under a hundred coincidences; the lexical half of the demo would look
 * broken for the wrong reason.
 */
export const TOKENIZER = {
  stemming: true,
  stopWords: stopwords,
  /*
   * Error codes and header names are identifiers, not English. Stemming
   * "ERR_TLS_HANDSHAKE" or "X-Atlas-Signature" would only make them harder to find, and
   * those exact-token lookups are where keyword search beats the encoder outright.
   */
  stemmerSkipProperties: ['tags'],
}

const STOP_WORDS = new Set(stopwords)

/**
 * The part of a query the inverted index will actually look for.
 *
 * Used for highlighting, so that the marks on a result correspond to the terms that earned
 * it rather than to every preposition the visitor typed. Single characters go too: they
 * survive stop-word removal but say nothing about why a document matched.
 *
 * @param {string} term
 * @returns {string}
 */
export function lexicalTerm(term) {
  return term
    .split(/[\s']+/)
    .filter(token => {
      const word = token.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, '')
      return word.length > 1 && !STOP_WORDS.has(word)
    })
    .join(' ')
}

/**
 * `area` and `topic` are each indexed twice on purpose: as `string`, which full-text
 * search and boosting run against, and as `enum` (`areaKey`, `topicKey`), which `where`
 * filters and facets run against. Enums match on exact values, so they never get stemmed
 * into each other.
 */
export const SCHEMA = {
  title: 'string',
  summary: 'string',
  body: 'string',
  tags: 'string[]',
  area: 'string',
  topic: 'string',
  areaKey: 'enum',
  topicKey: 'enum',
  audience: 'enum',
  views: 'number',
  helpful: 'number',
  updatedAt: 'number',
  embedding: `vector[${EMBEDDING_DIMENSIONS}]`,
}

/**
 * Which fields full-text search weighs, and by how much. A title match is worth far more
 * than a body match; tags sit in between because they are the closest thing the corpus has
 * to a curated label.
 */
export const DEFAULT_BOOST = {
  title: 4,
  summary: 2,
  tags: 2,
  area: 1,
  topic: 1,
  body: 1,
}

/**
 * The minimum cosine a document must reach to be a vector hit at all.
 *
 * ZBSearch defaults this to 0.8, which suits encoders whose unrelated pairs already sit
 * near 0.7. all-MiniLM-L6-v2 is not one of those. Measured over the curated queries with
 * `scripts/evaluate.mjs`, the right article scores between 0.39 and 0.74 while the best
 * wrong one sits between 0.14 and 0.48 — so 0.8 would return nothing whatsoever.
 *
 * 0.20 was chosen from that sweep: it keeps every query's answer, leaves around nine
 * results to rank, and is the point below which unrelated articles start arriving. The
 * console exposes the slider because this number is a property of the encoder rather than
 * of ZBSearch, and no single value is right for every model.
 */
export const DEFAULT_SIMILARITY = 0.2

/** An even split between the lexical and vector halves of a hybrid query. */
export const DEFAULT_HYBRID_WEIGHTS = { text: 0.5, vector: 0.5 }

/**
 * Typo tolerance, off by default.
 *
 * An edit distance of 1 is cheap insurance on long words and actively harmful on short
 * ones: it makes "429" match "428" and "2fa" match "3fa". This corpus is deliberately full
 * of short identifiers, and the demo is about the difference between lexical and semantic
 * matching rather than about typos, so nothing is fuzzed unless the console asks for it.
 */
export const DEFAULT_TOLERANCE = 0

/**
 * Turns a source article plus its vector into the document that goes into the index.
 *
 * @param {Record<string, any>} article
 * @param {number[]} embedding
 */
export function toDocument(article, embedding) {
  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    body: article.body,
    tags: article.tags,
    area: article.area,
    topic: article.topic,
    areaKey: article.area,
    topicKey: article.topic,
    audience: article.audience,
    views: article.views,
    helpful: article.helpful,
    updatedAt: Date.parse(article.updated),
    embedding,
  }
}

/**
 * Expands the base64 int8 payload written by build-corpus.mjs back into vectors.
 *
 * Dividing by `scale` is enough — ZBSearch normalises every vector on insert and on query,
 * so the magnitude that division restores is thrown away again immediately. It is done
 * anyway because the console displays raw components, and components that had been left
 * in the ±127 range would be confusing to read.
 *
 * @param {{ dim: number, scale: number, vectors: string }} payload
 * @param {(base64: string) => Uint8Array} decodeBase64
 * @returns {number[][]}
 */
export function dequantise(payload, decodeBase64) {
  const bytes = decodeBase64(payload.vectors)
  const components = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const vectors = []

  for (let offset = 0; offset < components.length; offset += payload.dim) {
    const vector = new Array(payload.dim)

    for (let d = 0; d < payload.dim; d++) {
      vector[d] = components[offset + d] / payload.scale
    }

    vectors.push(vector)
  }

  return vectors
}
