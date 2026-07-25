# ARCHITECTURE.md — Agent Hub

The **technical, code-grounded** companion to the functional docs. Where
[`CLAUDE.md`](../CLAUDE.md) maps *what* we're building (the full feature surface + build status),
[`context.md`](../context.md) fixes the *domain language*, and [`agents.md`](../agents.md) describes the
*conversational runtime*, this file documents **how the repo is actually built** — the stack, the
request/data flows, the runtime engines, the schema, and the seams you extend.

> **Accuracy convention.** Statements describe the code **as it is today**, with `file:line`
> references. Anything not yet built is marked **[target]** or **[stored-but-inert]** so a reader
> always knows what actually runs. When in doubt, the code wins — if you find a drift, fix the doc.

---

## 1. Stack & monorepo layout

- **Frontend/app**: Next.js (App Router, RSC + Server Actions), **Tailwind v4**, **shadcn/ui**
  (Radix primitives under `components/ui`), `lucide-react` icons.
- **AI runtime**: **Vercel AI SDK** (`ai`, `@ai-sdk/anthropic|openai|google`) — `streamText`,
  `generateObject`, `tool`, `embed`/`embedMany`.
- **Data**: **Supabase** (Postgres + Auth + RLS) with **pgvector**; an in-memory **mock** for
  offline/demo.
- **Crawler**: a provider matrix behind one lifecycle for Website Sources — **Local** (built-in
  same-origin HTTP crawler), **Crawl4AI** (a private pinned Chromium/Playwright worker for
  JavaScript-rendered and larger same-origin crawls), and **Apify** (Website Content Crawler for
  file/login/managed-proxy crawls). Sources select Automatic / Local / Crawl4AI / Apify; Automatic is
  a pure capability policy (`website-crawlers.ts`) that resolves one provider at crawl start and
  persists it. See [`docs/runbooks/website-crawler-providers.md`](runbooks/website-crawler-providers.md)
  and [`services/crawl4ai-worker/RUNBOOK.md`](../services/crawl4ai-worker/RUNBOOK.md).
- **Analytics**: **Vercel Analytics** (`@vercel/analytics`, cookieless) in both apps' root layouts;
  active on Vercel deployments, a no-op in local dev.
