// Maps each supported language to its BCP-47 locale tag.
// The keys are the canonical language names accepted by ZBSearch (they define
// `SUPPORTED_LANGUAGES` and the `Language` type); the values are passed to
// `String.prototype.localeCompare` for locale-aware string sorting (see `getLocale`).
// Note: these locale tags are intentionally decoupled from the file-id codes used by
// `@zbsearch/stemmers` / `@zbsearch/stopwords` (e.g. Danish stems live in `dk.js` but the
// locale is `da`), so keep them as valid BCP-47 primary subtags.
export const SUPPORTED_LANGUAGE_LOCALES: Record<string, string> = {
  arabic: 'ar',
  armenian: 'hy',
  bulgarian: 'bg',
  czech: 'cs',
  danish: 'da',
  dutch: 'nl',
  english: 'en',
  finnish: 'fi',
  french: 'fr',
  german: 'de',
  greek: 'el',
  hungarian: 'hu',
  indian: 'hi',
  indonesian: 'id',
  irish: 'ga',
  italian: 'it',
  lithuanian: 'lt',
  nepali: 'ne',
  norwegian: 'no',
  portuguese: 'pt',
  romanian: 'ro',
  russian: 'ru',
  serbian: 'sr',
  slovak: 'sk',
  slovenian: 'sl',
  spanish: 'es',
  swedish: 'sv',
  tamil: 'ta',
  turkish: 'tr',
  ukrainian: 'uk',
  vietnamese: 'vi',
  sanskrit: 'sa'
}

export const MULTILINGUAL_LANGUAGE = 'multilingual' as const

// The letters `replaceDiacritics` can fold to plain ASCII: the Latin-1 Supplement and Latin
// Extended-A blocks (U+00C0–U+017F), minus the × (U+00D7) and ÷ (U+00F7) math symbols that sit
// inside them and must keep splitting words. Every splitter has to accept these as word
// characters, including the ones for languages that do not use them: a splitter only whitelists
// its own alphabet, so an unlisted accent does not merely survive into the token, it cuts the
// word in half ("gâteau" -> "g", "teau" under the English splitter) during the split — long
// before `normalizeToken` gets a chance to fold it. Keep in sync with the tables in
// `diacritics.ts`.
const FOLDABLE_LETTERS = '\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u017F'

// Per-language alphabets, as character-class bodies. `FOLDABLE_LETTERS` is *prepended* to each one rather than appended, because several of them end in a literal `-` that would otherwise be read as the start of a range.
const SPLITTER_ALPHABETS: Record<SupportedLanguage, string> = {
  dutch: "A-Za-zàèéìòóù0-9_'-",
  english: "A-Za-zàèéìòóù0-9_'-",
  french: 'a-z0-9äâàéèëêïîöôùüûœç-',
  italian: "A-Za-zàèéìòóù0-9_'-",
  norwegian: 'a-z0-9_æøåÆØÅäÄöÖüÜ',
  portuguese: 'a-z0-9à-úÀ-Ú',
  russian: 'a-z0-9а-яА-ЯёЁ',
  spanish: 'a-z0-9A-Zá-úÁ-ÚñÑüÜ',
  swedish: 'a-z0-9_åÅäÄöÖüÜ-',
  german: 'a-z0-9A-ZäöüÄÖÜß',
  finnish: 'a-z0-9äöÄÖ',
  danish: 'a-z0-9æøåÆØÅ',
  hungarian: 'a-z0-9áéíóöőúüűÁÉÍÓÖŐÚÜŰ',
  romanian: 'a-z0-9ăâîșțĂÂÎȘȚ',
  serbian: 'a-z0-9čćžšđČĆŽŠĐ',
  turkish: 'a-z0-9çÇğĞıİöÖşŞüÜ',
  lithuanian: 'a-z0-9ąčęėįšųūžĄČĘĖĮŠŲŪŽ',
  // U+0671 (ٱ) sits outside the ء-ي range but is folded by `EXTRA_FOLDINGS`, so it belongs here.
  arabic: 'a-z0-9ء-ي\\u0671',
  nepali: 'a-z0-9अ-ह',
  irish: 'a-z0-9áéíóúÁÉÍÓÚ',
  indian: 'a-z0-9अ-ह',
  armenian: 'a-z0-9ա-ֆ',
  greek: 'a-z0-9α-ωά-ώ',
  indonesian: 'a-z0-9',
  ukrainian: 'a-z0-9а-яА-ЯіїєІЇЄ',
  slovenian: 'a-z0-9čžšČŽŠ',
  bulgarian: 'a-z0-9а-яА-Я',
  tamil: 'a-z0-9அ-ஹ',
  sanskrit: 'a-z0-9A-Zāīūṛḷṃṁḥśṣṭḍṇṅñḻḹṝ',
  vietnamese:
    'a-z0-9A-ZáàảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ_',
  czech: 'A-Z0-9a-zěščřžýáíéúůóťďĚŠČŘŽÝÁÍÉÓÚŮŤĎ-',
  slovak: 'A-Z0-9a-záäčďéíĺľňóôŕšťúýžÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ-'
}

export const SPLITTERS: Record<SupportedLanguage, RegExp> = Object.fromEntries(
  Object.entries(SPLITTER_ALPHABETS).map(([language, alphabet]) => [
    language,
    new RegExp(`[^${FOLDABLE_LETTERS}${alphabet}]+`, 'gim')
  ])
)

export const SUPPORTED_LANGUAGES = Object.keys(SUPPORTED_LANGUAGE_LOCALES)

export function getLocale(language: string | undefined) {
  return language !== undefined && SUPPORTED_LANGUAGES.includes(language)
    ? SUPPORTED_LANGUAGE_LOCALES[language]
    : undefined
}

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export type Language = SupportedLanguage | typeof MULTILINGUAL_LANGUAGE

// Languages whose diacritics are semantically significant (e.g. Vietnamese tone marks).
// Their tokens must not be folded to ASCII during tokenization, otherwise distinct
// words collapse together (e.g. "tài" -> "tai") and search quality breaks.
export const LANGUAGES_WITH_SIGNIFICANT_DIACRITICS = new Set<Language>(['vietnamese'])
