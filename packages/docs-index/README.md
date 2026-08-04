# @zbsearch/docs-index

The engine-facing half of the ZBSearch documentation integrations: it turns markdown into search records,
builds a [ZBSearch](https://zbsearch.dev) index from them, and queries that index in the browser.

It is the shared core behind [`@zbsearch/plugin-docusaurus`](../plugin-docusaurus) and
[`@zbsearch/plugin-starlight`](../plugin-starlight). Use it directly when you are wiring ZBSearch into a
framework neither of those covers.

## Installation

```sh
npm install @zbsearch/docs-index
```

## Building an index

```ts
import { buildIndex, parseMarkdown } from '@zbsearch/docs-index/node'
import { HIERARCHY_SEPARATOR, type SearchRecord } from '@zbsearch/docs-index'

const parsed = parseMarkdown(await readFile('docs/intro.md', 'utf8'))

const records: SearchRecord[] = parsed.sections.map((section) => ({
  title: parsed.title ?? 'Introduction',
  section: section.heading,
  hierarchy: ['Guides', 'Introduction', ...section.ancestors].join(HIERARCHY_SEPARATOR),
  content: section.content,
  url: section.anchor ? `/docs/intro#${section.anchor}` : '/docs/intro',
  category: 'Docs',
  path: section.ancestors.join(HIERARCHY_SEPARATOR)
}))

const payload = await buildIndex(records, 'english')
```

`parseMarkdown` splits a document into one section per heading. Front matter, fenced code, MDX imports and
JSX are removed first; anchors follow the same rules Docusaurus and Starlight use, including explicit
`{#custom-id}` syntax.

`buildIndex` returns a JSON-serializable payload. Only `title`, `section`, `hierarchy` and `content` are
tokenized — `url`, `category` and `path` ride along untouched and come back on every hit.

## Searching in the browser

```ts
import { createIndexLoader, createSearcher } from '@zbsearch/docs-index'

const loadIndex = createIndexLoader(async () => (await fetch('/zbsearch-index.json')).json())

const searcher = createSearcher(loadIndex, {
  boost: { title: 4, section: 3, hierarchy: 1.5, content: 1 },
  maxResults: 12,
  tolerance: 1,
  threshold: 0,
  snippetLength: 140
})
```

`createIndexLoader` fetches and rehydrates at most once per page session, sharing one promise between
concurrent callers and forgetting a failed attempt so the next one retries. ZBSearch itself is imported
dynamically, which keeps it out of the bundle until someone actually searches.

The resulting `searcher` is exactly the shape
[`@zbsearch/searchbox-react`](../searchbox-react) expects.

## Exports

| Entry point | Contents |
| --- | --- |
| `@zbsearch/docs-index` | Record shape, schema, defaults, and the browser-side loader and searcher |
| `@zbsearch/docs-index/node` | `parseMarkdown`, `stripInlineMarkup` and `buildIndex` |

## License

Apache-2.0
