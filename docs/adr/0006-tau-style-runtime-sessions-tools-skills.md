# Tau-style runtime deepening: tool registry, turn sessions, skills, tool lifecycle events

The agent loop (`searchKnowledgeHandler`) hard-wired a single tool (`searchKnowledge`), streamed
label-only `step` events, forgot everything between turns except the transcript, and had no way for
an org to package reusable prompt guidance. Taking the seams of a coding-agent harness (tau) as the
reference shape, we deepened the runtime along four axes, without widening the enforced deep-module
barrels (ADR-0005: still only `@/lib/runtime` and `@/lib/runtime/client`).

**Decision.**

1. **Pluggable tool registry** (`runtime/tools.ts`). A tool is a spec (name, description, zod input
   schema, step label, execute); `buildToolset()` assembles the turn's AI-SDK ToolSet from built-ins
   plus the assistant's **custom HTTP tools** (`assistants.tools` jsonb). Built-ins:
   `searchKnowledge` (always on, grounding is a runtime invariant, ADR-0002), `calculator` and
   `remember` (default on), `fetchUrl` (default **off**: network egress is opt-in, with a
   private-host blocklist). Custom tools declare model-filled params; GET sends them as query
   string, POST as JSON body. Admin surface: the "Tools & Skills" SETUP section (`?page=tools`).
2. **Turn sessions** (`runtime/session.ts` + `conversations.session_state` jsonb). A per-conversation
   state bag loaded before the engine runs and written back after the assistant message persists,
   only when a tool marked it dirty. The `remember` built-in writes capped, deduped facts into it;
   `buildSystemPrompt` injects them as a "Session memory" layer, so state survives across turns
   without bloating the transcript.
3. **Structured tool lifecycle events**. The wire gains `tool-start` / `tool-end`
   callId (the AI-SDK toolCallId), tool name, label, model input, ok/summary/duration.
   `consumeTurnStream` folds them into `TurnStep[]` (`kind: step | thought | tool`,
   `status: running | done | error`), both chat UIs render live per-tool progress instead of an
   append-only string list. `step` and `thought` remain for one-shot notes and reclassified reasoning.
4. **Skills** (`skills` + `assistant_skills` tables). Org-level reusable prompt templates attached
   per assistant, layered into the system prompt between the answering style and the flow context.
   Frozen into `PublicationConfig.skills` at publish (widget = snapshot semantics), read live in
   Preview.

**Rationale.**
- The registry replaces "add a tool = edit the agent loop" with "add a tool = add a spec"; the
  instrument wrapper gives every tool the lifecycle events, error containment (a throwing tool
  returns `{error}` to the model, never aborts the turn), and Thinking-panel UX for free.
- Sessions keep the toy-agent property "state = transcript" from becoming a ceiling: tools now have
  a place to put working state that isn't a message.
- Publications stay authoritative: assistant `tools` ride the existing assistant snapshot, and
  skills are snapshotted explicitly, a live skill edit never changes a published widget.

**Rejected.**
- *Skills as jsonb on the assistant*, kills reuse across assistants, the entire point.
- *Session state in `conversations.metadata`*, metadata is captured session *context* (UA/IP);
  mixing mutable tool state into it muddles both consumers.
- *Replacing `step` with tool events entirely*, classifier/progress notes have no lifecycle;
  forcing start/end pairs on them is noise.

**Flip condition:** if tools need per-org (not per-assistant) sharing or secret-bearing auth
configs, promote custom tools to their own table with sealed credentials (like ticketing
integrations, `0015`).
