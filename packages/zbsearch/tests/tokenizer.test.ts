import t from 'tap'

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
import { stemmer as slovakStemmer, language as slovakLanguage } from '@zbsearch/stemmers/slovak'
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
import { stopwords as slovakStopwords } from '@zbsearch/stopwords/slovak'
import { stopwords as slovenianStopwords } from '@zbsearch/stopwords/slovenian'
import { stopwords as spanishStopwords } from '@zbsearch/stopwords/spanish'
import { stopwords as swedishStopwords } from '@zbsearch/stopwords/swedish'
import { stopwords as ukrainianStopwords } from '@zbsearch/stopwords/ukrainian'
import { stopwords as tamilStopwords } from '@zbsearch/stopwords/tamil'
import { stopwords as vietnameseStopwords } from '@zbsearch/stopwords/vietnamese'

import { createTokenizer } from '../src/components/tokenizer/index.js'

t.test('Tokenizer', async (t) => {
  t.test('should tokenize and stem correctly in english', async (t) => {
    const tokenizer = await createTokenizer({ language: 'english', stopWords: false, stemming: true })

    const I1 = 'the quick brown fox jumps over the lazy dog'
    const I2 = 'I baked some cakes'

    const O1 = tokenizer.tokenize(I1, 'english')
    const O2 = tokenizer.tokenize(I2, 'english')

    t.strictSame(O1, ['the', 'quick', 'brown', 'fox', 'jump', 'over', 'lazi', 'dog'])
    t.strictSame(O2, ['i', 'bake', 'some', 'cake'])
  })

  t.test('should tokenize and stem correctly in english and allow duplicates', async (t) => {
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

    t.strictSame(O1, ['thi', 'is', 'a', 'test', 'with', 'test', 'duplic'])
    t.strictSame(O2, ["it'", 'aliv', "it'", 'aliv'])
  })

  t.test('should tokenize and stem correctly in english skipping appropriate properties (single)', async (t) => {
    const tokenizer = await createTokenizer({
      language: 'english',
      stemming: true,
      stemmerSkipProperties: 'notToStem',
      stopWords: englishStopwords
    })

    const I1 = 'the quick brown fox jumps over the lazy dog'

    const O1 = tokenizer.tokenize(I1, 'english')
    const O2 = tokenizer.tokenize(I1, 'english', 'notToStem')

    t.strictSame(O1, ['quick', 'brown', 'fox', 'jump', 'lazi', 'dog'])
    t.strictSame(O2, ['quick', 'brown', 'fox', 'jumps', 'lazy', 'dog'])
  })

  t.test('should tokenize and stem correctly in english skipping appropriate properties (multiple)', async (t) => {
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

    t.strictSame(O1, ['quick', 'brown', 'fox', 'jump', 'lazi', 'dog'])
    t.strictSame(O2, ['quick', 'brown', 'fox', 'jumps', 'lazy', 'dog'])
    t.strictSame(O3, ['quick', 'brown', 'fox', 'jumps', 'lazy', 'dog'])
  })

  t.test('should tokenize and stem correctly in english skipping appropriate properties (invalid)', async (t) => {
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

    t.strictSame(O1, ['quick', 'brown', 'fox', 'jump', 'lazi', 'dog'])
    t.strictSame(O2, ['quick', 'brown', 'fox', 'jump', 'lazi', 'dog'])
  })

  t.test('should tokenize and stem correctly in french', async (t) => {
    const tokenizer = await createTokenizer({
      language: frenchLanguage,
      stemmer: frenchStemmer,
      stopWords: frenchStopwords
    })

    const I1 = 'voyons quel temps il fait dehors'
    const I2 = "j'ai fait des gâteaux"

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['voyon', 'temp', 'fait', 'dehor'])
    t.strictSame(O2, ['fait', 'gateau'])
  })

  t.test('should tokenize and stem correctly in italian', async (t) => {
    const tokenizer = await createTokenizer({
      language: italianLanguage,
      stemmer: italianStemmer,
      stopWords: italianStopwords
    })

    const I1 = 'ho cucinato delle torte'
    const I2 = 'dormire è una cosa difficile quando i test non passano'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['cucin', 'tort'])
    t.strictSame(O2, ['dorm', 'cos', 'difficil', 'quand', 'test', 'pass'])
  })

  t.test('should tokenize and stem correctly in norwegian', async (t) => {
    const tokenizer = await createTokenizer({
      language: norwegianLanguage,
      stemmer: norwegianStemmer,
      stopWords: norwegianStopwords
    })
    const I1 = 'Jeg kokte noen kaker'
    const I2 = 'å sove er en vanskelig ting når testene mislykkes'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['kokt', 'kak'])
    t.strictSame(O2, ['sov', 'vansk', 'ting', 'test', 'mislykk'])
  })

  t.test('should tokenize and stem correctly in portuguese', async (t) => {
    const tokenizer = await createTokenizer({
      language: portugueseLanguage,
      stemmer: portugueseStemmer,
      stopWords: portugueseStopwords
    })

    const I1 = 'Eu cozinhei alguns bolos'
    const I2 = 'dormir é uma coisa difícil quando os testes falham'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['cozinh', 'alguns', 'bol'])
    t.strictSame(O2, ['dorm', 'e', 'cois', 'dificil', 'test', 'falh'])
  })

  t.test('should tokenize and stem correctly in russian', async (t) => {
    const tokenizer = await createTokenizer({
      language: russianLanguage,
      stemmer: russianStemmer,
      stopWords: russianStopwords
    })

    const I1 = 'я приготовила пирожные'
    const I2 = 'спать трудно, когда тесты не срабатывают'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['приготов', 'пирожн'])
    t.strictSame(O2, ['спат', 'трудн', 'тест', 'срабатыва'])
  })

  t.test('should tokenize and stem correctly in swedish', async (t) => {
    const tokenizer = await createTokenizer({
      language: swedishLanguage,
      stemmer: swedishStemmer,
      stopWords: swedishStopwords
    })
    const I1 = 'Jag lagade några kakor'
    const I2 = 'att sova är en svår sak när testerna misslyckas'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['lag', 'kak'])
    t.strictSame(O2, ['sov', 'svar', 'sak', 'test', 'misslyck'])
  })

  t.test('should tokenize and stem correctly in spanish', async (t) => {
    const tokenizer = await createTokenizer({
      language: spanishLanguage,
      stemmer: spanishStemmer,
      stopWords: spanishStopwords
    })

    const I1 = 'cociné unos pasteles'
    const I2 = 'dormir es algo dificil cuando las pruebas fallan'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['cocin', 'pastel'])
    t.strictSame(O2, ['dorm', 'dificil', 'prueb', 'fall'])
  })

  t.test('should tokenize and stem correctly in dutch', async (t) => {
    const tokenizer = await createTokenizer({
      language: dutchLanguage,
      stemmer: dutchStemmer,
      stopWords: dutchStopwords
    })
    const I1 = 'de kleine koeien'
    const I2 = 'Ik heb wat taarten gemaakt'

    const O2 = tokenizer.tokenize(I2)
    const O1 = tokenizer.tokenize(I1)

    t.strictSame(O1, ['klein', 'koei'])
    t.strictSame(O2, ['taart', 'gemaakt'])
  })

  t.test('should tokenize and stem correctly in german', async (t) => {
    const tokenizer = await createTokenizer({
      language: germanLanguage,
      stemmer: germanStemmer,
      stopWords: germanStopwords
    })

    const I1 = 'Schlaf ist eine harte Sache, wenn Tests fehlschlagen'
    const I2 = 'Ich habe ein paar Kekse gebacken'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['schlaf', 'hart', 'sach', 'test', 'fehlschlag'])
    t.strictSame(O2, ['paar', 'keks', 'geback'])
  })

  t.test('should tokenize and stem correctly in finnish', async (t) => {
    const tokenizer = await createTokenizer({
      language: finnishLanguage,
      stemmer: finnishStemmer,
      stopWords: finnishStopwords
    })

    const I1 = 'Uni on vaikea asia, kun testit epäonnistuvat'
    const I2 = 'Leivoin keksejä'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['uni', 'vaike', 'as', 'test', 'epaonnistuv'])
    t.strictSame(O2, ['leivo', 'keksej'])
  })

  t.test('should tokenize and stem correctly in danish', async (t) => {
    const tokenizer = await createTokenizer({
      language: danishLanguage,
      stemmer: danishStemmer,
      stopWords: danishStopwords
    })

    const I1 = 'Søvn er en svær ting, når prøver mislykkes'
    const I2 = 'Jeg bagte småkager'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['sovn', 'svar', 'ting', 'prov', 'mislyk'])
    t.strictSame(O2, ['bagt', 'smakag'])
  })

  t.test('should tokenize and stem correctly in tamil', async (t) => {
    const tokenizer = await createTokenizer({
      language: tamilLanguage,
      stemmer: tamilStemmer,
      stopWords: tamilStopwords
    })

    const I1 = 'கதை'
    const I2 = 'அவனிலா'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['கத'])
    t.strictSame(O2, ['அவன', 'ல'])
  })

  t.test('should tokenize and stem correctly in ukrainian', async (t) => {
    const tokenizer = await createTokenizer({
      language: ukrainianLanguage,
      stemmer: ukrainianStemmer,
      stopWords: ukrainianStopwords
    })

    const I1 = 'Коли тести не проходять, спати важко'
    const I2 = 'я приготувала тістечка'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['тест', 'не', 'проход', 'спат', 'важк'])
    t.strictSame(O2, ['я', 'приготувал', 'тістечк'])
  })

  t.test('should tokenize and stem correctly in vietnamese', async (t) => {
    const tokenizer = await createTokenizer({
      language: vietnameseLanguage,
      stemmer: vietnameseStemmer,
      stopWords: vietnameseStopwords
    })

    const I1 = 'Tìm kiếm tài liệu trong thư viện'
    const I2 = 'Học lập trình là một việc thú vị'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['tìm', 'kiếm', 'tài', 'liệu', 'thư', 'viện'])
    t.strictSame(O2, ['học', 'lập', 'trình', 'thú', 'vị'])
  })

  t.test('should tokenize and stem correctly in bulgarian', async (t) => {
    const tokenizer = await createTokenizer({ language: bulgarianLanguage, stemmer: bulgarianStemmer, stopWords: [] })

    const I1 = 'Кокошката е малка крава която не може да се събере с теста'
    const I2 = 'Има първа вероятност да се случи нещо неочаквано докато се изпълняват тестовете'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['кокошк', 'е', 'малк', 'крав', 'коят', 'не', 'мож', 'да', 'се', 'събер', 'с', 'тест'])
    t.strictSame(O2, ['има', 'първ', 'вероятност', 'да', 'се', 'случ', 'нещ', 'неочакван', 'док', 'изпълняват', 'тест'])
  })

  t.test('should tokenize and stem correctly in czech', async (t) => {
    const tokenizer = await createTokenizer({
      language: czechLanguage,
      stemmer: czechStemmer,
      stopWords: czechStopwords
    })

    const I1 = 'Upekla jsem nějaké koláče'
    const I2 = 'žáci četli knihy ve škole'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['upekl', 'nejak', 'kolak'])
    t.strictSame(O2, ['zak', 'cetl', 'knih', 'skol'])
  })

  t.test('should tokenize and stem correctly in slovak', async (t) => {
    const tokenizer = await createTokenizer({
      language: slovakLanguage,
      stemmer: slovakStemmer,
      stopWords: slovakStopwords
    })

    const I1 = 'Deti čítali knihy v škole'
    const I2 = 'ľudia sedeli za veľkým stolom'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['det', 'cital', 'knih', 'skol'])
    t.strictSame(O2, ['lud', 'sedl', 'velk', 'stol'])
  })

  t.test('slovak-only letters do not split tokens', async (t) => {
    const tokenizer = await createTokenizer({
      language: slovakLanguage,
      stemming: false,
      stopWords: slovakStopwords
    })

    // ä, ô, ľ, ĺ and ŕ are absent from the Czech splitter, which would break
    // these words apart. They must survive tokenization as whole tokens.
    t.strictSame(tokenizer.tokenize('mäso stôl ľudia vĺča vŕba'), ['maso', 'stol', 'ludia', 'vlca', 'vrba'])
  })

  t.test('uses the complete stopwords-iso Slovak list', async (t) => {
    t.equal(slovakStopwords.length, 418)
    for (const word of ['je', 'bude', 'ešte', 'takže']) {
      t.ok(slovakStopwords.includes(word), `contains ${word}`)
    }

    const tokenizer = await createTokenizer({
      language: slovakLanguage,
      stemming: false,
      stopWords: slovakStopwords
    })

    t.strictSame(tokenizer.tokenize('To je ešte bude takže vyhľadávanie'), ['vyhladavanie'])
  })

  t.test('should tokenize and stem correctly in slovenian', async (t) => {
    const tokenizer = await createTokenizer({
      language: slovenianLanguage,
      stemmer: slovenianStemmer,
      stopWords: slovenianStopwords
    })

    const I1 = 'Spekla sem nekaj tort'
    const I2 = 'otroci berejo knjige v mestih'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.strictSame(O1, ['spekl', 'tort'])
    t.strictSame(O2, ['otroc', 'ber', 'knjig', 'mest'])
  })

  t.test('disable stemming', async (t) => {
    const tokenizer = await createTokenizer({ language: 'english', stemming: false, stopWords: englishStopwords })

    const I1 = 'the quick brown fox jumps over the lazy dog'
    const I2 = 'I baked some cakes'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.same(O1, ['quick', 'brown', 'fox', 'jumps', 'lazy', 'dog'])
    t.same(O2, ['baked', 'cakes'])
  })

  t.test('should validate options', async (t) => {
    await t.rejects(() => createTokenizer({ language: 'weird-language' }), { code: 'LANGUAGE_NOT_SUPPORTED' })

    await t.rejects(() => createTokenizer({ language: 'italian', stemming: true }), { code: 'MISSING_STEMMER' })

    // @ts-expect-error testing validation
    await t.rejects(() => createTokenizer({ language: 'english', stemmer: 'FOO' }), {
      code: 'INVALID_STEMMER_FUNCTION_TYPE'
    })
  })
})

