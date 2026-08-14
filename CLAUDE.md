# CLAUDE.md

Guidance for AI assistants working in this repository.

**Ciele** (workspace name `agent-hub`) is a multi-tenant SaaS platform where each
Organization configures, tests, and publishes its own AI assistants — embeddable
chat widgets that answer from the Organization's own knowledge. AGPL-3.0-only.
This public repository is a **one-way mirror** of a private development repo:
history is one squashed commit per release, and PRs opened here are imported
(authorship preserved), never merged in place. See `CONTRIBUTING.md`.

## Companion documents — read these first

| Document | What it holds |
|---|---|
| `CONTEXT.md` | The **domain language**. Every term (Organization, Assistant, Flow, Concept, Publication, …) with its meaning and the words to avoid. Add a term here **before** adding its type. |
| `agents.md` | The **conversational runtime design** — how an Assistant behaves at runtime (triggers, conditions, action catalog, knowledge loop). |
| `docs/ARCHITECTURE.md` | **How the repo is built today**, with `file:line` refs. Unbuilt things are marked `[target]`. If it drifts from the code, the code wins — fix the doc. |
| `docs/adr/` | ~20 Architecture Decision Records. Read the relevant ADR before changing an architectural seam. |
| Per-workspace `CLAUDE.md` | `apps/web`, `apps/desktop`, `apps/docs`, `packages/{core,db,agent,ui,charts,eslint-config}`, `services/`, `supabase/` each carry their own. **Always read the local one before editing in that area** — they hold the traps this file doesn't repeat. |

## Repository layout

pnpm workspaces (`pnpm@10.28.0`) + Turborepo. Workspace globs: `apps/*`,
`packages/*`, `scripts/mirror-gate`, `ee/apps/*`.

```
apps/
  web/        @agent-hub/web      — the product: Next.js 16 App Router admin console,
                                    widget runtime, and API (platform.ciele.app)
  docs/       @agent-hub/docs     — public docs site (Fumadocs, port 3200)
  desktop/    @ciele/desktop      — Ciele Desktop (Electron) self-host wizard
packages/
  core/       @agent-hub/core     — the domain: ~150 types + pure derivations.
                                    Zero runtime deps, no I/O (ADR-0019)
  db/         @agent-hub/db       — the `Db` data-access seam (~170 methods):
                                    Supabase (RLS) + in-memory mock adapters
  agent/      @agent-hub/agent    — the chat/LLM runtime: turn pipeline, flow engine,
                                    retrieval, ingestion, jobs, egress guards.
                                    Framework-free (never imports next/*)
  ui/         @agent-hub/ui       — shared shadcn-style primitives on Base UI
  charts/     @agent-hub/charts   — hand-built SVG chart primitives (no chart library)
  cli/        @ciele/cli          — terminal client for an Organization
  mcp/        @ciele/mcp          — MCP server over /api/v1
  client/     @ciele/client       — API client library
  ops/        @ciele/ops          — ops tooling
  eslint-config/                  — shared flat ESLint config for the packages
services/     NOT in the pnpm workspace — Python/container workers (Cloud Run):
  crawl4ai-worker/  JS-rendered website crawls    graph-worker/  derived knowledge graph
supabase/     migrations (filename order) + seed.sql
deploy/       self-host Docker Compose + bootstrap.sh
scripts/      migration applier, license check, version bumper, mirror gate
ee/           enterprise-only; excluded from this mirror (globs match nothing here)
docs/         internal engineering docs: ARCHITECTURE.md, ADRs, runbooks, audits
```

## Commands

All from the repo root:

```sh
pnpm install                 # frozen lockfile in CI
pnpm typecheck               # turbo run typecheck
pnpm test                    # turbo run test — the CI gate (Vitest, offline)
pnpm lint                    # turbo run lint
pnpm build                   # turbo run build
pnpm db:start | db:reset | db:status | db:stop   # local Supabase
```

- **Single test file**: `pnpm --filter <pkg> exec vitest run src/foo.test.ts`
- **Scoped scripts**: `pnpm --filter @agent-hub/web test` etc.
- CI (`.github/workflows/ci.yml`) runs typecheck → test → lint → build. Run all
  four before considering work done; the same checks gate the private import.
- Turbo only runs scripts that exist — a workspace missing a `test`/`lint`
  script is skipped **silently**. `@agent-hub/ui` has no tests by design;
  `apps/docs` tests use `node --test`, not Vitest; `services/` is entirely
  outside `pnpm test`.
- Tests are colocated `*.test.ts` and run **offline** — no network, no API keys
  (the deterministic keyword engine is the no-model path, ADR-0003).
  `.tsx` test files are not collected anywhere by design: test behaviour via
  the plain-TS module the component delegates to.
- Files named `*.security.test.ts` assert SSRF/egress containment — a failure
  there is a security regression, not a flaky test.

## Architecture in one paragraph

