# @zbsearch/searchbox-react

The React search UI behind [ZBSearch](https://zbsearch.dev) integrations: a command-palette dialog, a navbar
trigger button, and the pieces they are made of.

The package is deliberately engine-agnostic. It renders whatever a `searcher` function resolves to, which
means it can front a local [ZBSearch](https://zbsearch.dev) index, a remote API, or anything else.

## Installation

```sh
npm install @zbsearch/searchbox-react
```

## Usage

```tsx
import { SearchBox, SearchButton, useSearchHotkeys } from '@zbsearch/searchbox-react'
import '@zbsearch/searchbox-react/styles.css'
import { useCallback, useState } from 'react'

export function Search() {
  const [open, setOpen] = useState(false)

  useSearchHotkeys(() => setOpen(true))

  const searcher = useCallback(async (term: string, signal: AbortSignal) => {
    const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal })

    return response.json() as Promise<SearchHit[]>
  }, [])

  return (
    <>
      <SearchButton onClick={() => setOpen(true)} />
      <SearchBox open={open} onClose={() => setOpen(false)} searcher={searcher} />
    </>
  )
}
```

### Hits

```ts
interface SearchHit {
  id: string // unique across the result set
  url: string // where the hit points
  title: string // title of the page it belongs to
  section?: string // heading it was extracted from
  snippet?: string // excerpt of the matching content
  breadcrumb?: string[] // ancestor headings, outermost first
  category?: string // label such as 'Docs', used to tag groups
}
```

Hits that share a page, ignoring the fragment, are grouped under one heading automatically.

## What it handles

- **Keyboard**: ⌘K / Ctrl+K and `/` open the dialog, arrows move the selection with wrapping, `Home`/`End`
  jump to either end, `Enter` opens, `Escape` closes, and `Tab` stays trapped inside.
- **Accessibility**: the ARIA 1.2 combobox pattern, focus restored to whatever was focused before opening,
  and a scroll lock that compensates for the scrollbar so the page does not shift.
- **Staleness**: every superseded query is aborted, so a slow searcher can never overwrite a newer result.
- **Recent searches**: opened results are remembered in `localStorage` and replayed on the start screen.
- **Modifier clicks**: rows are real links, so ⌘-click opens a result in a new tab.

## Theming

Every value is a `--zbs-*` custom property. Light is the default, dark follows the OS colour scheme, and an
explicit `data-theme` attribute on any ancestor wins over both.

```css
:root {
  --zbs-accent: #0aa;
  --zbs-radius: 8px;
  --zbs-font-family: 'Inter', sans-serif;
}
```

## Exports

| Export                                                                    | Description                                                      |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `SearchBox`                                                               | The dialog. Fully controlled through `open` and `onClose`        |
| `SearchButton`                                                            | Navbar trigger with a platform-aware shortcut badge              |
| `Highlighted`                                                             | Renders text with the parts matching a query wrapped in `<mark>` |
| `ZBSearchWordmark`, `ZBSearchLogo`                                        | The ZBSearch lockup and its mark                                 |
| `useSearch`                                                               | The query state machine, if you want to build your own UI        |
| `useSearchHotkeys`, `useScrollLock`, `useIsMounted`, `useIsApplePlatform` | Behaviour hooks                                                  |
| `highlight`, `snippetAround`                                              | Text helpers, built on [`@zbsearch/highlight`](../highlight)     |
| `groupHits`, `flattenGroups`, `wrapIndex`                                 | Result helpers                                                   |
| `readRecentSearches`, `addRecentSearch`, `removeRecentSearch`             | History helpers                                                  |

## License

Apache-2.0
