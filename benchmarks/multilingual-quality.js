// Search-quality benchmark: zero-config `multilingual` tokenization vs per-language
// tuned configs (stemmer + stopwords) vs the plain `create({ schema })` default.
//
// For every language in src/multilingual-quality/ this builds three indexes over the
// same documents, runs the language's judged queries, and reports precision@10,
// recall@10, and MRR. A final scenario indexes all languages together and compares
// `multilingual` against `english-default`.
//
// Run with: npm run benchmark:multilingual-quality

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { create, insertMultiple, search } from 'zbsearch'
import { stemmer as stemmerArabic } from '@zbsearch/stemmers/arabic'
import { stemmer as stemmerEnglish } from '@zbsearch/stemmers/english'
import { stemmer as stemmerFrench } from '@zbsearch/stemmers/french'
import { stemmer as stemmerGerman } from '@zbsearch/stemmers/german'
import { stemmer as stemmerItalian } from '@zbsearch/stemmers/italian'
import { stemmer as stemmerPortuguese } from '@zbsearch/stemmers/portuguese'
import { stemmer as stemmerRussian } from '@zbsearch/stemmers/russian'
import { stemmer as stemmerSpanish } from '@zbsearch/stemmers/spanish'
import { stopwords as stopwordsArabic } from '@zbsearch/stopwords/arabic'
import { stopwords as stopwordsEnglish } from '@zbsearch/stopwords/english'
import { stopwords as stopwordsFrench } from '@zbsearch/stopwords/french'
import { stopwords as stopwordsGerman } from '@zbsearch/stopwords/german'
import { stopwords as stopwordsItalian } from '@zbsearch/stopwords/italian'
import { stopwords as stopwordsPortuguese } from '@zbsearch/stopwords/portuguese'
import { stopwords as stopwordsRussian } from '@zbsearch/stopwords/russian'
import { stopwords as stopwordsSpanish } from '@zbsearch/stopwords/spanish'
import { languages } from './src/multilingual-quality/index.js'

const LIMIT = 10
const schema = { text: 'string' }

const RESULTS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'benchmark', 'results', 'multilingual-quality.json')

const tunedComponents = {
  arabic: { stemmer: stemmerArabic, stopWords: stopwordsArabic },
  english: { stemmer: stemmerEnglish, stopWords: stopwordsEnglish },
  french: { stemmer: stemmerFrench, stopWords: stopwordsFrench },
  german: { stemmer: stemmerGerman, stopWords: stopwordsGerman },
  italian: { stemmer: stemmerItalian, stopWords: stopwordsItalian },
  portuguese: { stemmer: stemmerPortuguese, stopWords: stopwordsPortuguese },
  russian: { stemmer: stemmerRussian, stopWords: stopwordsRussian },
  spanish: { stemmer: stemmerSpanish, stopWords: stopwordsSpanish }
}

const CONFIGS = ['multilingual', 'per-language', 'english-default']

function buildIndex(config, language, docs) {
  let db
  if (config === 'multilingual') {
    db = create({ schema, language: 'multilingual' })
  } else if (config === 'per-language') {
    const { stemmer, stopWords } = tunedComponents[language]
    db = create({ schema, components: { tokenizer: { language, stemmer, stopWords } } })
  } else {
    db = create({ schema })
  }

  // insertMultiple returns the generated document ids in insertion order;
  // zip them with the stable corpus ids so hits can be mapped back.
  const generatedIds = insertMultiple(db, docs.map(({ text }) => ({ text })))
  const idByGenerated = new Map(generatedIds.map((generated, i) => [String(generated), docs[i].id]))
  return { db, idByGenerated }
}

async function runQueries(db, idByGenerated, queries) {
  const rows = []
  for (const { term, kind, relevant } of queries) {
    const results = await search(db, { term, limit: LIMIT })
    const hitIds = results.hits.map((hit) => idByGenerated.get(String(hit.id)) ?? String(hit.id))
    rows.push({ term, kind, relevant, hits: hitIds })
  }
  return rows
}

// precision@10: share of the top-10 hits that are relevant. Queries with an empty
// relevance set are negative probes: they score 1 when nothing is returned and 0
// otherwise, so false positives keep precision meaningful.
// recall@10: share of the relevant docs found in the top 10 (empty-relevance
// queries are excluded from the average).
// MRR: reciprocal rank of the first relevant hit (empty-relevance queries excluded).
function evaluate(rows) {
  let precisionSum = 0
  let recallSum = 0
  let recallCount = 0
  let rrSum = 0
  let rrCount = 0

  for (const { relevant, hits } of rows) {
    const top = hits.slice(0, LIMIT)
    if (relevant.length === 0) {
      precisionSum += top.length === 0 ? 1 : 0
      continue
    }
    const relevantSet = new Set(relevant)
    const relevantHits = top.filter((id) => relevantSet.has(id))
    precisionSum += relevantHits.length / LIMIT
    recallSum += relevantHits.length / relevant.length
    recallCount++
    const firstRelevantRank = top.findIndex((id) => relevantSet.has(id))
    rrSum += firstRelevantRank === -1 ? 0 : 1 / (firstRelevantRank + 1)
    rrCount++
  }

  return {
    precision: precisionSum / rows.length,
    recall: recallCount > 0 ? recallSum / recallCount : 0,
    mrr: rrCount > 0 ? rrSum / rrCount : 0
  }
}

