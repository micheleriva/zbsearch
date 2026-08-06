import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SearchHit } from '../src/types.js'

import {
  addRecentSearch,
  MAX_RECENT_SEARCHES,
  readRecentSearches,
  type RecentSearchStorage,
  removeRecentSearch
} from '../src/recent-searches.js'

const KEY = 'test-key'

function memoryStorage(initial?: string): RecentSearchStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(key) {
      return key === KEY ? this.value : null
    },
    setItem(key, value) {
      if (key === KEY) {
        this.value = value
      }
    },
    removeItem(key) {
      if (key === KEY) {
        this.value = null
      }
    }
  }
}

function hit(url: string, title = 'Title'): SearchHit {
  return { id: url, url, title, section: 'Section', snippet: 'dropped', category: 'Docs' }
}

test('readRecentSearches returns nothing when the store is empty', () => {
  assert.deepEqual(readRecentSearches(memoryStorage(), KEY), [])
})

test('readRecentSearches survives malformed JSON', () => {
  assert.deepEqual(readRecentSearches(memoryStorage('{not json'), KEY), [])
})

test('readRecentSearches survives a non-array payload', () => {
  assert.deepEqual(readRecentSearches(memoryStorage('{"a":1}'), KEY), [])
})

test('readRecentSearches drops entries missing required fields', () => {
  const storage = memoryStorage(JSON.stringify([{ url: '/a' }, { id: '1', url: '/b', title: 'B' }, null, 'nope']))
  assert.deepEqual(readRecentSearches(storage, KEY), [{ id: '1', url: '/b', title: 'B' }])
})

test('readRecentSearches survives a storage that throws', () => {
  const storage: RecentSearchStorage = {
    getItem() {
      throw new Error('SecurityError')
    },
    setItem() {},
    removeItem() {}
  }

  assert.deepEqual(readRecentSearches(storage, KEY), [])
})

test('addRecentSearch puts the newest entry first', () => {
  const storage = memoryStorage()

  addRecentSearch(storage, hit('/a'), KEY)
  const entries = addRecentSearch(storage, hit('/b'), KEY)

  assert.deepEqual(
    entries.map((entry) => entry.url),
    ['/b', '/a']
  )
})

test('addRecentSearch keeps only the navigable fields', () => {
  const [entry] = addRecentSearch(memoryStorage(), hit('/a'), KEY)
  assert.deepEqual(entry, { id: '/a', url: '/a', title: 'Title', section: 'Section', breadcrumb: undefined })
})

test('addRecentSearch de-duplicates by url', () => {
  const storage = memoryStorage()

  addRecentSearch(storage, hit('/a'), KEY)
  addRecentSearch(storage, hit('/b'), KEY)
  const entries = addRecentSearch(storage, hit('/a', 'Renamed'), KEY)

  assert.deepEqual(
    entries.map((entry) => entry.url),
    ['/a', '/b']
  )
  assert.equal(entries[0].title, 'Renamed')
})

test('addRecentSearch caps the history', () => {
  const storage = memoryStorage()
  let entries: ReturnType<typeof addRecentSearch> = []

  for (let index = 0; index < MAX_RECENT_SEARCHES + 3; index++) {
    entries = addRecentSearch(storage, hit(`/page-${index}`), KEY)
  }

  assert.equal(entries.length, MAX_RECENT_SEARCHES)
  assert.equal(entries[0].url, `/page-${MAX_RECENT_SEARCHES + 2}`)
})

test('addRecentSearch tolerates a full quota', () => {
  const storage: RecentSearchStorage = {
    getItem: () => null,
    setItem() {
      throw new Error('QuotaExceededError')
    },
    removeItem() {}
  }

  assert.deepEqual(
    addRecentSearch(storage, hit('/a'), KEY).map((entry) => entry.url),
    ['/a']
  )
})

test('removeRecentSearch drops the matching entry and persists the rest', () => {
  const storage = memoryStorage()

  addRecentSearch(storage, hit('/a'), KEY)
  addRecentSearch(storage, hit('/b'), KEY)

  assert.deepEqual(
    removeRecentSearch(storage, '/b', KEY).map((entry) => entry.url),
    ['/a']
  )
  assert.deepEqual(
    readRecentSearches(storage, KEY).map((entry) => entry.url),
    ['/a']
  )
})
