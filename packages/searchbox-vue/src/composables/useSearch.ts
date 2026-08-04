import type { SearchHit, Searcher } from '@zbsearch/searchbox-core'
import { onScopeDispose, type Ref, ref, shallowRef, watch } from 'vue'

export type SearchStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SearchState {
  term: Ref<string>
  hits: Ref<SearchHit[]>
  status: Ref<SearchStatus>
  reset: () => void
}

export function useSearch(searcher: () => Searcher, debounceMs = 0): SearchState {
  const term = ref('')
  const hits = shallowRef<SearchHit[]>([])
  const status = ref<SearchStatus>('idle')

  let request = 0
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const cancel = () => {
    clearTimeout(timer)
    controller?.abort()
    controller = null
  }

  const reset = () => {
    request += 1
    cancel()
    term.value = ''
    hits.value = []
    status.value = 'idle'
  }

  watch(term, (value) => {
    const trimmed = value.trim()

    cancel()

    if (trimmed === '') {
      request += 1
      hits.value = []
      status.value = 'idle'
      return
    }

    const current = ++request
    const ownController = new AbortController()

    controller = ownController
    status.value = 'loading'

    const run = async () => {
      try {
        const result = await searcher()(trimmed, ownController.signal)

        if (current !== request) {
          return
        }

        hits.value = result
        status.value = 'ready'
      } catch (error) {
        if (current !== request || ownController.signal.aborted) {
          return
        }

        console.error('[zbsearch] search failed', error)
        hits.value = []
        status.value = 'error'
      }
    }

    if (debounceMs <= 0) {
      void run()
      return
    }

    timer = setTimeout(run, debounceMs)
  })

  onScopeDispose(cancel)

  return { term, hits, status, reset }
}
