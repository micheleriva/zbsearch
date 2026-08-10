# @zbsearch/searchbox-vue

The Vue 3 search dialog behind [ZBSearch](https://zbsearch.dev)'s VitePress integration, published on its own
so you can use it anywhere Vue runs.

It is the exact counterpart of [`@zbsearch/searchbox-react`](../searchbox-react): same markup, same
stylesheet, same behaviour. Both are thin framework layers over
[`@zbsearch/searchbox-core`](../searchbox-core).

The package is engine-agnostic. You give it a `searcher` function; it handles the dialog, the keyboard, the
grouping, the highlighting and the accessibility.

## Installation

```sh
npm install @zbsearch/searchbox-vue
```

## Usage

```vue
<script setup lang="ts">
import { SearchBox, SearchButton, useSearchHotkeys } from '@zbsearch/searchbox-vue'
import type { SearchHit } from '@zbsearch/searchbox-vue'
import '@zbsearch/searchbox-vue/styles.css'
import { ref } from 'vue'

const open = ref(false)

useSearchHotkeys(() => {
  open.value = true
})

async function searcher(term: string, signal: AbortSignal): Promise<SearchHit[]> {
  const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal })

  return response.json()
}
</script>

<template>
  <SearchButton @click="open = true" />
  <SearchBox :open="open" :searcher="searcher" @close="open = false" />
</template>
```

The dialog is fully controlled: it renders nothing until `open` is `true`, and emits `close` when the user
dismisses it or picks a result.

## Hits

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

## Props

| Prop                | Default                       | Description                                                                 |
| ------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| `open`              | —                             | Whether the dialog is visible                                               |
| `searcher`          | —                             | Resolves a query to hits                                                    |
| `onNavigate`        | full page load                | Opens a result; pass a router-aware function to keep client-side navigation |
| `labels`            | English defaults              | Copy overrides                                                              |
| `debounceMs`        | `0`                           | Milliseconds to wait after the last keystroke                               |
| `recentSearches`    | `true`                        | Remember and replay opened results                                          |
| `recentSearchesKey` | `'zbsearch:searchbox:recent'` | `localStorage` key backing that history                                     |

`SearchBox` emits `close`; `SearchButton` emits `click`.

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
| `SearchBox`                                                               | The dialog                                                       |
| `SearchButton`                                                            | Navbar trigger with a platform-aware shortcut badge              |
| `Highlighted`                                                             | Renders text with the parts matching a query wrapped in `<mark>` |
| `ZBSearchWordmark`                                                        | The ZBSearch lockup                                              |
| `useSearch`                                                               | The query state machine, if you want to build your own UI        |
| `useSearchHotkeys`, `useScrollLock`, `useIsMounted`, `useIsApplePlatform` | Behaviour composables                                            |

Everything framework-neutral — helpers, labels and types — is re-exported from
[`@zbsearch/searchbox-core`](../searchbox-core).

## License

Apache-2.0
