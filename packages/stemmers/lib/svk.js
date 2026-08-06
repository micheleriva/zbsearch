/**
 * Light Stemmer for Slovak.
 *
 * There is no official Snowball algorithm for Slovak, and the Czech stemmer in
 * this package is not a usable stand-in: the two languages share much of their
 * declension but not the endings that matter here. Slovak has `-och`, `-iach`
 * and `-om` where Czech has `-ech`, `-ích` and `-ům`; Slovak has no `ě`, `ř` or
 * `ů`, and adds `ä`, `ĺ`, `ľ`, `ŕ` and `ô`. This stemmer follows the shape of
 * `cs.js` - the same length-tiered suffix tables and palatalization pass - but
 * the tables themselves hold Slovak endings, and Slovak verb, comparative and
 * superlative inflections are handled here, which `cs.js` does not attempt.
 *
 * Strips the `naj-` superlative prefix, then a comparative, verb or case
 * ending, then possessives, and finally normalizes the stem so inflectional
 * variants conflate. Input is expected to be lowercase.
 *
 * Both the diacritic form ("knihách") and the ASCII-folded form ("knihach") are
 * accepted, because the ZBSearch tokenizer folds diacritics before stemming
 * while direct callers generally do not. The forms of a word conflate within
 * each of those two paths, but the paths need not agree with each other:
 * folding erases vowel length and the `ť`/`t` distinction, which Slovak uses to
 * keep infinitives ("robiť") apart from nouns ("zošit", "internát"), so the
 * folded path has to stem more aggressively than the accented one.
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

// Verb endings, longest match first. Folded "-is" is deliberately excluded:
// it collides with common nouns ("popis") without folding buying it back.
//
// The folded infinitive endings "-at"/"-it" are kept even though they collide
// with nouns in "-át" ("internat") and "-it" ("zosit"), because the tokenizer
// folds before stemming, so dropping them would leave every infinitive in
// every real search unstemmed. The collision is absorbed instead: stemmer()
// re-runs this table after case removal, so such nouns lose the ending in all
// their forms ("internat"/"internaty" -> "intern") and still conflate.
//
// The "-ieť" class ("vidieť") is folded in via "ieť"/"iet", but its past tense
// "-eli"/"-ela"/"-elo" is not: those collide with the locative of nouns in
// "-el" ("hoteli"), which no later pass can absorb. "videli" therefore keeps a
// separate stem from "vidieť" - a known gap, not an oversight.
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
  'ieť',
  'iet',
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
 * the Slovak fleeting "ie" ("okien" -> "okn", "oviec" -> "ovc", which
 * palatalization then rewrites to "ovk"), a fleeting "e" ("otec" -> "otc") and
 * the "ô"/"o" alternation ("stôl" -> "stol"). Runs before palatalization so
 * that e.g. "chlapec" and "chlapci" meet.
 *
 * The "ie" branch requires more than four characters so that the result keeps
 * at least three, the same minimum-stem policy `removeSuffix` enforces; below
 * that, dropping two characters yields a degenerate stem ("dieťa" -> "dť")
 * that invites false matches. The "e" branch skips an "e" that belongs to such
 * an "ie" so the length guard is not silently undone by the weaker rule.
 *
 * Note that a surface "ie" is ambiguous: it marks both an inserted fleeting
 * vowel ("okno"/"okien") and a lengthened root vowel ("žena"/"žien"). Only the
 * first is handled, so "žien" does not reach "žen".
 */
function dropFleetingVowel(word) {
  const last = word[word.length - 1]

  if (!isVowel(last) && word.slice(-3, -1) === 'ie') {
    return word.length > 4 ? word.slice(0, -3) + last : word
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
    // Case removal can expose an ASCII-folded ending that also reads as an
    // infinitive ("internaty" -> "internat"). Stripping it here keeps such
    // nouns aligned with their bare form, which the verb pass above already
    // shortened.
    stem = removeVerbEnding(stem)
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
