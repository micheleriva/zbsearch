# Starlight sandbox

An Astro Starlight site wired to the local [`@zbsearch/plugin-starlight`](../../packages/plugin-starlight).

It is not documentation for anything real. It exists because search only works when indexing, bundling and
the browser all agree, and the cheapest way to catch a disagreement is to run a genuine build.

The content is chosen to exercise the indexer: front matter titles and inferred ones, nested headings,
fenced code, MDX imports, admonitions, tables, a root index page, and a directory excluded through
`excludeRoutes`.

## Running it

```sh
pnpm start   # http://localhost:3220
```

The plugin ships TypeScript sources, so Astro picks up changes to it without a build step.

## Testing it

```sh
pnpm test        # the suite against both the dev server and a production build
pnpm test:prod   # production build only, on port 3221
pnpm test:dev    # dev server only, on port 3220
```

The two run one after the other rather than together: both would otherwise compete for the same `.astro`
cache directory.
