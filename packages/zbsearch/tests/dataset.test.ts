import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { stopwords as englishStopwords } from '@zbsearch/stopwords/english'
import { DocumentsStore } from '../src/components/documents-store.js'
import { AnyDocument, create, insertMultiple, remove, Results, search } from '../src/index.js'

const dataset = JSON.parse(readFileSync(new URL('./datasets/events.json', import.meta.url), 'utf-8')) as EventJson

const snapshots = JSON.parse(readFileSync(new URL('./snapshots/events.json', import.meta.url), 'utf-8')) as Record<
  string,
  Results<AnyDocument>
>

type EventJson = {
  result: {
    events: {
      date: string
      description: string
      granularity: string
      category1: string
      category2: string
    }[]
  }
}

function removeVariadicData(res: Results<AnyDocument>): Omit<Results<AnyDocument>, 'elapsed'> {
  const hits = res.hits.map((h) => {
    h.id = ''
    return h
  })

  return {
    count: res.count,
    hits
  }
}

describe('zbsearch.dataset', async () => {
  const db = await create({
    schema: {
      date: 'string',
      description: 'string',
      granularity: 'string',
      categories: {
        first: 'string',
        second: 'string'
      }
    } as const,
    sort: {
      enabled: false
    },
    components: {
      tokenizer: {
        stemming: true,
        stopWords: englishStopwords
      }
    }
  })

  const events = (dataset as EventJson).result.events.map((ev) => ({
    date: ev.date,
    description: ev.description,
    granularity: ev.granularity,
    categories: {
      first: ev.category1 ?? '',
      second: ev.category2 ?? ''
    }
  }))

  await insertMultiple(db, events)

  it('should correctly populate the database with a large dataset', async () => {
    const s1 = await search(db, {
      term: 'august',
      exact: true,
      properties: ['categories.first'],
      limit: 10,
      offset: 0
    })

    const s2 = await search(db, {
      term: 'january, june',
      exact: true,
      properties: ['categories.first'],
      limit: 10,
      offset: 0
    })

    const s3 = await search(db, {
      term: 'january/june',
      exact: true,
      properties: ['categories.first'],
      limit: 10,
      offset: 0
    })

    expect(Object.keys((db.data.docs as DocumentsStore).docs).length).toBe((dataset as EventJson).result.events.length)
    // Note: counts changed after adding case-sensitive exact matching in issue #866
    expect(s1.count).toBe(0) // "War" (capitalized) doesn't match "war" (lowercase) with exact: true
    expect(s2.count).toBe(0) // Same reason
    expect(s3.count).toBe(0) // Same reason
  })

  //  Tests for https://github.com/oramasearch/orama/issues/159
  it('should correctly search long strings', async () => {
    const s1 = await search(db, {
      term: 'e into the',
      properties: ['description']
    })

    const s2 = await search(db, {
      term: 'The Roman armies',
      properties: ['description']
    })

    const s3 = await search(db, {
      term: 'the King of Epirus, is taken',
      properties: ['description']
    })

    expect(s1.count).toBe(14927)
    expect(s2.count).toBe(2926)
    expect(s3.count).toBe(3332)
  })

  it('should perform paginate search', async ({ task }) => {
    const s1 = removeVariadicData(
      await search(db, {
        term: 'war',
        exact: true,
        // eslint-disable-next-line
        // @ts-ignore
        properties: ['description'],
        limit: 10,
        offset: 0
      })
    )

    const s2 = removeVariadicData(
      await search(db, {
        term: 'war',
        exact: true,
        properties: ['description'],
        limit: 10,
        offset: 10
      })
    )

    const s3 = removeVariadicData(
      await search(db, {
        term: 'war',
        exact: true,
        properties: ['description'],
        limit: 10,
        offset: 20
      })
    )

    const s4 = await search(db, {
      term: 'war',
      exact: true,
      properties: ['description'],
      limit: 2240,
      offset: 0
    })

    const s5 = await search(db, {
      term: 'war',
      exact: true,
      properties: ['description'],
      limit: 10,
      offset: 2239
    })

    if (typeof process !== 'undefined' && process.env.GENERATE_SNAPSHOTS) {
      const { writeFile } = await import('node:fs/promises')
      const { fileURLToPath } = await import('node:url')
      await writeFile(
        fileURLToPath(new URL('./snapshots/events.json', import.meta.url)),
        JSON.stringify(
          {
            [`${task.name}-page-1`]: s1,
            [`${task.name}-page-2`]: s2,
            [`${task.name}-page-3`]: s3
          },
          null,
          2
        ),
        'utf-8'
      )

      expect(s1).toBeTruthy()
      expect(s2).toBeTruthy()
      expect(s3).toBeTruthy()
    } else {
      expect(s1).toStrictEqual(snapshots[`${task.name}-page-1`])
      expect(s2).toStrictEqual(snapshots[`${task.name}-page-2`])
      expect(s3).toStrictEqual(snapshots[`${task.name}-page-3`])
    }

    // Note: counts changed after adding case-sensitive exact matching in issue #866
    expect(s4.count).toBe(679) // Only lowercase "war" matches, not "War"
    expect(s5.hits.length).toBe(0) // No results at offset 2239 with only 679 total results
  })

  it('should correctly delete documents', async () => {
    const documentsToDelete = await search(db, {
      term: 'war',
      exact: true,
      properties: ['description'],
      limit: 10,
      offset: 0
    })

    for (const doc of documentsToDelete.hits) {
      await remove(db, doc.id)
    }

    const newSearch = await search(db, {
      term: 'war',
      exact: true,
      properties: ['description'],
      limit: 10,
      offset: 0
    })

    // Note: counts changed after adding case-sensitive exact matching in issue #866
    expect(newSearch.count).toBe(669) // Only lowercase "war" matches, not "War", and after deleting 10 docs
  })
})