t.test('Czech, Slovak and Slovenian stemming', async (t) => {
  t.test('czech inflected forms collapse to a single stem', async (t) => {
    for (const word of ['žák', 'žáci', 'žáky', 'žákům', 'žácích']) {
      t.equal(czechStemmer(word), 'žák', `${word} stems to žák`)
    }

    for (const word of ['kniha', 'knihy', 'knihám', 'knihách']) {
      t.equal(czechStemmer(word), 'knih', `${word} stems to knih`)
    }

    for (const word of ['malý', 'malá', 'malé', 'malému', 'malých']) {
      t.equal(czechStemmer(word), 'mal', `${word} stems to mal`)
    }
  })

  t.test('czech short words are left unchanged', async (t) => {
    t.equal(czechStemmer('e'), 'e')
    t.equal(czechStemmer('zi'), 'zi')
  })

  t.test('slovak inflected forms collapse to a single stem', async (t) => {
    for (const word of ['žiak', 'žiaka', 'žiaci', 'žiakovi', 'žiakom', 'žiakov', 'žiakoch', 'žiakmi']) {
      t.equal(slovakStemmer(word), 'žiak', `${word} stems to žiak`)
    }

    for (const word of ['kniha', 'knihy', 'knihe', 'knihu', 'knihou', 'knihám', 'knihách', 'knihami']) {
      t.equal(slovakStemmer(word), 'knih', `${word} stems to knih`)
    }

    for (const word of ['mesto', 'mesta', 'mestu', 'mestom', 'mestá', 'mestám', 'mestách']) {
      t.equal(slovakStemmer(word), 'mest', `${word} stems to mest`)
    }

    for (const word of ['malý', 'malá', 'malé', 'malého', 'malému', 'malej', 'malých', 'malými']) {
      t.equal(slovakStemmer(word), 'mal', `${word} stems to mal`)
    }
  })

  t.test('slovak stems ascii-folded input the same way', async (t) => {
    // The tokenizer folds diacritics before stemming, so the folded forms must
    // collapse exactly like their accented counterparts.
    for (const word of ['ziak', 'ziaka', 'ziaci', 'ziakovi', 'ziakom', 'ziakov', 'ziakoch']) {
      t.equal(slovakStemmer(word), 'ziak', `${word} stems to ziak`)
    }

    for (const word of ['maly', 'mala', 'male', 'maleho', 'malemu', 'malej', 'malych', 'malymi']) {
      t.equal(slovakStemmer(word), 'mal', `${word} stems to mal`)
    }
  })

  t.test('slovak fleeting vowel and ô alternations conflate', async (t) => {
    for (const word of ['stôl', 'stola', 'stolu', 'stolom', 'stoly', 'stolov']) {
      t.equal(slovakStemmer(word), 'stol', `${word} stems to stol`)
    }

    for (const word of ['ovca', 'ovce', 'ovcu', 'oviec', 'ovciam']) {
      t.equal(slovakStemmer(word), 'ovk', `${word} stems to ovk`)
    }

    for (const word of ['chlapec', 'chlapca', 'chlapci', 'chlapcov']) {
      t.equal(slovakStemmer(word), 'chlapk', `${word} stems to chlapk`)
    }
  })

  t.test('slovak superlative, comparative and verb inflections conflate', async (t) => {
    for (const word of ['najžľaznatejšieho', 'najzlaznatejsieho']) {
      t.equal(slovakStemmer(word), word.includes('ž') ? 'žľaznat' : 'zlaznat', `${word} stems to its adjective base`)
    }

    for (const word of ['robiť', 'robit', 'robím', 'robim', 'robíš', 'robíme', 'robime', 'robíte', 'robite', 'robili', 'robila', 'robilo']) {
      t.equal(slovakStemmer(word), 'rob', `${word} stems to rob`)
    }

    for (const [word, expected] of [
      ['čítajú', 'čít'],
      ['citaju', 'cit'],
      ['pracujú', 'prac'],
      ['pracuju', 'prac']
    ]) {
      t.equal(slovakStemmer(word), expected, `${word} stems to its verb base`)
    }
  })

  t.test('slovak z/ž endings remain stable across muž inflections', async (t) => {
    for (const word of ['muž', 'muža', 'muži', 'mužom', 'mužoch', 'mužmi']) {
      t.equal(slovakStemmer(word), 'muž', `${word} stems to muž`)
    }

    for (const word of ['muz', 'muza', 'muzi', 'muzom', 'muzoch', 'muzmi']) {
      t.equal(slovakStemmer(word), 'muz', `${word} stems to muz`)
    }
  })

  t.test('slovak short words are left unchanged', async (t) => {
    t.equal(slovakStemmer('e'), 'e')
    t.equal(slovakStemmer('zi'), 'zi')
    t.equal(slovakStemmer('dom'), 'dom')
  })

  t.test('slovak stemming keeps distinct words distinct', async (t) => {
    t.not(slovakStemmer('mesto'), slovakStemmer('meso'), 'mesto and meso must not collapse')
    t.not(slovakStemmer('stôl'), slovakStemmer('stolica'), 'stôl and stolica must not collapse')
    t.not(slovakStemmer('okno'), slovakStemmer('oko'), 'okno and oko must not collapse')
  })

  t.test('slovenian inflected forms collapse to a single stem', async (t) => {
    for (const word of ['mesto', 'mesta', 'mestu', 'mestom', 'mest', 'mestih']) {
      t.equal(slovenianStemmer(word), 'mest', `${word} stems to mest`)
    }

    for (const word of ['hiša', 'hiše', 'hiši', 'hišo']) {
      t.equal(slovenianStemmer(word), 'hiš', `${word} stems to hiš`)
    }

    for (const word of ['velik', 'velika', 'veliko', 'velikega', 'velikih']) {
      t.equal(slovenianStemmer(word), 'velik', `${word} stems to velik`)
    }

    for (const word of ['delati', 'delam', 'delaš', 'dela', 'delamo', 'delajo']) {
      t.equal(slovenianStemmer(word), 'del', `${word} stems to del`)
    }
  })

  t.test('slovenian stemming keeps distinct words distinct', async (t) => {
    t.not(slovenianStemmer('mesto'), slovenianStemmer('meso'), 'mesto and meso must not collapse')
    t.not(slovenianStemmer('letalo'), slovenianStemmer('leto'), 'letalo and leto must not collapse')
  })
})

