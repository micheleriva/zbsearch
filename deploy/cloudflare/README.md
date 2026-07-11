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
node packages/runtime-cloudflare/deploy/setup.mjs --deploy-dir deploy/cloudflare --init
node packages/runtime-cloudflare/deploy/teardown.mjs --deploy-dir deploy/cloudflare --dry-run
```

Config templates ship with the package:

`packages/runtime-cloudflare/deploy/templates/config.example.json`

Generated files in this directory (gitignored):

- `zbsearch.edge.config.json`
- `wrangler.toml`
- `.env`

## Manual deploy

```bash
pnpm --filter @zbsearch/edge-core build
wrangler deploy --config deploy/cloudflare/wrangler.toml
```

## Bulk import (example)

```bash
pnpm --filter @zbsearch/edge-index-builder build
source deploy/cloudflare/.env
bash deploy/cloudflare/ingest-unicorns.sh
```

Or run the CLI directly:

```bash
node packages/edge-index-builder/dist/cli.js import unicorns ./data.json \
  --create --name unicorns --schema-file ./schema.json
```
