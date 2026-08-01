/**
 * Light Stemmer for Slovak.
 *
 * There is no official Snowball algorithm for Slovak, so this is an original
 * implementation following the light-stemming approach of Ljiljana Dolamic and
 * Jacques Savoy, "Indexing and stemming approaches for the Czech language",
 * Information Processing & Management 45 (2009) — the same approach the Czech
 * stemmer in this package (`cs.js`) ports from Apache Lucene.
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

function endsWithAny(word, suffixes) {
  return suffixes.some((suffix) => word.endsWith(suffix))
}

function isVowel(character) {
  return CASE_SUFFIXES_1.includes(character)
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
 * Rewrites palatalized stem endings: "c"/"č" -> "k" ("žiaci" -> "žiak"),
 * "z"/"ž" -> "h" ("bože" -> "boh"), plus the "čt" -> "ck" and "št" -> "sk"
 * clusters shared with Czech.
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
  if (last === 'z' || last === 'ž') {
    return word.slice(0, -1) + 'h'
  }

  return word
}

export function stemmer(word) {
  let stem = removeCase(word)
  stem = removePossessives(stem)

  if (stem.length > 0) {
    stem = dropFleetingVowel(stem)
    stem = normalize(stem)
  }

  return stem
}
