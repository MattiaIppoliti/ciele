#!/usr/bin/env bash
#
# Smoke test for the Crawl4AI worker.
#
# Submits a controlled crawl and observes a terminal result, using the EXACT
# API contract the Ciele adapter (apps/web/src/lib/runtime/crawl4ai.ts) speaks:
#
#   1. GET  /health                 -> 200 (server up)
#   2. POST /crawl/job              -> { task_id }         (auth: Bearer token)
#   3. GET  /crawl/job/{task_id}    -> { status, results } (poll to terminal)
#
# Success = the task reaches "completed" with at least one page carrying text.
#
# Requires a RUNNING worker. Point it at a local `docker compose up` worker or a
# managed one — the contract is identical:
#
#   export CRAWL4AI_API_TOKEN=<token>
#   export CRAWL4AI_BASE_URL=http://localhost:11235   # or the managed URL
#   ./scripts/smoke-test.sh
#
# By default it crawls an inline `raw://` fixture (deterministic, no network) so
# it can run in CI wherever Docker is available. Pass a URL to instead run a
# real bounded deep crawl against a controlled site:
#
#   ./scripts/smoke-test.sh https://example.com
#
# Dependencies: bash, curl, python3.

set -euo pipefail

BASE_URL="${CRAWL4AI_BASE_URL:-http://localhost:11235}"
BASE_URL="${BASE_URL%/}"
TOKEN="${CRAWL4AI_API_TOKEN:-}"
TARGET="${1:-}"
POLL_TIMEOUT_S="${SMOKE_POLL_TIMEOUT_S:-90}"

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: CRAWL4AI_API_TOKEN must be set (the worker's operator token)." >&2
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

# Build the job body with the same typed-config envelope the adapter uses.
if [[ -n "$TARGET" ]]; then
  echo "==> [2/3] POST /crawl/job  (deep crawl of ${TARGET}, max 5 pages, same-origin)"
  job_body="$(TARGET="$TARGET" python3 - <<'PY'
import json, os
target = os.environ["TARGET"]
print(json.dumps({
    "urls": [target],
    "browser_config": {"type": "BrowserConfig", "params": {"headless": True}},
    "crawler_config": {"type": "CrawlerRunConfig", "params": {
        "cache_mode": "BYPASS",
        "stream": False,
        "page_timeout": 30000,
        "deep_crawl_strategy": {"type": "BFSDeepCrawlStrategy", "params": {
            "max_depth": 5, "max_pages": 5, "include_external": False,
        }},
    }},
}))
PY
)"
else
  echo "==> [2/3] POST /crawl/job  (inline raw:// fixture — offline, deterministic)"
  job_body="$(python3 - <<'PY'
import json
fixture = "raw://<html><body><h1>Ciele smoke test</h1><p>terminal result</p></body></html>"
print(json.dumps({
    "urls": [fixture],
    "browser_config": {"type": "BrowserConfig", "params": {"headless": True}},
    "crawler_config": {"type": "CrawlerRunConfig", "params": {
        "cache_mode": "BYPASS", "stream": False,
    }},
}))
PY
)"
fi

submit="$(curl -sS "${auth[@]}" -H "Content-Type: application/json" \
  -X POST "${BASE_URL}/crawl/job" -d "$job_body")"
task_id="$(printf '%s' "$submit" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("task_id",""))')"
if [[ -z "$task_id" ]]; then
  echo "FAIL: no task_id in submit response: ${submit}" >&2
  exit 1
fi
echo "    submitted task ${task_id}"

echo "==> [3/3] Poll GET /crawl/job/${task_id} until terminal (timeout ${POLL_TIMEOUT_S}s)"
deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
while (( $(date +%s) < deadline )); do
  task="$(curl -sS "${auth[@]}" "${BASE_URL}/crawl/job/${task_id}")"
  verdict="$(TASK_JSON="$task" python3 <<'PY'
import os, json
try:
    body = json.loads(os.environ["TASK_JSON"])
except Exception:
    print("MALFORMED"); raise SystemExit
status = str(body.get("status", "")).lower()
# Same result extraction order as the adapter: results ?? data ?? result.
payload = body.get("results")
if payload is None: payload = body.get("data")
if payload is None: payload = body.get("result")
if payload is None: pages = []
elif isinstance(payload, list): pages = payload
else: pages = [payload]

def text_of(page):
    md = page.get("markdown")
    if isinstance(md, str): return md.strip()
    if isinstance(md, dict): return (md.get("fit_markdown") or md.get("raw_markdown") or "").strip()
    return ""

if status == "completed":
    usable = [p for p in pages if isinstance(p, dict) and p.get("success") is not False and text_of(p)]
    print("COMPLETED %d" % len(usable))
elif status == "failed":
    print("FAILED %s" % (body.get("error") or "unknown"))
else:
    print("RUNNING %s" % (status or "unknown"))
PY
)"
  case "$verdict" in
    COMPLETED\ *)
      pages="${verdict#COMPLETED }"
      if (( pages < 1 )); then
        echo "FAIL: task completed but produced 0 usable pages (empty crawl)." >&2
        exit 1
      fi
      echo "    PASS: task completed with ${pages} usable page(s)."
      exit 0
      ;;
    FAILED\ *)
      echo "FAIL: task failed: ${verdict#FAILED }" >&2
      exit 1
      ;;
    MALFORMED)
      echo "FAIL: malformed task-status response." >&2
      exit 1
      ;;
    *)
      sleep 2
      ;;
  esac
done

echo "FAIL: task ${task_id} did not reach a terminal state within ${POLL_TIMEOUT_S}s." >&2
exit 1
