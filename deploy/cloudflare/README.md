# Cloudflare deploy (monorepo)

This directory holds **generated** deploy artifacts for developing ZBSearch Edge inside the monorepo.

End users install from npm and do not need this folder:

```bash
npm install @zbsearch/runtime-cloudflare wrangler
npx zbsearch-edge-setup --init
```

See [`packages/runtime-cloudflare/deploy/README.md`](../../packages/runtime-cloudflare/deploy/README.md) for the npm quick start.

## Monorepo commands

From the repository root:

```bash
wrangler login
pnpm install
pnpm setup:edge -- --init
pnpm teardown:edge -- --dry-run
```

Config templates ship with the package:

`packages/runtime-cloudflare/deploy/templates/config.example.json`

Generated files in this directory (gitignored):

- `zbsearch.edge.config.json`
- `wrangler.toml`
- `.env`

## Manual deploy

```bash
pnpm deploy:edge
```
