# @zbsearch/plugin-starlight

Makes [ZBSearch](https://zbsearch.dev) the search engine of an [Astro Starlight](https://starlight.astro.build)
site, in place of Pagefind.

The plugin builds the index from Starlight's own content collection, so slugs, drafts and front matter come
from Starlight rather than from a second interpretation of your files. The whole engine runs in the
visitor's browser: no service, no API key, no query leaving the page.

- Works identically in `astro dev` and `astro build`
- Section-level results, so a hit lands on the right heading rather than the top of a page
- The index and the engine load lazily, on the first sign the visitor wants to search
- ⌘K / Ctrl+K and `/` shortcuts, full keyboard navigation, recent searches
- Follows the Starlight theme switcher, including `auto`

## Installation

The search box is a React island, so the site needs Astro's React renderer:

```sh
npm install @zbsearch/plugin-starlight @astrojs/react react react-dom
```

Then add the plugin to Starlight:

```js
import starlight from '@astrojs/starlight'
import zbsearch from '@zbsearch/plugin-starlight'
import { defineConfig } from 'astro/config'

export default defineConfig({
  integrations: [
    starlight({
      title: 'My docs',
      plugins: [zbsearch()]
    })
  ]
})
```

The plugin registers `@astrojs/react` itself if the site has not already, disables Pagefind, and takes over
Starlight's `Search` component.

## Options

```js
zbsearch({
  excludeRoutes: ['/internal/**'],
  maxResults: 12
})
```

| Option | Default | Description |
| --- | --- | --- |
| `language` | `'english'` | Language used to tokenize and stem the index |
| `excludeRoutes` | `[]` | Routes to leave out, with `*` and `**` wildcards |
| `categoryLabel` | `'Docs'` | Label shown next to a result's page title |
| `indexDrafts` | `false` | Index pages marked `draft: true` |
| `maxResults` | `12` | Maximum number of hits shown at once |
| `boost` | `{ title: 4, section: 3, hierarchy: 1.5, content: 1 }` | Per-property ranking weights |
| `tolerance` | `1` | Edit distance tolerated per term |
| `threshold` | `0` | Minimum share of query terms a document must match |
| `snippetLength` | `140` | Maximum length of the excerpt under a hit |
| `recentSearches` | `true` | Remember and replay recently opened results |
| `hotkeys` | `true` | Bind the ⌘K / Ctrl+K and `/` shortcuts |
| `searchButtonLabel` | `'Search'` | Text of the header button |
| `placeholder` | `'Search documentation…'` | Placeholder of the search input |
| `labels` | `{}` | Copy overrides for the dialog |

## How it works

The plugin injects a prerendered route at `/zbsearch-index.json`. That endpoint reads the `docs` collection
with `getCollection`, splits every page into one record per heading, builds a ZBSearch index and serializes
it.

Because it is a real Astro route, the dev server answers it on demand and the production build writes it to
`dist/` as a static file. The search box fetches it the first time a visitor reaches for search, so neither
the index nor ZBSearch itself weighs on the initial page load.

Only `title`, `section`, `hierarchy` and `content` are tokenized. Permalinks and category labels travel with
each record but never reach the inverted index.

## Styling

Every colour, radius and font is a `--zbs-*` custom property, so a site can re-theme the widget from its own
CSS without overriding a single rule:

```css
:root {
  --zbs-accent: #0aa;
  --zbs-radius: 8px;
}
```

## Development

The `sandboxes/starlight` site in this repository is a real Starlight site wired to the local plugin.

```sh
pnpm --filter @zbsearch/sandbox-starlight start   # http://localhost:3220
pnpm --filter @zbsearch/sandbox-starlight test    # end-to-end, dev server and production build
```

## License

Apache-2.0
