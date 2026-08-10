import { expect, it } from "vitest";
import { create, insert, search } from 'zbsearch'
import { createTokenizer } from '../src/korean.js'

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

it('Korean tokenizer', async () => {
  await insert(db, { name: '서울' }) // Seoul
  await insert(db, { name: '부산' }) // Busan
  await insert(db, { name: '대구' }) // Daegu
  await insert(db, { name: '인천' }) // Incheon
  await insert(db, { name: '광주' }) // Gwangju
  await insert(db, { name: '수원' }) // Suwon
  await insert(db, { name: '포항' }) // Pohang
  await insert(db, { name: '서울대학교' }) // Seoul National University
  await insert(db, { name: '부산대학교' }) // Pusan National University
  await insert(db, { name: '포항공과대학교' }) // Pohang University of Science and Technology
  await insert(db, { name: '대전 울산 세종' }) // space-separated multi-word string (Daejeon Ulsan Sejong)

  // Intl.Segmenter('ko', { granularity: 'word' }) segments Korean on whitespace (UAX#29), so
  // space-less compounds such as '서울대학교' stay a single token and are NOT split into '서울' + '대학교'
  // (unlike the Japanese/Mandarin tokenizers, where dictionary segmentation splits e.g. '東京大学' into
  // '東京' + '大学'). This is an experimental limitation of the Korean tokenizer. The '서울'/'부산'/'포항'
  // searches below still return the compound because ZBSearch matches the radix index by prefix
  // (default exact: false): '서울' is a prefix of the '서울대학교' token.
  const resultsSeoul = await search(db, { term: '서울', threshold: 0 })

  expect(resultsSeoul.count).toBe(2)
  expect(getHitsNames(resultsSeoul.hits).join(', ')).toBe('서울, 서울대학교')

  const resultsBusan = await search(db, { term: '부산', threshold: 0 })

  expect(resultsBusan.count).toBe(2)
  expect(getHitsNames(resultsBusan.hits).join(', ')).toBe('부산, 부산대학교')

  const resultsGwangju = await search(db, { term: '광주', threshold: 0 })

  expect(resultsGwangju.count).toBe(1)
  expect(getHitsNames(resultsGwangju.hits).join(', ')).toBe('광주')

  const resultsIncheon = await search(db, { term: '인천', threshold: 0 })

  expect(resultsIncheon.count).toBe(1)
  expect(getHitsNames(resultsIncheon.hits).join(', ')).toBe('인천')

  const resultsPohang = await search(db, { term: '포항', threshold: 0 })

  expect(resultsPohang.count).toBe(2)
  expect(getHitsNames(resultsPohang.hits).join(', ')).toBe('포항, 포항공과대학교')

  // Searching the shared suffix '대학교' (university) returns nothing: the compounds are indexed as
  // whole tokens ('서울대학교', '부산대학교', '포항공과대학교'), so the suffix is not a prefix of any token.
  // Contrast japanese.test.ts, where '大学' matches all three universities because the Japanese
  // tokenizer dictionary-splits the compounds. This assertion locks in the no-segmentation behavior.
  const resultsUniversity = await search(db, { term: '대학교', threshold: 0 })

  expect(resultsUniversity.count).toBe(0)

  // Whitespace word segmentation works: the space-separated '대전 울산 세종' is tokenized into
  // '대전' / '울산' / '세종', so searching the middle word finds that document.
  const resultsUlsan = await search(db, { term: '울산', threshold: 0 })

  expect(resultsUlsan.count).toBe(1)
  expect(getHitsNames(resultsUlsan.hits).join(', ')).toBe('대전 울산 세종')
})
