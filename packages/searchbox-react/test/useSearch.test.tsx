import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import type { SearchHit } from '@zbsearch/searchbox-core'
import { JSDOM } from 'jsdom'

// The hook runs effects, so it needs a DOM before React is imported.
before(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })

  // `navigator` is deliberately left alone: Node defines it as a getter-only
  // global, and nothing on this path reads it.
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node
  })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

function hit(id: string): SearchHit {
  return { id, url: `/${id}`, title: id }
}

interface Harness {
  state: () => { term: string; hits: SearchHit[]; status: string; setTerm: (t: string) => void; reset: () => void }
  act: (body: () => void | Promise<void>) => Promise<void>
  unmount: () => Promise<void>
}

/** Mounts `useSearch` in a real React root and exposes its latest value. */
async function mount(
  searcher: () => Parameters<typeof import('../src/hooks/useSearch.js').useSearch>[0]
): Promise<Harness> {
  const { act, createElement } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { useSearch } = await import('../src/hooks/useSearch.js')

  let latest: ReturnType<typeof useSearch> | undefined

  function Probe() {
    latest = useSearch(searcher())
    return null
  }

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  const run = async (body: () => void | Promise<void>) => {
    await act(async () => {
      await body()
    })
  }

  await run(() => {
    root.render(createElement(Probe))
  })

  return {
    state: () => latest as NonNullable<typeof latest>,
    act: run,
    unmount: () => run(() => root.unmount())
  }
}

/** Lets the awaited searcher and the resulting state update flush. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

test('starts idle with no hits', async () => {
  const harness = await mount(() => () => [])

  assert.equal(harness.state().term, '')
  assert.deepEqual(harness.state().hits, [])
  assert.equal(harness.state().status, 'idle')

  await harness.unmount()
})

test('a query resolves to hits and reports ready', async () => {
  const harness = await mount(() => () => [hit('a')])

  await harness.act(async () => {
    harness.state().setTerm('vector')
    await flush()
  })

  assert.deepEqual(
    harness.state().hits.map((item) => item.id),
    ['a']
  )
  assert.equal(harness.state().status, 'ready')

  await harness.unmount()
})

test('an empty query clears the results without calling the searcher', async () => {
  let calls = 0
  const harness = await mount(() => () => {
    calls++
    return [hit('a')]
  })

  await harness.act(async () => {
    harness.state().setTerm('vector')
    await flush()
  })
  assert.equal(calls, 1)

  await harness.act(async () => {
    harness.state().setTerm('   ')
    await flush()
  })

  assert.deepEqual(harness.state().hits, [])
  assert.equal(harness.state().status, 'idle')
  assert.equal(calls, 1)

  await harness.unmount()
})

test('a stale query cannot overwrite a newer one', async () => {
  const resolvers: Array<(hits: SearchHit[]) => void> = []
  const harness = await mount(
    () => () =>
      new Promise<SearchHit[]>((resolve) => {
        resolvers.push(resolve)
      })
  )

  await harness.act(async () => {
    harness.state().setTerm('slow')
    await flush()
  })
  await harness.act(async () => {
    harness.state().setTerm('fast')
    await flush()
  })

  assert.equal(resolvers.length, 2, 'both queries should have started')

  await harness.act(async () => {
    resolvers[1]([hit('fast')])
    await flush()
  })
  await harness.act(async () => {
    resolvers[0]([hit('slow')])
    await flush()
  })

  assert.deepEqual(
    harness.state().hits.map((item) => item.id),
    ['fast']
  )

  await harness.unmount()
})

test('a superseded query is aborted', async () => {
  const signals: AbortSignal[] = []
  const harness = await mount(() => (_term, signal) => {
    signals.push(signal)
    return []
  })

  await harness.act(async () => {
    harness.state().setTerm('one')
    await flush()
  })
  await harness.act(async () => {
    harness.state().setTerm('two')
    await flush()
  })

  assert.equal(signals.length, 2)
  assert.equal(signals[0].aborted, true, 'the first query should be aborted')
  assert.equal(signals[1].aborted, false)

  await harness.unmount()
})

test('a failing searcher reports an error and clears the hits', async () => {
  const original = console.error
  console.error = () => {}

  try {
    const harness = await mount(() => () => {
      throw new Error('boom')
    })

    await harness.act(async () => {
      harness.state().setTerm('vector')
      await flush()
    })

    assert.equal(harness.state().status, 'error')
    assert.deepEqual(harness.state().hits, [])

    await harness.unmount()
  } finally {
    console.error = original
  }
})

test('reset clears the term, the hits and the status', async () => {
  const harness = await mount(() => () => [hit('a')])

  await harness.act(async () => {
    harness.state().setTerm('vector')
    await flush()
  })

  await harness.act(async () => {
    harness.state().reset()
    await flush()
  })

  assert.equal(harness.state().term, '')
  assert.deepEqual(harness.state().hits, [])
  assert.equal(harness.state().status, 'idle')

  await harness.unmount()
})
