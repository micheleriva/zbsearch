#!/usr/bin/env bash
# Orchestrator for the HTTP load tests.
#
# Usage:
#   ./run.sh <corpus-size> [--via-api] [--local]
#
# Examples:
#   BASE_URL=https://worker.example.com API_KEY=secret ./run.sh 100000
#   ./run.sh 10000 --local --via-api        # wrangler dev on 127.0.0.1:8787
#
# Flow: generate corpus (if missing) -> ingest -> warm -> search + mixed
# scenarios, writing timestamped JSON summaries to results/.

set -euo pipefail
cd "$(dirname "$0")"

SIZE=""
VIA_API=0
LOCAL=0

for arg in "$@"; do
  case "$arg" in
    --via-api) VIA_API=1 ;;
    --local) LOCAL=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      if [[ "$arg" =~ ^[0-9]+$ ]] && [[ -z "$SIZE" ]]; then
        SIZE="$arg"
      else
        echo "run.sh: unknown argument: $arg" >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$SIZE" ]]; then
  echo "run.sh: missing corpus size (e.g. ./run.sh 100000)" >&2
  exit 1
fi

if [[ "$LOCAL" -eq 1 ]]; then
  export BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
  export API_KEY="${API_KEY:-dev-key}"
fi

MISSING=()
[[ -z "${BASE_URL:-}" ]] && MISSING+=("BASE_URL")
[[ -z "${API_KEY:-}" ]] && MISSING+=("API_KEY")
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "run.sh: missing required env vars: ${MISSING[*]}" >&2
  echo "  export BASE_URL=https://your-worker.workers.dev" >&2
  echo "  export API_KEY=<your api key>" >&2
  echo "  (or pass --local to target wrangler dev on http://127.0.0.1:8787)" >&2
  exit 1
fi

if ! command -v k6 >/dev/null 2>&1; then
  echo "run.sh: k6 is not installed (https://k6.io/docs/get-started/installation/)" >&2
  exit 1
fi

export INDEX_ID="${INDEX_ID:-loadtest}"
TS="$(date +%Y%m%d-%H%M%S)"
CORPUS="data/corpus-${SIZE}.jsonl"
mkdir -p data results

echo "==> target: ${BASE_URL} index=${INDEX_ID} run=${TS}"

if [[ ! -f "$CORPUS" ]]; then
  echo "==> generating corpus: ${CORPUS}"
  node generate-corpus.mjs --docs "$SIZE" --out "$CORPUS"
else
  echo "==> corpus exists, skipping generation: ${CORPUS}"
fi

echo "==> ingesting ${SIZE} docs"
if [[ "$VIA_API" -eq 1 ]]; then
  node ingest.mjs --via-api --corpus "$CORPUS" --index "$INDEX_ID" \
    --base-url "$BASE_URL" --api-key "$API_KEY"
else
  node ingest.mjs --corpus "$CORPUS" --index "$INDEX_ID" \
    --base-url "$BASE_URL" --api-key "$API_KEY"
fi

echo "==> waiting for rebuilds to settle (pendingOps -> 0)"
SETTLE_TIMEOUT="${SETTLE_TIMEOUT:-600}"
SETTLE_START="$(date +%s)"
while true; do
  PENDING="$(curl -sf -H "Authorization: Bearer ${API_KEY}" \
    "${BASE_URL}/v1/indexes/${INDEX_ID}/status" | node -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.pendingOps??0)})' \
    2>/dev/null || echo -1)"
  if [[ "$PENDING" == "0" ]]; then
    echo "==> settled (pendingOps=0)"
    break
  fi
  if (( $(date +%s) - SETTLE_START > SETTLE_TIMEOUT )); then
    echo "==> settle timeout after ${SETTLE_TIMEOUT}s (pendingOps=${PENDING}); continuing anyway"
    break
  fi
  echo "    pendingOps=${PENDING} ..."
  sleep 10
done

echo "==> warming (short search run)"
WARMUP=true ABORT_ON_THRESHOLD=false k6 run --quiet k6/search.js || \
  echo "==> warmup threshold(s) crossed (ignored)"

echo "==> search scenario"
k6 run --summary-export "results/search-${TS}.json" --tag runid="$TS" k6/search.js || \
  echo "==> search scenario threshold(s) crossed"

echo "==> mixed scenario"
k6 run --summary-export "results/mixed-${TS}.json" --tag runid="$TS" k6/mixed.js || \
  echo "==> mixed scenario threshold(s) crossed"

echo "==> done. summaries:"
ls -1 results/*-"${TS}".json
