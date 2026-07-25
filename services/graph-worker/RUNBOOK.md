# Graph Knowledge worker runbook

Operations for the Ciele Graph Knowledge worker: configuration, sizing,
production provisioning (a deploy action), monitoring, upgrades, and rollback.

The worker is **one private managed container service** (plus local Docker for
development). Both run the same image built from
[`Dockerfile`](./Dockerfile), the same static bearer-token auth, and the same
API contract (see [`README.md`](./README.md)).

---

## 1. Why one managed container — no cluster

**Decision:** run the graph worker as a single private managed container service
(Cloud Run or equivalent). Do **not** introduce Kubernetes, an external cluster,
or an autoscaler for the pilot.

**Why:** the pilot needs exactly one bounded worker holding embedded
graph/vector/relational stores (cognee's Ladybug graph + LanceDB + SQLite). That
is a *container-shaped, stateful* need — a pinned image, runtime secret
injection, a persistent volume, health probes, and revision rollback — not a
*cluster-shaped* one. Because the stores are process-local, scaling out is not a
config change: it requires moving cognee onto external Postgres-backed stores
(relational + pgvector + Postgres graph adapter), which is a deliberate later
step tracked separately, not a reason to adopt a cluster now.

---

## 2. Configuration

Secrets stay out of the image; everything is env-injected and auditable.

| Var | Purpose | Notes |
|-----|---------|-------|
| `GRAPH_WORKER_API_TOKEN` | Static operator token; the app sends it as `Bearer`. | **Required, ≥16 chars.** The server refuses to boot without it. Generate: `openssl rand -hex 32`. |
| `LLM_API_KEY` | Key for cognify extraction + graph-completion answers. | Required. Use a **paid-tier** key — the spike hit free-tier daily caps (20 req/day/model). |
| `LLM_PROVIDER` / `LLM_MODEL` | Which model answers. | Any litellm provider: gemini/openai/anthropic/azure/ollama/custom. Per-stage overrides (`LLM_EXTRACTION_*`, `LLM_QUERY_*`) let a cheap model do extraction and a better one answer. |
| `EMBEDDING_PROVIDER` etc. | Local ONNX embeddings. | Default `fastembed` MiniLM (384-dim) — zero embedding-token cost. Baked into the image; override only with care (dimension changes require a rebuild of the graph). |
| `TELEMETRY_DISABLED` | cognee telemetry. | Pinned `1` in the image. Must stay off for our deployment posture. |
| `COGNEE_DATA_ROOT` / `COGNEE_SYSTEM_ROOT` | Store locations on the volume. | Default under `/data`; must resolve to the persistent volume. |

## 3. Storage & the persistent volume

The derived stores live under `/data` on a mounted volume. In
[`cloudrun/service.yaml`](./cloudrun/service.yaml) the template mounts an
NFS/Filestore volume — provision a Filestore instance and fill the
`<FILESTORE_IP>` / `<FILESTORE_SHARE>` placeholders before deploying. Never
swap it for an `emptyDir`: the stores are stateful and an `emptyDir` is wiped on
every restart, forcing a full rebuild-from-OKF.

Losing the volume is recoverable, not catastrophic: the graph is a **derived
index** (ADR-0017). Rebuild it by re-running ingestion from OKF (the backfill
action in the ingestion-fan-out work, #387).

## 4. Sizing

Pilot: ~4 GiB RAM, ~2 vCPU, one instance, `containerConcurrency: 4`. cognify and
`improve` are the memory-hungry passes (embedding + graph build). Watch memory
on large collections; the token budget (not CPU) is usually the first limit.

## 5. Provisioning (a deploy action)

1. Build & push the image: `docker build -t <REGISTRY>/graph-worker:<TAG> .` then push. Pin by digest in production.
2. Create secrets in Secret Manager: `graph-worker-api-token`, `graph-worker-llm-api-key`.
3. Provision the persistent volume and wire it into `cloudrun/service.yaml`.
4. `gcloud run services replace cloudrun/service.yaml --region <REGION>`.
5. Post-deploy readiness gate: run `./scripts/smoke-test.sh` against the deployed URL with the operator token — it must reach a graph answer whose provenance carries the ingested conceptId.

## 6. Monitoring

- Liveness: the `/health` probe (server up). The app also polls it via
  `getGraphWorkerHealth()` for availability gating + the Alerts producer
  (#389 wires the Alert).
- Real-runtime check: `scripts/smoke-test.sh` (ingest → search round-trip). Run
  after every deploy and upgrade.

## 7. Upgrades & rollback

cognee's storage + search contract is **version-sensitive** (see the spike: the
PyPI `export()` signature drifted from the repo; SearchType values changed).
Upgrade `cognee==` in [`requirements.txt`](./requirements.txt) deliberately:
rebuild, run the smoke test against a scratch dataset on a staging revision,
then promote. Roll back by redeploying the previous image digest — the volume
format is backward-compatible within a cognee minor line but **not guaranteed
across majors**, so a major upgrade may require a rebuild-from-OKF.

## 8. Security posture

- Fail-closed auth: no/weak token ⇒ no boot; every route except `/health` gated.
- Never reachable by browsers — only the Ciele app server side calls it, behind
  private ingress. The token is the access boundary.
- No arbitrary code execution surface (no hook/JS endpoints exist).
- Secrets never rendered to any client; the adapter also redacts them from any
  error text before it can reach an Alert or telemetry.
