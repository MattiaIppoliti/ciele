# Crawl4AI worker runbook

Operations for the Ciele Crawl4AI crawler worker: configuration, pilot sizing,
production provisioning (a deploy action), monitoring, upgrades, and rollback.

The worker is **one private managed container service** (plus local Docker for
development). Both run the same pinned image, the same hardened
[`config/crawl4ai.config.yml`](./config/crawl4ai.config.yml), the same static
bearer-token auth, and the same API contract (see [`README.md`](./README.md)).

---

## 1. Why one managed container: no GKE / no Kubernetes

**Decision:** run Crawl4AI as a single private managed container service (Cloud
Run or equivalent). Do **not** introduce GKE, Kubernetes, a self-operated
cluster, an external Redis, or a browser-fleet autoscaler for this feature.

**Why:** the pilot needs exactly one bounded browser worker. Crawl4AI needs
Chromium, several GiB of RAM, and a process lifecycle unsuited to Vercel
functions, but that is a *container-shaped* need, not a *cluster-shaped* one. A
managed container service gives us a pinned image, runtime secret injection,
health probes, request/instance concurrency limits, scale bounds, and revision
rollback with no control plane to operate. A cluster would add node pools,
autoscaling, ingress controllers, and on-call surface out of all proportion to a
single-tenant pilot. The async job queue and rate-limit store are the image's
**bundled in-container Redis**, which is why the service is pinned to a single
instance (see §3); scaling out is a deliberate later step that requires a shared
external Redis, tracked separately, not a reason to adopt Kubernetes now.

Vercel container images can host an isolated proof of concept, but their beta
lifecycle, function-duration limits, 4 GiB memory ceiling, and scale-down
behavior make them a tighter fit than Cloud Run for a browser-pool worker.

---

## 2. Configuration

Two layers, both auditable and both keeping secrets out of the image:

**Runtime env (secrets + toggles):**

| Var | Purpose | Notes |
|-----|---------|-------|
| `CRAWL4AI_API_TOKEN` | Static operator token; the app sends it as `Bearer`. | Required. A non-loopback bind refuses to boot without it. Generate: `openssl rand -hex 32`. |
| `SECRET_KEY` | HS256 signing key for the JWT path (unused by Ciele but validated at startup). | Required, ≥32 chars, not a known-weak value. Generate: `python3 -c "import secrets; print(secrets.token_hex(32))"`. |
| `CRAWL4AI_HOOKS_ENABLED` | Arbitrary hook / JS execution. | Keep `false` (default). `true` is an RCE risk and is never set. |

**Mounted config** (`/app/config.yml`): fully replaces the image default, so it
is kept complete. Ciele-specific deltas from the pinned default (each marked
`Ciele:` inline in the file):

- `app.host: 0.0.0.0`: accept connections from the app; also arms the
  no-token-no-boot guard.
- `security`: `enabled: true`, `jwt_enabled: false`, the static bearer token
  is the auth. `api_token` left empty (comes from the env var).
- `limits.max_pages: 50`: the product page budget, as defense in depth behind
  the adapter's own clamp; `limits.wall_clock_s: 600`, per-crawl deadline;
  `limits.queue.workers: 2`, `per_principal: 4`, bound concurrency.
- `crawler.pool.max_pages: 8`: cap concurrent browser pages for a ~4 GiB box.
- `webhooks.enabled: false`: completion is by polling, per the parent spec.

**Never** put the token, secret key, or any credential in `config.yml`, the
image, logs, telemetry, Source config, or client payloads. The token is
compared server-side and never echoed.

---

## 3. Pilot sizing

Sized for a small pilot; each knob has a home so it is tunable later.

| Resource | Value | Where | Rationale |
|----------|-------|-------|-----------|
| Memory | **4 GiB** | `mem_limit` / `resources.limits.memory` | Chromium + Crawl4AI minimum; the parent spec's floor. |
| CPU | **1.5–2 vCPU** | `cpus` / `resources.limits.cpu` | One-to-two concurrent renders; ≥1 vCPU required alongside 4 GiB. |
| Shared memory | **1 GiB** | `shm_size` (local); gen2 `/dev/shm` (Cloud Run) | Chromium crashes on Docker's 64 MB default `/dev/shm`. |
| Request concurrency | **2** | `containerConcurrency` / queue `workers` | Bound browser fan-out independently of Vercel concurrency. |
| Min instances | **1** | `autoscaling…/minScale` | Never scale to zero while an async job is in flight; CPU stays for polling. |
| Max instances | **1** | `autoscaling…/maxScale` | The job queue + rate store are in-container Redis, a task submitted to one instance is only pollable there. Raising this REQUIRES a shared external Redis first. |
| CPU allocation | **always allocated** | `run.googleapis.com/cpu-throttling: "false"` | The crawl runs after the submit response returns; request-scoped CPU would freeze it between polls. |

The single-instance constraint (`maxScale: 1` + session affinity) is the
load-bearing decision: correctness of the poll-based finalizer depends on it
until a shared queue store exists.

---

## 4. Production provisioning (deploy action)

Run these once to stand up the managed service. This is an **operator action**,
never performed by application code. Cloud Run shown; adapt names to your host.

