# Ciele Graph Knowledge worker: a thin FastAPI service wrapping the cognee
# library (see app/main.py). Unlike the crawler worker (an off-the-shelf image),
# this is our own small app, so we build it. Pin the base by digest in
# production (see RUNBOOK.md); never rely on a floating tag.

# ── model stage ──────────────────────────────────────────────────────────────
# The embedding model is resolved here, at one immutable revision, and carried
# into the runtime image as verified bytes (#801, CYB-20). Its own stage so
# `huggingface_hub` never joins the runtime image's dependency resolution.
FROM python:3.12-slim-bookworm AS model

# The tokenizer/model repository and the commit it is pinned to. Override both
# together when upgrading, and record the new revision in RUNBOOK.md §9.
ARG EMBEDDING_MODEL_REPO=sentence-transformers/all-MiniLM-L6-v2
ARG EMBEDDING_MODEL_REVISION=1110a243fdf4706b3f48f1d95db1a4f5529b4d41
# The ONNX export fastembed actually loads at run time (its registry maps the
# model name to this repository). A separate repository with its own history,
# so its own pin; upgrade both together and record it in RUNBOOK.md §9.
ARG FASTEMBED_MODEL_REPO=Qdrant/all-MiniLM-L6-v2-onnx
ARG FASTEMBED_MODEL_REVISION=5f1b8cd78bc4fb444dd171e59b18f3a3af89a079
ENV EMBEDDING_MODEL_REPO=${EMBEDDING_MODEL_REPO} \
    EMBEDDING_MODEL_REVISION=${EMBEDDING_MODEL_REVISION} \
    FASTEMBED_MODEL_REPO=${FASTEMBED_MODEL_REPO} \
    FASTEMBED_MODEL_REVISION=${FASTEMBED_MODEL_REVISION} \
    EMBEDDING_MODEL_DIR=/opt/models/embedding

RUN pip install --no-cache-dir "huggingface_hub==0.27.1"
COPY scripts/fetch-model.py /build/fetch-model.py
RUN python /build/fetch-model.py

# ── runtime stage ────────────────────────────────────────────────────────────
FROM python:3.12-slim-bookworm

WORKDIR /app

# cognee pulls in native deps (pyarrow/lancedb, kuzu fork, onnxruntime for
# fastembed). The compilers their wheels need at *build* time have no business
# in the image that serves requests (#801, CYB-06), so they are installed,
# used and purged in one layer; only the runtime library survives.
COPY requirements.txt ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y --auto-remove build-essential libpq-dev \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY app ./app
COPY scripts ./scripts
COPY --from=model /opt/models/embedding /opt/models/embedding

# Embedded stores live on a mounted volume, never in the image layer.
ENV COGNEE_DATA_ROOT=/data/cognee/data \
    COGNEE_SYSTEM_ROOT=/data/cognee/system \
    # Fail-closed defaults; the real values are injected at runtime.
    TELEMETRY_DISABLED=1 \
    COGNEE_SKIP_CONNECTION_TEST=true \
    # Local ONNX embeddings: no embedding-token cost, no external embed calls.
    EMBEDDING_PROVIDER=fastembed \
    EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2 \
    EMBEDDING_DIMENSIONS=384 \
    # The tokenizer loads from the verified local copy rather than a repository
    # name, so what it reads is bytes this image can prove.
    EMBEDDING_MODEL_DIR=/opt/models/embedding \
    HUGGINGFACE_TOKENIZER=/opt/models/embedding \
    # fastembed resolves EMBEDDING_MODEL through its registry and
    # snapshot-downloads the ONNX weights on first use; the cache the model
    # stage pre-populated IS that download, at the pinned revision. Offline
    # mode turns a cache miss into a startup failure instead of a silent
    # fetch from a mutable branch (#801, CYB-20).
    FASTEMBED_CACHE_PATH=/opt/models/embedding/fastembed-cache \
    HF_HUB_OFFLINE=1

# Non-root from here on. /data is chowned before it is declared a volume, so a
# fresh named volume inherits an ownership this user can actually write.
RUN useradd --system --uid 10001 --create-home --home-dir /home/worker worker \
    && mkdir -p /data \
    && chown -R worker:worker /data /app

# The volume that holds the derived graph/vector/relational stores. Must be a
# real persistent volume in the managed deployment (see cloudrun/service.yaml).
VOLUME ["/data"]

USER 10001

EXPOSE 8000

# Verify, then serve. A model file that no longer matches the build-time
# manifest stops the container instead of silently re-shaping every index it
# goes on to build.
#
# One worker: cognee's embedded stores are process-local (like the crawler's
# bundled Redis), so a task written on one worker is only visible there. Scaling
# out requires external Postgres-backed stores first, a deliberate later step.
CMD ["sh", "-c", "python /app/scripts/verify-model.py && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1"]
