import { expect, it } from "vitest";
import { create, insert, search } from 'zbsearch'
import { createTokenizer } from '../src/mandarin.js'

const db = create({
  schema: {
    name: 'string'
  },
  components: {
    tokenizer: createTokenizer()
  }
})

function getHitsNames(hits) {
  return hits.map((hit) => hit.document.name)
}

it('Mandarin tokenizer', async () => {
  await insert(db, { name: '北京' }) // Beijing
  await insert(db, { name: '上海' }) // Shanghai
  await insert(db, { name: '广州' }) // Guangzhou
  await insert(db, { name: '深圳' }) // Shenzhen
  await insert(db, { name: '成都' }) // Chengdu
  await insert(db, { name: '杭州' }) // Hangzhou
  await insert(db, { name: '南京' }) // Nanjing
  await insert(db, { name: '北京大学' }) // Peking University
  await insert(db, { name: '上海交通大学' }) // Shanghai Jiao Tong University
  await insert(db, { name: '广州中医药大学' }) // Guangzhou University of Chinese Medicine

  const resultsBeijing = await search(db, { term: '北京', threshold: 0 })

  expect(resultsBeijing.count).toBe(2)
  expect(getHitsNames(resultsBeijing.hits).join(', ')).toBe('北京, 北京大学')

  const resultsShanghai = await search(db, { term: '上海', threshold: 0 })

  expect(resultsShanghai.count).toBe(2)
  expect(getHitsNames(resultsShanghai.hits).join(', ')).toBe('上海, 上海交通大学')

  const resultsGuangzhou = await search(db, { term: '广州', threshold: 0 })

  expect(resultsGuangzhou.count).toBe(2)
  expect(getHitsNames(resultsGuangzhou.hits).join(', ')).toBe('广州, 广州中医药大学')

  const resultsShenzhen = await search(db, { term: '深圳', threshold: 0 })

  expect(resultsShenzhen.count).toBe(1)
  expect(getHitsNames(resultsShenzhen.hits).join(', ')).toBe('深圳')

  const resultsChengdu = await search(db, { term: '成都', threshold: 0 })

  expect(resultsChengdu.count).toBe(1)
  expect(getHitsNames(resultsChengdu.hits).join(', ')).toBe('成都')

  const resultsNan = await search(db, { term: '南', threshold: 0 })

  expect(resultsNan.count).toBe(1)
  expect(getHitsNames(resultsNan.hits).join(', ')).toBe('南京')

  const resultsHangzhou = await search(db, { term: '杭州', threshold: 0 })

  expect(resultsHangzhou.count).toBe(1)
  expect(getHitsNames(resultsHangzhou.hits).join(', ')).toBe('杭州')

  const resultsUniversity = await search(db, { term: '大学', threshold: 0 })

  expect(resultsUniversity.count).toBe(3)
})
