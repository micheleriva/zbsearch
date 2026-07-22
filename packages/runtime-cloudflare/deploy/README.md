# ZBSearch Edge on Cloudflare

Deploy ZBSearch Edge from npm - no monorepo clone required.

## Quick start

```bash
mkdir my-search-api && cd my-search-api
npm init -y
npm install @zbsearch/runtime-cloudflare wrangler
npx wrangler login
npx zbsearch-edge-setup --init
```

Or use a config file:

```bash
cp node_modules/@zbsearch/runtime-cloudflare/deploy/templates/config.example.json zbsearch.edge.config.json
# edit zbsearch.edge.config.json
npx zbsearch-edge-setup
```

## Commands

| Command | Purpose |
| --- | --- |
| `npx zbsearch-edge-setup` | Configure, provision, and deploy |
| `npx zbsearch-edge-teardown` | Remove Worker and R2 buckets |
| `npx zbsearch-edge-builder rebuild --all` | Rebuild indexes (from `@zbsearch/edge-index-builder`) |

## Generated files

In your project directory:

- `zbsearch.edge.config.json` - your settings (gitignore this; may contain secrets)
- `wrangler.toml` - generated Worker config
- `.env` - R2 credentials for rebuild CLI and teardown

## Teardown

```bash
npx zbsearch-edge-teardown --dry-run
npx zbsearch-edge-teardown --yes
```

## Packages

- `@zbsearch/runtime-cloudflare` - Worker runtime + setup/teardown CLIs
- `@zbsearch/edge-index-builder` - rebuild CLI for production indexes
- `@zbsearch/edge-core` - installed automatically as a dependency