The **dependency arrow is one-way**: `core` (domain types + pure functions,
zero deps) ← `db` (the `Db` seam: operations over those types) ← `agent`
(the runtime) ← `apps`. Import a **type from `@agent-hub/core`**, an
**operation from `@agent-hub/db`** (ADR-0019). All reads go through a
request-scoped `Db` bound to the caller's auth context; multi-tenancy is
enforced in Postgres by RLS. With no Supabase env the whole product runs on the
in-memory mock `Db` and demo session. Mutations are Server Actions only
(`apps/web/src/app/actions.ts`), each starting with `requireMember(capability)`
and revalidating **by path, not tag** (ADR-0005). The runtime is a deep module
behind three barrels (`@agent-hub/agent`, `/client`, `/local-providers`) whose
`exports` map blocks deep imports; host facts (Next `after()`, egress policy)
reach it via ports registered in `apps/web/src/instrumentation.ts`, never via
imports.

## Runtime invariants (never break these)

- **Flows are an authoritative router.** Intent Classification picks the Flow;
  its actions then execute in order. The LLM never overrides them.
- **`custom_message` and Notification output is verbatim** — never paraphrased
  by a model.
- Generative behaviour lives only inside `search_knowledge`, the Default
  behavior flow, and `basic_reply` (which never retrieves, so it must never
  assert a fact about the organization). A new generative action needs an
  argument for why it isn't one of these three.
- **Citations resolve to a Concept → Source**, never an opaque chunk (ADR-0002).
- Published widget traffic runs only on Platform / API-key / Federated Provider
  Connections; personal Subscription connections are preview-only (ADR-0001/0007).

## Key conventions

- **Vocabulary is law.** Use the canonical terms from `CONTEXT.md` in code, DB,
  APIs, and docs (e.g. Assistant not "agent"/"bot", Member not "user",
  Visitor not "customer", Organization not "tenant"). New domain term → add it
  to `CONTEXT.md` first, then the type in `packages/core/src/types.ts`.
- **Extending the seams** (each is two-plus coordinated edits — the tests pin them):
  - New `Db` method: extend `types.ts`, implement in **both** `supabase.ts`
    and `mock.ts`, add the case to the shared `db-contract.suite.ts` (it runs
    against both adapters). Prefer narrowing the facade over widening it (ADR-0016).
  - New public `@agent-hub/agent` capability: export from the right barrel
    **and** update `src/interface.test.ts` (it locks value exports only).
  - New migration: `supabase/migrations/YYYYMMDDHHMMSS_name.sql` (timestamp
    prefix; the `00NN_` scheme is legacy). Same PR as its code. **Append-only
    once merged** — fix forward. New tables get RLS policies in the same
    migration. RLS helpers live in the `private` schema
    (`private.is_org_member(...)`, never `public.*`).
- **Pure domain logic goes in `core`** — if it needs a `Db` it goes in `db`;
  if it needs a framework or provider SDK it goes where that dependency lives.
- **Dependencies are a last resort**: charts are hand-built SVG; prefer
  extending an existing component. `ui`/`charts` keep React as a **peer**
  dependency. Run `pnpm check:licenses` when adding one.
- `src/ee/` and `ee/` are enterprise-only and mirror-excluded — OSS code must
  never import from them (EE may reference OSS, never the reverse).
- Match the surrounding code's naming, comment density, and structure. One
  logical change per PR; behaviour changes come with colocated tests.
- Statements in docs describe the code **as it is**; mark aspirations
  `[target]`. When docs and code disagree, fix the doc.

## Working in a given area — local guides

Non-obvious traps live in the per-area `CLAUDE.md` files. Highlights so you
know to look:

- **apps/web** — don't run `pnpm dev` in a shell (use the launch configs);
  browser Supabase client is lint-banned in `components/**`/`app/**`;
  the local-connector artifact bump touches five pinned places.
- **apps/desktop** — three processes, two tsconfigs; never `app.getVersion()`
  (use `appVersion()`); `src/setup/` and `src/shared/` must stay free of
  `electron`/`node:*` imports.
- **apps/docs** — write English only; translations are generated + committed;
  strict Mermaid diagram rules; Tailwind must keep scanning `packages/ui/src`.
- **supabase** — production migrations are applied by filename via
  `scripts/apply-migrations.sh`, **not** `supabase db push`; the numbering
  oddities (no `0021`, the `0017` twin in `ee/migrations/`) are intentional.
- **services** — each worker has a `README.md` and a `RUNBOOK.md`; a behaviour
  change that affects operations updates the RUNBOOK in the same change.

## Environment

Full stack: `NEXT_PUBLIC_SUPABASE_URL` + anon key (+ service role),
`APP_ENCRYPTION_KEY`, provider keys (e.g. `ANTHROPIC_API_KEY`), optional
`APIFY_API_TOKEN`. With none of it set, everything runs on the mock `Db`, demo
session, and deterministic engine. Self-hosting: `./deploy/bootstrap.sh`
(see `deploy/README.md`).
