# Reference parity: agent trace, tool catalog, and the Inbox transcript

**Status**: analysis · **Date**: 2026-07-29 · **Evidence**: a 101-conversation / 655-message
conversation export from the reference platform (`Inbox → Exports`, JSON), plus four Inbox
screenshots of the same conversations.

Scope: **how the reference agent reasons at runtime** and **how that reasoning is stored and
rendered in the Inbox**. Everything else in the reference surface (LMS sync, AI Tutor, Publish
channels…) stays out; it is already tracked in the root [`CLAUDE.md`](../../CLAUDE.md) §11 gap
table.

---

## 1. What the export tells us

### 1.1 Conversation record

Flat, one object per Conversation, 29 fields:

```
Conversation ID · User Name · User Email · User Role · Student ID · Assistant ID ·
Assistant Name · Course ID · Course Name · Date · Messages Count ·
Positive Feedback Count · Negative Feedback Count ·
Escalation Status · Escalation Help Desk · Escalation Option ·
Session Launch URL · IP Address · Browser · OS · Resolution · Language ·
Country Code · City · CSAT Score · CSAT Comment ·
External User Data · External User Data Source Names · Messages[]
```

`Messages[]` items have exactly five fields: `Sender` (`User` | `Assistant`), `Timestamp`,
`Content`, `Feedback` (`"positive" | "negative" | null`), `AgenticTrace` (string).

Observed in this dataset: 5 assistants, `User Role` ∈ {`Learner`, `Instructor`,
`Administrator,Instructor`, `""`}, launch URLs of two shapes, the widget
(`chat…/?assistantId=…&courseId=…&locale=it&launchType=lti`) and the **admin Preview**
(`admin…/assistants/{id}?page=…&flowId=…`), so Preview turns land in the same Inbox as widget
turns. `Escalation*`, `CSAT*` and `External User Data` were empty across all 101 rows (features
exist in the schema, unused by this tenant).

### 1.2 `Content` is not just the answer

An assistant `Content` carries three things concatenated, in order:

1. **Progressive status lines**, one per tool phase, joined with `...`,
   `"Sto cercando i video nella sezione \"Video Prova\" del corso...Provo ad accedere
   direttamente ai contenuti video del corso tramite il sistema LMS...Mi dispiace, ma…"`.
   This is the **Simplified thinking** feature: each line is a short, student-facing rewrite of
   what the agent is about to do, and it is **persisted into the message**, not just streamed.
   32 / 378 assistant messages carry them.
2. The **final markdown answer** (tables, headings, emoji, bullet lists).
3. **Inline source markers** appended at the end, one per citation:
   `[Source: Course 'MARKETING (A) 2024/2025' - Files: Lecture 3 … .pdf]`.
   178 / 378 assistant messages have them. Format = `Collection - SourceType: SourceName`; an
   API-derived citation gets a synthetic name (`[Source: Moodle Course Modules]`), **live API
   results are citable sources**, not just knowledge chunks.

### 1.3 `AgenticTrace`, the whole turn, as a flat bracketed string

273 / 655 messages have one; length 33 → 108,355 chars (median ~9.8k). Grammar, in emission order:

| Marker | Payload | Count |
|---|---|---|
| `[Workflow started: <flow>]` | flow name | 264 |
| `[Thinking: <raw CoT>]` | full, unredacted model reasoning, in the user's language | 894 |
| `[Tool: <human label + args>]` | e.g. `Searching my knowledge for the following queries:\n- q1\n- q2` | 794 |
| `[Result: <rendered output>]` | tool output as YAML/text, **plus an embedded `[System note]`** | 794 |
| `[Suggested questions: q1, q2, q3]` | end-of-turn follow-ups | 166 |
| `[Workflow completed: <flow>]` | flow name | 260 |

Observed segment sequences are all `W (Think Tool Result [SysNote])* [SuggQ] W`, 25 distinct
shapes, up to 14 tool calls in one turn.

Flows seen: `Default Behavior` (171), `Socratic flow` (39),
`Quiz follow-up | Personalised reading list` (34), `Exam/assignment preparation` (10),
`Assistant Information` (10).

### 1.4 The agent loop

- **Hard iteration budget of 6**, and the budget is *told to the model* every step, as a
  `[System note]` appended to each tool result:
  > `You are now at iteration 2 out of 6. Make sure to plan your tool calls strategically and
  > finalize within the iteration limit. IMPORTANT: Before any final answer to the user, you MUST
  > call the 'ReadyToAnswer' tool exactly once…`

  It escalates: at 5/6 → *"You have 1 iteration remaining. You MUST call ReadyToAnswer now."*; at
  6/6 → *"CRITICAL: … DO NOT CALL ANY OTHER TOOLS and do not write a final answer; you will not
  get another turn."*
