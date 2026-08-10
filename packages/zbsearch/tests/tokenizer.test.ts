import { describe, expect, it, onTestFinished } from 'vitest'
import { stemmer as bulgarianStemmer, language as bulgarianLanguage } from '@zbsearch/stemmers/bulgarian'
import { stemmer as czechStemmer, language as czechLanguage } from '@zbsearch/stemmers/czech'
import { stemmer as danishStemmer, language as danishLanguage } from '@zbsearch/stemmers/danish'
import { stemmer as dutchStemmer, language as dutchLanguage } from '@zbsearch/stemmers/dutch'
import { stemmer as finnishStemmer, language as finnishLanguage } from '@zbsearch/stemmers/finnish'
import { stemmer as frenchStemmer, language as frenchLanguage } from '@zbsearch/stemmers/french'
import { stemmer as germanStemmer, language as germanLanguage } from '@zbsearch/stemmers/german'
import { stemmer as italianStemmer, language as italianLanguage } from '@zbsearch/stemmers/italian'
import { stemmer as norwegianStemmer, language as norwegianLanguage } from '@zbsearch/stemmers/norwegian'
import { stemmer as portugueseStemmer, language as portugueseLanguage } from '@zbsearch/stemmers/portuguese'
import { stemmer as russianStemmer, language as russianLanguage } from '@zbsearch/stemmers/russian'
import { stemmer as slovenianStemmer, language as slovenianLanguage } from '@zbsearch/stemmers/slovenian'
import { stemmer as spanishStemmer, language as spanishLanguage } from '@zbsearch/stemmers/spanish'
import { stemmer as swedishStemmer, language as swedishLanguage } from '@zbsearch/stemmers/swedish'
import { stemmer as ukrainianStemmer, language as ukrainianLanguage } from '@zbsearch/stemmers/ukrainian'
import { stemmer as tamilStemmer, language as tamilLanguage } from '@zbsearch/stemmers/tamil'
import { stemmer as vietnameseStemmer, language as vietnameseLanguage } from '@zbsearch/stemmers/vietnamese'

import { stopwords as czechStopwords } from '@zbsearch/stopwords/czech'
import { stopwords as danishStopwords } from '@zbsearch/stopwords/danish'
import { stopwords as dutchStopwords } from '@zbsearch/stopwords/dutch'
import { stopwords as englishStopwords } from '@zbsearch/stopwords/english'
import { stopwords as finnishStopwords } from '@zbsearch/stopwords/finnish'
import { stopwords as frenchStopwords } from '@zbsearch/stopwords/french'
import { stopwords as germanStopwords } from '@zbsearch/stopwords/german'
import { stopwords as italianStopwords } from '@zbsearch/stopwords/italian'
import { stopwords as norwegianStopwords } from '@zbsearch/stopwords/norwegian'
import { stopwords as portugueseStopwords } from '@zbsearch/stopwords/portuguese'
import { stopwords as russianStopwords } from '@zbsearch/stopwords/russian'
import { stopwords as slovenianStopwords } from '@zbsearch/stopwords/slovenian'
import { stopwords as spanishStopwords } from '@zbsearch/stopwords/spanish'
import { stopwords as swedishStopwords } from '@zbsearch/stopwords/swedish'
import { stopwords as ukrainianStopwords } from '@zbsearch/stopwords/ukrainian'
import { stopwords as tamilStopwords } from '@zbsearch/stopwords/tamil'
import { stopwords as vietnameseStopwords } from '@zbsearch/stopwords/vietnamese'

import { createTokenizer } from '../src/components/tokenizer/index.js'

