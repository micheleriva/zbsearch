#!/usr/bin/env python3
"""Replace products index and ingest unicorn startup data."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request

WORKER_URL = os.environ.get("WORKER_URL", "").rstrip("/")
API_KEY = os.environ.get("API_KEY", "")
DATA_FILE = os.environ.get(
    "DATA_FILE",
    "/Users/michele/Downloads/list_of_unicorn_startup_companies.json",
)
OLD_INDEX = os.environ.get("OLD_INDEX", "products")
NEW_INDEX = os.environ.get("NEW_INDEX", "unicorns")
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "50"))


def api(method: str, path: str, body: dict | None = None) -> dict:
    if not WORKER_URL or not API_KEY:
        raise SystemExit("Set WORKER_URL and API_KEY")

    data = None
    headers = {
        "authorization": f"Bearer {API_KEY}",
        "content-type": "application/json",
        "user-agent": "curl/8.7.1",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(
        f"{WORKER_URL}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req) as res:
            raw = res.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8")
        raise SystemExit(f"{method} {path} failed ({err.code}): {raw}") from err


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "company"


def main() -> None:
    with open(DATA_FILE, encoding="utf-8") as f:
        payload = json.load(f)

    companies = payload["data"]
    print(f"Loaded {len(companies)} companies from {DATA_FILE}")

    print(f"\n==> Delete old index '{OLD_INDEX}' (if present)")
    try:
        api("DELETE", f"/v1/indexes/{OLD_INDEX}")
        print("deleted")
    except SystemExit as err:
        if "404" in str(err):
            print("not found, skipping")
        else:
            raise

    print(f"\n==> Create index '{NEW_INDEX}'")
    api(
        "POST",
        "/v1/indexes",
        {
            "name": NEW_INDEX,
            "schema": {
                "company_name": "string",
                "valuation_usd_billion": "string",
                "valuation_date": "string",
                "industry": "string",
                "operating_countries": "string",
                "founders": "string",
            },
            "settings": {"language": "english"},
        },
    )
    print("created")

    print("\n==> Batch ingest")
    seen: dict[str, int] = {}
    operations = []
    for company in companies:
        base = slugify(company["company_name"])
        count = seen.get(base, 0)
        seen[base] = count + 1
        doc_id = base if count == 0 else f"{base}-{count + 1}"
        operations.append({"op": "upsert", "id": doc_id, "doc": company})

    for i in range(0, len(operations), BATCH_SIZE):
        chunk = operations[i : i + BATCH_SIZE]
        api("POST", f"/v1/indexes/{NEW_INDEX}/documents/batch", {"operations": chunk})
        print(f"  ingested {min(i + BATCH_SIZE, len(operations))}/{len(operations)}")

    print("\n==> Rebuild")
    rebuild = api("POST", f"/v1/indexes/{NEW_INDEX}/rebuild")
    print(json.dumps(rebuild, indent=2))

    print("\n==> Sample searches")
    for term in ["artificial intelligence", "fintech", "OpenAI"]:
        result = api(
            "POST",
            f"/v1/indexes/{NEW_INDEX}/search",
            {"term": term, "limit": 3},
        )
        hits = result.get("hits", [])
        print(f"\nterm={term!r} -> {len(hits)} hits")
        for hit in hits:
            doc = hit.get("document", {})
            print(f"  - {doc.get('company_name')} (${doc.get('valuation_usd_billion')}B)")

    print("\nDone.")


if __name__ == "__main__":
    main()
