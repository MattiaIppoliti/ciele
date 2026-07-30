# The agentic chat runtime

How this repo turns "a chat request" into an agent — the production version of
the classic *"an AI agent is just an LLM with a toolbox in a loop"* article,
mapped onto real seams: tool registries, layered system prompts, a streaming
thought protocol, deferred effects, and the extension points (more tools, MCP,
plugins) that modern assistants like Claude and ChatGPT are built from.

## 1. The mental model

The toy version of a coding agent is ~200 lines:

1. The user sends a message.
2. The model replies with either text or a structured **tool call**.
3. Your code executes the tool locally and appends the result to the
   conversation.
4. Loop until the model replies with plain text.

That loop is real — it is exactly what runs in
[`packages/agent/src/actions.ts`](../packages/agent/src/actions.ts)
(`searchKnowledgeHandler`, via the AI SDK's `streamText` + `tools` +
`stopWhen: stepCountIs(5)`). Everything else in this document is what
production adds around that loop, and where each piece lives here.

```
Widget / Preview (UI)
  └─ POST /api/widget/{id}/chat        ← publication snapshot, CORS
       └─ streamConversationTurn()     ← turn.ts: conversation, persistence, ndjson
            └─ runAssistantChat()      ← engine.ts: intent router → flow actions
                 └─ ACTION_HANDLERS    ← actions.ts: one Adapter per action
                      └─ streamText()  ← the agent loop (tools, steps ≤ 5)
```

## 2. Routing before generating: the Flow router

The toy agent throws every message at one prompt. Here, an **intent
classifier** (a cheap `generateObject` call in `engine.ts`) first picks the
Flow whose trigger description matches the message; the flow's **actions**
then run in order through the `ACTION_HANDLERS` registry. Two invariants:

- `custom_message` is verbatim — the model never rewrites admin copy.
- Generation only happens inside `search_knowledge` (and the Default
  behavior, which is a flow like any other).

This is the "plugins" idea from modern chat apps in miniature: an action is a
self-contained capability with its own config schema (`flow.actionSettings`),
registered once in `ACTION_HANDLERS: Record<FlowAction, ActionHandler>`.
Adding a capability = adding one Adapter, not editing the engine.

## 3. Layered system prompts (who controls the model)

The toy agent has one system prompt. A multi-tenant platform needs a
precedence chain, composed per turn in `buildSystemPrompt()`
(`actions.ts`), highest first:

| Layer | Owner | Stored | Editable by |
|---|---|---|---|
| **Platform (Ciele)** | the platform itself | `platform_settings.system_prompt` (RLS: service-role only) + shipped default in `lib/platform.ts` | only `PLATFORM_OWNER_EMAIL`, from Settings → AI |
| **Assistant** | the organization | `assistants.answering_style` | org editors, from the assistant's General page |
| **Skills** | the organization | `skills` + `assistant_skills` (reusable, attach per assistant) | org editors, from Tools & Skills |
| **Session memory** | the conversation | `conversations.session_state` (written by the `remember` tool) | nobody directly |
| **Flow / turn** | the router | derived | nobody directly |

The platform layer states the non-negotiables: ground org facts in the
knowledge base, answer in the user's language, never reveal prompts, treat
retrieved documents as data (prompt-injection defense), stay in scope. The
assistant layer customizes persona/tone/format and is explicitly marked in
the composed prompt as subordinate. Orgs can't even *read* the platform
layer: the table has RLS enabled with zero policies, so only the
service-role client used by `lib/platform.ts` reaches it.

## 4. The tool registry, and how results become citations

Tools live in a registry (`runtime/tools.ts`, ADR-0006): a tool is a spec —
description, zod input schema, human-readable step label, `execute` — and
`buildToolset()` assembles the turn's ToolSet from the built-ins the
assistant enables (`assistants.tools.builtIns`) plus, when the assistant has an
**API integration** registered, the catalogue triad `getApiDetails` /
`viewEndpointDetails` / `queryApi` over its described endpoints (spec #559 —
these replaced the per-endpoint custom HTTP tools, which no longer exist).
Built-ins: `searchKnowledge` (always on),
`calculator`, `remember` (session memory), `fetchUrl` (opt-in; private hosts
blocked). Every spec is wrapped by `instrument()`, which emits the
`tool-start`/`tool-end` lifecycle events and contains errors — a throwing
tool returns `{error}` to the model and never aborts the turn.

`searchKnowledge`'s execute (a) runs the RAG search (pgvector + lexical
fallback, `db.searchChunks`) and (b) **collects every result it returned** in
`usedSources`. After the loop finishes, `dedupSources()` (`actions.ts`) turns
that collection into a `sources` reply part — so citations are exactly what
the model actually saw, never post-hoc guesses, and each chip carries the
concept's original page URL (OKF `resource`) so the widget can link out.