describe('Tokenizer', () => {
  it('should tokenize and stem correctly in english', async () => {
    const tokenizer = await createTokenizer({ language: 'english', stopWords: false, stemming: true })

    const I1 = 'the quick brown fox jumps over the lazy dog'
    const I2 = 'I baked some cakes'

    const O1 = tokenizer.tokenize(I1, 'english')
    const O2 = tokenizer.tokenize(I2, 'english')

    expect(O1).toStrictEqual(['the', 'quick', 'brown', 'fox', 'jump', 'over', 'lazi', 'dog'])
    expect(O2).toStrictEqual(['i', 'bake', 'some', 'cake'])
  })

  it('should tokenize and stem correctly in english and allow duplicates', async () => {
    const tokenizer = await createTokenizer({
      language: 'english',
      allowDuplicates: true,
      stopWords: false,
      stemming: true
    })

    const I1 = 'this is a test with test duplicates'
    const I2 = "it's alive! it's alive!"

    const O1 = tokenizer.tokenize(I1, 'english')
    const O2 = tokenizer.tokenize(I2, 'english')

    expect(O1).toStrictEqual(['thi', 'is', 'a', 'test', 'with', 'test', 'duplic'])
    expect(O2).toStrictEqual(["it'", 'aliv', "it'", 'aliv'])
  })

  it('should tokenize and stem correctly in english skipping appropriate properties (single)', async () => {
    const tokenizer = await createTokenizer({
      language: 'english',
      stemming: true,
      stemmerSkipProperties: 'notToStem',
      stopWords: englishStopwords
    })

    const I1 = 'the quick brown fox jumps over the lazy dog'

    const O1 = tokenizer.tokenize(I1, 'english')
    const O2 = tokenizer.tokenize(I1, 'english', 'notToStem')

    expect(O1).toStrictEqual(['quick', 'brown', 'fox', 'jump', 'lazi', 'dog'])
    expect(O2).toStrictEqual(['quick', 'brown', 'fox', 'jumps', 'lazy', 'dog'])
  })

  it('should tokenize and stem correctly in english skipping appropriate properties (multiple)', async () => {
    const tokenizer = await createTokenizer({
      language: 'english',
      stemming: true,
      stemmerSkipProperties: ['notToStem', 'another'],
      stopWords: englishStopwords
    })

    const I1 = 'the quick brown fox jumps over the lazy dog'

    const O1 = tokenizer.tokenize(I1, 'english')
    const O2 = tokenizer.tokenize(I1, 'english', 'notToStem')
    const O3 = tokenizer.tokenize(I1, 'english', 'another')

    expect(O1).toStrictEqual(['quick', 'brown', 'fox', 'jump', 'lazi', 'dog'])
    expect(O2).toStrictEqual(['quick', 'brown', 'fox', 'jumps', 'lazy', 'dog'])
    expect(O3).toStrictEqual(['quick', 'brown', 'fox', 'jumps', 'lazy', 'dog'])
  })

  it('should tokenize and stem correctly in english skipping appropriate properties (invalid)', async () => {
    const tokenizer = await createTokenizer({
      language: 'english',
      stemming: true,
      // @ts-expect-error Testing error
      stemmerSkipProperties: 1,
      stopWords: englishStopwords
    })

    const I1 = 'the quick brown fox jumps over the lazy dog'

    const O1 = tokenizer.tokenize(I1, 'english')
    const O2 = tokenizer.tokenize(I1, 'english', 'notToStem')

    expect(O1).toStrictEqual(['quick', 'brown', 'fox', 'jump', 'lazi', 'dog'])
    expect(O2).toStrictEqual(['quick', 'brown', 'fox', 'jump', 'lazi', 'dog'])
  })

  it('should tokenize and stem correctly in french', async () => {
    const tokenizer = await createTokenizer({
      language: frenchLanguage,
      stemmer: frenchStemmer,
      stopWords: frenchStopwords
    })

    const I1 = 'voyons quel temps il fait dehors'
    const I2 = "j'ai fait des gâteaux"

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['voyon', 'temp', 'fait', 'dehor'])
    expect(O2).toStrictEqual(['fait', 'gateau'])
  })

  it('should tokenize and stem correctly in italian', async () => {
    const tokenizer = await createTokenizer({
      language: italianLanguage,
      stemmer: italianStemmer,
      stopWords: italianStopwords
    })

    const I1 = 'ho cucinato delle torte'
    const I2 = 'dormire è una cosa difficile quando i test non passano'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['cucin', 'tort'])
    expect(O2).toStrictEqual(['dorm', 'cos', 'difficil', 'quand', 'test', 'pass'])
  })

  it('should tokenize and stem correctly in norwegian', async () => {
    const tokenizer = await createTokenizer({
      language: norwegianLanguage,
      stemmer: norwegianStemmer,
      stopWords: norwegianStopwords
    })
    const I1 = 'Jeg kokte noen kaker'
    const I2 = 'å sove er en vanskelig ting når testene mislykkes'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['kokt', 'kak'])
    expect(O2).toStrictEqual(['sov', 'vansk', 'ting', 'test', 'mislykk'])
  })

  it('should tokenize and stem correctly in portuguese', async () => {
    const tokenizer = await createTokenizer({
      language: portugueseLanguage,
      stemmer: portugueseStemmer,
      stopWords: portugueseStopwords
    })

    const I1 = 'Eu cozinhei alguns bolos'
    const I2 = 'dormir é uma coisa difícil quando os testes falham'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['cozinh', 'alguns', 'bol'])
    expect(O2).toStrictEqual(['dorm', 'cois', 'dificil', 'test', 'falh'])
  })

  it('should tokenize and stem correctly in russian', async () => {
    const tokenizer = await createTokenizer({
      language: russianLanguage,
      stemmer: russianStemmer,
      stopWords: russianStopwords
    })

    const I1 = 'я приготовила пирожные'
    const I2 = 'спать трудно, когда тесты не срабатывают'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['приготов', 'пирожн'])
    expect(O2).toStrictEqual(['спат', 'трудн', 'тест', 'срабатыва'])
  })

  it('should tokenize and stem correctly in swedish', async () => {
    const tokenizer = await createTokenizer({
      language: swedishLanguage,
      stemmer: swedishStemmer,
      stopWords: swedishStopwords
    })
    const I1 = 'Jag lagade några kakor'
    const I2 = 'att sova är en svår sak när testerna misslyckas'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['lag', 'kak'])
    expect(O2).toStrictEqual(['sov', 'svar', 'sak', 'test', 'misslyck'])
  })

  it('should tokenize and stem correctly in spanish', async () => {
    const tokenizer = await createTokenizer({
      language: spanishLanguage,
      stemmer: spanishStemmer,
      stopWords: spanishStopwords
    })

    const I1 = 'cociné unos pasteles'
    const I2 = 'dormir es algo dificil cuando las pruebas fallan'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['cocin', 'pastel'])
    expect(O2).toStrictEqual(['dorm', 'dificil', 'prueb', 'fall'])
  })

  it('should tokenize and stem correctly in dutch', async () => {
    const tokenizer = await createTokenizer({
      language: dutchLanguage,
      stemmer: dutchStemmer,
      stopWords: dutchStopwords
    })
    const I1 = 'de kleine koeien'
    const I2 = 'Ik heb wat taarten gemaakt'

    const O2 = tokenizer.tokenize(I2)
    const O1 = tokenizer.tokenize(I1)

    expect(O1).toStrictEqual(['klein', 'koei'])
    expect(O2).toStrictEqual(['taart', 'gemaakt'])
  })

  it('should tokenize and stem correctly in german', async () => {
    const tokenizer = await createTokenizer({
      language: germanLanguage,
      stemmer: germanStemmer,
      stopWords: germanStopwords
    })

    const I1 = 'Schlaf ist eine harte Sache, wenn Tests fehlschlagen'
    const I2 = 'Ich habe ein paar Kekse gebacken'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['schlaf', 'hart', 'sach', 'test', 'fehlschlag'])
    expect(O2).toStrictEqual(['paar', 'keks', 'geback'])
  })

  it('should tokenize and stem correctly in finnish', async () => {
    const tokenizer = await createTokenizer({
      language: finnishLanguage,
      stemmer: finnishStemmer,
      stopWords: finnishStopwords
    })

    const I1 = 'Uni on vaikea asia, kun testit epäonnistuvat'
    const I2 = 'Leivoin keksejä'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['uni', 'vaike', 'as', 'test', 'epaonnistuv'])
    expect(O2).toStrictEqual(['leivo', 'keksej'])
  })

  it('should tokenize and stem correctly in danish', async () => {
    const tokenizer = await createTokenizer({
      language: danishLanguage,
      stemmer: danishStemmer,
      stopWords: danishStopwords
    })

    const I1 = 'Søvn er en svær ting, når prøver mislykkes'
    const I2 = 'Jeg bagte småkager'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['sovn', 'svar', 'ting', 'prov', 'mislyk'])
    expect(O2).toStrictEqual(['bagt', 'smakag'])
  })

  it('should tokenize and stem correctly in tamil', async () => {
    const tokenizer = await createTokenizer({
      language: tamilLanguage,
      stemmer: tamilStemmer,
      stopWords: tamilStopwords
    })

    const I1 = 'கதை'
    const I2 = 'அவனிலா'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['கத'])
    expect(O2).toStrictEqual(['அவன', 'ல'])
  })

  it('should tokenize and stem correctly in ukrainian', async () => {
    const tokenizer = await createTokenizer({
      language: ukrainianLanguage,
      stemmer: ukrainianStemmer,
      stopWords: ukrainianStopwords
    })

    const I1 = 'Коли тести не проходять, спати важко'
    const I2 = 'я приготувала тістечка'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['тест', 'не', 'проход', 'спат', 'важк'])
    expect(O2).toStrictEqual(['я', 'приготувал', 'тістечк'])
  })

  it('should tokenize and stem correctly in vietnamese', async () => {
    const tokenizer = await createTokenizer({
      language: vietnameseLanguage,
      stemmer: vietnameseStemmer,
      stopWords: vietnameseStopwords
    })

    const I1 = 'Tìm kiếm tài liệu trong thư viện'
    const I2 = 'Học lập trình là một việc thú vị'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['tìm', 'kiếm', 'tài', 'liệu', 'thư', 'viện'])
    expect(O2).toStrictEqual(['học', 'lập', 'trình', 'thú', 'vị'])
  })

  it('should tokenize and stem correctly in bulgarian', async () => {
    const tokenizer = await createTokenizer({ language: bulgarianLanguage, stemmer: bulgarianStemmer, stopWords: [] })

    const I1 = 'Кокошката е малка крава която не може да се събере с теста'
    const I2 = 'Има първа вероятност да се случи нещо неочаквано докато се изпълняват тестовете'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['кокошк', 'е', 'малк', 'крав', 'коят', 'не', 'мож', 'да', 'се', 'събер', 'с', 'тест'])
    expect(O2).toStrictEqual([
      'има',
      'първ',
      'вероятност',
      'да',
      'се',
      'случ',
      'нещ',
      'неочакван',
      'док',
      'изпълняват',
      'тест'
    ])
  })

  it('should tokenize and stem correctly in czech', async () => {
    const tokenizer = await createTokenizer({
      language: czechLanguage,
      stemmer: czechStemmer,
      stopWords: czechStopwords
    })

    const I1 = 'Upekla jsem nějaké koláče'
    const I2 = 'žáci četli knihy ve škole'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['upekl', 'nejak', 'kolak'])
    expect(O2).toStrictEqual(['zak', 'cetl', 'knih', 'skol'])
  })

  it('should tokenize and stem correctly in slovenian', async () => {
    const tokenizer = await createTokenizer({
      language: slovenianLanguage,
      stemmer: slovenianStemmer,
      stopWords: slovenianStopwords
    })

    const I1 = 'Spekla sem nekaj tort'
    const I2 = 'otroci berejo knjige v mestih'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toStrictEqual(['spekl', 'tort'])
    expect(O2).toStrictEqual(['otroc', 'ber', 'knjig', 'mest'])
  })

  it('disable stemming', async () => {
    const tokenizer = await createTokenizer({ language: 'english', stemming: false, stopWords: englishStopwords })

    const I1 = 'the quick brown fox jumps over the lazy dog'
    const I2 = 'I baked some cakes'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toEqual(['quick', 'brown', 'fox', 'jumps', 'lazy', 'dog'])
    expect(O2).toEqual(['baked', 'cakes'])
  })

  it('should validate options', async () => {
    expect(() => createTokenizer({ language: 'weird-language' })).toThrow(
      expect.objectContaining({ code: 'LANGUAGE_NOT_SUPPORTED' })
    )

    expect(() => createTokenizer({ language: 'italian', stemming: true })).toThrow(
      expect.objectContaining({ code: 'MISSING_STEMMER' })
    )

    // @ts-expect-error testing validation
    expect(() => createTokenizer({ language: 'english', stemmer: 'FOO' })).toThrow(
      expect.objectContaining({
        code: 'INVALID_STEMMER_FUNCTION_TYPE'
      })
    )
  })
})

