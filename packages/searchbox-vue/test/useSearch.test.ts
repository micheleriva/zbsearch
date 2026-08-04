import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SearchHit } from '@zbsearch/searchbox-core'
import { effectScope, nextTick } from 'vue'
import { useSearch } from '../src/composables/useSearch.js'

function hit(id: string): SearchHit {
  return { id, url: `/${id}`, title: id }
}

/** Runs `body` inside a scope, so `onScopeDispose` in the composable is honoured. */
async function withScope<T>(body: () => Promise<T> | T): Promise<T> {
  const scope = effectScope()
  const result = await scope.run(body)!

  scope.stop()

  return result as T
}

/** Waits for the watcher and the awaited searcher to settle. */
async function settle(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await nextTick()
    await Promise.resolve()
  }
}

test('starts idle with no hits', async () => {
  await withScope(async () => {
    const state = useSearch(() => () => [])

    assert.equal(state.term.value, '')
    assert.deepEqual(state.hits.value, [])
    assert.equal(state.status.value, 'idle')
  })
})

test('a query resolves to hits and reports ready', async () => {
  await withScope(async () => {
    const state = useSearch(() => () => [hit('a')])

    state.term.value = 'vector'
    await settle()

    assert.deepEqual(
      state.hits.value.map((item) => item.id),
      ['a']
    )
    assert.equal(state.status.value, 'ready')
  })
})

test('an empty query clears the results without calling the searcher', async () => {
  await withScope(async () => {
    let calls = 0
    const state = useSearch(() => () => {
      calls++
      return [hit('a')]
    })

    state.term.value = 'vector'
    await settle()
    assert.equal(calls, 1)

    state.term.value = '   '
    await settle()

    assert.deepEqual(state.hits.value, [])
    assert.equal(state.status.value, 'idle')
    assert.equal(calls, 1)
  })
})

test('a stale query cannot overwrite a newer one', async () => {
  await withScope(async () => {
    const resolvers: Array<(hits: SearchHit[]) => void> = []

    const state = useSearch(
      () => () =>
        new Promise<SearchHit[]>((resolve) => {
          resolvers.push(resolve)
        })
    )

    state.term.value = 'slow'
    await settle(1)
    state.term.value = 'fast'
    await settle(1)

    assert.equal(resolvers.length, 2, 'both queries should have started')

    resolvers[1]([hit('fast')])
    await settle()
    resolvers[0]([hit('slow')])
    await settle()

    assert.deepEqual(
      state.hits.value.map((item) => item.id),
      ['fast']
    )
  })
})

test('a superseded query is aborted', async () => {
  await withScope(async () => {
    const signals: AbortSignal[] = []

    const state = useSearch(() => (_term, signal) => {
      signals.push(signal)
      return []
    })

    state.term.value = 'one'
    await settle(1)
    state.term.value = 'two'
    await settle()

    assert.equal(signals.length, 2)
    assert.equal(signals[0].aborted, true, 'the first query should be aborted')
    assert.equal(signals[1].aborted, false)
  })
})

test('a failing searcher reports an error and clears the hits', async () => {
  const original = console.error
  console.error = () => {}

  try {
    await withScope(async () => {
      const state = useSearch(() => () => {
        throw new Error('boom')
      })

      state.term.value = 'vector'
      await settle()

      assert.equal(state.status.value, 'error')
      assert.deepEqual(state.hits.value, [])
    })
  } finally {
    console.error = original
  }
})

test('an aborted searcher does not report an error', async () => {
  await withScope(async () => {
    const state = useSearch(() => (_term, signal) => {
      if (signal.aborted) {
        throw new Error('aborted')
      }
      return [hit('a')]
    })

    state.term.value = 'one'
    await settle(1)
    state.term.value = 'two'
    await settle()

    assert.equal(state.status.value, 'ready')
  })
})

test('reset clears the term, the hits and the status', async () => {
  await withScope(async () => {
    const state = useSearch(() => () => [hit('a')])

    state.term.value = 'vector'
    await settle()

    state.reset()

    assert.equal(state.term.value, '')
    assert.deepEqual(state.hits.value, [])
    assert.equal(state.status.value, 'idle')
  })
})

test('the searcher is read lazily, so a recreated one is picked up', async () => {
  await withScope(async () => {
    let current = () => [hit('first')]
    const state = useSearch(() => current)

    state.term.value = 'a'
    await settle()
    assert.equal(state.hits.value[0].id, 'first')

    current = () => [hit('second')]
    state.term.value = 'b'
    await settle()

    assert.equal(state.hits.value[0].id, 'second')
  })
})
