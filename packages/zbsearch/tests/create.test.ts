import t from 'tap'
import { create } from '../src/methods/create.js'

t.test('create method', (t) => {
  t.test('should provide an unique ID for the instance', async (t) => {
    const zbsearch1 = create({ schema: {} })
    const zbsearch2 = create({ schema: {} })

    t.hasProp(zbsearch1, 'id')
    t.hasProp(zbsearch2, 'id')

    t.equal(zbsearch1.id === zbsearch2.id, false)
  })

  t.test('should accept an "id" property and set is as instance ID', async (t) => {
    const zbsearch = create({ schema: {}, id: 'my-instance-id' })

    t.hasProp(zbsearch, 'id')
    t.same(zbsearch.id, 'my-instance-id')
  })

  t.test('should throw if custom tokenizer and language are specified together', async (t) => {
    t.throws(() =>
      create({
        schema: {},
        language: 'en'
      })
    )

    t.end()
  })

  t.test('should allow creation of an index with a geopoint property', async (t) => {
    t.ok(
      create({
        schema: {
          name: 'string',
          location: 'geopoint'
        }
      })
    )
  })

  t.test('should accept "multilingual" as language', async (t) => {
    const zbsearch = create({
      schema: { text: 'string' },
      language: 'multilingual'
    })

    t.equal(zbsearch.tokenizer.language, 'multilingual')
  })

  t.test('should throw when multilingual stemming is enabled without a custom stemmer', async (t) => {
    t.throws(
      () =>
        create({
          schema: { text: 'string' },
          components: { tokenizer: { language: 'multilingual', stemming: true } }
        }),
      { code: 'MISSING_STEMMER' }
    )
  })

  t.end()
})
