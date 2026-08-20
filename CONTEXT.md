# Agent Hub

Multi-tenant SaaS admin platform where each company configures, tests and publishes its own AI assistants (chatbot widgets embeddable on the company's websites).

Every term below is encoded as a type in **`@agent-hub/core`** (`packages/core/src/types.ts`), and the
pure functions that derive facts from those terms live beside them (ADR-0019). Add the term here
first, then the type.

## Language

**Organization**:
A tenant company with its own isolated workspace of assistants and members.
_Avoid_: company, azienda, workspace, tenant (in code)

**Assistant**:
A configurable AI chatbot owned by one Organization, edited in the admin and published as a widget.
_Avoid_: agent, agente, bot, chatbot (as entity name)

**Member**:
A person (Supabase Auth user) belonging to one Organization with exactly one Role.
_Avoid_: user (ambiguous with widget end users), account

**Role**:
A Member's permission level: Owner, Admin, Editor or Viewer. Publish and member management require Owner/Admin; Editors edit and test assistants; Viewers only read and test.
_Avoid_: permission, group

**API Key**:
An Organization-scoped credential (`ciele_sk_…`) for programmatic access (CLI, MCP server, public API). Minted by an Admin+ Member, it acts with a Role capped at its creator's; only the secret's hash is stored, and revocation keeps the row for audit.
_Avoid_: token (ambiguous with invite tokens and LLM tokens), PAT

**Knowledge Collection**:
A named group of knowledge, anchorable in chat as context and represented as an OKF bundle. Owned by the Organization (PRD #726); each org has a default "Knowledge Library" Collection that hub-created items land in. It says nothing about which Assistant answers from a Source, the column that used to name an owning assistant is gone (#741), so **an assistant-scoped read narrows by the Assistant Knowledge Link, never by collection membership**.
_Avoid_: course (education-specific label), folder, dataset

**Source**:
An original artifact (file, URL, crawled website, pasted text, or FAQ) from which Concepts are derived; cited in chat replies. Every knowledge item on the hub is a Source, a FAQ's question is its Source name, the answer stays on its Concept.
_Avoid_: document (ambiguous), attachment

**Library**:
The org-level knowledge page (`/library/[tab]`, sidebar label **Library**): every Source across all Assistants in per-kind tabs (Websites / Files / FAQs), with linked-assistant chips, filters, add flows, and Direct access management. Renamed from "Knowledge Hub" so the sidebar stops showing two rows called Knowledge, the per-Assistant SETUP section keeps that name. Its one ambiguity is deliberate: "Library" is the page, while "Knowledge Library" is the default Collection the page writes into.
_Avoid_: knowledge bank (reference-platform phrasing), hub (the shipped label is Library)

**Assistant Knowledge Link**:
The M:N row tying one Assistant to one Source, what makes the Source answer for that Assistant. Replacing the set takes effect immediately in retrieval (knowledge is live, never snapshotted into Publications). Carries the per-assistant Direct access flag.
_Avoid_: share, subscription

**Direct Access**:
Per-(assistant, file) flag, default off: on, chat users can open the cited file's original from the AI chat via a short-lived signed URL; off, the file is still cited inline but the link stays hidden.
_Avoid_: public file, download toggle

**Concept**:
One OKF v0.2 markdown document (YAML frontmatter + body) inside a Knowledge Collection, the unit the agent reads, links and cites. Its frontmatter carries provenance and trust: `generated` (who wrote it), `verified` (who confirmed it), `sources` (what it derives from).
_Avoid_: page, note, chunk

**Actor**:
The OKF identity string on `generated.by` / `verified[].by`: `<producer>/<version>` for an agent, `human:<id>` for a person, `process:<id>` for an automated process. Build them with `okfActor`, never by hand, the `human:` prefix is what distinguishes a human review from a machine one.
_Avoid_: author, user (both ambiguous across the three forms)

**Trust tier**:
The level derived from a Concept's `verified` field, unverified, machine-confirmed, or human-reviewed. Derived at read time, never stored, and advisory only: it never gates retrieval.
_Avoid_: confidence, score, credibility (OKF records signals, not verdicts)

**Publication**:
An immutable, versioned snapshot of an Assistant's config (General, Flows, Knowledge references, model) created by Publish; the live widget always serves the latest Publication. Rollback = republishing a previous one.
_Avoid_: deploy, release, version (alone)

**Widget**:
The embeddable chat UI (floating launcher button or iFrame) served on a customer website, always backed by a Publication.
_Avoid_: plugin, floater (in code), chatbot

**Visitor**:
An anonymous end user of a published widget, identified by a persistent `visitor_id` in the host site's localStorage (no login at day one; SSO is a later phase).
_Avoid_: user (ambiguous with Member), student, customer

**Conversation**:
A persisted chat thread between one Visitor (or Member, in Preview) and one Assistant, optionally anchored to a Knowledge Collection; listed in the History sidebar.
_Avoid_: chat, session, thread

**Context Hint**:
A parameter the host page passes to the embedded widget (e.g. which Knowledge Collection to anchor), how the "Current course" chip gets pre-filled.
_Avoid_: page context, metadata

**Deep Search**:
A composer mode that gives the agent loop more iterations and multi-hop navigation of the OKF graph (index → linked Concepts → Sources), knowledge-only, never the open web.
_Avoid_: web search, research mode

**Provider Connection**:
An Organization's configured way to reach an LLM. Current types are Platform plan (bundled models), API key (BYOK, encrypted), and Federated (tenant-billed keyless enterprise auth such as Google Vertex, Anthropic WIF, or Azure OpenAI). Legacy Subscription rows are retired and never power runtime traffic.
_Avoid_: integration, LLM config

**Flow**:
A rule attached to an Assistant that starts on a **Flow Trigger** and executes an ordered list of Flow Actions. A message-triggered Flow is matched to an incoming user message by Intent Classification; a proactively-triggered one starts on a client event, with no message to match.
_Avoid_: workflow, intent

**Flow Trigger**:
The event that starts a Flow: **User sends a message** (the reactive path) or one of the three **proactive** events, **On page load**, **Time on page** (after a configured dwell), **Chat opens**. Exactly one per Flow. A proactive Flow needs no Intent Classification and runs a single **Notification**.
_Avoid_: event (alone), hook

**Flow Action**:
One step a matched Flow executes: search knowledge, custom message, basic reply, suggest help desk, follow-up questions, notification.
_Avoid_: step, tool

**Basic Interaction**:
The built-in Flow, first in priority, that answers conversational courtesy, a greeting, a thanks, a farewell, an acknowledgement, rather than an information need. Its single Flow Action, **Basic reply**, produces one generated sentence or two with no retrieval, no tools and no citations; a configured message pins the wording and skips the model. Counted as an AI answer, never graded (nothing was cited, so there is nothing to grade against).
_Avoid_: small talk (in UI), chitchat, greeting flow

**Notification**:
The proactive Flow Action: an unprompted in-widget message from the Assistant, delivered when a proactive Flow Trigger fires. Verbatim like a custom message, bounded by a delivery rule (once per Conversation / once per Visitor / every time), and the only action a proactive Flow may run. Distinct from an **Alert**, which is an operational health notice for admins, that term's `_Avoid_: notification` guidance is about not calling Alerts notifications, and does not reserve the word.
_Avoid_: alert, push, banner

**Default behavior**:
The locked, always-last Flow that handles any message no other Flow matches.
_Avoid_: fallback flow (in UI)

**Intent Classification**:
The cheap LLM call that identifies matching enabled Flows and routes to the highest-priority one (top-to-bottom configured order; replaces keyword matching with the same `matchFlow` seam).
_Avoid_: routing model, matcher

**Thinking Steps**:
The user-visible trace of what the runtime did for a reply (classify → search → generate), expandable in the chat UI.
_Avoid_: reasoning, chain of thought (in UI)

**Conversation Turn**:
One user message and everything the runtime does to answer it: get-or-create the Conversation, persist the user message, route through the flow engine, persist the reply with its flow markers, apply deferred effects, stream Thinking Steps + reply. One module (`packages/agent/src/turn.ts`) owns it; Widget and Preview are thin adapters over it.
_Avoid_: exchange, round, request (alone)

**Extractor**:
One adapter in the Source text-extraction registry (`packages/agent/src/extract.ts`) that turns one
SourceKind's raw input (pasted text, a URL, uploaded file bytes) into plain text + a display name,
ready for OKF enrichment. Adding an ingestable kind = one Extractor + one registry entry (same
pattern as Flow Action handlers).
_Avoid_: parser (an implementation detail), converter

**Ingestion Job**:
A JSON-serializable unit of deferred knowledge-ingestion work (enrich → persist Concepts → embed,
or a website crawl) executed off the request path (`packages/agent/src/jobs.ts`); progress and failures are
tracked by the Source status lifecycle (`processing` → `ready`/`error`), which the Knowledge UI polls.
_Avoid_: background task, queue item (adapter detail)

**Knowledge Graph**:
A *derived* retrieval + learning index over a Knowledge Collection's Concepts, built by the graph
worker (cognee) as entities + typed relationships. Never the system of record, OKF stays
authoritative, and every result resolves back to a Concept → Source citation (ADR-0017, preserving
the ADR-0002 invariant).
_Avoid_: knowledge base (that's OKF), memory, vector store (that's the pgvector layer)

**Knowledge Engine**:
The per-Assistant choice of how `search_knowledge` retrieves: **Vector** (the pgvector RAG, default
and fallback) or **Graph** (answers composed from the Knowledge Graph, with the feedback loop live).
_Avoid_: retriever, backend, mode (alone)

**Retrieval Trace**:
The record of which Knowledge Graph elements produced a given answer, captured when a Graph-engine
search runs with the conversation as its session, the substrate feedback later re-weights.
_Avoid_: history, log, trace (alone)

**Suggested Fix**:
A drafted, human-approved knowledge-improvement proposal attached to an Improvement (a draft FAQ
Concept + rationale + Source refs), generated by Ciele from the flagged answer and the Member's
description. Accepting it writes a real Concept; the loop never auto-edits a tenant's knowledge.
_Avoid_: suggestion, recommendation, auto-fix

## Relationships

- An **Organization** owns many **Assistants**; every Assistant belongs to exactly one Organization
- An **Organization** has many **Members**, each with exactly one **Role** (Owner | Admin | Editor | Viewer); at least one Owner exists
- An **Assistant** owns many **Flows**; exactly one of them is the **Default behavior**
- A **Flow** starts on exactly one **Flow Trigger** and executes one or more **Flow Actions** in order
- An **Assistant** owns many **Knowledge Collections**; a Collection contains **Sources** and the **Concepts** derived from them; chat can be anchored to one Collection
- An **Organization** has many **Provider Connections**; each **Assistant** selects the provider+model it runs on
- **Subscription** Provider Connection rows are retired. After an Organization owner opts in, a Member may use a personal Claude/ChatGPT subscription only for that Member's Preview through the local connector; published Widget traffic uses Platform, API-key, or Federated Provider Connections.
- A **Visitor** has many **Conversations** with one Assistant; a Conversation may be anchored to one **Knowledge Collection** (via **Context Hint** or the composer chip)
- Publish creates a **Publication**; a **Widget** serves the latest Publication, admin edits are visible only in Preview until the next Publish
- Day-one Widget channels: Website floater (script snippet) and iFrame; campus channels (Teams, SharePoint, WordPress, …) come later

## Runtime invariants

- Flows are an **authoritative router**: Intent Classification picks the Flow, then its Flow Actions execute in order, the LLM never overrides them. A proactive **Flow Trigger** consults no model at all: the fired event selects the Flows.
- `custom_message` and **Notification** output is **verbatim**, never paraphrased by a model.
- Generative behavior (agent loop with knowledge/deep-search tools, Thinking Steps) lives **inside** `search_knowledge` and the Default behavior, not above the router.

## Example dialogue

> **Dev:** "If the professor's **Flow** has a `custom_message`, can the model reword it to fit the conversation?"
> **Domain expert:** "Never, the router picks the Flow via **Intent Classification**, and `custom_message` goes out verbatim. Only `search_knowledge` and the **Default behavior** generate text, and there the **Thinking Steps** show what the agent did."

## Scope (current phase)

**In:** Organizations + 4-role RBAC (Supabase Auth) · multi-provider agent runtime (authoritative Flow router + agent loop in `search_knowledge`/Default behavior, TypeScript, native tool-use) · Knowledge Collections as OKF bundles with pgvector RAG and Source citations · Conversations/History for anonymous Visitors with Context Hints · snapshot-based Publish with Website floater + iFrame · per-message 👍/👎 feedback · minimal Style (brand colors, logo, floater position) · Deep Search (knowledge-only).

**Out (explicitly, for later phases):** AI Tutor · AI Feedback section · full Help Desks configuration (`suggest_help_desk` keeps a single configurable link) · widget Authentication/SSO · campus channels (Teams, SharePoint, MyDay, CampusGroups, Kaltura, Google, WordPress) · billing/plans · consumer subscription reuse in published Widgets (see ADR-0007).

**Out within proactive Flow Triggers** (the rest of them ship): multiple triggers per Flow ("Add trigger") · conditions on a proactive Flow · Notification auto-delete · a separate notification inbox (a nudge lands in the Conversation; the launcher only badges itself) · delivery anywhere but in-widget.

## Flagged ambiguities

- "agente" (spoken wording) vs **Assistant**, resolved: **Assistant** is canonical in code, DB, APIs and docs; "agente" may appear only as an Italian UI label.
- "aziende univoche" resolved to **Organization**: one shared SaaS platform, tenant isolation via RLS, not one deployment per company.

## Additional language (full product surface)

These terms extend the vocabulary beyond the current-phase core, to cover the complete product
surface (see [`CLAUDE.md`](CLAUDE.md) for the exhaustive feature map and [`agents.md`](agents.md)
for runtime behavior).

**Help Desk**:
An Organization-level escalation destination with a description the AI uses to decide when to
recommend it; owns Support Channels and links to the Assistants that may offer it.
_Avoid_: department, queue.

**Support Channel**:
One escalation method on a Help Desk, type is Email, Phone number, Live chat, Create a ticket,
External link, Salesforce Chat Handover, or API endpoint, each with its own Form, Conversation Data
selection, and Availability.
_Avoid_: contact, route.

**Escalation**:
The act of handing a Conversation off from the AI to a Help Desk / human, optionally collecting a
form and attaching conversation data; may open a ticket in a connected system.
_Avoid_: handoff (reserved for assistant-to-assistant **Handover**), transfer.

**Improvement**:
A tracked answer-quality work item (status/priority/tags/assignee) linked to the flagged AI
message(s); created by the Flow Improvement action, a Help Desk's auto-generate setting, or a manual
"Improve Answer" flag.
_Avoid_: ticket (reserved for external ticketing), issue.

**Alert**:
A system-raised operational health notice (e.g. an integration whose credentials stopped working)
that persists until an admin resolves it or it auto-clears.
_Avoid_: notification, warning.

**Course / LMS Connection**:
A live integration with a Learning Management System (e.g. Moodle, Canvas) that syncs Courses as
Knowledge and enables LTI publishing; each Course carries an indexing Status.
_Avoid_: class, integration (generic).

**H5P Interactive / Study Mode**:
AI-generated learning exercises (quizzes, flashcards, drag-the-words) and a self-assessment quiz
shell, triggered by tags (e.g. `@quiz`) or automatically; part of the AI Tutor module.
_Avoid_: game, activity (generic).

**Quick-reply Button (starter button)**:
A configurable launcher button on the welcome screen with a typed action (Send Text, Role-Play,
Escalation, …); reorderable, capped per assistant.
_Avoid_: chip, shortcut (Insights uses "shortcut button clicks" for these).

**Dynamic Field**:
A per-user data value (from SSO profile or imported User data) interpolated into messages for
personalization.
_Avoid_: variable, merge tag.

**Role, target RBAC (5 tiers)**:
The target org-role model is **Super Admin · Admin · Collaborator · Support Agent · Data Viewer**
(new-member invite defaults to Collaborator). The current model has four (Owner/Admin/Editor/
Viewer); mapping-wise Super Admin≈Owner, Admin≈Admin, Collaborator≈Editor, Data Viewer≈Viewer, and
**Support Agent** (a help-desk/escalation operator) has no equivalent yet.
_Avoid_: permission, group.

**Analytics API**:
A public, org-scoped HTTP API (base path `/analytics`) for pulling Insights data programmatically,
authenticated by **API keys** minted in Organization → API Keys.
_Avoid_: export, webhook.

**API Integration**:
An Assistant's one configured external HTTP API: a base URL, one sealed credential, and an
**Endpoint Catalogue**. The only way an Organization's own API is reachable from a Conversation
Turn: the model discovers it, reads endpoint contracts, and queries relative paths that the
runtime prepends to the base URL. Its own table, never part of `assistants.tools`, so the
credential can never travel into a Publication snapshot.
_Avoid_: custom tool (the retired per-endpoint shape), connector (reserved for knowledge
Applications).

**Endpoint Catalogue**:
The admin-described list of endpoints inside an API Integration, each with its purpose, path
(with `{placeholder}` path parameters), required/optional parameters and response keys. The
catalogue is the egress allow-list: a model-substituted path is validated against it **before**
any outbound request, and a path it does not describe never reaches the network. A queried
endpoint is a citable Source.
_Avoid_: schema (too generic), OpenAPI spec (it is hand-described, not imported).

**Windowed Read**:
Reading a large payload deliberately in character ranges instead of receiving a truncation: the
model asks for `(from, to)` against a stored handle (an API response) or a Source id, and every
window returns the total length plus the next offset so a long document is walked, never
silently cut.
_Avoid_: pagination (that's rows), chunking (that's the embedding layer).

**Turn Trace**:
The persisted, structured form of a Conversation Turn's Thinking Steps, reasoning thoughts and
tool calls folded from runtime events by one shared function, stored on the assistant message
(capped, redacted, truncation flagged rather than silent). Reasoning text is Role-gated;
tool rows are visible to any Role that can read the Inbox. Always stored structured, the flat
bracketed export string is a serialization produced at export time, never the storage format.
_Avoid_: chain of thought (in UI), log, AgenticTrace (the export serialization only).

**AI Usage Ledger**:
One row per model call the runtime makes (stage `classify` / `generate` / `embed` / `verify` /
`goal_eval` / `compost`), attributed to Organization, Assistant, Conversation, message and the
**resolved** provider/model; written post-commit, never blocking a turn. Feeds the org's daily
token **Budget** (notify raises an Alert; block pauses AI answers with the escalation offer).
_Avoid_: billing, metering (generic).

**Credit**:
One euro cent of **estimated** platform cost, the unit the managed edition's plan allowances are
denominated in, derived from the **AI Usage Ledger** and from crawled pages through one rate table.
Denominating an allowance in cost rather than in tokens or pages is what keeps a plan's margin
independent of which model an Organization runs. Never a billed amount: no provider gives Ciele a
per-call cost feed, so every credit figure is a projection.
_Avoid_: token, quota, point.

**Metered Resource**:
One of the three kinds of work the platform funds and therefore caps separately, **AI** (routing,
answers, verification, scheduled AI work), **Embeddings** (knowledge indexing and query vectors),
and **Scraping** (pages fetched by a crawler). Disjoint: every metered unit belongs to exactly one,
so an exhausted crawl budget never stops answering. Each carries a monthly allowance from the plan
and a weekly ceiling that guards against spending the month in days.
_Avoid_: category, bucket, dimension.

**Standing Goal**:
An admin-authored golden question on an Assistant with deterministic expectations (not the
fallback, cites a Source, expected Source URL, must-contain fragments), re-verified on a schedule
against the latest Publication; a failing Goal raises an auto-resolving Alert. Flaky Goals are
**quarantined**, never deleted.
_Avoid_: test, check (generic).

**Answer Verdict**:
The independent verifier's one-line judgment (pass/fail + reason) on a generative answer, graded
fresh-context from (question, answer, cited Concept content) by a cheap-tier model; one Verdict per
message. FAILs create/increment Improvements; Verdicts feed the Trust Tier.
_Avoid_: rating (reserved for Visitor 👍/👎 feedback), score.

**Trust Tier**:
The earned autonomy level of an (Assistant, Flow) pair, `auto` / `queue` / `watch`, a rolling
pass rate over recent Verdicts and explicit feedback, materialized nightly. `watch` answers always
offer Escalation; a demotion into `watch` raises an auto-resolving Alert.
_Avoid_: grade, rank.

**Compost**:
The weekly pass that digests an Assistant's failure exhaust (failed Verdicts, 👎, escalations,
refusals, Goal violations, demotions) into at most three **proposed** Improvements (tagged; human
accepts or archives, never auto-applied). A clean week is recorded, not silent.
_Avoid_: auto-fix, retro.

**Developer Panel**:
The docked panel in the admin console that shows the current page's programmatic surface (its
/api/v1 operations as CLI, cURL and MCP snippets carrying the page's own ids), titled after the
domain it presents ("Flows API"). Present only where the page has an /api/v1 domain behind it; the
Role each snippet names is the Role an **API key** must carry, never the Role of the Member reading it.
_Avoid_: API drawer, code sidebar, developer mode.

## Functional surface index

Nine assistant SETUP sections: **General, Knowledge (Websites/Courses/Applications/Files/EdTech
Support Guides/FAQs), AI Tutor, AI Feedback, Flows, Help Desks, Style, Authentication, Publish**,
plus five org areas, **Assistants, Help Desks, Inbox, Improvements, Insights**, and **Alerts**.
Full per-screen detail and the ✅/🟡/⬜ build-status map live in [`CLAUDE.md`](CLAUDE.md); the
Flow router, condition types, action catalog, and knowledge loop live in [`agents.md`](agents.md).

## Scope note (revised)

The In/Out scope above reflects the **current build phase**, not the full target. The full target
surface is broader, AI Tutor (Study Mode/H5P), AI Feedback (grading), full Help Desks with typed Support
Channels + ticketing, Authentication (SSO/OIDC + User data), LMS/Course integration, Improvements
tracker, Alerts, richer Publish channels (LTI, campus portals, pop-up), and the full Flow action
catalog (Button/Iframe/API request/Send email/Handover/Study Mode/H5P). Treat the "Out (for later
phases)" list as *sequenced*, not *excluded*; `CLAUDE.md` §11 ranks the highest-leverage gaps.
