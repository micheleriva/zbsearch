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

Site search is powered by **ZBSearch** via Fumadocs' built-in search API. The monorepo overrides `fumadocs-core`'s `@orama/orama` dependency to the local `zbsearch` package (see `pnpm-workspace.yaml`), so Fumadocs uses ZBSearch instead of Orama.

## Content

Documentation lives in `content/docs/zbsearch/` and is adapted from the official Orama JS docs.
