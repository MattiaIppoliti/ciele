"""Resolve the embedding model at build time, at one immutable revision.

#801, CYB-20. Pinning `cognee`, `fastembed` and a base-image digest pins the
*code* that loads a model; it says nothing about the model bytes, which the
worker was fetching by name from a mutable branch on first use. This downloads
the tokenizer/model repository at a fixed commit, records a sha256 per file, and
`verify-model.py` re-checks that manifest before the server accepts a request.

Run in its own build stage so `huggingface_hub` never enters the runtime image's
dependency resolution.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

from huggingface_hub import snapshot_download

REPO_ID = os.environ["EMBEDDING_MODEL_REPO"]
REVISION = os.environ["EMBEDDING_MODEL_REVISION"]
TARGET = Path(os.environ.get("EMBEDDING_MODEL_DIR", "/opt/models/embedding"))

# The weights fastembed actually loads. fastembed resolves the model name to
# its own ONNX export repository and snapshot-downloads it into
# FASTEMBED_CACHE_PATH at *run* time, so pinning the sentence-transformers
# repository above pinned the tokenizer and a copy of the weights nothing
# loads. This populates that cache at build time, at one immutable revision,
# in the hub layout fastembed's snapshot_download expects; HF_HUB_OFFLINE=1
# in the runtime image then makes a cache miss a startup failure instead of a
# silent unpinned fetch.
FASTEMBED_REPO = os.environ["FASTEMBED_MODEL_REPO"]
FASTEMBED_REVISION = os.environ["FASTEMBED_MODEL_REVISION"]
FASTEMBED_CACHE = TARGET / "fastembed-cache"

# The tokenizer and config files the worker actually loads. Naming them keeps
# the image free of the repository's PyTorch, TensorFlow, OpenVINO and Rust
# copies of the same weights.
ALLOW = [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "vocab.txt",
    "modules.json",
    "sentence_bert_config.json",
]

# What fastembed's own downloader allow-lists for this model (its fixed
# tokenizer/config set plus the model_file from its registry entry).
FASTEMBED_ALLOW = [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "preprocessor_config.json",
    "model.onnx",
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    if len(REVISION) != 40 or not all(c in "0123456789abcdef" for c in REVISION):
        print(
            f"EMBEDDING_MODEL_REVISION must be a full 40-character commit sha, got {REVISION!r}",
            file=sys.stderr,
        )
        return 1

    if len(FASTEMBED_REVISION) != 40 or not all(
        c in "0123456789abcdef" for c in FASTEMBED_REVISION
    ):
        print(
            f"FASTEMBED_MODEL_REVISION must be a full 40-character commit sha, got {FASTEMBED_REVISION!r}",
            file=sys.stderr,
        )
        return 1

    TARGET.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=REPO_ID,
        revision=REVISION,
        local_dir=str(TARGET),
        allow_patterns=ALLOW,
    )

    # Hub *cache* layout (cache_dir, not local_dir): that is what fastembed's
    # snapshot_download reads at run time.
    snapshot_download(
        repo_id=FASTEMBED_REPO,
        revision=FASTEMBED_REVISION,
        cache_dir=str(FASTEMBED_CACHE),
        allow_patterns=FASTEMBED_ALLOW,
    )
    # fastembed asks for "main"; a revision-pinned snapshot records no ref, so
    # offline resolution of "main" would miss the cache. Point it at the pin.
    refs = FASTEMBED_CACHE / f"models--{FASTEMBED_REPO.replace('/', '--')}" / "refs"
    refs.mkdir(parents=True, exist_ok=True)
    (refs / "main").write_text(FASTEMBED_REVISION)

    files = sorted(
        path
        for path in TARGET.rglob("*")
        if path.is_file() and ".cache" not in path.parts
    )
    if not files:
        print(f"{REPO_ID}@{REVISION} produced no files", file=sys.stderr)
        return 1

    # Both identities, not one: the ONNX weights are hashed below like every
    # other file, but a hash alone cannot tell an operator *which* revision of
    # which repository they are looking at when a verification fails.
    manifest = {
        "repo": REPO_ID,
        "revision": REVISION,
        "fastembed_repo": FASTEMBED_REPO,
        "fastembed_revision": FASTEMBED_REVISION,
        "files": {
            str(path.relative_to(TARGET)): sha256(path) for path in files
        },
    }
    (TARGET / "model-manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True))
    print(
        f"pinned {REPO_ID}@{REVISION} and {FASTEMBED_REPO}@{FASTEMBED_REVISION}: "
        f"{len(manifest['files'])} files"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
