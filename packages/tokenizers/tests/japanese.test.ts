import { expect, it } from "vitest";
import { create, insert, search } from 'zbsearch'
import { createTokenizer } from '../src/japanese.js'

const db = create({
  schema: {
    name: 'string'
  },
  components: {
    tokenizer: createTokenizer()
  }
})

// @ts-ignore
function getHitsNames(hits) {
  // @ts-ignore
  return hits.map((hit) => hit.document.name)
}

it('Japanese tokenizer', async () => {
  await insert(db, { name: '東京' }) // Tokyo
  await insert(db, { name: '大阪' }) // Osaka
  await insert(db, { name: '京都' }) // Kyoto
  await insert(db, { name: '横浜' }) // Yokohama
  await insert(db, { name: '札幌' }) // Sapporo
  await insert(db, { name: '仙台' }) // Sendai
  await insert(db, { name: '広島' }) // Hiroshima
  await insert(db, { name: '東京大学' }) // University of Tokyo
  await insert(db, { name: '京都大学' }) // Kyoto University
  await insert(db, { name: '大阪大学' }) // Osaka University

  const resultsTokyo = await search(db, { term: '東京', threshold: 0 })

  expect(resultsTokyo.count).toBe(2)
  expect(getHitsNames(resultsTokyo.hits).join(', ')).toBe('東京, 東京大学')

  const resultsOsaka = await search(db, { term: '大阪', threshold: 0 })

  expect(resultsOsaka.count).toBe(2)
  expect(getHitsNames(resultsOsaka.hits).join(', ')).toBe('大阪, 大阪大学')

  const resultsKyoto = await search(db, { term: '京都', threshold: 0 })

  expect(resultsKyoto.count).toBe(2)
  expect(getHitsNames(resultsKyoto.hits).join(', ')).toBe('京都, 京都大学')

  const resultsYokohama = await search(db, { term: '横浜', threshold: 0 })

  expect(resultsYokohama.count).toBe(1)
  expect(getHitsNames(resultsYokohama.hits).join(', ')).toBe('横浜')

  const resultsSapporo = await search(db, { term: '札幌', threshold: 0 })

  expect(resultsSapporo.count).toBe(1)
  expect(getHitsNames(resultsSapporo.hits).join(', ')).toBe('札幌')

  const resultsSendai = await search(db, { term: '仙台', threshold: 0 })

  expect(resultsSendai.count).toBe(1)
  expect(getHitsNames(resultsSendai.hits).join(', ')).toBe('仙台')

  const resultsHiroshima = await search(db, { term: '広島', threshold: 0 })

  expect(resultsHiroshima.count).toBe(1)
  expect(getHitsNames(resultsHiroshima.hits).join(', ')).toBe('広島')

  const resultsUniversity = await search(db, { term: '大学', threshold: 0 })

  expect(resultsUniversity.count).toBe(3)
  expect(getHitsNames(resultsUniversity.hits).join(', ')).toBe('東京大学, 京都大学, 大阪大学')
})
