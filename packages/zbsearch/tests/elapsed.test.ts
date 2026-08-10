import { describe, expect, it } from 'vitest'
import { create, insert, search } from '../src/index.js'

describe('elapsed', () => {
  it('should correctly set elapsed time to a custom format', async () => {
    const db = await create({
      schema: {
        title: 'string',
        body: 'string'
      } as const,
      components: {
        formatElapsedTime: (n: bigint) => {
          return `${Number(n)}n`
        }
      }
    })

    await insert(db, {
      title: 'Hello world',
      body: 'This is a test'
    })

    const results = await search(db, {
      term: 'test'
    })

    expect(typeof results.elapsed).toEqual('string')
    expect(/(\d)n$/.test(results.elapsed as unknown as string)).toEqual(true)
  })

  it('should correctly set elapsed time to a bigint by default', async () => {
    const db = await create({
      schema: {
        title: 'string',
        body: 'string'
      } as const
    })

    await insert(db, {
      title: 'Hello world',
      body: 'This is a test'
    })

    const results = await search(db, {
      term: 'test'
    })

    expect(typeof results.elapsed).toEqual('object')
  })
})