```bash
# --- 0. Prerequisites: gcloud authenticated, project + region chosen ---
PROJECT=<PROJECT_ID>; REGION=<REGION>            # region near the app + Supabase
gcloud config set project "$PROJECT"
gcloud services enable run.googleapis.com secretmanager.googleapis.com

# --- 1. Create runtime secrets (never committed) ---
openssl rand -hex 32 | gcloud secrets create crawl4ai-api-token --data-file=-
python3 -c "import secrets;print(secrets.token_hex(32))" \
  | gcloud secrets create crawl4ai-secret-key --data-file=-

# --- 2. Store the hardened config as a secret (keeps it off the public image) ---
gcloud secrets create crawl4ai-config --data-file=config/crawl4ai.config.yml

# --- 3. Grant the runtime service account read access to the three secrets ---
SA="$(gcloud iam service-accounts list --format='value(email)' \
      --filter='displayName:Compute Engine default')"
for s in crawl4ai-api-token crawl4ai-secret-key crawl4ai-config; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor
done

# --- 4. Deploy the pinned service from the manifest (edit <PLACEHOLDER>s first) ---
gcloud run services replace cloudrun/service.yaml --region "$REGION"

# --- 5. Confirm the server, then the browser runtime, then wire the app ---
URL="$(gcloud run services describe ciele-crawl4ai-worker \
        --region "$REGION" --format='value(status.url)')"
curl -fsS "$URL/health"                                   # server up

TOKEN="$(gcloud secrets versions access latest --secret=crawl4ai-api-token)"
CRAWL4AI_BASE_URL="$URL" CRAWL4AI_API_TOKEN="$TOKEN" ./scripts/smoke-test.sh
```

Then set the app's server-side env (Vercel project settings, server scope only,
never a `NEXT_PUBLIC_` var):

```
CRAWL4AI_BASE_URL = <the Cloud Run URL>
CRAWL4AI_API_TOKEN = <same value as the crawl4ai-api-token secret>
```

The app treats the crawler as available only when both are set
(`isCrawl4aiConfigured()`), so Automatic provider selection lights up on its own.

---

## 5. Monitoring

- **Server health:** `GET /health` (public). Cloud Run startup + liveness probes
  hit it; a failing probe stops routing / restarts the revision.
- **Browser runtime:** local Docker verifies it on every health check
  (`scripts/healthcheck.py` renders an inline fixture). Cloud Run service probes
  are HTTP-only, so browser health is verified by running `scripts/smoke-test.sh`
  against the deployed URL, as the post-deploy readiness gate and periodically
  (e.g. an external uptime job or the schedule that owns re-crawls).
- **Metrics:** `GET /metrics` (Prometheus, auth-gated) exposes request and job
  telemetry. Watch: task failure rate, queue depth (`maxsize` 1000 → 503 when
  full), 401s (misconfigured token), memory near `memory_threshold_percent`
  (95%), and p95 crawl duration vs. `wall_clock_s` (600s).
- **Logs:** container stdout (structured). A submitted crawl logs task id,
  resolved page count, and terminal status. Tokens never appear in logs.
- **Alerts:** crawl failures surface to the org through Ciele's existing crawl
  Alert path (the finalizer maps a terminal `failed`/empty result to a Source
  error); this worker adds no separate alerting surface.

---

## 6. Version upgrades

The Crawl4AI Docker API has changed substantially across releases, so upgrades
are intentional, reviewed, and verified, never `latest`.

1. **Read the release notes** for the target tag; confirm `/crawl/job`,
   `/crawl/job/{task_id}`, `/health`, the `CRAWL4AI_API_TOKEN` static-bearer
   auth gate, and `CRAWL4AI_HOOKS_ENABLED=false` behavior are unchanged. If the
   request/response envelope changed, update the adapter (`crawl4ai.ts`) and its
   unit tests in the SAME change.
2. **Reconcile the config:** diff the new tag's `deploy/docker/config.yml`
   against ours and re-apply the `Ciele:` deltas; a replaced config must stay
   complete or the server won't boot.
3. **Resolve and pin a digest** for reproducibility:
   ```bash
   docker pull unclecode/crawl4ai:<new-tag>
   docker inspect --format '{{index .RepoDigests 0}}' unclecode/crawl4ai:<new-tag>
   # -> unclecode/crawl4ai:<new-tag>@sha256:<digest>
   ```
   Use the `…@sha256:<digest>` form in `docker-compose.yml` and
   `cloudrun/service.yaml`.
4. **Verify locally** (`docker compose up -d` → healthy → `smoke-test.sh`), then
   deploy a new managed revision (`gcloud run services replace …`) and run the
   smoke test against it before shifting traffic.

---

## 7. Rollback

- **Cloud Run:** every deploy is an immutable revision. Roll back by shifting
  traffic to the last-good revision, no rebuild:
  ```bash
  gcloud run services update-traffic ciele-crawl4ai-worker \
    --region <REGION> --to-revisions <PREVIOUS_REVISION>=100
  ```
  Confirm with `curl $URL/health` and `smoke-test.sh`.
- **Local:** restore the previous pinned tag/digest in `docker-compose.yml` and
  `docker compose up -d`.
- **App-side:** the app never fails an in-flight run over to another provider;
  if the worker is unhealthy, an org admin's explicit retry re-resolves the
  provider (Automatic may pick Local or Apify). Disabling the crawler entirely
  is just unsetting `CRAWL4AI_BASE_URL`/`CRAWL4AI_API_TOKEN` on the app,
  Automatic then routes elsewhere and existing Apify/local runs still finalize.

---

## 8. Hardening notes

- **`--no-sandbox`**: set in the browser args because the container runs as a
  non-root user without a usable Chromium sandbox. To remove it, run the
  container with an unprivileged user namespace or a verified seccomp profile,
  then delete the flag and confirm Chromium still starts. Tracked as a follow-up.
- **Ingress**: the pilot's access boundary is the app-level bearer token, so the
  managed service allows ingress and the AuthGate enforces the token. Tighten to
  `internal-and-cloud-load-balancing` (VPC connector / load balancer) when one
  is available, for defense in depth.
- **Trusted hosts**: `config.yml` leaves `trusted_hosts: ["*"]` for local use;
  pin it to the managed service hostname in production.
