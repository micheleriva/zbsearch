# Cloudflare R2 + Workers deploy for ZBSearch Edge

## Prerequisites

- Cloudflare account
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) installed
- R2 bucket created (`zbsearch-edge` or update `wrangler.toml`)

## Setup

```bash
cd deploy/cloudflare
cp .env.example .env
# Fill in credentials for rebuild CLI (S3-compatible R2 API)

# Create R2 bucket (once)
wrangler r2 bucket create zbsearch-edge

# Optional auth
wrangler secret put API_KEY

# Deploy Worker
pnpm deploy:edge
```

## Rebuild options

**Small indexes (dev/demo):** the Worker's cron trigger rebuilds in-place when `pendingOps >= REBUILD_THRESHOLD_OPS`.

**Production:** set `BUILDER_WEBHOOK_URL` to trigger GitHub Actions or a Docker builder:

```bash
wrangler secret put BUILDER_WEBHOOK_URL
```

Then run rebuilds with:

```bash
pnpm --filter @zbsearch/edge-index-builder rebuild --all
```

## API

After deploy, Wrangler prints your Worker URL.

```bash
# Create index
curl -X POST "$WORKER_URL/v1/indexes" \
  -H 'content-type: application/json' \
  -d '{"name":"products","schema":{"title":"string","price":"number"}}'

# Insert document
curl -X PUT "$WORKER_URL/v1/indexes/products/documents/sku-1" \
  -H 'content-type: application/json' \
  -d '{"title":"Headphones","price":99}'

# Rebuild
curl -X POST "$WORKER_URL/v1/indexes/products/rebuild"

# Search
curl -X POST "$WORKER_URL/v1/indexes/products/search" \
  -H 'content-type: application/json' \
  -d '{"term":"headphones"}'
```

## Environment variables (builder CLI)

| Variable | Description |
|---|---|
| `R2_BUCKET` | Bucket name |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_ENDPOINT` | `https://<account_id>.r2.cloudflarestorage.com` |
