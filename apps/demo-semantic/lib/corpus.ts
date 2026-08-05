import articlesJson from '@/data/articles.json'
import embeddingsJson from '@/data/embeddings.json'
import queriesJson from '@/data/queries.json'
import { hashCorpus } from './embedding-text.mjs'
import { dequantise } from './schema.mjs'
import type { Article } from './types'

export const articles = articlesJson as Article[]

export interface ExampleQuery {
  term: string
  /** Article ids a good answer contains — used by scripts/evaluate.mjs, not by the UI. */
  expect: string[]
  note: string
}

export const examples = queriesJson as ExampleQuery[]

export const encoderModel = embeddingsJson.model
const dimensions = embeddingsJson.dim

/**
 * `data/embeddings.json` is generated, committed, and easy to forget about. If somebody
 * edits an article and does not re-run `pnpm corpus`, search keeps working while quietly
 * ranking against the previous wording — so the mismatch is surfaced in the console
 * rather than left to be discovered.
 */
export const corpusIsStale = hashCorpus(articles) !== embeddingsJson.sourceHash

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}

export const vectors: number[][] = dequantise(embeddingsJson, decodeBase64)

/** Lets the article view ask for neighbours without re-encoding anything. */
export const vectorById = new Map(articles.map((article, i) => [article.id, vectors[i]]))

export const areas = [...new Set(articles.map(article => article.area))]

/** Bytes of int8 vector data shipped with the page, for the console's index panel. */
export const vectorBytes = articles.length * dimensions
