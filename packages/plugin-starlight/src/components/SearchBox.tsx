import { createIndexLoader, createSearcher, type SearchIndexPayload } from '@zbsearch/docs-index'
import { SearchBox as Dialog, SearchButton, useSearchHotkeys } from '@zbsearch/searchbox-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { VirtualOptions } from '../options.js'

export interface StarlightSearchProps {
  options: VirtualOptions
  indexUrl: string
}

export default function StarlightSearch({ options, indexUrl }: StarlightSearchProps) {
  const { runtime } = options
  const [open, setOpen] = useState(false)

  const loaderRef = useRef<ReturnType<typeof createIndexLoader> | null>(null)

  loaderRef.current ??= createIndexLoader(async () => {
    const response = await fetch(indexUrl)

    if (!response.ok) {
      throw new Error(`[zbsearch] could not load ${indexUrl}: ${response.status}`)
    }

    return (await response.json()) as SearchIndexPayload
  })

  const loadIndex = loaderRef.current

  const searcher = useMemo(
    () =>
      createSearcher(loadIndex, {
        boost: runtime.boost,
        maxResults: runtime.maxResults,
        tolerance: runtime.tolerance,
        threshold: runtime.threshold,
        snippetLength: runtime.snippetLength
      }),
    [loadIndex, runtime]
  )

  const openDialog = useCallback(() => setOpen(true), [])
  const closeDialog = useCallback(() => setOpen(false), [])

  const prefetch = useCallback(() => {
    void loadIndex().catch(() => undefined)
  }, [loadIndex])

  useSearchHotkeys(openDialog, runtime.hotkeys)

  return (
    <div className="zbs-starlight-search" onMouseEnter={prefetch} onFocus={prefetch}>
      <SearchButton onClick={openDialog} label={runtime.searchButtonLabel} />

      <Dialog
        open={open}
        onClose={closeDialog}
        searcher={searcher}
        labels={runtime.labels}
        recentSearches={runtime.recentSearches}
      />
    </div>
  )
}
