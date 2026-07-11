#!/usr/bin/env bash
# Bulk-import unicorn startup JSON into ZBSearch Edge via local snapshot build + R2 upload.
set -euo pipefail

WORKER_URL="${WORKER_URL:?Set WORKER_URL}"
API_KEY="${API_KEY:?Set API_KEY}"
DATA_FILE="${DATA_FILE:-/Users/michele/Downloads/list_of_unicorn_startup_companies.json}"
OLD_INDEX="${OLD_INDEX:-products}"
NEW_INDEX="${NEW_INDEX:-unicorns}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/deploy/cloudflare/.env}"
SCHEMA_FILE="${SCHEMA_FILE:-$REPO_ROOT/deploy/cloudflare/unicorns.schema.json}"

auth=(-H "authorization: Bearer ${API_KEY}" -H 'content-type: application/json')

api() {
  local method="$1" path="$2" data="${3:-}"
  local args=(-sS --retry 3 --retry-delay 2 --max-time 60 -X "$method" "${WORKER_URL}${path}" "${auth[@]}")
  [[ -n "$data" ]] && args+=(-d "$data")
  curl "${args[@]}"
}

echo "==> Delete old indexes"
api DELETE "/v1/indexes/${OLD_INDEX}" || true
api DELETE "/v1/indexes/${NEW_INDEX}" || true

echo "==> Write schema file"
cat >"$SCHEMA_FILE" <<'EOF'
{
  "company_name": "string",
  "valuation_usd_billion": "string",
  "valuation_date": "string",
  "industry": "string",
  "operating_countries": "string",
  "founders": "string"
}
EOF

echo "==> Bulk import via CLI (builds snapshot locally, uploads to R2)"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
node "$REPO_ROOT/packages/edge-index-builder/dist/cli.js" import "$NEW_INDEX" "$DATA_FILE" \
  --create \
  --name "$NEW_INDEX" \
  --schema-file "$SCHEMA_FILE" \
  --language english

echo "==> Index status"
api GET "/v1/indexes/${NEW_INDEX}" | python3 -m json.tool

echo "==> Sample search"
api POST "/v1/indexes/${NEW_INDEX}/search" '{"term":"OpenAI","limit":5}' | python3 -m json.tool

echo "Done."
