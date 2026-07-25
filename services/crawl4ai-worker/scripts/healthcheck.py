#!/usr/bin/env python3
"""Container health check for the Crawl4AI worker.

Verifies BOTH halves of the runtime, which a bare GET /health cannot:

  1. Server   - GET /health returns 200 (the HTTP app + job queue are up).
  2. Browser  - a real headless-Chromium render of an inline fixture, submitted
                through the same POST /crawl/job / GET /crawl/job/{task_id}
                contract the Ciele adapter uses, reaches a COMPLETED task with a
                non-empty page. If Chromium cannot launch, this fails.

Runs inside the container against loopback. /health is public; /crawl/job is
auth-gated, so the CRAWL4AI_API_TOKEN already present in the container env is
sent as a Bearer token. Uses only the Python standard library.

Exit 0 = healthy, non-zero = unhealthy (Docker/Cloud Run marks the container).
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE_URL = os.environ.get("HEALTHCHECK_BASE_URL", "http://127.0.0.1:11235")
TOKEN = os.environ.get("CRAWL4AI_API_TOKEN", "")
POLL_TIMEOUT_S = float(os.environ.get("HEALTHCHECK_POLL_TIMEOUT_S", "35"))
POLL_INTERVAL_S = 1.0

# A tiny inline page: no network egress, deterministic, but still forces a real
# browser render. `raw://` is Crawl4AI's scheme for crawling literal HTML.
FIXTURE = "raw://<html><body><h1>Ciele health check</h1><p>ok</p></body></html>"


def _request(method, path, body=None):
    url = BASE_URL + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if TOKEN:
        headers["Authorization"] = "Bearer " + TOKEN
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, json.loads(resp.read() or b"{}")


def _fail(msg):
    print("UNHEALTHY: " + msg, file=sys.stderr)
    sys.exit(1)


def main():
    # 1) Server liveness.
    try:
        status, _ = _request("GET", "/health")
    except (urllib.error.URLError, OSError) as exc:
        _fail("server /health unreachable: %s" % exc)
    if status != 200:
        _fail("server /health returned HTTP %s" % status)

    # 2) Browser runtime via the real job contract.
    job = {
        "urls": [FIXTURE],
        "browser_config": {"type": "BrowserConfig", "params": {"headless": True}},
        "crawler_config": {
            "type": "CrawlerRunConfig",
            "params": {"cache_mode": "BYPASS", "stream": False},
        },
    }
    try:
        status, payload = _request("POST", "/crawl/job", job)
    except urllib.error.HTTPError as exc:
        _fail("POST /crawl/job returned HTTP %s" % exc.code)
    except (urllib.error.URLError, OSError) as exc:
        _fail("POST /crawl/job failed: %s" % exc)
    task_id = payload.get("task_id")
    if not task_id:
        _fail("POST /crawl/job returned no task_id")

    deadline = time.time() + POLL_TIMEOUT_S
    while time.time() < deadline:
        try:
            _, task = _request("GET", "/crawl/job/" + task_id)
        except (urllib.error.URLError, OSError) as exc:
            _fail("GET /crawl/job/%s failed: %s" % (task_id, exc))
        state = str(task.get("status", "")).lower()
        if state == "completed":
            print("healthy: server up, browser rendered task %s" % task_id)
            sys.exit(0)
        if state == "failed":
            _fail("browser task failed: %s" % task.get("error", "unknown"))
        time.sleep(POLL_INTERVAL_S)

    _fail("browser task %s did not complete within %ss" % (task_id, POLL_TIMEOUT_S))


if __name__ == "__main__":
    main()