function averageMetrics(metricsList) {
  const sum = { precision: 0, recall: 0, mrr: 0 }
  for (const metrics of metricsList) {
    sum.precision += metrics.precision
    sum.recall += metrics.recall
    sum.mrr += metrics.mrr
  }
  const n = metricsList.length
  return { precision: sum.precision / n, recall: sum.recall / n, mrr: sum.mrr / n }
}

function fmt(value) {
  return value.toFixed(3)
}

function cell(metrics) {
  return `${fmt(metrics.precision)} | ${fmt(metrics.recall)} | ${fmt(metrics.mrr)}`
}

function printTable(perLanguageResults, macroAverage, mixedResults) {
  const header =
    '| Language | multilingual P@10 | R@10 | MRR | per-language P@10 | R@10 | MRR | english-default P@10 | R@10 | MRR |'
  const separator = '|---|---|---|---|---|---|---|---|---|---|'
  const lines = [header, separator]

  for (const [language, configs] of Object.entries(perLanguageResults)) {
    lines.push(
      `| ${language} | ${cell(configs.multilingual)} | ${cell(configs['per-language'])} | ${cell(configs['english-default'])} |`
    )
  }

  lines.push(
    `| **macro avg** | ${cell(macroAverage.multilingual)} | ${cell(macroAverage['per-language'])} | ${cell(macroAverage['english-default'])} |`
  )
  lines.push(`| mixed (all languages, one index) | ${cell(mixedResults.multilingual)} | — | — | — | ${cell(mixedResults['english-default'])} |`)

  console.log('\n### Multilingual vs per-language vs default: search quality (P@10 / R@10 / MRR)\n')
  console.log(lines.join('\n'))
  console.log('')
}

const perLanguageResults = {}
const perLanguageDetails = {}

for (const { language, documents, queries } of languages) {
  perLanguageResults[language] = {}
  perLanguageDetails[language] = {}

  for (const config of CONFIGS) {
    const { db, idByGenerated } = buildIndex(config, language, documents)
    const rows = await runQueries(db, idByGenerated, queries)
    perLanguageResults[language][config] = evaluate(rows)
    perLanguageDetails[language][config] = rows
  }
}

const macroAverage = {}
for (const config of CONFIGS) {
  macroAverage[config] = averageMetrics(languages.map(({ language }) => perLanguageResults[language][config]))
}

// Mixed-index scenario: every language's documents in a single index, queried with
// the union of all judged queries. Only the two zero-config modes make sense here.
const mixedResults = {}
const mixedDetails = {}
const allDocuments = languages.flatMap(({ documents }) => documents)
const allQueries = languages.flatMap(({ language, queries }) => queries.map((query) => ({ ...query, language })))

for (const config of ['multilingual', 'english-default']) {
  const { db, idByGenerated } = buildIndex(config, undefined, allDocuments)
  const rows = await runQueries(db, idByGenerated, allQueries)
  mixedResults[config] = evaluate(rows)
  mixedDetails[config] = rows
}

printTable(perLanguageResults, macroAverage, mixedResults)

// Sanity guard: multilingual tokenization must never do worse than the
// english-default splitter on non-Latin scripts. If it does, the
// Intl.Segmenter path is broken — that is a bug, not a quality trade-off.
const warnings = []
for (const language of ['russian', 'arabic']) {
  const multilingualRecall = perLanguageResults[language].multilingual.recall
  const englishDefaultRecall = perLanguageResults[language]['english-default'].recall
  if (multilingualRecall < englishDefaultRecall) {
    warnings.push(
      `*** WARNING: multilingual recall on ${language} (${fmt(multilingualRecall)}) is LOWER than english-default (${fmt(englishDefaultRecall)}). This indicates a tokenizer bug, not a quality trade-off. ***`
    )
  }
}
for (const warning of warnings) {
  console.log(warning)
}
if (warnings.length > 0) {
  console.log('')
}

const report = {
  description: 'Search quality of multilingual vs per-language vs english-default tokenization',
  metrics: {
    precisionAt10: 'relevant hits in top 10 / 10; negative probes (empty relevance) score 1 if no hits else 0',
    recallAt10: 'relevant hits in top 10 / relevant docs; averaged over queries with non-empty relevance',
    mrr: 'reciprocal rank of first relevant hit; averaged over queries with non-empty relevance'
  },
  limit: LIMIT,
  perLanguage: Object.fromEntries(
    languages.map(({ language }) => [
      language,
      Object.fromEntries(
        CONFIGS.map((config) => [config, { ...perLanguageResults[language][config], queries: perLanguageDetails[language][config] }])
      )
    ])
  ),
  macroAverage,
  mixed: Object.fromEntries(
    ['multilingual', 'english-default'].map((config) => [config, { ...mixedResults[config], queries: mixedDetails[config] }])
  ),
  warnings
}

await mkdir(path.dirname(RESULTS_FILE), { recursive: true })
await writeFile(RESULTS_FILE, JSON.stringify(report, null, 2))
console.log(`Full results written to ${path.relative(process.cwd(), RESULTS_FILE)}`)