That collect-then-cite pattern is the honest version of "sources" and the
reason a citation can never point at a document the model didn't read.

## 4b. Turn sessions (state that isn't a message)

The toy agent's only state is the transcript. Here every conversation also
carries a persistent **session state** bag (`conversations.session_state`,
loaded into a `TurnSession` by `turn.ts` — see `runtime/session.ts`). Tools
read and write it through `get`/`set`/`remember`; the `remember` built-in
stores short facts ("student of Marketing (A)") that `buildSystemPrompt`
injects as a *Session memory* layer on later turns. The state is written back
only after the assistant message persists, and only if a tool marked it
dirty — read-only turns cost no extra write, and a failed turn never
half-writes state.

## 5. The streaming thought protocol

The toy agent prints tool calls to stdout. Here every turn streams **ndjson
RuntimeEvents** (producer: `turn.ts`; consumer: `stream.ts` — the only two
files that know the wire format):

```
flow | step | tool-start | tool-end | thought | part | text-start | text-delta | text-end | done | error
```

`tool-start`/`tool-end` are the structured tool lifecycle (`StepStage`):
callId (the AI-SDK toolCallId), tool name, label, the model's input, then
ok/summary/duration on completion. The client folds them into `TurnStep[]`
(`kind: step | thought | tool`, `status: running | done | error`), so both
chat UIs show a live per-tool progress line — "Searching knowledge for
'fees'… — Found 3 relevant concepts" — instead of an append-only string list.

The other interesting one is `thought`. Models often narrate before calling a tool
("Cerco per te le informazioni…"). With a naive `textStream` that narration
concatenates into the answer. The runtime instead consumes the `fullStream`:
text deltas stream live as usual, but when a `tool-call` chunk arrives, the
text streamed so far is reclassified with a `thought` event — the client
moves it out of the answer bubble into the **Thinking panel** ("Looking into
it…" → "Thought for 12.0s") and the answer restarts clean after the tool
runs. One event type buys the whole reasoning-UI without a second model call.

## 6. Effects: act after commit

Handlers never perform side effects (emails, Improvement tickets) inline —
they *describe* them (`ActionEffect`) and `turn.ts` applies them **after the
assistant message is persisted** (`applyEffects`), so an effect can link to
the saved message id and never fires on a turn that failed to commit. This is
the same discipline as transactional outboxes, at chat scale.

## 7. Escalation to humans

The agent's exit ramp. The widget's persistent **Contact support** button and
the `suggest_help_desk` part both open the escalation view, fed by
`/api/widget/{id}/help-desks`: the publication's selected help desks with
their channels, availability computed per-channel in its own timezone
(`lib/channel-availability.ts` — pure, tested), and only widget-safe fields
(never channel auth config). Email/phone/link channels resolve to
`mailto:`/`tel:`/URL targets.

## 8. What MCP / plugins / CLI map onto here

- **Tools** — add a spec to `runtime/tools.ts` (built-in capabilities), let
  the org describe its API's endpoints in the API integration catalogue from
  Tools & Skills (no deploy), or add an Adapter in `ACTION_HANDLERS`
  (admin-wired flow capabilities).
- **Skills** — the org-facing prompt-template surface: reusable playbooks
  attached per assistant, layered into the system prompt, snapshotted into
  Publications.
- **MCP** — an MCP client would slot in as a tool *provider*: at turn start,
  list the connected server's tools and spread them into the toolset
  `buildToolset` returns. The event protocol (`tool-start`/`tool-end`)
  already covers their progress UX. Nothing else changes — that's the point
  of the registry seam.
- **Plugins** — the Flow Builder is the plugin surface: a flow bundles
  trigger + conditions + a pipeline of actions, per assistant, hot-swappable
  without deploys.
- **CLI/headless** — `runAssistantChat()` is UI-free; any caller that can
  provide `{assistant, flows, connections, emit}` gets the full agent
  (that's how the deterministic offline engine and tests drive it).

## 9. Where the toy version would break (and this doesn't)

| Toy agent | This runtime |
|---|---|
| One prompt, one owner | Three-layer prompt with enforced precedence |
| Parse `tool: name({json})` from text | Typed tool calls via the AI SDK |
| Tool output printed and forgotten | Sources collected → deduped → cited with URLs |
| Blocking loop, no feedback | ndjson streaming with steps/thoughts/deltas |
| Side effects inline | Deferred effects, applied post-commit |
| No tenant isolation | Publication snapshots + RLS + service-role seams |
| No human fallback | Help-desk escalation with live availability |