- **`ReadyToAnswer` is a mandatory terminal tool** with a status. Three statuses are visible in
  its results:
  - *clarification required* → `"The very next thing you do must be a concise user-facing
    clarification question. Do not answer the original question yet."`
  - *insufficient information* → `"write a concise user-facing message explaining you could not
    find the answer, and recommend they reach out to a human… Do not provide workarounds or
    general information."`
  - normal answer → the answer-time instructions.
- **The org's answering style is injected at `ReadyToAnswer` time**, not (only) in the system
  prompt: every `ReadyToAnswer` result re-states the full `**Custom Instructions**` block
  ("Keep answers short and concise… For different learning styles… ## Visual Learners…"), plus
  the **per-flow** instruction (`"Return an extensive, prioritised reading list grouped by
  topic…"`). Late-binding the style to the moment of writing is a deliberate design choice: the
  style never competes with tool-selection reasoning during the loop.

### 1.5 The tool catalog

Six tools, inferred from labels + the model's own enumeration of them inside `[Thinking:]`:

| Tool | Label in trace | UI chip | Notes |
|---|---|---|---|
| `AgenticSearch` | `Searching my knowledge for the following queries:\n- …\n- …` | Knowledge | **multi-query per call** (a list, not one string) |
| `ReadKnowledgeSource` | `Reading characters 0-5000 from source 1597fbe5…` | Read source | **char-range paging into a specific source doc**, model-chosen window; 60+ calls, offsets like `21858-23800` |
| `ReadyToAnswer` | `Getting ready to answer...` | | terminal, mandatory, status-carrying |
| `GetAPISummary` | `Getting a summary of available API endpoints` | **Get API Details** | dumps the whole endpoint catalog: base URL + 21 endpoints × (description, required/optional params w/ types, response keys) |
| `GetAPIEndpointDetails` | `Getting detailed information about endpoint: GET /…` | **View Endpoint Details** | per-endpoint detail; prompt tells the model to *call it in parallel for every endpoint you think you will need* |
| `QueryGetEndpoint` | `Querying /local/<lms-plugin>/api/r.php/courses/1818/modules` | **Query API** | relative path only; base URL prepended server-side |

Plus a **paged API-response reader**: `Reading more from API response api_08ec32558b8b`, large API
responses are stored under a handle and read in windows, same idea as `ReadKnowledgeSource`.

The API shape is the important part: **one registered API integration with a described endpoint
catalog**, exposed to the model as three generic discovery/read tools, *not* one hand-registered
tool per endpoint. The model discovers → reads the contract → queries → pages. Path params
(`{courseId}`, `{quizId}`) are substituted by the model from conversation context (course 1818,
quiz 6215).

### 1.6 The Inbox transcript UI (from the screenshots)

- Centered pills around each flow run: `▶ Workflow triggered: <flow>` … `■ Workflow ended: <flow>`.
- Above the answer bubble, a **collapsible trace panel**: a pill `API × 4` + the word `Thought`,
  chevron to expand. Expanded, it shows a row of **named chips**, `Get API Details`,
  `View Endpoint Details`, `View Endpoint Details`, `Query API`, then the reasoning text in
  colored italic, interleaved with per-tool expandable cards.
- A tool card expands to a labelled table: **Endpoint** · **Method** · **Status** (`✅ 200 OK`) ·
  **Response** (monospace, scrollable, syntax-coloured JSON/YAML).
- Per answer: `Improve Answer` button, a `Sources` disclosure that reveals source chips
  (`Moodle Quizzes ↗`), 👍/👎.
- Right rail: **Conversation details** (Assistant, Timestamp, Course, Course ID) · **Session**
  (Launch URL, IP, OS, Browser, Resolution, Language, Location, City) · **Escalation** (Status).
- A **PDF export** affordance on the transcript.

---

## 2. Ciele today

### 2.1 What already matches (better than expected)