- **Tooling**: pnpm workspaces + Turbo. **Tests**: Vitest (`pnpm test` → `turbo run test`) +
  `pnpm typecheck` (`turbo run typecheck`), colocated `*.test.ts`. Coverage: the deterministic engine
  (`packages/db/engine.test.ts`) + the `Db` contract against the mock (`db-contract.test.ts`); on the
  app side, the Flow Action handler registry (`actions.test.ts`), the Conversation Turn module
  (`turn.test.ts`), the turn-stream consumer (`stream.test.ts`), the ingest write seam
  (`ingest.test.ts`), the Source extraction registry (`extract.test.ts`), the Ingestion Job runner
  (`jobs.test.ts`), the Intent Classification routing chain (`engine.test.ts`, via `ai/test` mock
  models — classify → keyword-fallback → Default), the authorization guard (`authz.test.ts`), provider resolution / ADR-0001
  boundary (`models.test.ts`), Insights KPIs (`lib/insights/kpi.test.ts`), and email templates
  (`notify.test.ts`). All offline — no network, no keys (ADR-0003's no-model path).

```
/
├── CLAUDE.md            # feature map + build status (the "what")
├── context.md           # ubiquitous language (the domain vocabulary)
├── agents.md            # conversational runtime (the router + actions)
├── docs/
│   ├── ARCHITECTURE.md  # ← this file (the "how")
│   └── adr/             # 0001 providers · 0002 OKF knowledge · 0003 two-engine runtime ·
│                         # 0004 per-app middleware · 0005 path-based revalidation
├── apps/web/            # Next.js app (admin console + widget + API)
│   └── src/
│       ├── app/(admin)/ # authenticated admin console
│       ├── app/widget/  # public widget page
│       ├── app/api/     # widget + preview HTTP endpoints
│       ├── app/actions.ts     # server actions (all mutations, RBAC-gated)
│       ├── components/  # editor + widget UI (assistant/, help-desks/, widget/, ui/)
│       └── lib/         # auth, rbac, data (request-scoped Db), runtime/ (engine, models, …)
├── packages/db/         # @agent-hub/db: types (Db interface), mock, supabase, keyword engine
└── supabase/            # migrations 0001–0016 + seed.sql
```

---

## 2. Frontend architecture (Next.js App Router + shadcn/ui)

### 2.1 Route groups

| Group | Path | Auth | Purpose |
|-------|------|------|---------|
| `(admin)` | `/`, `/assistants/*`, `/help-desks/*`, `/inbox`, `/insights/*`, `/settings/*` | required | Admin console shell |
| widget | `/widget/[assistantId]` | public | Embeddable chat page (serves latest Publication; **static** — cached shell busted by Publish, `?c=` Context Hint read client-side) |
| api | `/api/widget/[assistantId]/*`, `/api/preview/chat` | public / session | Chat, config, history, feedback |
| auth | `/login`, `/signup`, `/join/[token]`, `/onboarding` | public | Supabase Auth + invite/onboarding |

`middleware.ts` gates everything: public paths are `/login`, `/signup`, `/join/*`, `/widget/*`,
`/api/widget/*`; unauthenticated requests elsewhere → `/login?next=…`. The session JWT is validated
**locally** (`auth.getClaims()`, JWKS cached) rather than with a per-request network `getUser()` call;
projects on a legacy symmetric JWT secret transparently fall back to the server check. **Demo mode**
(no Supabase env) short-circuits middleware entirely.

### 2.2 Rendering & mutation model

- **Server Components** load data through a **request-scoped `Db`** (`lib/data.ts` → `getDb()`), which
  binds the Supabase client to the caller's auth context (so RLS applies) or returns the mock.
- Admin layouts and pages enter through the React-cached **`requirePageMember()`** guard and share an
  **`AdminPageReads`** coordinator for common bootstrap data. Its lazy Promises collapse concurrent
  Assistant-list consumers and load the shell's Assistant list + active Alert count in parallel.
  The coordinator lives only for the current render request: RLS-bound admin data never enters
  `unstable_cache` or another cross-request cache (ADR-0005).
- **Server Actions** (`app/actions.ts`, ~810 lines) are the single mutation surface. Every org-scoped
  action starts with **`requireMember(capability)`** (`lib/authz.ts`) — the one authorization seam:
  it re-derives the session, checks the capability against the Member's Role (`lib/rbac.ts`), and
  hands back the request-scoped `Db`. The action then mutates and `revalidatePath`s. There is **no**
  client-side data mutation path — the client calls actions.
- Client Components handle interactivity (drag-reorder, dialogs, the streaming chat) and call server
  actions or the streaming API routes.
- **Navigation prefetch boundary**: the shared `components/ui/Link` uses intent prefetching on
  hover/focus by default and deduplicates each destination in a short intent window. Viewport
  prefetch is opt-in with `prefetch={true}`; `false` disables both modes. Navigation itself stays on
  Next.js' standard click path — there is no early `mousedown` router push.

### 2.3 The assistant editor shell (nested route modules)

`/assistants/[id]` is a shared editor shell (`layout.tsx`): the global sidebar supplies SETUP
navigation, the center renders one section, and the right edge owns the **Preview** launcher. The live
Preview loads only when the Member opens it, so the default workspace does not ship its streaming/chat
dependencies. Every enabled section is a nested route module (`/general`, `/knowledge`, `/flows`,
`/tools`, `/goals`, `/help-desks`, `/style`, `/authentication`, `/publish`); Flow builders live at
`/flows/new` and `/flows/[flowId]`. Query params now hold section-local state only, such as the selected
Knowledge Collection (`?c=`). The Overview route retains a compatibility adapter that redirects former
`?page=<section>&flowId=...` URLs to the canonical nested route.

**SETUP nav** (`components/shell/nav.ts` + `components/app-sidebar.tsx`) with an explicit `enabled`
flag per item:

| Section | slug | Status |
|---------|------|--------|
| General | `general` | ✅ enabled |
| Knowledge | `knowledge` | ✅ enabled |
| AI Tutor | `ai-tutor` | ⬜ disabled ("Coming soon") |
| AI Feedback | `ai-feedback` | ⬜ disabled |
| Flows | `flows` | ✅ enabled |
| Help Desks | `help-desks` | ✅ enabled |
| Style | `style` | ⬜ disabled |
| Authentication | `authentication` | ⬜ disabled |
| Publish | `publish` | ✅ enabled |

> Note the divergence from the full target map in CLAUDE.md §4: the target editor has 9 live
> sections; **this repo ships 5** (General, Knowledge, Flows, Help Desks, Publish). Style &
> Authentication are stubbed nav entries, not routes.

### 2.4 Key components

| Component | File | Role |
|-----------|------|------|
| `SetupNav` | `components/assistant/setup-nav.tsx` | Left rail; enabled/disabled sections |
| `GeneralForm` | `components/assistant/general-form.tsx` | Title/nickname/model+provider/welcome/suggested Qs/style |
| `KnowledgeClient` | `components/assistant/knowledge-client.tsx` | Collections, sources (text/url/file/website), FAQs |
| `FlowBuilder` | `components/assistant/flow-builder.tsx` | Trigger→Conditions→Response editor (UI covers all 12 action types even where runtime is inert) |
| `PreviewPanelLauncher` / `PreviewPanel` | `components/assistant/preview-panel-launcher.tsx` | Opens the code-split live preview, which streams from `/api/preview/chat`; history; per-message feedback |
| `PublishClient` | `components/assistant/publish-client.tsx` | Create/view/republish Publication snapshots |
| `HelpDeskManage` / `ChannelPanel` | `components/help-desks/*` | Desk + typed Support Channel editor (setup/form/conv-data/availability) |
| `WidgetChat` | `components/widget/widget-chat.tsx` | Public widget client; consumes the ndjson stream |
| `InsightsClient` | `components/insights/insights-client.tsx` | Overview analytics (filtering + KPI/chart computation lives in the pure, unit-tested `lib/insights/kpi.ts`; the component wraps it in `useMemo` and attaches series colors) |

### 2.5 Streaming client contract

Both the widget (`WidgetChat`) and the admin `PreviewPanel` consume the **same ndjson event stream**
(`RuntimeEvent`, `lib/runtime/types.ts`): `turn` → `flow` → `step`* → (`text-start`/`text-delta`*/`text-end`)
and/or `part`* → `done` | `error`. `step` events are the visible **Thinking Steps**; `part` events
carry non-text reply parts (help-desk button, follow-ups, button, iframe, sources). The early `turn`
event exposes the resolved conversation id before generation, allowing Preview to steer an active
turn without forking a new conversation. Both clients
decode and fold the stream through one client-safe module — **`consumeTurnStream`**
(`lib/runtime/stream.ts`, unit-tested): ndjson buffering, delta accumulation into a text part, error
degradation. Components differ only in their `onDone`/`errorText` hooks, so the wire contract has
exactly one producer (`lib/runtime/turn.ts`) and one consumer. This is why preview and production
render identically.

---

## 3. Auth, multi-tenancy & RBAC

- **Auth**: Supabase Auth (SSR cookies via `@supabase/ssr`, `lib/supabase/server.ts`). `getSession()`
  (`lib/auth.ts`) returns `{ userId, email, organization|null, role|null, demo }`. A signed-in user
  with no org → `/onboarding`.
- **Demo mode**: when Supabase env vars are absent, `getSession()` returns a hardcoded demo org +
  owner and the app runs entirely on the mock `Db`. This is how the repo runs with zero configuration.
- **Tenancy**: every domain row is org-scoped (directly or via `assistant → organization_id`).
  Isolation is enforced **twice**: Postgres **RLS** on every table (defence in depth) *and*
  server-action RBAC checks before each mutation.
- **RBAC** (`lib/rbac.ts`, mirrored by SQL `role_rank()` in `0003_multi_tenant.sql`):
  `owner=4 > admin=3 > editor=2 > viewer=1`. `canEdit ≥ 2` (assistants/flows/knowledge/help-desks),
  `canPublish ≥ 3` (publish + delete assistants), `canManageMembers ≥ 3` (invites, provider keys),
  `canChangeRoles ≥ 4` (owner only). Server actions consume these only through
  **`requireMember(capability)`** (`lib/authz.ts`, unit-tested) — extending the role model (e.g. the
  target 5-tier set) means touching `rbac.ts` + `authz.ts`, not 50 call sites.

> **Roadmap gap** (CLAUDE.md §2): the target role model has **5 tiers**
> (Super Admin/Admin/Collaborator/Support Agent/Data Viewer). This repo has **4** — no Support Agent
> or Data Viewer equivalent.

---

## 4. Data layer & the `Db` seam

`packages/db` is a self-contained data package with **one interface, two implementations**:

- **`types.ts`** — all domain types **and** the `Db` interface (~45 methods). This is the contract
  every consumer codes against.
- **`mock.ts`** — in-memory `MockStore` (Maps per entity), stashed on `globalThis.__agentHubMock` to
  survive Next HMR, richly seeded (demo org, 6 assistants w/ default flows, 6 help desks, an inbox
  conversation + linked improvement). No external deps.
- **`supabase.ts`** — `createSupabaseDb(client)`: RLS-scoped queries, server-side joins, and RPCs
  (`create_organization`, `accept_invite`, `match_chunks`, `next_improvement_seq`). Vector search with
  a **lexical fallback** when no embedding is available.
- **`index.ts`** — the switch: `isSupabaseConfigured()` (checks `NEXT_PUBLIC_SUPABASE_URL` +
  anon key), `createDb(client)`, `getMockDb()`. `apps/web/src/lib/data.ts` picks per request.
- **`id.ts`** — `shortId()` 12-char slug (dash at position 8) used as the **text primary key** for
  content rows (assistants, flows, conversations, …); org/user/invite tables use Postgres `uuid`.

### 4.1 Schema (16 migrations → 19 tables)

Migrations `0001_init` → `0016_improvements` (note: **0016**, not 0015 — the Improvements feature is
built). Grouped:

- **Tenancy**: `organizations`, `organization_members` (PK `(org,user)`, `org_role` enum),
  `organization_invites` (token), `profiles` (mirrors `auth.users` for RLS). Helpers:
  `role_rank`, `is_org_member`, `has_org_role`; RPCs `create_organization`, `accept_invite`.
- **Assistants & flows**: `assistants` (text PK; `organization_id`, `model_provider`, `model_id`,
  `style` jsonb, `allowed_domains` text[], `help_desk_settings` jsonb), `flows` (text PK; `actions`
  text[], `custom_message`, `trigger_kind`, `condition_logic`, `conditions` jsonb, `action_settings`
  jsonb, `is_default`).
- **Knowledge (OKF + RAG)**: `knowledge_collections` → `sources` (`kind` file|url|text|website,
  `status`, `config` jsonb, crawl finalizer lease/attempt timestamps) → `concepts`
  (`frontmatter` jsonb, `body` md, `path`, `excluded`) →
  `concept_chunks` (`embedding vector(1536)`, **HNSW** `vector_cosine_ops` index). RPC `match_chunks`.
- **Conversations**: `conversations` (subject member|visitor, `metadata` jsonb, `pinned`),
  `messages` (`content` jsonb parts, `flow_id`/`flow_name`, `feedback` −1|0|1).
- **Provider connections**: `provider_connections` (`type` platform|subscription|api_key|federated,
  `provider`, `encrypted_key`, `config`). `api_key` stores encrypted BYOK secrets; `federated`
  stores only non-secret tenant enterprise config and must have `encrypted_key = null`.
- **Publish**: `publications` (`version`, `config` jsonb snapshot, unique `(assistant, version)`).
- **Help desks**: `help_desks` (`ticketing_integration` jsonb sealed), `support_channels` (`kind`,
  `config`/`form`/`conversation_data`/`availability` jsonb).
- **Improvements**: `improvements` (`seq` per-org human key, status/priority/tags/assignee/due_date),
  `improvement_counters` (monotonic `next_seq`, RPC `next_improvement_seq`),
  `improvement_messages` (M:N improvement↔message).

**RLS pattern**: every table has RLS; members read within their org, `editor+` create/update, `admin+`
delete/manage; secret-bearing writes (counters) go through `security definer` RPCs. Encrypted secrets
(`provider_connections.encrypted_key`, `help_desks.ticketing_integration`) are **AES-256-GCM**, sealed
app-side (`lib/runtime/crypto.ts` `sealSecret`/`openSecret`) — Postgres never sees plaintext.

---

## 5. The two-engine runtime  →  see [ADR-0003](adr/0003-two-engine-runtime.md)

There are **two** implementations of "route a message to a Flow", unified behind the
widget/preview entrypoint `runAssistantChat` (`apps/web/src/lib/runtime/engine.ts:233`). Since
spec #194 the deterministic side is a **router only** — action *rendering* has exactly one home,
the runtime's `ACTION_HANDLERS` registry, and the runtime owns the `ChatReplyPart` wire contract
(exported type-only via `@/lib/runtime/client`):

| | LLM runtime | Deterministic router |
|---|---|---|
| Function | `runAssistantChat` (`apps/web/.../runtime/engine.ts`) | `matchFlow` / `messageFlowCandidates` (`packages/db/src/engine.ts`) |
| Intent routing | `classifyIntent` — **`generateObject` on a cheap classifier model**, flows rendered as a catalog w/ conditions + few-shot examples (`engine.ts:73`) | keyword/token scoring, `MATCH_THRESHOLD = 3`, hardcoded built-in triggers |
| Knowledge | real RAG agent loop (`streamText` + `searchKnowledge` tool, `stepCountIs(5)`, cited Sources) | n/a — routing only, never renders |
| Output | streamed ndjson (`text-delta`, `part`) | the matched `Flow` (or null) |
| Used by | `/api/widget/[id]/chat`, `/api/preview/chat` (including no-provider action execution) | classifier fallback (no model / empty candidates / error) |

**How they connect**: `runAssistantChat` resolves a chat model + classifier from the org's
Provider Connections. If **no model is available anywhere**, it routes with `matchFlow` and still
executes the same `ACTION_HANDLERS` registry; `search_knowledge` switches to a real lexical search.
It emits the **same wire events**, so the UI is identical and non-generative effects remain live. If
a model exists, `classifyIntent` routes via LLM and falls back to `matchFlow` only on
empty-candidates/error.

### 5.1 Flow Action handlers (the registry seam)

The LLM runtime does **not** dispatch actions with an inline `switch` — it walks `flow.actions` and
looks each up in **`ACTION_HANDLERS`** (`apps/web/src/lib/runtime/actions.ts`), a
`Record<FlowAction, ActionHandler>`. Each **handler** is one **Adapter**:
`(ctx: ActionContext) => Promise<ActionResult>` — it emits its own wire events via `ctx.emit`, returns
the reply `parts` (for persistence), and may request deferred **effects** or `halt` the flow. **Adding
a Flow Action is one Adapter + one registry entry** — not edits across two engines (the win over the
old double-`switch`; see ADR-0003). The engine wraps each handler in a try/catch, so one failing action
degrades to a fallback part instead of killing the turn.

| Action | Behavior |
|--------|----------|
| `custom_message` | `flow.customMessage` **verbatim** (never model-rewritten) |
| `search_knowledge` | Generative agent loop: `streamText` + `searchKnowledge` tool (≤5 steps) → text + dedup'd `sources`; `escalatePrompt` adds a help-desk button when nothing grounded the answer |
| `suggest_help_desk` | Help-desk button (`helpDeskSettings.contactButtonLabel`) |
| `follow_up_questions` | Up to 3 `suggestedQuestions` |
| `show_button` / `iframe` | Emit if `actionSettings.{show_button.url, iframe.url}` set |
| `improvement` | Silent — requests a `create_improvement` **effect** (creates + links an Improvement to the persisted answer) |
| `api_request` | Full request core (`api-request.ts`): auth (bearer/api-key/basic), headers, query params, body template, template-vars (origin locked to config-time host), JSON-path extraction → template patch, egress-guarded, 10s timeout |
| `send_email` | Requests a `send_email` **effect** delivered through the one email transport (`email.ts` `sendEmail` — Resend HTTP API via `RESEND_API_KEY`+`EMAIL_FROM`; also used by Improvement notifications and the escalation email channel). Reports `{delivered}`/`{reason}`; when unconfigured the handler emits honest "couldn't forward" copy and requests no effect |
| `handover` | Acknowledges + **halts** the flow. Continuing inside the target Assistant is a follow-up (#314) |

**Deferred effects** (`ActionEffect` in `types.ts`): handlers stay pure — they *request* effects
(`create_improvement`, `send_email`); the **route** applies them via `applyEffects` (`effects.ts`)
**after** persisting the assistant message, so `improvement` links to the real message id and
`send_email` only fires on a committed turn. Each effect is isolated — a failing effect never breaks
the reply the user already received. This keeps handlers unit-testable (assert *which effect* they
request, with no db).

### 5.2 Conditions & triggers — what actually runs

- **Conditions** (`conversation_context` w/ few-shot examples) are **fed to the LLM classifier as
  routing context** (`flowCatalogEntry`, `engine.ts:49`) — they *influence* routing but are **not
  evaluated as hard gates**. The richer condition types in the FlowBuilder UI (User role, URL,
  External data, Course, Schedule) are **[target]** — not yet in the `FlowCondition` model or the
  classifier.
- **Triggers**: only `message`-triggered flows compete for user messages (`engine.ts:80`).
  `page_load` / `time_on_page` / `chat_open` are stored on the flow but **not fired** by any runtime
  path yet **[target]**.

### 5.3 Runtime invariants (must hold; see context.md)

1. Flows are an **authoritative router**: the model picks *which* flow (classification), then the
   flow's actions execute in order — the model never overrides the flow.
2. `custom_message` is **verbatim**.
3. Generative behavior lives **inside** `search_knowledge` (and the Default behavior), never above the
   router.

---

## 6. Widget chat request flow (end-to-end)

```
Browser (WidgetChat)
  │  POST /api/widget/{assistantId}/chat  { visitorId, conversationId?, collectionId?, message }
  ▼
Route handler (app/api/widget/[assistantId]/chat/route.ts, maxDuration 300s, CORS via allowed_domains)
  │  1. load latest Publication snapshot (NOT live config), resolve connections
  ▼
Conversation Turn module (lib/runtime/turn.ts → streamConversationTurn)
  │  2. get/create conversation (reused only if subject+assistant match), append user message
  │  3. runAssistantChat({ assistant, flows, connections, message, history, searchKnowledge, emit })
  │        emit → ndjson: turn, flow, step*, text-delta*, part*, done
  │  4. persist assistant message (content parts, flow_id/flow_name), applyEffects, emit done
  ▼
Browser renders stream incrementally; feedback via POST /api/widget/{id}/feedback
```

Steps 2–4 — the **Conversation Turn** (see context.md) — live in one module,
`lib/runtime/turn.ts`: get-or-create conversation, history assembly, knowledge-search wiring,
user/assistant message persistence, deferred-effects application, and the ndjson stream framing
(`NDJSON_HEADERS` + one JSON `RuntimeEvent` per line). The two chat entrypoints are thin adapters
over this seam and differ only in what they feed it.

Companion widget endpoints: `GET /config` (public published config), `GET /conversations`
(visitor history by `visitorId`), `POST /feedback`. All four widget routes enter through
**`resolveWidgetContext`** (`lib/widget-db.ts`): it resolves the latest Publication, derives CORS
from its allowed domains, and returns the uniform `{"error":"not_published"}` 404 — routes are thin
adapters over it (plus a shared `widgetOptions` preflight). Publication resolution is **cached**
(`getLatestPublicationCached`, `unstable_cache` tagged per assistant) and invalidated by
`invalidatePublication()` at the moment of Publish — widget requests don't pay a Postgres round-trip
for a snapshot that only changes on Publish. Demo/mock mode bypasses the cache (deterministic
offline reads, ADR-0003). **Preview** uses `POST /api/preview/chat`
— session-gated, subject_type `member`, and it **re-reads live flows/connections each message** (so
editor changes take effect immediately, unlike the widget which is pinned to the Publication).

---

## 7. Knowledge & RAG pipeline (OKF → chunks → pgvector) → see [ADR-0002](adr/0002-knowledge-as-okf-bundles.md)

Ingestion (server actions in `actions.ts` are thin adapters; runtime in `lib/runtime/`):

- **Extraction seam** (`lib/runtime/extract.ts`, unit-tested): the **Extractor** registry
  (`EXTRACTORS`, keyed by input kind — same pattern as `ACTION_HANDLERS`) turns raw input into
  `{name, text}`: `text` passthrough, `url` (fetch + **cheerio** HTML→text with entity decoding,
  block-boundary spacing, and `<title>` as the Source name), `file` (`unpdf` for PDF, `mammoth` for
  DOCX, plain text). Server actions call `extractSourceText` and never parse anything inline.
- **Ingestion Jobs** (`lib/runtime/jobs.ts`, unit-tested): the OKF pipeline and website crawls run
  **off the request path**. `enqueueIngestJob` is the in-process deferred adapter (Next `after()`);
  `runIngestJob` rehydrates everything from the `Db` (the payload is JSON-serializable on purpose,
  so a queue-backed adapter can replace `enqueueIngestJob` without touching callers). Progress and
  failures land in the Source `status` lifecycle (`processing` → `ready`/`error`), which
  `KnowledgeClient` polls (3s `router.refresh()` while any Source is processing).
- **Sources** by kind: `text`, `url`, `file`, `website` (configured crawler provider + a persisted
  resolved provider/run identity → one Concept per page; `recrawl` replaces the prior pages), plus
  **FAQ** Concepts (`createFaqAction`,
  `frontmatter.type = "FAQ"`). The cron claims crawls atomically with a renewable lease; a
  least-recently-attempted partial index bounds each sweep and prevents a widget poll from
  finalizing the same crawl concurrently.
- **Website crawl safety** (`lib/runtime/crawl-target.ts`, `pinned-fetch.ts`): every provider rejects
  non-HTTP(S), credentialed, loopback/private/link-local/metadata, and privately-resolving start
  targets before submission. Local also revalidates every redirect, enforces same-origin traversal,
  pins connections to the public DNS answer that passed validation, limits responses to 5 MB, and
  has page plus total deadlines. The remote providers (Apify, Crawl4AI) receive the validated
  hostname and resolve it in their own network; remote DNS pinning is therefore outside this
  process's boundary. Crawl4AI credentials are server-only and redacted from any Source error,
  Alert, or telemetry.
- Each Source is enriched into **Concepts** (OKF markdown + YAML frontmatter), then chunked and
  **embedded**. `concepts.excluded` drops a page from retrieval without deleting it.
- **One write seam** (`lib/runtime/ingest.ts`): every route that lands knowledge —
  enriched source (`ingestSource`), crawled page (`crawlWebsiteSource`), FAQ (`createFaqAction`) —
  goes through **`persistConcept`** (create Concept + `embedConcept` index, title-prefixed). The
  website route owns the whole Source status lifecycle, so a config/crawl/ingest failure lands in
  exactly one `error` update (no double-catch). `chunkMarkdown` + `persistConcept` are unit-tested.
- **Embeddings** (`lib/runtime/embeddings.ts`): fixed `DIMS = 1536`, **zero-padded** so every provider
  shares one pgvector column + HNSW index (cosine is unaffected by padding). Model preference:
  OpenAI `text-embedding-3-small` → Google `text-embedding-004` → **null ⇒ lexical fallback**
  (Anthropic has no embeddings API).
- **Retrieval**: `match_chunks(assistant_id, collection_id, query_embedding, k)` cosine search;
  results resolve to **Concept → Source** so replies cite named Sources, never opaque chunks.

> The 1536-dim padding is a deliberate trade-off (one shared index vs. cross-model similarity caveats
> and a costly future dimension migration); rationale kept inline here rather than as its own ADR. The
> invariant lives in `padEmbedding` (`embeddings.ts`, exported + unit-tested, incl. cosine-preservation).

**Citation rendering** is one shared component — `CitationList` (`components/chat/citation-list.tsx`) —
used by the widget, the admin Preview, and the Inbox transcript. Since citations always resolve to a
Concept → Source (ADR-0002), the chip that displays that shape lives in one place; the three surfaces
differ in theming/interactivity for other reply parts but not for citations.

---

## 8. Providers, models & secrets -> see [ADR-0007](adr/0007-retire-subscriptions-federated-credentials.md)

- **Provider Connections** (`provider_connections`): `platform` (our keys), `api_key`
  (BYOK, encrypted, validated live on connect via `lib/runtime/validate-key.ts`), and `federated`
  (tenant-billed keyless enterprise auth; no stored secret). Legacy `subscription` rows are retired
  and never resolve as hosted credentials. Local demo Preview invokes authenticated Codex/Claude
  CLIs directly. Hosted Preview uses a signed desktop connector: the server queues an opaque model
  invocation, the paired Member's connector claims it, invokes the official CLI locally, and returns
  only the model result plus provider-reported token counts. Local default-model selection is source-qualified and
  a local override is accepted only for a provider verified by that Member's relay. Credentials remain
  on the Member's device. The generic macOS `.pkg` installs a per-user LaunchAgent;
  the Windows NSIS `.exe` installs under `%LOCALAPPDATA%` and registers only per-user
  `HKCU` startup/uninstall entries, without administrator elevation. Both pair after
  install to the current Member + Organization. If a deployment has neither a
  configured signed-asset URL nor a bundled binary, the authenticated route emits
  a small per-user setup ZIP for the selected OS instead of a JSON error (ADR-0015).
- **Resolution** (`lib/runtime/models.ts`): `resolveProviderCredential(provider, connections, resolution)`
  returns a credential capability (`api_key`, `platform`, or provider-specific federated capability)
  instead of assuming every connection is an API key string. BYOK wins, then federated, then platform
  env fallback. `resolveProviderKey` remains only as a compatibility wrapper for static-key callers.
  Google Vertex federated runtime uses Vercel OIDC + GCP WIF through `lib/runtime/google-vertex.ts`.
  Anthropic WIF and Azure OpenAI are modeled in `ProviderConnection.config` for follow-up adapters;
  Azure OpenAI is distinct from direct OpenAI because it has endpoint, deployment and Entra config.
  `getChatModel(provider, modelId, connections, resolution)` and
  `getClassifierModel(provider, connections, resolution)` return AI-SDK clients. Model catalog
  (`lib/runtime/catalog.ts`): Anthropic `claude-opus-4-8` / `claude-sonnet-5` / `claude-haiku-4-5`;
  OpenAI `gpt-5.1` / `gpt-5.1-mini`; Google `gemini-3.5-flash` / `gemini-3.1-flash-lite`. The
  **classifier** uses a cheap model tier (haiku / mini / flash-lite).
- **Secrets**: AES-256-GCM via `lib/runtime/crypto.ts`, key from `APP_ENCRYPTION_KEY`. Sealed
  values: BYOK keys, ServiceNow ticketing creds (`clientSecret`/`password` are redacted before any
  payload reaches the client — see `help-desks/[deskId]/page.tsx`).

---

## 9. Publishing model (immutable snapshots)

`publishAssistantAction` captures a **`Publication`**: a versioned, immutable jsonb snapshot of the
assistant config + all flows + collection references. The snapshot's field selection lives in one
tested place — **`buildPublicationConfig(assistant, flows, collections)`** (`packages/db/publication.ts`),
so a newly-added `Assistant` field can't silently be omitted from new Publications (a unit test asserts
the captured key set). The widget always serves the **latest** Publication (`/widget/[id]` and
`/api/widget/[id]/*` read the snapshot, not the live row), so admin edits are invisible to end users
until the next publish; `republishAction` restores an older snapshot as a new version. Both publish
actions call `invalidatePublication(assistantId)` (`lib/widget-db.ts`) so the per-assistant
Publication cache is busted exactly when a new version exists — "latest" stays exact without
re-querying per request. Rationale
(safety/rollback vs. staleness) is captured here rather than a separate ADR because the README already
states it.

---

## 10. Extension seams (where to plug in)

| Add a… | Steps |
|--------|-------|
| **Flow action type** | 1) add to `FlowAction` union (`packages/db/types.ts`); 2) optional per-action config in `FlowActionSettings`; 3) add one **Adapter** + register it in `ACTION_HANDLERS` (`apps/web/src/lib/runtime/actions.ts`) — the single home for action rendering (spec #194; the offline/no-model path runs the same registry); if it has a post-commit side effect, add an `ActionEffect` kind (`types.ts`) + a case in `effects.ts`; 4) extend the `ChatReplyPart` union (`runtime/types.ts`) if the action renders a new part shape; 5) add builder UI in `flow-builder.tsx` + catalog in `lib/flow-actions.ts`. |
| **Flow condition kind** | Extend `FlowCondition` to a discriminated union (`types.ts:29`); teach `classifyIntent`/`flowCatalogEntry` to render + weigh it (`engine.ts:49`); for hard gating, evaluate it before/around classification. (Today only `conversation_context` exists and it's soft context.) |
| **Trigger** | Add to `FlowTrigger` (`types.ts:16`); the *message* path only routes `message` flows — non-message triggers need a client event + a new runtime entry to fire them. |
| **Knowledge source kind** | Add to `SourceKind` (`types.ts:358`) + a config shape; add one **Extractor** to `EXTRACTORS` (`lib/runtime/extract.ts`) for its raw-input→text step; if it needs its own pipeline (like `website`), add an `IngestJob` kind (`lib/runtime/jobs.ts`); add a server action; retrieval already flows through chunks. |
| **Provider** | Add to `Provider` union + `MODEL_CATALOG` (`catalog.ts`); wire the AI-SDK client in `models.ts` (+ embeddings if available). |
| **Runtime public capability** | The chat runtime is a **deep, gray-box module** (ADR-0005): add the capability inside `lib/runtime/` freely, then decide if it's public — if so, export it from the right barrel (`index.ts` server / `client.ts` client-safe) **and** update `interface.test.ts`. Consumers import `@/lib/runtime` or `@/lib/runtime/client`; importing an internal (`@/lib/runtime/<file>`) from outside the folder is a lint error. |

**Golden rule** (context.md invariant): new generative behavior belongs **inside an action**
(like `search_knowledge`), never above the router.

**Runtime module boundary** (ADR-0005): `lib/runtime/` exposes exactly two entry points —
`@/lib/runtime` (server) and `@/lib/runtime/client` (client-safe). A `no-restricted-imports` lint
rule forbids deep imports into the module from outside; the barrels' export shape is locked by
`interface.test.ts`. Read the barrels to learn what the runtime does; open internals only to change
behavior. (Security sealing lives in `lib/crypto.ts` and improvement-email templates in
`lib/notify.ts` — deliberately *outside* the runtime, since they aren't chat.)

---

## 11. Environment & running

- **Zero-config demo**: with no Supabase env, the app runs on the mock `Db` + demo session (seeded
  org/assistants). Chat uses the deterministic engine unless an LLM key is present.
- **Full stack**: set `NEXT_PUBLIC_SUPABASE_URL` + anon key (+ service role where needed),
  `APP_ENCRYPTION_KEY` (secret sealing), provider keys (`ANTHROPIC_API_KEY` etc. as platform keys or
  via org BYOK), and optionally `APIFY_API_TOKEN` for Apify website crawls. Local crawling needs no
  crawler credential. Apply `supabase/migrations/*` in order;
  `seed.sql` loads the demo org + 8 assistants.

---

## 12. Status snapshot (what actually runs today)

- **Live**: multi-tenant admin (Assistants/Knowledge/Flows/Help Desks/Publish), LLM widget runtime
  (classifier routing + RAG agent loop + streaming), OKF knowledge (text/url/file/website/FAQ) with
  pgvector + lexical fallback, Publications, Inbox, Insights overview, Improvements (schema + actions),
  provider connections (platform + BYOK), 4-role RBAC + RLS.
- **Tests**: offline Vitest unit suites (~100 tests across `apps/web` + `packages/db`) — see the
  coverage list in §1 (`pnpm test`).
- **Ingestion**: extraction behind the `EXTRACTORS` registry (cheerio HTML→text, PDF, DOCX, plain
  text) and the pipeline running off the request path as **Ingestion Jobs** (in-process `after()`
  adapter; queue adapter is a later swap). The Knowledge UI polls Source status while processing.
- **Flow Actions** — all 10 now dispatch through the handler registry (`actions.ts`): `improvement`
  (creates + links an Improvement, via a deferred effect), `api_request` (full config: auth/headers/
  query/body/JSON-path/template-vars, egress-guarded), `handover` (acknowledge + halt),
  `send_email` (deferred effect via the **Resend** email transport; honest copy when unconfigured).
- **Escalation & desks**: the escalation email channel sends for real and reports non-delivery to
  the widget (mailto fallback); **"AI recommended help desk"** is live — the turn resolves the
  selected desks and a cached classifier pick attaches `helpDeskId` to escalation chips.
- **FAQ quick replies** answer with the curated FAQ Concept body **verbatim** (no model call,
  cited), via `Db.findFaqConcept` + a Conversation Turn short-circuit.
- **Retrieval hardening**: `searchChunks` tops up partial vector results with lexical matches
  (null-embedding chunks are never masked); `match_chunks` filters `concepts.excluded` in SQL.
- **[partial]**: `handover` doesn't yet continue inside the target Assistant (#314); embedding
  failures still degrade silently to null embeddings with no Alert/backfill (#312); ticket/
  salesforce/api_endpoint channels render info-only in the widget (#315).
- **[stored-but-inert]**: non-message triggers; rich condition types (role/url/course/schedule).
- **⬜ disabled UI**: Style, Authentication, AI Feedback editor sections. AI Tutor is out of scope
  (removed from the SETUP nav; no `study_mode`/`h5p` flow actions).
- **provider connections**: API keys remain supported; hosted consumer subscription credentials are
  retired (see ADR-0007). Per-Member local subscriptions can resolve only for Preview through the
  direct local adapter or paired connector relay; Widget resolution excludes them (ADR-0015). Federated/keyless
  auth is implemented for Google Vertex runtime and modeled for Anthropic WIF + Azure OpenAI follow-up
  adapters. Platform-plan billing (Stripe) is the remaining tier.
- **Enforced deep modules**: `packages/db` (the `Db` seam, contract-tested) and `lib/runtime` (barrel
  + `no-restricted-imports` boundary, surface locked by `interface.test.ts` — ADR-0005) are the two
  modules whose interfaces the tooling enforces; the rest of `apps/web` composes over them.

Keep this section honest — it's the fastest way for a new contributor (human or agent) to know what to
trust versus what to build.
