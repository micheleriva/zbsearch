# Docusaurus sandbox

A Docusaurus site wired to the local [`@zbsearch/plugin-docusaurus`](../../packages/plugin-docusaurus).

It is not documentation for anything real. It exists because search only works when indexing, bundling and
the browser all agree, and the cheapest way to catch a disagreement is to run a genuine build.

The content is chosen to exercise the indexer: front matter titles and inferred ones, nested headings,
explicit `{#anchors}`, fenced code, MDX imports, admonitions, tables, a blog post, a standalone MDX page, a
React page that must be skipped, and a directory excluded through `excludeRoutes`.

## Running it

```sh
pnpm --filter @zbsearch/plugin-docusaurus build
pnpm start   # http://localhost:3210
```

Rebuild the plugin after changing it; the dev server picks up the new `lib` on restart.

## Testing it

```sh
pnpm test        # the suite against both the dev server and a production build
pnpm test:prod   # production build only, on port 3211
pnpm test:dev    # dev server only, on port 3210
```

The two configurations run one after the other rather than together: `docusaurus build` and
`docusaurus start` share the `.docusaurus` directory, so starting both at once makes them race over the
generated index.
