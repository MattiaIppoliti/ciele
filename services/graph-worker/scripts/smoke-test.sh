#!/usr/bin/env bash
#
# Smoke test for the Graph Knowledge worker.
#
# Round-trips the EXACT API contract the Ciele adapter
# (apps/web/src/lib/runtime/graph-worker.ts) speaks:
#
#   1. GET  /health                        -> 200 (server up, no token)
#   2. POST /ingest  {dataset, documents}  -> { ingested }   (auth: Bearer token)
#   3. POST /search  {dataset, query}      -> { answer, provenance, qa_id }
#   4. POST /purge   {dataset}             -> { purged }      (cleanup, on PASS)
#
# Success = ingest reports >=1 document AND a subsequent search returns a
# non-empty answer whose provenance carries back the ingested conceptId. On
# success the smoke dataset is then purged so the run leaves nothing behind.
#
# Requires a RUNNING worker WITH a working LLM key (cognify + graph-completion
# make real LLM calls). Point it at a local `docker compose up` worker or a
# managed one — the contract is identical:
#
#   export GRAPH_WORKER_API_TOKEN=<token>
#   export GRAPH_WORKER_BASE_URL=http://localhost:8000   # or the managed URL
#   ./scripts/smoke-test.sh
#
# Dependencies: bash, curl, python3.

set -euo pipefail

BASE_URL="${GRAPH_WORKER_BASE_URL:-http://localhost:8000}"
BASE_URL="${BASE_URL%/}"
TOKEN="${GRAPH_WORKER_API_TOKEN:-}"
DATASET="${SMOKE_DATASET:-ciele_col_smoke_test}"

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: GRAPH_WORKER_API_TOKEN must be set (the worker's operator token)." >&2
  exit 2
fi
for bin in curl python3; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: '$bin' is required." >&2; exit 2; }
done

auth=(-H "Authorization: Bearer ${TOKEN}")

echo "==> [1/3] GET ${BASE_URL}/health"
health_code="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/health")"
if [[ "$health_code" != "200" ]]; then
  echo "FAIL: /health returned HTTP ${health_code}" >&2
  exit 1
fi
echo "    server healthy (HTTP 200)"

echo "==> [2/3] POST /ingest  (one tagged document into ${DATASET})"
ingest_body="$(DATASET="$DATASET" python3 - <<'PY'
import json, os
print(json.dumps({
    "dataset": os.environ["DATASET"],
    "collection_id": "smoke",
    "documents": [{
        "conceptId": "smoke-concept-1",
        "sourceId": "smoke-source-1",
        "text": ("Password resets are done in the Identity Portal. Choose "
                 "'Forgot password'; the reset link expires after 30 minutes."),
    }],
}))
PY
)"
ingested="$(curl -sS "${auth[@]}" -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/ingest" -d "$ingest_body" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("ingested",0))')"
if [[ "${ingested:-0}" -lt 1 ]]; then
  echo "FAIL: /ingest reported ${ingested} documents." >&2
  exit 1
fi
echo "    ingested ${ingested} document(s) + cognified"

echo "==> [3/4] POST /search  (graph completion + provenance)"
search_body="$(DATASET="$DATASET" python3 - <<'PY'
import json, os
print(json.dumps({
    "dataset": os.environ["DATASET"],
    "query": "How do I reset my password?",
    "mode": "graph_completion",
    "session_id": "smoke-session",
}))
PY
)"
search="$(curl -sS "${auth[@]}" -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/search" -d "$search_body")"
verdict="$(SEARCH_JSON="$search" python3 <<'PY'
import os, json
try:
    body = json.loads(os.environ["SEARCH_JSON"])
except Exception:
    print("MALFORMED"); raise SystemExit
answer = (body.get("answer") or "").strip()
prov = body.get("provenance") or []
has_concept = any(p.get("concept_id") == "smoke-concept-1" for p in prov)
if answer and has_concept:
    print("PASS")
elif answer:
    print("PARTIAL answer-without-provenance")
else:
    print("EMPTY")
PY
)"
case "$verdict" in
  PASS)
    echo "    PASS: graph answered with provenance resolving to the ingested Concept."
    ;;
  PARTIAL*)
    echo "WARN: got an answer but provenance did not carry the conceptId — check ingest tagging." >&2
    exit 1
    ;;
  *)
    echo "FAIL: search returned no usable answer (${verdict}): ${search}" >&2
    exit 1
    ;;
esac

echo "==> [4/4] POST /purge  (reclaim the smoke dataset)"
purge_body="$(DATASET="$DATASET" python3 -c 'import json,os; print(json.dumps({"dataset": os.environ["DATASET"]}))')"
purged="$(curl -sS "${auth[@]}" -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/purge" -d "$purge_body" \
  | python3 -c 'import sys,json; print(str(json.load(sys.stdin).get("purged", False)).lower())')"
if [[ "$purged" != "true" ]]; then
  echo "FAIL: /purge did not drop the smoke dataset (purged=${purged})." >&2
  exit 1
fi
echo "    purged: smoke dataset reclaimed."
exit 0
