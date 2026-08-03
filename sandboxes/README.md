# Sandboxes

Real applications wired to the local packages, used to develop and end-to-end test integrations that only
make sense inside a framework.

They are workspace members, so they always resolve the packages from `packages/` rather than from npm.

| Sandbox | Exercises |
| --- | --- |
| [`docusaurus`](./docusaurus) | [`@zbsearch/plugin-docusaurus`](../packages/plugin-docusaurus) |
| [`starlight`](./starlight) | [`@zbsearch/plugin-starlight`](../packages/plugin-starlight) |

Both also exercise [`@zbsearch/docs-index`](../packages/docs-index),
[`@zbsearch/searchbox-react`](../packages/searchbox-react) and
[`@zbsearch/highlight`](../packages/highlight).

## Running one

```sh
pnpm --filter @zbsearch/plugin-docusaurus build
pnpm --filter @zbsearch/sandbox-docusaurus start   # http://localhost:3210
pnpm --filter @zbsearch/sandbox-starlight start    # http://localhost:3220
```

## Testing one

The suites drive a browser, so they need Chromium; `pretest` installs it if it is missing.

```sh
pnpm --filter @zbsearch/sandbox-docusaurus test   # dev server and production build
pnpm --filter @zbsearch/sandbox-starlight test    # dev server and production build

# Each sandbox also exposes test:prod and test:dev to run one half on its own.
```
