import { useHistory } from '@docusaurus/router'
import { usePluginData } from '@docusaurus/useGlobalData'
import { SearchBox, SearchButton, useSearchHotkeys } from '@zbsearch/searchbox-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { createDocusaurusIndexLoader, createSearcher } from '../../client/index.js'
import { PLUGIN_NAME, type ZBSearchGlobalData } from '../../shared/index.js'
import '@zbsearch/searchbox-react/styles.css'
import './navbar.css'

export default function SearchBar() {
  const data = usePluginData(PLUGIN_NAME) as ZBSearchGlobalData | undefined
  const history = useHistory()
  const [open, setOpen] = useState(false)

  const loaderRef = useRef<ReturnType<typeof createDocusaurusIndexLoader> | null>(null)
  loaderRef.current ??= createDocusaurusIndexLoader()
  const loadIndex = loaderRef.current

  const searcher = useMemo(
    () =>
      createSearcher(loadIndex, {
        boost: data?.boost ?? { title: 4, section: 3, hierarchy: 1.5, content: 1 },
        maxResults: data?.maxResults ?? 12,
        tolerance: data?.tolerance ?? 1,
        threshold: data?.threshold ?? 0,
        snippetLength: data?.snippetLength ?? 140
      }),
    [loadIndex, data]
  )

  const openDialog = useCallback(() => setOpen(true), [])
  const closeDialog = useCallback(() => setOpen(false), [])

  const prefetch = useCallback(() => {
    void loadIndex().catch(() => undefined)
  }, [loadIndex])

  useSearchHotkeys(openDialog, data?.hotkeys !== false)

  const navigate = useCallback((url: string) => history.push(url), [history])

  return (
    <div className="zbs-navbar-search" onMouseEnter={prefetch} onFocus={prefetch}>
      <SearchButton onClick={openDialog} label={data?.searchButtonLabel ?? 'Search'} />
      <SearchBox
        open={open}
        onClose={closeDialog}
        searcher={searcher}
        onNavigate={navigate}
        labels={data?.labels}
        recentSearches={data?.recentSearches !== false}
      />
    </div>
  )
}
