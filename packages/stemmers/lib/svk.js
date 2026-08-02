/**
 * Light Stemmer for Slovak.
 *
 * There is no official Snowball algorithm for Slovak. This implementation uses
 * Slovak declension paradigms and selected inflection rules adapted from 
 * the Czech stemmer in this package (`cs.js`) and fixed with gpt-5.6-terra high 
 * for missing cases
 *
 * Slovak and Czech are closely related, but their inflectional endings diverge
 * enough that the Czech stemmer mis-stems Slovak: Slovak uses `-och`, `-iach`,
 * `-ám`, `-ami` where Czech uses `-ech`, `-ích`, `-ům`, `-ami`; Slovak has no
 * `ě`, `ř` or `ů`; and Slovak adds `ä`, `ĺ`, `ľ`, `ŕ`, `ô`. The tables below are
 * built from the Slovak declension paradigms rather than adapted from Czech.
 *
 * Removes case endings and possessive suffixes from nouns and adjectives, then
 * normalizes the stem so inflectional variants conflate. Input is expected to
 * be lowercase. Both the diacritic form ("knihách") and the ASCII-folded form
 * ("knihach") are accepted, because the ZBSearch tokenizer folds diacritics
 * before stemming while direct callers generally do not.
 */

const CASE_SUFFIXES_4 = ['ieho', 'iemu', 'iach', 'iami', 'ovia']

const CASE_SUFFIXES_3 = [
  'och',
  'ách',
  'ach',
  'ami',
  'ého',
  'eho',
  'ému',
  'emu',
  'ých',
  'ych',
  'ími',
  'imi',
  'ými',
  'ymi',
  'ích',
  'ich',
  'ovi',
  'ove',
  'iam'
]

const CASE_SUFFIXES_2 = ['om', 'ou', 'ov', 'mi', 'ám', 'am', 'ím', 'im', 'ým', 'ym', 'em', 'ej', 'ie', 'iu', 'ia']

const CASE_SUFFIXES_1 = 'aeiouyáéíóúýäô'

const POSSESSIVE_SUFFIXES = ['ov', 'in']

// Comparative and superlative adjective inflections. Both accented and
// ASCII-folded forms are needed because the tokenizer folds before stemming.
const COMPARATIVE_SUFFIXES = [
  'ejšieho',
  'ejsieho',
  'ejšiemu',
  'ejsiemu',
  'ejšími',
  'ejsimi',
  'ejších',
  'ejsich',
  'ejšia',
  'ejsia',
  'ejšom',
  'ejsom',
  'ejším',
  'ejsim',
  'ejšej',
  'ejsej',
  'ejšou',
  'ejsou',
  'ejšiu',
  'ejsiu',
  'ejšie',
  'ejsie',
  'ejší',
  'ejsi'
]

// Unambiguous multi-character verb endings. Shorter endings such as folded
// "-is" are deliberately excluded: they collide with common nouns (e.g.
// "popis") once diacritics have been folded.
const VERB_SUFFIXES = [
  'ajú',
  'aju',
  'ujú',
  'uju',
  'ejú',
  'eju',
  'íme',
  'ime',
  'íte',
  'ite',
  'eme',
  'ili',
  'ila',
  'ilo',
  'ať',
  'at',
  'iť',
  'it',
  'íš',
  'eš'
]

function endsWithAny(word, suffixes) {
  return suffixes.some((suffix) => word.endsWith(suffix))
}

function isVowel(character) {
  return CASE_SUFFIXES_1.includes(character)
}

function removeSuffix(word, suffixes, minimumStemLength = 3) {
  const suffix = suffixes.find((candidate) => word.endsWith(candidate))
  return suffix && word.length - suffix.length >= minimumStemLength ? word.slice(0, -suffix.length) : word
}

function removeSuperlativePrefix(word) {
  return word.length > 6 && word.startsWith('naj') ? word.slice(3) : word
}

function removeComparative(word) {
  return removeSuffix(word, COMPARATIVE_SUFFIXES)
}

function removeVerbEnding(word) {
  return removeSuffix(word, VERB_SUFFIXES)
}

/**
 * Removes Slovak case endings from nouns and adjectives, longest match first.
 */
function removeCase(word) {
  if (word.length > 6 && endsWithAny(word, CASE_SUFFIXES_4)) {
    return word.slice(0, -4)
  }
  if (word.length > 5 && endsWithAny(word, CASE_SUFFIXES_3)) {
    return word.slice(0, -3)
  }
  if (word.length > 4 && endsWithAny(word, CASE_SUFFIXES_2)) {
    return word.slice(0, -2)
  }
  if (word.length > 3 && isVowel(word[word.length - 1])) {
    return word.slice(0, -1)
  }
  return word
}

/**
 * Removes the possessive suffixes "-ov" ("otcov") and "-in" ("matkin").
 * Slovak has no "-ův" equivalent.
 */
function removePossessives(word) {
  if (word.length > 5 && endsWithAny(word, POSSESSIVE_SUFFIXES)) {
    return word.slice(0, -2)
  }
  return word
}

/**
 * Drops a fleeting vowel from the stem so that alternating forms conflate:
 * the Slovak fleeting "ie" ("okien" -> "okn", "oviec" -> "ovc"), a fleeting
 * "e" ("otec" -> "otc") and the "ô"/"o" alternation ("stôl" -> "stol").
 * Runs before palatalization so that e.g. "chlapec" and "chlapci" meet.
 */
function dropFleetingVowel(word) {
  const last = word[word.length - 1]

  if (word.length > 3 && !isVowel(last) && word.slice(-3, -1) === 'ie') {
    return word.slice(0, -3) + last
  }
  if (word.length > 3 && word[word.length - 2] === 'e' && !isVowel(last)) {
    return word.slice(0, -2) + last
  }
  if (word.length > 2 && word[word.length - 2] === 'ô') {
    return word.slice(0, -2) + 'o' + last
  }

  return word
}

/**
 * Rewrites Slovak palatalized stem endings: "c"/"č" -> "k"
 * ("žiaci" -> "žiak") and terminal ľ/ň/ť to their folded equivalents.
 * In contrast to the Czech stemmer, z/ž are not rewritten to h: that corrupts
 * the Slovak paradigm muž/muži.
 */
function normalize(word) {
  if (word.endsWith('čt')) {
    return word.slice(0, -2) + 'ck'
  }
  if (word.endsWith('št')) {
    return word.slice(0, -2) + 'sk'
  }

  const last = word[word.length - 1]
  if (last === 'c' || last === 'č') {
    return word.slice(0, -1) + 'k'
  }
  if (last === 'ľ') {
    return word.slice(0, -1) + 'l'
  }
  if (last === 'ň') {
    return word.slice(0, -1) + 'n'
  }
  if (last === 'ť') {
    return word.slice(0, -1) + 't'
  }

  return word
}

export function stemmer(word) {
  let stem = removeSuperlativePrefix(word)
  const comparativeStem = removeComparative(stem)
  const isComparative = comparativeStem !== stem
  stem = comparativeStem

  const verbStem = isComparative ? stem : removeVerbEnding(stem)
  const isVerb = verbStem !== stem
  stem = verbStem

  if (!isComparative && !isVerb) {
    stem = removeCase(stem)
  }
  stem = removePossessives(stem)

  if (stem.length > 0) {
    stem = dropFleetingVowel(stem)
    // c/č -> k is useful for nominal palatalization (žiaci -> žiak), but
    // not for verb bases such as pracovať/pracujú.
    if (!isVerb) {
      stem = normalize(stem)
    }
  }

  return stem
}