t.test('Custom stop-words rules', async (t) => {
  t.test('custom array of stop-words', async (t) => {
    const tokenizer = await createTokenizer({
      language: 'english',
      stopWords: ['quick', 'brown', 'fox', 'dog'],
      stemming: true
    })

    const I1 = 'the quick brown fox jumps over the lazy dog'
    const I2 = 'I baked some cakes'

    const O1 = tokenizer.tokenize(I1)

    const O2 = tokenizer.tokenize(I2)

    t.same(O1, ['the', 'jump', 'over', 'lazi'])
    t.same(O2, ['i', 'bake', 'some', 'cake'])
  })

  t.test('custom stop-words function', async (t) => {
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

    t.same(O1, ['jump', 'lazi'])
    t.same(O2, ['bake', 'cake'])
  })

  t.test('disable stop-words', async (t) => {
    const tokenizer = await createTokenizer({ language: 'english', stopWords: false, stemming: true })

    const I1 = 'the quick brown fox jumps over the lazy dog'
    const I2 = 'I baked some cakes'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.same(O1, ['the', 'quick', 'brown', 'fox', 'jump', 'over', 'lazi', 'dog'])
    t.same(O2, ['i', 'bake', 'some', 'cake'])
  })

  t.test('custom stemming function', async (t) => {
    const tokenizer = await createTokenizer({
      language: 'english',
      stemmer: (word) => `${word}-ish`,
      stopWords: englishStopwords
    })

    const I1 = 'the quick brown fox jumps over the lazy dog'
    const I2 = 'I baked some cakes'

    const O1 = tokenizer.tokenize(I1)
    const O2 = tokenizer.tokenize(I2)

    t.same(O1, ['quick-ish', 'brown-ish', 'fox-ish', 'jumps-ish', 'lazy-ish', 'dog-ish'])
    t.same(O2, ['baked-ish', 'cakes-ish'])
  })

  await t.test('should validate options', async (t) => {
    // @ts-expect-error testing validation
    await t.rejects(() => createTokenizer({ language: 'english', stopWords: 'FOO' }), {
      code: 'CUSTOM_STOP_WORDS_MUST_BE_FUNCTION_OR_ARRAY'
    })

    // @ts-expect-error testing validation
    await t.rejects(() => createTokenizer({ language: 'english', stopWords: [1, 2, 3] }), {
      code: 'CUSTOM_STOP_WORDS_MUST_BE_FUNCTION_OR_ARRAY'
    })

    // @ts-expect-error testing validation
    await t.rejects(() => createTokenizer({ language: 'english', stopWords: {} }), {
      code: 'CUSTOM_STOP_WORDS_MUST_BE_FUNCTION_OR_ARRAY'
    })
  })

  t.test('multilingual mode', async (t) => {
    // NOTE: this test must run before any other multilingual tokenization in this file, because the Intl.Segmenter instance is cached at module level on first use and the fallback can only trigger beforehand.
    t.test('falls back to a Unicode regex when Intl.Segmenter is unavailable', async (t) => {
      const originalSegmenter = Intl.Segmenter
      // @ts-expect-error simulating a runtime without Intl.Segmenter
      delete Intl.Segmenter
      t.teardown(() => {
        Intl.Segmenter = originalSegmenter
      })

      const tokenizer = createTokenizer({ language: 'multilingual' })
      const O = tokenizer.tokenize('The quick fox съешь café')

      t.strictSame(O, ['the', 'quick', 'fox', 'съешь', 'cafe'])
    })

    t.test('tokenizes mixed Latin and Cyrillic scripts, lowercased and diacritic-folded', async (t) => {
      const tokenizer = createTokenizer({ language: 'multilingual' })

      const I1 = 'The quick BROWN fox. Съешь же ещё этих МЯГКИХ французских булок'
      const I2 = 'Un café crème et deux croissants'

      t.strictSame(tokenizer.tokenize(I1), [
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
      t.strictSame(tokenizer.tokenize(I2), ['un', 'cafe', 'creme', 'et', 'deux', 'croissants'])
    })

    t.test('produces searchable tokens for CJK text', async (t) => {
      const tokenizer = createTokenizer({ language: 'multilingual' })

      const tokens = tokenizer.tokenize('日本語のテキストを検索する')

      t.ok(tokens.length > 0, 'CJK input yields tokens')
      for (const token of tokens) {
        t.equal(token, token.toLowerCase(), 'tokens are lowercased')
      }
    })

    t.test('honors stopWords, custom stemmer, and allowDuplicates', async (t) => {
      const tokenizer = createTokenizer({ language: 'multilingual', stopWords: ['the'] })
      t.strictSame(tokenizer.tokenize('the fox the dog'), ['fox', 'dog'])

      const stemmed = createTokenizer({ language: 'multilingual', stemmer: (word) => `${word}!` })
      t.strictSame(stemmed.tokenize('quick fox'), ['quick!', 'fox!'])

      const duplicates = createTokenizer({ language: 'multilingual', allowDuplicates: true })
      t.strictSame(duplicates.tokenize('test test test'), ['test', 'test', 'test'])
    })

    t.test('still rejects a different explicit language at tokenize time', async (t) => {
      const tokenizer = createTokenizer({ language: 'multilingual' })

      t.throws(() => tokenizer.tokenize('some text', 'russian'), { code: 'LANGUAGE_NOT_SUPPORTED' })
    })

    t.test('requires an explicit custom stemmer when stemming is enabled', async (t) => {
      t.throws(() => createTokenizer({ language: 'multilingual', stemming: true }), { code: 'MISSING_STEMMER' })
    })

    t.test('folds Cyrillic ё and Arabic alef variants', async (t) => {
      const tokenizer = createTokenizer({ language: 'multilingual' })

      t.strictSame(tokenizer.tokenize('ёлка'), ['елка'])
      t.strictSame(tokenizer.tokenize('Съешь ещё'), ['съешь', 'еще'])
      t.strictSame(tokenizer.tokenize('آلاف إبراهيم'), ['الاف', 'ابراهيم'])
    })

    t.test('folds diacritics before stemming, so accented and folded forms share a stem', async (t) => {
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

      t.strictSame(seen, ['pao', 'pao'], 'the stemmer receives the diacritic-folded form')
    })
  })

  t.test('arabic tokenizer keeps alef madda and standalone hamza inside words', async (t) => {
    const tokenizer = createTokenizer({ language: 'arabic' })

    // آ (U+0622) and ء (U+0621) were outside the old splitter range, so words
    // like آلاف and قراءة were shredded into fragments.
    t.strictSame(tokenizer.tokenize('آلاف'), ['الاف'])
    t.strictSame(tokenizer.tokenize('قراءة'), ['قراءة'])
  })
})
