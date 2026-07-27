const DIACRITICS_CHARCODE_START = 192
const DIACRITICS_CHARCODE_END = 383

const CHARCODE_REPLACE_MAPPING = [
  65,
  65,
  65,
  65,
  65,
  65,
  65,
  67,
  69,
  69,
  69,
  69,
  73,
  73,
  73,
  73,
  69,
  78,
  79,
  79,
  79,
  79,
  79,
  null,
  79,
  85,
  85,
  85,
  85,
  89,
  80,
  115,
  97,
  97,
  97,
  97,
  97,
  97,
  97,
  99,
  101,
  101,
  101,
  101,
  105,
  105,
  105,
  105,
  101,
  110,
  111,
  111,
  111,
  111,
  111,
  null,
  111,
  117,
  117,
  117,
  117,
  121,
  112,
  121,
  65,
  97,
  65,
  97,
  65,
  97,
  67,
  99,
  67,
  99,
  67,
  99,
  67,
  99,
  68,
  100,
  68,
  100,
  69,
  101,
  69,
  101,
  69,
  101,
  69,
  101,
  69,
  101,
  71,
  103,
  71,
  103,
  71,
  103,
  71,
  103,
  72,
  104,
  72,
  104,
  73,
  105,
  73,
  105,
  73,
  105,
  73,
  105,
  73,
  105,
  73,
  105,
  74,
  106,
  75,
  107,
  107,
  76,
  108,
  76,
  108,
  76,
  108,
  76,
  108,
  76,
  108,
  78,
  110,
  78,
  110,
  78,
  110,
  110,
  78,
  110,
  79,
  111,
  79,
  111,
  79,
  111,
  79,
  111,
  82,
  114,
  82,
  114,
  82,
  114,
  83,
  115,
  83,
  115,
  83,
  115,
  83,
  115,
  84,
  116,
  84,
  116,
  84,
  116,
  85,
  117,
  85,
  117,
  85,
  117,
  85,
  117,
  85,
  117,
  85,
  117,
  87,
  119,
  89,
  121,
  89,
  90,
  122,
  90,
  122,
  90,
  122,
  115
]

function replaceChar(charCode: number): number {
  if (charCode < DIACRITICS_CHARCODE_START || charCode > DIACRITICS_CHARCODE_END) return charCode

  /* c8 ignore next  */
  return CHARCODE_REPLACE_MAPPING[charCode - DIACRITICS_CHARCODE_START] || charCode
}

// Non-Latin foldings the Latin table above cannot cover. These unify common orthographic variants so that, e.g., Russian "ёлка"/"елка" and Arabic "آلاف"/"الاف" converge to the same token.
const EXTRA_FOLDINGS: Record<number, number> = {
  0x0401: 0x0415, // Ё > Е (Cyrillic)
  0x0451: 0x0435, // ё > е (Cyrillic)
  0x0622: 0x0627, // آ > ا (Arabic alef madda)
  0x0623: 0x0627, // أ > ا (Arabic alef with hamza above)
  0x0625: 0x0627, // إ > ا (Arabic alef with hamza below)
  0x0671: 0x0627, // ٱ > ا (Arabic alef wasla)
  0x0649: 0x064a // ى > ي (Arabic alef maksura)
}

function replaceLatinDiacritics(str: string): string {
  const len = str.length

  for (let idx = 0; idx < len; idx++) {
    const charCode = str.charCodeAt(idx)
    if (charCode < DIACRITICS_CHARCODE_START || charCode > DIACRITICS_CHARCODE_END) {
      continue
    }

    const replaced = CHARCODE_REPLACE_MAPPING[charCode - DIACRITICS_CHARCODE_START]
    if (!replaced || replaced === charCode) {
      continue
    }

    const codes = new Array<number>(len)
    for (let j = 0; j < idx; j++) {
      codes[j] = str.charCodeAt(j)
    }
    codes[idx] = replaced

    for (let j = idx + 1; j < len; j++) {
      codes[j] = replaceChar(str.charCodeAt(j))
    }

    return String.fromCharCode(...codes)
  }

  return str
}

export function replaceDiacritics(str: string): string {
  str = replaceLatinDiacritics(str)

  let out = ''
  let changed = false

  for (let i = 0; i < str.length; i++) {
    const replaced = EXTRA_FOLDINGS[str.charCodeAt(i)]

    if (replaced !== undefined) {
      if (!changed) {
        out = str.slice(0, i)
        changed = true
      }
      out += String.fromCharCode(replaced)

    } else if (changed) {
      out += str[i]
    }
  }

  return changed ? out : str
}