| Reference capability | Ciele today |
|---|---|
| Structured tool lifecycle | `RuntimeEvent` has `tool-start` / `tool-end` (callId, tool, label, input, ok, summary, durationMs), `packages/agent/src/tools.ts` `instrument()` wraps *every* tool automatically |
| Reasoning-before-tool as a visible thought | `{ type: "thought" }`, emitted by reclassifying the pre-tool-call text segment (`agentic-search/run.ts:401`) |
| Engine stages | ~~`{ type: "step", stage }`~~, **retired in #560**. The nine-state phase machine and its label table were a stand-in for knowing what the agent was doing; the tool lifecycle, the reasoning thoughts and the Simplified-thinking narration now carry it, and `TurnPhase` is `running`/`done`. Genuine runtime diagnostics moved to `{ type: "notice" }`; `TurnStep.kind: "step"` survives for reading back traces written before the collapse |
| The collapsible "API × N / Thought" panel | **already built** for live chat: `apps/web/src/components/chat/thinking-panel.tsx` (icon stack, `×N` count pill, "Thought for X.Xs", chevron) + `tool-calls-section.tsx` (timeline, per-tool expand → Input / Output / duration) |
| Multi-pass search with a per-turn budget | `MAX_SEARCH_PASSES`, `searchBudgetExhausted`, coverage verdict per pass, seed→reformulate→widen (`agentic-search/`) |
| Clarify instead of dead-ending | `ChatReplyPart` `clarify`, pre- and post-search, with the already-clarified anti-loop guard |
| Insufficient-information copy | `bestEffortCaveat`, refusal + help-desk exit ramp, truncation notice |
| Layered system prompt | platform → assistant `answeringStyle` → Skills → session memory → retrieval frame → flow style (with per-flow override) |
| Follow-up questions | `follow_up_questions` flow action → `follow_ups` part |
| Sources as Concept → Source | `sources` part with `conceptId`, `collectionName`, `sourceName`, `url` (ADR-0002) |
| Custom HTTP tools | `AssistantTools.custom`: name, description, url, GET/POST, headers, params |
| Session state across turns | `conversations.session_state` + the `remember` tool |
| Workflow marker in Inbox | `messages.flow_name` → the `Workflow ended: <flow>` pill |
| Session rail | `ConversationMetadata` has launchUrl / ip / os / browser / language / location / city / resolution / userRole / userEmail |
| Inbox export | CSV + JSON of the **conversation list** |

### 2.2 The gap, precisely

**A. Nothing about the turn's reasoning survives the turn.** `db.appendMessage` takes
`{ conversationId, role, content, flowId, flowName }` and `StoredMessage` is
`{ id, conversationId, role, content: unknown[], flowId, flowName, feedback, createdAt }`. The
`step` / `thought` / `tool-start` / `tool-end` events are emitted to the live stream and dropped.
So:

- The Inbox transcript can never show a Thinking panel; it has no data, and `ThinkingPanel`
  itself returns `null` for a history-loaded message by design (`steps.length === 0 && finished`).
- There is no way to audit *why* an answer came out that way after the fact, which is the single
  most valuable thing in the reference Inbox.
- `graphQaId` / Retrieval Trace exists but is **Graph-engine only** and is a knowledge-substrate
  record, not a renderable turn trace.

**B. No terminal-tool discipline.** Ciele's clarify / insufficient-information decisions are
deterministic heuristics computed *around* the model loop (`decideClarify`, `scoreCoverage`). The
reference makes the model itself declare, through `ReadyToAnswer`, that it is done and in what
state, which is what lets the platform re-inject the answering style at write time and hard-stop
a runaway loop. Ciele's loop stops on `stopWhen`, silently, and the model is never told its
budget.

**C. No API catalog tool.** Ciele's custom tools are one-tool-per-endpoint, no path-param
substitution (`{courseId}`), no endpoint discovery, no response paging, no per-call
method/status/response surfaced for the Inbox card. Reaching the screenshot UI needs the
`Endpoint / Method / Status / Response` quadruple recorded per call.

**D. No source-window reader.** `searchKnowledge` returns chunk content; the model cannot ask for
"characters 21858-23800 of source X" when a chunk is truncated mid-answer.

**E. ~~Inbox/export shape.~~** *Closed by #561, see T7 below.* The JSON export was
conversation-level only (no `Messages[]`, no trace), the transcript had no per-message timestamp, no
`Workflow triggered` opening pill, no PDF export and no `Sources` disclosure, and
`ConversationMetadata` lacked the eight remaining reference fields. All shipped; the ones whose
producing feature does not exist yet (LMS course, CSAT) export empty by design.

**F. ~~No Simplified thinking.~~** *Closed by #560, see T6 below.* The reference persists short
user-facing progress lines into the answer itself; Ciele streamed generic phase labels
(`"Looking into it…"`) that were never persisted. Both halves changed: the narration is real and
persisted, and the phase labels are gone.

**G. Multi-query search.** `searchKnowledge` takes one `query: string`; the reference issues a
list per call, which is why its traces reach useful coverage inside 6 iterations.

---

## 3. Target design

Three decisions worth fixing before any code:

