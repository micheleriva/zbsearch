#!/usr/bin/env bash
# Ingest sample products into ZBSearch Edge and run search queries.
#
# Usage:
#   export WORKER_URL="https://zbsearch-edge.zbsearch.workers.dev"
#   export API_KEY="xyz"
#   ./deploy/cloudflare/demo-ingest.sh
#
# Optional:
#   INDEX_ID=products ./deploy/cloudflare/demo-ingest.sh
#   SEARCH_TERM="keyboard" ./deploy/cloudflare/demo-ingest.sh

set -euo pipefail

WORKER_URL="${WORKER_URL:?Set WORKER_URL (e.g. https://zbsearch-edge.zbsearch.workers.dev)}"
API_KEY="${API_KEY:?Set API_KEY}"
INDEX_ID="${INDEX_ID:-products}"
SEARCH_TERM="${SEARCH_TERM:-wireless}"

pretty() {
  if command -v jq >/dev/null 2>&1; then
    jq . 2>/dev/null || cat
  else
    python3 -m json.tool 2>/dev/null || cat
  fi
}

api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local args=(-sS -X "$method" "${WORKER_URL}${path}" -H "authorization: Bearer ${API_KEY}" -H 'content-type: application/json')
  if [[ -n "$data" ]]; then
    args+=(-d "$data")
  fi
  curl "${args[@]}"
}

echo "==> Health"
api GET /health | pretty

echo ""
echo "==> Ensure index '${INDEX_ID}' exists"
if ! api GET "/v1/indexes/${INDEX_ID}" | pretty; then
  echo "Index missing - creating..."
  api POST /v1/indexes "$(cat <<EOF
{
  "name": "${INDEX_ID}",
  "schema": {
    "title": "string",
    "description": "string",
    "price": "number",
    "category": "string"
  }
}
EOF
)" | pretty
fi

echo ""
echo "==> Batch ingest sample documents"
api POST "/v1/indexes/${INDEX_ID}/documents/batch" "$(cat <<'EOF'
{
  "operations": [
    {
      "op": "upsert",
      "id": "sku-1",
      "doc": {
        "title": "Wireless Headphones",
        "description": "Noise cancelling over-ear headphones with Bluetooth 5.3",
        "price": 99,
        "category": "audio"
      }
    },
    {
      "op": "upsert",
      "id": "sku-2",
      "doc": {
        "title": "Mechanical Keyboard",
        "description": "Hot-swappable RGB mechanical keyboard with Cherry MX switches",
        "price": 149,
        "category": "peripherals"
      }
    },
    {
      "op": "upsert",
      "id": "sku-3",
      "doc": {
        "title": "USB-C Hub",
        "description": "Seven port USB-C hub with HDMI and SD card reader",
        "price": 45,
        "category": "accessories"
      }
    },
    {
      "op": "upsert",
      "id": "sku-4",
      "doc": {
        "title": "Wireless Mouse",
        "description": "Ergonomic wireless mouse with silent clicks",
        "price": 29,
        "category": "peripherals"
      }
    }
  ]
}
EOF
)" | pretty

echo ""
echo "==> Rebuild index (writes become searchable)"
api POST "/v1/indexes/${INDEX_ID}/rebuild" | pretty

echo ""
echo "==> Search: term='${SEARCH_TERM}'"
api POST "/v1/indexes/${INDEX_ID}/search" "$(cat <<EOF
{
  "term": "${SEARCH_TERM}",
  "limit": 5
}
EOF
)" | pretty

echo ""
echo "==> Search: peripherals under \$100"
api POST "/v1/indexes/${INDEX_ID}/search" "$(cat <<'EOF'
{
  "term": "",
  "limit": 10,
  "where": {
    "category": { "eq": "peripherals" },
    "price": { "lte": 100 }
  }
}
EOF
)" | pretty

echo ""
echo "==> Index status"
api GET "/v1/indexes/${INDEX_ID}" | pretty

echo ""
echo "Done."