describe('Czech and Slovenian stemming', () => {
  it('czech inflected forms collapse to a single stem', async () => {
    for (const word of ['žák', 'žáci', 'žáky', 'žákům', 'žácích']) {
      expect(czechStemmer(word), `${word} stems to žák`).toBe('žák')
    }

    for (const word of ['kniha', 'knihy', 'knihám', 'knihách']) {
      expect(czechStemmer(word), `${word} stems to knih`).toBe('knih')
    }

    for (const word of ['malý', 'malá', 'malé', 'malému', 'malých']) {
      expect(czechStemmer(word), `${word} stems to mal`).toBe('mal')
    }
  })

  it('czech short words are left unchanged', async () => {
    expect(czechStemmer('e')).toBe('e')
    expect(czechStemmer('zi')).toBe('zi')
  })

  it('slovenian inflected forms collapse to a single stem', async () => {
    for (const word of ['mesto', 'mesta', 'mestu', 'mestom', 'mest', 'mestih']) {
      expect(slovenianStemmer(word), `${word} stems to mest`).toBe('mest')
    }

    for (const word of ['hiša', 'hiše', 'hiši', 'hišo']) {
      expect(slovenianStemmer(word), `${word} stems to hiš`).toBe('hiš')
    }

    for (const word of ['velik', 'velika', 'veliko', 'velikega', 'velikih']) {
      expect(slovenianStemmer(word), `${word} stems to velik`).toBe('velik')
    }

    for (const word of ['delati', 'delam', 'delaš', 'dela', 'delamo', 'delajo']) {
      expect(slovenianStemmer(word), `${word} stems to del`).toBe('del')
    }
  })

  it('slovenian stemming keeps distinct words distinct', async () => {
    expect(slovenianStemmer('mesto'), 'mesto and meso must not collapse').not.toBe(slovenianStemmer('meso'))
    expect(slovenianStemmer('letalo'), 'letalo and leto must not collapse').not.toBe(slovenianStemmer('leto'))
  })
})

