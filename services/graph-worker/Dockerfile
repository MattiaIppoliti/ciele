# Ciele Graph Knowledge worker: a thin FastAPI service wrapping the cognee
# library (see app/main.py). Unlike the crawler worker (an off-the-shelf image),
# this is our own small app, so we build it. Pin the base by digest in
# production (see RUNBOOK.md); never rely on a floating tag.
FROM python:3.12-slim-bookworm

# cognee pulls in native deps (pyarrow/lancedb, kuzu fork, onnxruntime for
# fastembed); these are the system libraries their wheels need at build/runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first for layer caching.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts

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
    HUGGINGFACE_TOKENIZER=sentence-transformers/all-MiniLM-L6-v2

# The volume that holds the derived graph/vector/relational stores. Must be a
# real persistent volume in the managed deployment (see cloudrun/service.yaml).
VOLUME ["/data"]

EXPOSE 8000

# One worker: cognee's embedded stores are process-local (like the crawler's
# bundled Redis), so a task written on one worker is only visible there. Scaling
# out requires external Postgres-backed stores first, a deliberate later step.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
