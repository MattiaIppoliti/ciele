"""Re-check the pinned embedding model before the worker serves anything.

#801, CYB-20. The manifest `fetch-model.py` wrote at build time names a
revision and a sha256 per file. This runs at container start and exits non-zero
on any mismatch, missing file, or missing manifest, so a swapped model file
stops the worker instead of quietly changing what every index means.

Fail-closed on purpose: an index built with different embedding bytes is not a
degraded index, it is a differently-shaped one, and nothing downstream can tell.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

TARGET = Path(os.environ.get("EMBEDDING_MODEL_DIR", "/opt/models/embedding"))
MANIFEST = TARGET / "model-manifest.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    if not MANIFEST.is_file():
        print(f"model manifest missing at {MANIFEST}", file=sys.stderr)
        return 1

    manifest = json.loads(MANIFEST.read_text())
    problems: list[str] = []
    for name, expected in manifest["files"].items():
        if name == "model-manifest.json":
            continue
        path = TARGET / name
        if not path.is_file():
            problems.append(f"missing {name}")
        elif sha256(path) != expected:
            problems.append(f"changed {name}")

    if problems:
        for problem in problems:
            print(f"model verification failed: {problem}", file=sys.stderr)
        return 1

    onnx = (
        f" and {manifest['fastembed_repo']}@{manifest['fastembed_revision']}"
        if "fastembed_repo" in manifest
        else ""
    )
    print(f"embedding model verified: {manifest['repo']}@{manifest['revision']}{onnx}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
