'use client'

import { createIndexLoader, createSearcher, DEFAULT_BOOST, type SearchIndexPayload } from '@zbsearch/docs-index'
import { SearchBox } from '@zbsearch/searchbox-react'
import '@zbsearch/searchbox-react/styles.css'
import type { SharedProps } from 'fumadocs-ui/contexts/search'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect } from 'react'
import { searchIndexRoute } from '@/lib/shared'

const loadIndex = createIndexLoader(async () => {
  const response = await fetch(searchIndexRoute)

  if (!response.ok) {
    throw new Error(`[zbsearch] could not load ${searchIndexRoute}: ${response.status}`)
  }

  return (await response.json()) as SearchIndexPayload
})

const searcher = createSearcher(loadIndex, {
  boost: DEFAULT_BOOST,
  maxResults: 12,
  tolerance: 1,
  threshold: 0,
  snippetLength: 140
})

function prefetch() {
  void loadIndex().catch(() => undefined)
}

const TRIGGER_SELECTOR = '[data-search], [data-search-full]'

export default function SearchDialog({ open, onOpenChange }: SharedProps) {
  const router = useRouter()

  useEffect(() => {
    const onIntent = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(TRIGGER_SELECTOR)) prefetch()
    }

    document.addEventListener('pointerover', onIntent, { passive: true })
    document.addEventListener('focusin', onIntent)

    return () => {
      document.removeEventListener('pointerover', onIntent)
      document.removeEventListener('focusin', onIntent)
    }
  }, [])

  useEffect(() => {
    if (open) prefetch()
  }, [open])

  const onClose = useCallback(() => onOpenChange(false), [onOpenChange])
  const onNavigate = useCallback((url: string) => router.push(url), [router])

  return <SearchBox open={open} onClose={onClose} searcher={searcher} onNavigate={onNavigate} />
}
