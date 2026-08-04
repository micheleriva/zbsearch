# VitePress sandbox

A VitePress site wired to the local [`@zbsearch/plugin-vitepress`](../../packages/plugin-vitepress).

It is not documentation for anything real. It exists because search only works when indexing, bundling and
the browser all agree, and the cheapest way to catch a disagreement is to run a genuine build.

The content mirrors the Docusaurus and Starlight sandboxes, so the same queries are expected to behave the
same way across all three integrations.

## Running it

```sh
pnpm --filter @zbsearch/plugin-vitepress build
pnpm start   # http://localhost:3230
```

Rebuild the plugin after changing its Node half; the theme half is compiled by Vite, so it hot-reloads.

## Testing it

```sh
pnpm test        # the suite against both the dev server and a production build
pnpm test:prod   # production build only, on port 3231
pnpm test:dev    # dev server only, on port 3230
```
