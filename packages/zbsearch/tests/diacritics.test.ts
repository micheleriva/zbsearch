import { describe, expect, it } from 'vitest'
import { replaceDiacritics } from '../src/components/tokenizer/diacritics.js'

describe('Diacritics Replacer', () => {
  it('should replace diacritics', async () => {
    const I1 = 'áàâãéèêíïóôõöúçñÁÀÂÃÉÈÍÏÓÔÕÖÚÇÑ'
    const I2 = 'áaauioèaíïóiuubnÁoiÃotytÓhygÚnÑ'
    const I3 = 'aaaaeeeiiooooucnAAAAEEIIOOOOUCN'

    const O1 = replaceDiacritics(I1)
    const O2 = replaceDiacritics(I2)
    const O3 = replaceDiacritics(I3)

    expect(O1).toBe('aaaaeeeiiooooucnAAAAEEIIOOOOUCN')
    expect(O2).toBe(`aaauioeaiioiuubnAoiAotytOhygUnN`)
    expect(O3).toBe(`aaaaeeeiiooooucnAAAAEEIIOOOOUCN`)
  })
})
