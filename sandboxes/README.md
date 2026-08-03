# Sandboxes

Real applications wired to the local packages, used to develop and end-to-end test integrations that only
make sense inside a framework.

They are workspace members, so they always resolve the packages from `packages/` rather than from npm.

| Sandbox | Exercises |
| --- | --- |
| [`docusaurus`](./docusaurus) | [`@zbsearch/plugin-docusaurus`](../packages/plugin-docusaurus) and [`@zbsearch/searchbox-react`](../packages/searchbox-react) |

## Running one

```sh
pnpm --filter @zbsearch/plugin-docusaurus build
pnpm --filter @zbsearch/sandbox-docusaurus start
```

## Testing one

The suites drive a browser, so they need Chromium; `pretest` installs it if it is missing.

```sh
pnpm --filter @zbsearch/sandbox-docusaurus test        # dev server and production build
pnpm --filter @zbsearch/sandbox-docusaurus test:prod   # production build only
pnpm --filter @zbsearch/sandbox-docusaurus test:dev    # dev server only
```
