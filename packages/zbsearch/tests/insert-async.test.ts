import { describe, expect, it } from 'vitest'
import { count, create, getByID, insertMultiple, insertMultipleAsync, save, search } from '../src/index.js'
import type { InsertProgress } from '../src/index.js'
import { yieldToEventLoop } from '../src/utils.js'

const schema = {
  id: 'string',
  title: 'string',
  year: 'number'
} as const

function makeDocs(howMany: number) {
  return Array.from({ length: howMany }, (_, i) => ({
    id: `doc-${i}`,
    title: `The quick brown fox number ${i}`,
    year: 2000 + (i % 20)
  }))
}

function probeEventLoop(): { ran: () => boolean; cancel: () => void } {
  let ran = false
  const onRun = () => {
    ran = true
  }

  const immediate = setImmediate(onRun)
  const timer = setTimeout(onRun, 0)

  return {
    ran: () => ran,
    cancel: () => {
      clearImmediate(immediate)
      clearTimeout(timer)
    }
  }
}

describe('insertMultipleAsync', () => {
  it('should insert every document and return their ids in order', async () => {
    const db = create({ schema })
    const docs = makeDocs(250)

    const ids = await insertMultipleAsync(db, docs, { batchSize: 40 })

    expect(ids).toHaveLength(250)
    expect(ids).toEqual(docs.map((doc) => doc.id))
    expect(count(db)).toBe(250)
    expect(getByID(db, 'doc-137')).toEqual(docs[137])
  })

  it('should produce a database equivalent to the synchronous insertMultiple', async () => {
    const docs = makeDocs(120)

    const syncDb = create({ schema })
    insertMultiple(syncDb, docs)

    const asyncDb = create({ schema })
    await insertMultipleAsync(asyncDb, docs, { batchSize: 17 })

    const term = 'fox'
    const syncResults = search(syncDb, { term, limit: 120 })
    const asyncResults = search(asyncDb, { term, limit: 120 })

    expect(asyncResults.count).toBe(syncResults.count)
    expect(asyncResults.hits.map((hit) => hit.id)).toEqual(syncResults.hits.map((hit) => hit.id))
    expect(asyncResults.hits.map((hit) => hit.score)).toEqual(syncResults.hits.map((hit) => hit.score))
    expect(save(asyncDb).docs).toEqual(save(syncDb).docs)
  })

  it('should yield to the event loop between batches', async () => {
    const db = create({ schema })
    const probe = probeEventLoop()

    await insertMultipleAsync(db, makeDocs(100), { batchSize: 10 })
    probe.cancel()

    expect(probe.ran()).toBe(true)
    expect(count(db)).toBe(100)
  })

  it('should not yield when everything fits in a single batch', async () => {
    const db = create({ schema })
    const probe = probeEventLoop()

    await insertMultipleAsync(db, makeDocs(10), { batchSize: 10 })
    probe.cancel()

    expect(probe.ran()).toBe(false)
    expect(count(db)).toBe(10)
  })

  it('should report progress after every batch', async () => {
    const db = create({ schema })
    const progress: InsertProgress[] = []

    await insertMultipleAsync(db, makeDocs(25), {
      batchSize: 10,
      onProgress: (p) => progress.push(p)
    })

    expect(progress).toEqual([
      { processed: 10, total: 25 },
      { processed: 20, total: 25 },
      { processed: 25, total: 25 }
    ])
  })

  it('should handle an empty document list', async () => {
    const db = create({ schema })
    const progress: InsertProgress[] = []

    const ids = await insertMultipleAsync(db, [], { onProgress: (p) => progress.push(p) })

    expect(ids).toEqual([])
    expect(progress).toEqual([])
    expect(count(db)).toBe(0)
  })

  it('should handle a batch size larger than the document list', async () => {
    const db = create({ schema })

    const ids = await insertMultipleAsync(db, makeDocs(3), { batchSize: 1000 })

    expect(ids).toHaveLength(3)
    expect(count(db)).toBe(3)
  })

  it('should reject an invalid batch size', async () => {
    const db = create({ schema })

    await expect(insertMultipleAsync(db, makeDocs(2), { batchSize: 0 })).rejects.toThrow(/Batch size/)
    await expect(insertMultipleAsync(db, makeDocs(2), { batchSize: -5 })).rejects.toThrow(/Batch size/)
    await expect(insertMultipleAsync(db, makeDocs(2), { batchSize: 1.5 })).rejects.toThrow(/Batch size/)
  })

  it('should run the insertion hooks', async () => {
    const beforeInsert: string[] = []
    const afterInsert: string[] = []
    let afterInsertMultipleCalls = 0

    const db = create({
      schema,
      plugins: [
        {
          name: 'hooks',
          beforeInsert: (_db, id) => {
            beforeInsert.push(id)
          },
          afterInsert: (_db, id) => {
            afterInsert.push(id)
          },
          afterInsertMultiple: () => {
            afterInsertMultipleCalls++
          }
        }
      ]
    })

    await insertMultipleAsync(db, makeDocs(30), { batchSize: 7 })

    expect(beforeInsert).toHaveLength(30)
    expect(afterInsert).toHaveLength(30)
    expect(afterInsertMultipleCalls).toBe(1)
  })

  it('should skip the hooks when asked to', async () => {
    let hookCalls = 0

    const db = create({
      schema,
      plugins: [
        {
          name: 'hooks',
          beforeInsert: () => {
            hookCalls++
          },
          afterInsertMultiple: () => {
            hookCalls++
          }
        }
      ]
    })

    await insertMultipleAsync(db, makeDocs(20), { batchSize: 5, skipHooks: true })

    expect(hookCalls).toBe(0)
    expect(count(db)).toBe(20)
  })

  it('should await asynchronous hooks', async () => {
    const seen: string[] = []

    const db = create({
      schema,
      plugins: [
        {
          name: 'async-hooks',
          afterInsert: async (_db, id) => {
            await yieldToEventLoop()
            seen.push(id)
          }
        }
      ]
    })

    await insertMultipleAsync(db, makeDocs(12), { batchSize: 5 })

    expect(seen).toHaveLength(12)
    expect(count(db)).toBe(12)
  })

  it('should reject and keep the documents inserted before the failure', async () => {
    const db = create({ schema })
    const docs = makeDocs(10)
    docs[6] = { ...docs[6], id: docs[2].id }

    await expect(insertMultipleAsync(db, docs, { batchSize: 4 })).rejects.toThrow(/already exists/)
    expect(count(db)).toBe(6)
  })

  it('should honour the language option', async () => {
    const db = create({ schema: { title: 'string' } as const, language: 'english' })

    await insertMultipleAsync(db, [{ title: 'running quickly' }], { batchSize: 1, language: 'english' })

    expect(search(db, { term: 'running' }).count).toBe(1)
  })
})

describe('yieldToEventLoop', () => {
  it('should resolve on a later turn of the event loop', async () => {
    const order: string[] = []

    const yielded = yieldToEventLoop().then(() => order.push('yield'))
    void Promise.resolve().then(() => order.push('microtask'))

    await yielded

    expect(order).toEqual(['microtask', 'yield'])
  })

  it('should resolve every caller when several yields are in flight', async () => {
    const resolved = await Promise.all([
      yieldToEventLoop().then(() => 1),
      yieldToEventLoop().then(() => 2),
      yieldToEventLoop().then(() => 3)
    ])

    expect(resolved).toEqual([1, 2, 3])
  })
})
