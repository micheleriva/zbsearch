# @zbsearch/plugin-docusaurus

Makes [ZBSearch](https://zbsearch.dev) the search engine of a [Docusaurus](https://docusaurus.io) site.

The plugin indexes your docs, blog posts and MDX pages at compile time, serializes the index next to the
build output, and replaces `@theme/SearchBar` with a search dialog built on
[`@zbsearch/searchbox-react`](../searchbox-react). Nothing is sent anywhere: the whole engine runs in the
visitor's browser.

- Works identically in `docusaurus start` and `docusaurus build`
- Section-level results, so a hit lands on the right heading rather than the top of a page
- The index and the engine load lazily, on the first sign the visitor wants to search
- ⌘K / Ctrl+K and `/` shortcuts, full keyboard navigation, recent searches
- Light and dark themes out of the box

## Installation

```sh
npm install @zbsearch/plugin-docusaurus
```

Then add it to `docusaurus.config.ts`:

```ts
export default {
  plugins: ['@zbsearch/plugin-docusaurus']
}
```

That is the whole setup. Docusaurus renders `@theme/SearchBar` in the navbar of every page, and this plugin
supplies it.

## Options

```ts
import type { ZBSearchDocusaurusOptions } from '@zbsearch/plugin-docusaurus'

const options: ZBSearchDocusaurusOptions = {
  excludeRoutes: ['/docs/internal/**'],
  maxResults: 12
}

export default {
  plugins: [['@zbsearch/plugin-docusaurus', options]]
}
```

| Option                 | Default                                                | Description                                          |
| ---------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| `language`             | `'english'`                                            | Language used to tokenize and stem the index         |
| `docs`                 | `true`                                                 | Index every docs plugin instance                     |
| `blog`                 | `true`                                                 | Index every blog plugin instance                     |
| `pages`                | `true`                                                 | Index standalone MDX pages                           |
| `indexAllDocsVersions` | `false`                                                | Index older docs versions as well as the current one |
| `excludeRoutes`        | `[]`                                                   | Routes to leave out, with `*` and `**` wildcards     |
| `categoryLabels`       | `{ docs: 'Docs', blog: 'Blog', pages: 'Pages' }`       | Labels used to tag results                           |
| `maxResults`           | `12`                                                   | Maximum number of hits shown at once                 |
| `boost`                | `{ title: 4, section: 3, hierarchy: 1.5, content: 1 }` | Per-property ranking weights                         |
| `tolerance`            | `1`                                                    | Edit distance tolerated per term                     |
| `threshold`            | `0`                                                    | Minimum share of query terms a document must match   |
| `snippetLength`        | `140`                                                  | Maximum length of the excerpt under a hit            |
| `recentSearches`       | `true`                                                 | Remember and replay recently opened results          |
| `hotkeys`              | `true`                                                 | Bind the ⌘K / Ctrl+K and `/` shortcuts               |
| `searchButtonLabel`    | `'Search'`                                             | Text of the navbar button                            |
| `placeholder`          | `'Search documentation…'`                              | Placeholder of the search input                      |
| `labels`               | `{}`                                                   | Copy overrides for the dialog                        |

## How it works

Indexing runs in `allContentLoaded`, the one hook that behaves the same in the dev server and in a
production build, so there is no second code path to keep in sync.

Each page is split into one record per heading. A record carries the page title, the heading, the ancestor
chain and the prose beneath it; only those four properties are tokenized, which keeps permalinks and
category labels out of the inverted index. Fenced code, front matter, JSX and MDX imports are stripped
before indexing.

The result is serialized with ZBSearch's `save()` and written to `.docusaurus/zbsearch-index/`. The theme
imports it through a static `import()`, so webpack emits it as its own chunk and downloads it, along with
ZBSearch itself, only when the visitor first reaches for search.

## Styling

Every colour, radius and font is a `--zbs-*` custom property, so a site can re-theme the widget without
overriding a single rule:

```css
:root {
  --zbs-accent: #0aa;
  --zbs-radius: 8px;
}
```

## Development

The `sandboxes/docusaurus` site in this repository is a real Docusaurus site wired to the local plugin.

```sh
pnpm --filter @zbsearch/plugin-docusaurus build
pnpm --filter @zbsearch/sandbox-docusaurus start   # http://localhost:3210
pnpm --filter @zbsearch/sandbox-docusaurus test    # end-to-end, dev server and production build
```

## License

Apache-2.0
