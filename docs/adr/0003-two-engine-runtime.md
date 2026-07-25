# Two chat engines: a deterministic keyword router alongside the LLM runtime

The conversational runtime exists in **two implementations behind one entrypoint**. The production
path, `runAssistantChat` (`apps/web/src/lib/runtime/engine.ts`), does real intent classification with a
cheap LLM (`generateObject` over a flow catalog), a RAG agent loop inside `search_knowledge`
(`streamText` + a knowledge tool, capped at 5 steps), streams ndjson to the client, and calls
Anthropic/OpenAI/Google via the Vercel AI SDK. A second, dependency-free engine — `runChat` /
`matchFlow` / `runAction` in `packages/db/src/engine.ts` — routes the same message with **keyword/token
scoring** (`MATCH_THRESHOLD = 3`, hardcoded built-in triggers) and returns a synchronous `ChatReply`.

**Decision.** Keep both, and make the LLM runtime **fall back** to the deterministic engine when no
model is configured — emitting the *same* wire events so the UI is identical
(`engine.ts:261-317`). The deterministic engine is also what the offline mock and the non-streaming
`chatPreviewAction` use. `matchFlow` additionally backstops the LLM classifier on empty-candidates or
error (`engine.ts:83,104`).

**Rationale.**
- **Zero-config demo & tests**: the whole app (and its Playwright/unit paths) must run with no API
  keys and no network. A deterministic router gives reproducible output and keeps `packages/db`
  free of AI-SDK/Node-only dependencies, so it stays importable anywhere.
- **Graceful degradation**: a misconfigured or rate-limited provider still yields a coherent, routed
  reply instead of an error page.
- **Shared seam**: both engines route through the same `Flow[]` model and the same `matchFlow` name,
  so the LLM classifier is a drop-in *upgrade* of the same seam rather than a parallel concept — which
  is exactly how `context.md` frames "Intent Classification (replaces keyword matching; same
  `matchFlow` seam)".

**Consequences / the cost we accept.** Two routers can **drift**: the keyword engine has no notion of
LLM-only conditions, and it stubs `search_knowledge` (returns placeholder text; the real lexical search
is re-run by `runAssistantChat` even in fallback). Action coverage also differs — several actions are
stored-but-inert in both. This is acceptable because the deterministic engine's job is *plausible
offline behavior*, not parity; the LLM runtime is the source of truth for production. When adding a
flow action or condition, treat the LLM runtime as primary and only mirror it in `runChat`/`runAction`
if the offline path needs it.

**Rejected.**
- *One engine, LLM-only.* Simpler, but breaks the no-key demo, makes tests non-deterministic and
  network-bound, and forces AI-SDK deps into `packages/db`.
- *One engine, keyword-only.* Can't do real intent classification, semantic conditions, or the RAG
  agent loop — i.e. not the product.
- *Fold the deterministic engine into `apps/web`.* Keeping it in `packages/db` is what lets the data
  package (and the mock) stay self-contained and dependency-light.

**Update — the drift is now bounded by a registry.** The LLM runtime dispatches Flow Actions through a
handler registry (`apps/web/src/lib/runtime/actions.ts`, `Record<FlowAction, ActionHandler>`) instead
of an inline `switch`. Adding an action is one Adapter in one place; the deterministic engine's
`runAction` (`packages/db/src/engine.ts`) still carries only the pure offline subset, on purpose. So
the two paths can still diverge, but the effectful path has a single home and is unit-testable — the
"drift cost" above is now paid down to just the deliberate offline subset.

**Update (spec #194) — two routers, one renderer.** The deterministic engine's reply renderer
(`runChat`/`runAction` and the `ChatReply` envelope) turned out to be unreachable in production: the
no-model fallback in `runAssistantChat` dispatches the runtime's `ACTION_HANDLERS` directly, the mock
Db never called `runChat`, and the only nominal caller (`chatPreviewAction`) had no call sites. It has
been deleted. What `packages/db/src/engine.ts` keeps — and what this ADR's "two engines" now means —
is the deterministic *router* only: `messageFlowCandidates` + keyword-scored `matchFlow`, the
classifier's offline/error fallback at the shared `matchFlow` seam. Rendering a matched Flow's
actions has exactly one home, the runtime's handler registry, and the runtime owns its wire contract
(`ChatReplyPart`, exported type-only via `@/lib/runtime/client`; the shared `iframeReplyPart` helper
moved beside its only caller). The offline no-key demo path is unchanged — it always ran through
`ACTION_HANDLERS` with a null model.
