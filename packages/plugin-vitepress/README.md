# @zbsearch/plugin-vitepress

Makes [ZBSearch](https://zbsearch.dev) the search engine of a [VitePress](https://vitepress.dev) site.

The index is built from VitePress's own content loader, so routes honour `srcDir`, `cleanUrls` and `base`
exactly as the router does. The whole engine runs in the visitor's browser: no service, no API key, no query
leaving the page.

- Works identically in `vitepress dev` and `vitepress build`
- Section-level results, so a hit lands on the right heading rather than the top of a page
- The index and the engine load lazily, on the first sign the visitor wants to search
- ⌘K / Ctrl+K and `/` shortcuts, full keyboard navigation, recent searches
- Follows VitePress's own appearance toggle

## Installation

```sh
npm install @zbsearch/plugin-vitepress
```

Add the Vite plugin in `.vitepress/config.ts`:

```ts
import zbsearch from '@zbsearch/plugin-vitepress'
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'My docs',
  vite: {
    plugins: [zbsearch()]
  }
})
```

Then use the theme in `.vitepress/theme/index.ts`:

```ts
export { default } from '@zbsearch/plugin-vitepress/theme'
```

Both halves are required: the plugin builds the index, the theme renders the search box.

### Keeping your own theme

If you already extend the default theme, render the search box yourself instead:

```ts
import DefaultTheme from 'vitepress/theme'
import { ZBSearchBox } from '@zbsearch/plugin-vitepress/theme'
import { h } from 'vue'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'nav-bar-content-before': () => h(ZBSearchBox)
    })
}
```

## Options

```ts
zbsearch({
  excludeRoutes: ['/internal/**'],
  maxResults: 12
})
```

| Option              | Default                                                | Description                                        |
| ------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| `language`          | `'english'`                                            | Language used to tokenize and stem the index       |
| `excludeRoutes`     | `[]`                                                   | Routes to leave out, with `*` and `**` wildcards   |
| `categoryLabel`     | `'Docs'`                                               | Label shown next to a result's page title          |
| `indexDrafts`       | `false`                                                | Index pages marked `draft: true`                   |
| `maxResults`        | `12`                                                   | Maximum number of hits shown at once               |
| `boost`             | `{ title: 4, section: 3, hierarchy: 1.5, content: 1 }` | Per-property ranking weights                       |
| `tolerance`         | `1`                                                    | Edit distance tolerated per term                   |
| `threshold`         | `0`                                                    | Minimum share of query terms a document must match |
| `snippetLength`     | `140`                                                  | Maximum length of the excerpt under a hit          |
| `recentSearches`    | `true`                                                 | Remember and replay recently opened results        |
| `hotkeys`           | `true`                                                 | Bind the ⌘K / Ctrl+K and `/` shortcuts             |
| `searchButtonLabel` | `'Search'`                                             | Text of the navbar button                          |
| `placeholder`       | `'Search documentation…'`                              | Placeholder of the search input                    |
| `labels`            | `{}`                                                   | Copy overrides for the dialog                      |

A page is left out of the index when its front matter sets `search: false`, and landing pages
(`layout: home`) are skipped because they are navigation rather than prose.

## How it works

The plugin serves `/zbsearch-index.json`. In dev it is a middleware that rebuilds on every request, so an
edit shows up in search on reload; in a production build the same payload is emitted as a static asset.

Only `title`, `section`, `hierarchy` and `content` are tokenized. Permalinks and category labels travel with
each record but never reach the inverted index.

The search box fetches the index the first time a visitor shows intent to search, so neither it nor ZBSearch
itself weighs on the initial page load.

## Styling

Every colour, radius and font is a `--zbs-*` custom property:

```css
:root {
  --zbs-accent: #0aa;
  --zbs-radius: 8px;
}
```

VitePress signals dark mode with a `dark` class while the search box reads `data-theme`, so the theme
component mirrors one onto the other. `data-theme` is otherwise unused by VitePress.

## Development

The `sandboxes/vitepress` site in this repository is a real VitePress site wired to the local plugin.

```sh
pnpm --filter @zbsearch/plugin-vitepress build
pnpm --filter @zbsearch/sandbox-vitepress start   # http://localhost:3230
pnpm --filter @zbsearch/sandbox-vitepress test    # end-to-end, dev server and production build
```

## License

Apache-2.0
