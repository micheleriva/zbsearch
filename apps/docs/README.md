# ZBSearch Documentation

Documentation site for [ZBSearch](https://github.com/micheleriva/zbsearch), built with [Fumadocs](https://www.fumadocs.dev/).

## Development

From the monorepo root:

```sh
pnpm docs:dev
```

Or from this directory:

```sh
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Build

```sh
pnpm docs:build
```

## Search

Site search runs entirely in the browser on **ZBSearch**, the same way the Starlight, Docusaurus and VitePress plugins replace Pagefind, with no search API route.

- `lib/search-index.ts` turns every docs page (from Fumadocs' own `source`, so URLs, titles and the page tree are the real ones) into one record per heading and builds the index with `@zbsearch/docs-index`.
- `app/zbsearch-index.json/route.ts` serves the payload, prerendered at build time and answered on demand by `next dev`. Small indexes ship inline; past the inline limit the payload is a sentinel and `app/zbsearch-static/[...file]/route.ts` serves the sharded file set from `@zbsearch/static`, which the browser fetches lazily per query.
- `components/search/search-dialog.tsx` replaces Fumadocs' default dialog with `@zbsearch/searchbox-react`, themed from the site tokens in `app/global.css`. Fumadocs keeps its triggers and the ⌘K hotkey.

## Content

Documentation lives in `content/docs/zbsearch/` and is adapted from the official Orama JS docs.
