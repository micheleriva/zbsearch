# @zbsearch/searchbox-core

The framework-neutral half of the [ZBSearch](https://zbsearch.dev) search boxes: the types they agree on, the
text and result helpers they share, and the stylesheet they both render.

[`@zbsearch/searchbox-react`](../searchbox-react) and [`@zbsearch/searchbox-vue`](../searchbox-vue) are thin
layers over this package, which is why the two behave identically. Depend on it directly when you are
building a search UI for another framework, or none at all.

It has no framework dependency of any kind.

## Installation

```sh
npm install @zbsearch/searchbox-core
```

## Types

```ts
interface SearchHit {
  id: string
  url: string
  title: string
  section?: string
  snippet?: string
  breadcrumb?: string[]
  category?: string
}

type Searcher = (term: string, signal: AbortSignal) => Promise<SearchHit[]> | SearchHit[]
```

## Helpers

```ts
import { groupHits, highlight, snippetAround, wrapIndex } from '@zbsearch/searchbox-core'

groupHits(hits) // buckets hits by page, preserving relevance order
highlight(text, query) // alternating matched/unmatched segments
snippetAround(text, query, 160) // an excerpt centred on the first match
wrapIndex(current, +1, length) // arrow-key movement that wraps at both ends
```

`highlight` returns segments rather than HTML, so a framework can render matches without
`dangerouslySetInnerHTML` or `v-html`. It is built on
[`@zbsearch/highlight`](../highlight).

### Recent searches

```ts
import { addRecentSearch, readRecentSearches, removeRecentSearch } from '@zbsearch/searchbox-core'
```

All three take a storage object, so they work with `localStorage`, `sessionStorage`, or a stub in tests. A
corrupt or unavailable store degrades to an empty list rather than throwing.

### Labels

`defaultLabels` holds the English copy; `resolveLabels(overrides)` merges a partial set over it.

## Stylesheet

```ts
import '@zbsearch/searchbox-core/styles.css'
```

Every value is a `--zbs-*` custom property. Light is the default, dark follows the OS colour scheme, and an
explicit `data-theme` attribute on any ancestor wins over both.

The three cases are kept mutually exclusive rather than layered by source order, because CSS minifiers merge
rules that share declarations and move them to the position of the first — which silently reorders a cascade
that only order kept correct.

## License

Apache-2.0
