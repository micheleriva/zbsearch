import { describe, expect, it } from 'vitest'
import { getLocale, SUPPORTED_LANGUAGES, SUPPORTED_LANGUAGE_LOCALES } from '../src/components/tokenizer/languages.js'

describe('language locales', () => {
  it('every supported language maps to a canonical, well-formed BCP-47 locale', async () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const locale = getLocale(language)

      expect(typeof locale, `getLocale('${language}') returns a locale`).toBe('string')

      let canonical: string[] = []
      expect(() => {
        canonical = Intl.getCanonicalLocales(locale)
      }, `'${locale}' (${language}) is a well-formed BCP-47 tag`).not.toThrow()
      expect(canonical, `'${locale}' (${language}) is already in canonical form`).toStrictEqual([locale])
    }
  })

  it('specific language to locale mappings', async () => {
    const expectedLocales = {
      czech: 'cs',
      slovenian: 'sl',
      danish: 'da',
      greek: 'el',
      swedish: 'sv',
      serbian: 'sr',
      armenian: 'hy',
      sanskrit: 'sa',
      indian: 'hi',
      irish: 'ga',
      nepali: 'ne'
    }

    for (const [language, locale] of Object.entries(expectedLocales)) {
      expect(getLocale(language), `getLocale('${language}') returns '${locale}'`).toBe(locale)
    }
  })

  it('supported languages include czech and slovenian', async () => {
    expect(SUPPORTED_LANGUAGES.includes('czech')).toBeTruthy()
    expect(SUPPORTED_LANGUAGES.includes('slovenian')).toBeTruthy()
    expect(SUPPORTED_LANGUAGES).toStrictEqual(Object.keys(SUPPORTED_LANGUAGE_LOCALES))
  })

  it('unknown or missing languages return undefined', async () => {
    expect(getLocale(undefined)).toBe(undefined)
    expect(getLocale('klingon')).toBe(undefined)
    expect(getLocale('multilingual')).toBe(undefined)
  })

  it('multilingual is a tokenizer mode, not a supported language', async () => {
    expect(SUPPORTED_LANGUAGES.includes('multilingual')).toBeFalsy()
  })
})
