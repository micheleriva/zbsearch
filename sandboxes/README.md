# Sandboxes

Real applications wired to the local packages, used to develop and end-to-end test integrations that only
make sense inside a framework.

They are workspace members, so they always resolve the packages from `packages/` rather than from npm.

| Sandbox | Exercises |
| --- | --- |
| [`docusaurus`](./docusaurus) | [`@zbsearch/plugin-docusaurus`](../packages/plugin-docusaurus) |
| [`starlight`](./starlight) | [`@zbsearch/plugin-starlight`](../packages/plugin-starlight) |
| [`vitepress`](./vitepress) | [`@zbsearch/plugin-vitepress`](../packages/plugin-vitepress) |

All three also exercise [`@zbsearch/docs-index`](../packages/docs-index),
[`@zbsearch/searchbox-core`](../packages/searchbox-core) and
[`@zbsearch/highlight`](../packages/highlight) — the React sandboxes through
[`@zbsearch/searchbox-react`](../packages/searchbox-react), the VitePress one through
[`@zbsearch/searchbox-vue`](../packages/searchbox-vue).

## Running one

```sh
pnpm --filter @zbsearch/plugin-docusaurus build
pnpm --filter @zbsearch/sandbox-docusaurus start   # http://localhost:3210
pnpm --filter @zbsearch/sandbox-starlight start    # http://localhost:3220
pnpm --filter @zbsearch/sandbox-vitepress start    # http://localhost:3230
```

## Testing one

The suites drive a browser, so they need Chromium; `pretest` installs it if it is missing.

```sh
pnpm --filter @zbsearch/sandbox-docusaurus test   # dev server and production build
pnpm --filter @zbsearch/sandbox-starlight test    # dev server and production build
pnpm --filter @zbsearch/sandbox-vitepress test   # dev server and production build

# Each sandbox also exposes test:prod and test:dev to run one half on its own.
```
