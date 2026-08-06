import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchHit, Searcher } from '@zbsearch/searchbox-core'

export type SearchStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface SearchState {
  term: string
  setTerm: (term: string) => void
  hits: SearchHit[]
  status: SearchStatus
  reset: () => void
}

export function useSearch(searcher: Searcher, debounceMs = 0): SearchState {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')

  const searcherRef = useRef(searcher)
  searcherRef.current = searcher

  const requestRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    requestRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setTerm('')
    setHits([])
    setStatus('idle')
  }, [])

  useEffect(() => {
    const trimmed = term.trim()

    if (trimmed === '') {
      requestRef.current += 1
      controllerRef.current = null
      setHits([])
      setStatus('idle')
      return
    }

    const request = ++requestRef.current
    const controller = new AbortController()
    controllerRef.current = controller

    setStatus('loading')

    const run = async () => {
      try {
        const result = await searcherRef.current(trimmed, controller.signal)

        if (request !== requestRef.current) {
          return
        }

        setHits(result)
        setStatus('ready')
      } catch (error) {
        if (request !== requestRef.current || controller.signal.aborted) {
          return
        }

        console.error('[zbsearch] search failed', error)
        setHits([])
        setStatus('error')
      }
    }

    if (debounceMs <= 0) {
      void run()
      return () => controller.abort()
    }

    const timer = setTimeout(run, debounceMs)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [term, debounceMs])

  useEffect(() => () => controllerRef.current?.abort(), [])
  return { term, setTerm, hits, status, reset }
}
