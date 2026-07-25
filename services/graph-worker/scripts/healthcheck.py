#!/usr/bin/env python3
"""Container health check for the Graph Knowledge worker.

Verifies the HTTP server is up: GET /health returns 200. Unlike the crawler
worker, the "does the real runtime work" check (a full ingest -> cognify ->
search round-trip) needs an LLM key and takes minutes, so it lives in
scripts/smoke-test.sh and runs as a post-deploy readiness gate, not on every
health probe.

Runs inside the container against loopback. /health is public (no token). Uses
only the Python standard library. Exit 0 = healthy, non-zero = unhealthy.
"""

import os
import sys
import urllib.error
import urllib.request

BASE_URL = os.environ.get("HEALTHCHECK_BASE_URL", "http://127.0.0.1:8000")


def main() -> None:
    try:
        with urllib.request.urlopen(BASE_URL + "/health", timeout=10) as resp:
            status = resp.status
    except (urllib.error.URLError, OSError) as exc:
        print("UNHEALTHY: server /health unreachable: %s" % exc, file=sys.stderr)
        sys.exit(1)
    if status != 200:
        print("UNHEALTHY: server /health returned HTTP %s" % status, file=sys.stderr)
        sys.exit(1)
    print("healthy: server up")
    sys.exit(0)


if __name__ == "__main__":
    main()