describe('Custom stop-words rules', async () => {
  it('custom array of stop-words', async () => {
    const tokenizer = await createTokenizer({
      language: 'english',
      stopWords: ['quick', 'brown', 'fox', 'dog'],
      stemming: true
    })

    const I1 = 'the quick brown fox jumps over the lazy dog'
    const I2 = 'I baked some cakes'

    const O1 = tokenizer.tokenize(I1)

    const O2 = tokenizer.tokenize(I2)

    expect(O1).toEqual(['the', 'jump', 'over', 'lazi'])
    expect(O2).toEqual(['i', 'bake', 'some', 'cake'])
  })

  it('custom stop-words function', async () => {
    const tokenizer = await createTokenizer({
      language: 'english',
      stopWords(): string[] {
        return [...englishStopwords, 'quick', 'brown', 'fox', 'dog']
      },
      stemming: true
    })

    const I1 = 'the quick brown fox jumps over the lazy dog'
    const I2 = 'I baked some cakes'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toEqual(['jump', 'lazi'])
    expect(O2).toEqual(['bake', 'cake'])
  })

  it('disable stop-words', async () => {
    const tokenizer = await createTokenizer({ language: 'english', stopWords: false, stemming: true })

    const I1 = 'the quick brown fox jumps over the lazy dog'
    const I2 = 'I baked some cakes'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toEqual(['the', 'quick', 'brown', 'fox', 'jump', 'over', 'lazi', 'dog'])
    expect(O2).toEqual(['i', 'bake', 'some', 'cake'])
  })

  it('custom stemming function', async () => {
    const tokenizer = await createTokenizer({
      language: 'english',
      stemmer: (word) => `${word}-ish`,
      stopWords: englishStopwords
    })

    const I1 = 'the quick brown fox jumps over the lazy dog'
    const I2 = 'I baked some cakes'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    expect(O1).toEqual(['quick-ish', 'brown-ish', 'fox-ish', 'jumps-ish', 'lazy-ish', 'dog-ish'])
    expect(O2).toEqual(['baked-ish', 'cakes-ish'])
  })

  it('should validate options', async () => {
    // @ts-expect-error testing validation
    expect(() => createTokenizer({ language: 'english', stopWords: 'FOO' })).toThrow(
      expect.objectContaining({
        code: 'CUSTOM_STOP_WORDS_MUST_BE_FUNCTION_OR_ARRAY'
      })
    )

    // @ts-expect-error testing validation
    expect(() => createTokenizer({ language: 'english', stopWords: [1, 2, 3] })).toThrow(
      expect.objectContaining({
        code: 'CUSTOM_STOP_WORDS_MUST_BE_FUNCTION_OR_ARRAY'
      })
    )

    // @ts-expect-error testing validation
    expect(() => createTokenizer({ language: 'english', stopWords: {} })).toThrow(
      expect.objectContaining({
        code: 'CUSTOM_STOP_WORDS_MUST_BE_FUNCTION_OR_ARRAY'
      })
    )
  })

  describe('multilingual mode', () => {
    // NOTE: this test must run before any other multilingual tokenization in this file, because the Intl.Segmenter instance is cached at module level on first use and the fallback can only trigger beforehand.
    it('falls back to a Unicode regex when Intl.Segmenter is unavailable', async () => {
      const originalSegmenter = Intl.Segmenter
      // @ts-expect-error simulating a runtime without Intl.Segmenter
      delete Intl.Segmenter
      onTestFinished(() => {
        Intl.Segmenter = originalSegmenter
      })

      const tokenizer = createTokenizer({ language: 'multilingual' })
      const O = tokenizer.tokenize('The quick fox съешь café')

      expect(O).toStrictEqual(['the', 'quick', 'fox', 'съешь', 'cafe'])
    })

    it('tokenizes mixed Latin and Cyrillic scripts, lowercased and diacritic-folded', async () => {
      const tokenizer = createTokenizer({ language: 'multilingual' })

      const I1 = 'The quick BROWN fox. Съешь же ещё этих МЯГКИХ французских булок'
      const I2 = 'Un café crème et deux croissants'

      expect(tokenizer.tokenize(I1)).toStrictEqual([
        'the',
        'quick',
        'brown',
        'fox',
        'съешь',
        'же',
        'еще',
        'этих',
        'мягких',
        'французских',
        'булок'
      ])
      expect(tokenizer.tokenize(I2)).toStrictEqual(['un', 'cafe', 'creme', 'et', 'deux', 'croissants'])
    })

    it('produces searchable tokens for CJK text', async () => {
      const tokenizer = createTokenizer({ language: 'multilingual' })

      const tokens = tokenizer.tokenize('日本語のテキストを検索する')

      expect(tokens.length > 0, 'CJK input yields tokens').toBeTruthy()
      for (const token of tokens) {
        expect(token, 'tokens are lowercased').toBe(token.toLowerCase())
      }
    })

    it('honors stopWords, custom stemmer, and allowDuplicates', async () => {
      const tokenizer = createTokenizer({ language: 'multilingual', stopWords: ['the'] })
      expect(tokenizer.tokenize('the fox the dog')).toStrictEqual(['fox', 'dog'])

      const stemmed = createTokenizer({ language: 'multilingual', stemmer: (word) => `${word}!` })
      expect(stemmed.tokenize('quick fox')).toStrictEqual(['quick!', 'fox!'])

      const duplicates = createTokenizer({ language: 'multilingual', allowDuplicates: true })
      expect(duplicates.tokenize('test test test')).toStrictEqual(['test', 'test', 'test'])
    })

    it('still rejects a different explicit language at tokenize time', async () => {
      const tokenizer = createTokenizer({ language: 'multilingual' })

      expect(() => tokenizer.tokenize('some text', 'russian')).toThrow(
        expect.objectContaining({ code: 'LANGUAGE_NOT_SUPPORTED' })
      )
    })

    it('requires an explicit custom stemmer when stemming is enabled', async () => {
      expect(() => createTokenizer({ language: 'multilingual', stemming: true })).toThrow(
        expect.objectContaining({ code: 'MISSING_STEMMER' })
      )
    })

    it('folds Cyrillic ё and Arabic alef variants', async () => {
      const tokenizer = createTokenizer({ language: 'multilingual' })

      expect(tokenizer.tokenize('ёлка')).toStrictEqual(['елка'])
      expect(tokenizer.tokenize('Съешь ещё')).toStrictEqual(['съешь', 'еще'])
      expect(tokenizer.tokenize('آلاف إبراهيم')).toStrictEqual(['الاف', 'ابراهيم'])
    })

    it('folds diacritics before stemming, so accented and folded forms share a stem', async () => {
      const seen: string[] = []
      const tokenizer = createTokenizer({
        language: 'multilingual',
        stemmer: (word) => {
          seen.push(word)
          return word
        }
      })

      tokenizer.tokenize('pão')
      tokenizer.tokenize('pao')

      expect(seen, 'the stemmer receives the diacritic-folded form').toStrictEqual(['pao', 'pao'])
    })
  })

  it('arabic tokenizer keeps alef madda and standalone hamza inside words', async () => {
    const tokenizer = createTokenizer({ language: 'arabic' })

    // آ (U+0622) and ء (U+0621) were outside the old splitter range, so words
    // like آلاف and قراءة were shredded into fragments.
    expect(tokenizer.tokenize('آلاف')).toStrictEqual(['الاف'])
    expect(tokenizer.tokenize('قراءة')).toStrictEqual(['قراءة'])
  })

  it('foreign accents do not split words apart', async () => {
    for (const language of ['english', 'dutch', 'italian', 'french', 'german', 'portuguese', 'spanish'] as const) {
      const tokenizer = createTokenizer({ language })

      expect(
        tokenizer.tokenize('Invitation gâteau au chocolat'),
        `${language}: accented word survives as one token`
      ).toStrictEqual(['invitation', 'gateau', 'au', 'chocolat'])
      expect(
        tokenizer.tokenize('Gateau'),
        `${language}: accented and unaccented queries produce the same token`
      ).toStrictEqual(tokenizer.tokenize('Gâteau'))
      expect(tokenizer.tokenize('Crème brûlée'), `${language}: folds every accent`).toStrictEqual(['creme', 'brulee'])
    }
  })

  it('languages with significant diacritics are still not folded', async () => {
    const tokenizer = createTokenizer({ language: 'vietnamese' })

    // Vietnamese tone marks change the meaning of a word, so "tài" must not collapse onto "tai".
    expect(tokenizer.tokenize('tài')).toStrictEqual(['tài'])
    expect(tokenizer.tokenize('tai')).toStrictEqual(['tai'])
  })

  it('accented stopwords are still filtered out once tokens are folded', async () => {
    const tokenizer = createTokenizer({ language: 'french', stopWords: ['où', 'été'] })

    expect(tokenizer.tokenize('Où est le gâteau été')).toStrictEqual(['est', 'le', 'gateau'])
    // The unaccented spelling of a stopword is dropped too, so a query typed
    // without accents behaves exactly like the accented one.
    expect(tokenizer.tokenize('Ou est le gateau ete')).toStrictEqual(['est', 'le', 'gateau'])
  })
})
