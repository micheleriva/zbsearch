import { describe, expect, it } from 'vitest'
import { create } from '../src/methods/create.js'

describe('create method', () => {
  it('should provide an unique ID for the instance', async () => {
    const zbsearch1 = create({ schema: {} })
    const zbsearch2 = create({ schema: {} })

    expect(zbsearch1).toHaveProperty('id')
    expect(zbsearch2).toHaveProperty('id')

    expect(zbsearch1.id === zbsearch2.id).toBe(false)
  })

  it('should accept an "id" property and set is as instance ID', async () => {
    const zbsearch = create({ schema: {}, id: 'my-instance-id' })

    expect(zbsearch).toHaveProperty('id')
    expect(zbsearch.id).toEqual('my-instance-id')
  })

  it('should throw if custom tokenizer and language are specified together', async () => {
    expect(() =>
      create({
        schema: {},
        language: 'en'
      })
    ).toThrow()
  })

  it('should allow creation of an index with a geopoint property', async () => {
    expect(
      create({
        schema: {
          name: 'string',
          location: 'geopoint'
        }
      })
    ).toBeTruthy()
  })

  it('should accept "multilingual" as language', async () => {
    const zbsearch = create({
      schema: { text: 'string' },
      language: 'multilingual'
    })

    expect(zbsearch.tokenizer.language).toBe('multilingual')
  })

  it('should throw when multilingual stemming is enabled without a custom stemmer', async () => {
    expect(() =>
      create({
        schema: { text: 'string' },
        components: { tokenizer: { language: 'multilingual', stemming: true } }
      })
    ).toThrow(expect.objectContaining({ code: 'MISSING_STEMMER' }))
  })
})