1. **Persist the trace as structured JSON, not the reference's flat string.** The reference's
   `AgenticTrace` is a bracketed blob that has to be re-parsed to render; we already have
   `TurnStep` (`packages/agent/src/stream.ts`), the exact shape the panel consumes. Store
   `TurnStep[]` (+ flow name, + iteration count) and the Inbox reuses `ToolCallsSection`
   unchanged. The reference's string is then a *serialization* we can emit on export for parity,
   never the storage format.
2. **A new column, not a new table**: `messages.trace jsonb`, keeps one round-trip per
   transcript. But raw CoT is sensitive and unbounded (108k chars observed): cap it, redact it
   through the existing `redact.ts`, and make retention a per-org setting with a default. Decide
   whether thoughts are visible to all Roles or Admin+ only.
3. **The API catalog is a new integration object, not a tool config.** One
   `api_integrations` row per assistant (base URL, auth, endpoint catalog), three generic tools
   over it. Path-param substitution and response paging are properties of that object.

---

## 4. Tickets

Grouped so each ticket is one vertical slice that ships something visible. `Db`-touching tickets
mean: extend `packages/db/src/types.ts`, implement in **both** `supabase.ts` and `mock.ts`, add the
case to `db-contract.suite.ts`, and land the migration in the same PR.

### T1: Persist the turn trace and render it in the Inbox  *(the unlock; do first)*

*Everything else in this doc is optional next to this one; it is what turns the Inbox from a
transcript into an audit surface, and it reuses UI that already exists.*

- **T1.1, `messages.trace` + the `Db` seam.** Migration adds `trace jsonb null`. `appendMessage`
  accepts `trace?: TurnStep[]`; `StoredMessage` exposes it. Cap: N steps, M chars per thought
  (constants in `@agent-hub/core`), truncation flagged in the payload, thought text through
  `redact.ts`. Contract-suite case for both adapters.
- **T1.2, Collect steps in `turn.ts`.** Fold the emitted `RuntimeEvent`s into `TurnStep[]` with
  the *same* folding rules the client uses (extract the fold out of `consumeTurnStream` so
  producer and consumer cannot drift), and pass it to `finishTurn`'s `appendMessage`. Zero new
  model calls; pure bookkeeping on an already-emitted stream.
- **T1.3, Inbox renders it.** `ThinkingPanel` + `ToolCallsSection` above each assistant bubble,
  collapsed by default, with the `× N` pill. Add the opening `▶ Workflow triggered: <flow>` pill
  to match the closing one, and a per-message timestamp.
- **T1.4, Role gate + retention.** Who sees raw reasoning (proposal: Admin+; Viewer sees tool
  calls but not thoughts) and a per-org trace-retention setting with a default; the sweep runs on
  the existing cron drain.

### T2, Terminal-tool discipline: `ReadyToAnswer` + a spoken iteration budget

- **T2.1, Iteration budget in-band.** Count agent-loop iterations, append the escalating
  `[System note]` to each tool result (normal → "1 remaining" → "final turn"), and expose the
  count on the trace so the Inbox can show `iteration 4/6`. Keeps `stopWhen` as the hard stop.
- **T2.2, The `ReadyToAnswer` tool.** Mandatory, exactly once, status ∈
  `{ answer, needs_clarification, insufficient_information }`; its result carries the write-time
  instructions. Wire the existing `decideClarify` / `bestEffortCaveat` copy as the payload for the
  two non-answer statuses so behaviour is unchanged where it already worked, the model now
  *declares* the state instead of us inferring it.
- **T2.3, Late-bind the answering style.** Move the org `answeringStyle` + per-flow
  `search_knowledge` answering style out of the loop's system prompt and into the `ReadyToAnswer`
  result (keeping the platform layer where it is). Needs a before/after eval on the existing
  goal-runner fixtures, this changes answer shape, so it ships behind a flag.

### T3: API catalog integration (the `Get API Details / View Endpoint Details / Query API` triad)

- **T3.1, The integration object.** `api_integrations` (per assistant: name, base URL, auth ref
  via the existing sealed-secret helper, endpoint catalog `jsonb`) + `Db` methods + admin CRUD UI
  under the assistant's tools section. Egress goes through `egress.ts` / `pinned-fetch.ts`
  unchanged.
- **T3.2, The three tools.** `getApiSummary` (catalog dump), `getApiEndpointDetails`
  (per-endpoint, parallel-callable), `queryEndpoint` (relative path + model-substituted path
  params, validated against the catalog before egress). Registered through the existing
  `instrument()` wrapper so they get lifecycle events for free.
- **T3.3, Response paging.** Store a large response under a handle and add
  `readApiResponse(handle, from, to)`. Same primitive as T4.
- **T3.4, The Inbox tool card.** Record `endpoint / method / status / response` on the trace step
  and render the labelled card (status badge, monospace scrollable response), the screenshot's
  expanded `View Endpoint Details` / `Query API` view.
- **T3.5, API results as citable Sources.** A synthetic `sources` entry per queried endpoint
  (`Moodle Course Modules`-style) so an API-grounded answer cites its provenance.

### T4, `readKnowledgeSource`: char-window reads into a Source

One tool, `(sourceId, from, to)`, bounded per turn and per window, returning the window plus the
total length so the model can walk a long document. Shares the paging primitive with T3.3 and the
lifecycle wrapper with everything else.

### T5: Multi-query `searchKnowledge`

`query: string` → `queries: string[]` (capped), one pass per query inside the existing budget,
label rendered as the reference's bulleted list. Back-compat: accept a bare string. Touches
`search-pass.ts` and the pass ledger.

### T6: Simplified thinking (persisted progress lines), **shipped (#560)**

Per-assistant toggle (General, `assistants.simplified_thinking`). When on, every tool's input schema
grows an optional `progress` argument the model fills with one short user-language line saying what it
is about to do; the registry hands it to the turn, which streams it and keeps it as its own
`{ type: "progress" }` reply part ahead of the answer, separable for the transcript, the export and
analytics, unlike the reference's string concatenation. Zero extra model calls, and a narration line
can never describe a phase that did not run. Off = the previous behaviour exactly, down to there being
no schema field for the model to fill.

Shipped with it: the **removal** the ticket paired with it, `TurnPhase` collapsed to `running`/`done`,
the `step`/`stage` wire event replaced by `{ type: "notice" }` for genuine diagnostics, and the panel's
live label now read off the newest Thinking Step instead of a label table.

### T7: Inbox/export parity, **shipped (#561)**

- **T7.1, Message-level export.** `apps/web/src/lib/inbox/conversation-export.ts` builds the
  reference's 29-field record, `Messages[]` and all; `packages/core/src/agentic-trace.ts` owns
  `serializeAgenticTrace` / `parseAgenticTrace`, and the round trip is tested both ways (including
  against a hand-written reference-shaped string it did not produce). The flat string exists **only**
  at export time. `Content` is likewise flattened on the way out, narration joined with `...`, then
  the answer, then one inline `[Source: …]` marker per citation. Assembled in a server action, where
  the reasoning gate is *enforced* rather than requested: an export leaves the console.
- **T7.2, Metadata fields.** All eight landed on `ConversationMetadata` (jsonb, no migration).
  `escalationHelpDesk` / `escalationOption` are written for real by `escalateConversation` and shown in
  the Inbox rail; `courseId`/`courseName`/`studentId`/`csat*`/`externalUserData*` wait on LMS sync and
  the CSAT survey and export as empty strings, exactly as the reference does for this tenant.
- **T7.3, Transcript polish.** `CitationList` gained a `collapsible` mode (the transcript uses it, the
  chat does not, citations are the point of a grounded answer). PDF export goes through the browser's
  own print pipeline (`transcript-print.ts` renders a standalone document into a hidden iframe), which
  is what makes a long transcript paginate rather than get cut off.

### Order and dependencies

```
T1 ──────────────────────────────► (unlocks every Inbox card below)
      T2 (independent, flagged)
      T3 ── needs T1.1 for the card, T3.3 shares T4's primitive
      T4 ── independent
      T5 ── independent
      T6 ── independent
      T7.1 ── needs T1 (serializes the trace)
```

T1 first, then T3 + T4 together (they are the same paging primitive and the same tool-card
rendering), T5 and T6 as small independents, T2 last of the runtime work because it changes answer
shape and wants an eval, T7 once there is a trace to export.

---

## 5. Open questions

1. **Trace visibility.** Raw CoT in an admin console is an audit win and a privacy liability
   (student names and quiz grades appear verbatim in the observed traces). Admin+ only, or all
   roles?
2. **Retention.** 108k chars for one turn. Cap per step, per message, and a TTL, what default?
3. **T2.3 is a behaviour change.** Late-binding the answering style will change answers. Do we
   want it, or is the in-loop system prompt good enough given Ciele already layers per-flow style?
4. **Do we want the flat-string `AgenticTrace` at all**, beyond the export? Structured is strictly
   better everywhere except drop-in compatibility with the reference's export consumers.
5. **`Course` as a first-class noun.** The reference anchors conversations to a Course; Ciele
   anchors to a Knowledge Collection. T7.2 stores the fields, but whether Course becomes a real
   domain noun is the LMS-integration decision (root guide §11), not this one.
