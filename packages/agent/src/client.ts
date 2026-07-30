/**
 * Runtime — client-safe public interface.
 *
 * The counterpart to `./index` for browser bundles. Everything here is either
 * type-only or pure static data, so importing it from a client component never
 * drags in the AI SDK or other server-only code. Client components import from
 * `@agent-hub/agent/client`; server code imports from `@agent-hub/agent`.
 *
 * Locked by `interface.test.ts`. See ADR-0005.
 */

// Parse the NDJSON turn stream the chat routes emit into view state.
export { consumeTurnStream, decodeRuntimeEvents } from "./stream";
// The single fold from wire events to Thinking Steps, shared by the live chat
// clients and by turn.ts (which persists what it folds) so the Inbox shows what
// the visitor watched happen. `EMPTY_TURN_TRACE` seeds a fold.
export { EMPTY_TURN_TRACE, foldTraceEvent } from "./stream";
export type {
  TurnView,
  TurnStep,
  TurnPhase,
  TurnTrace,
  ConsumeTurnOptions,
} from "./stream";
// The reply-part contract every chat surface renders (owned by the runtime,
// spec #194); flows through the RuntimeEvent `part` event.
export type { ChatReplyPart, RuntimeEvent, StepStage } from "./types";

// Whether a Provider Connection can embed — powers the org embedding picker
// in Settings > AI (#437). Pure predicate, no credentials, no AI SDK.
export { canEmbedWithConnection } from "./embedding-capability";

// Static model catalog for editor UI (provider labels + model lists).
export { MODEL_CATALOG, PROVIDER_NAMES } from "./catalog";

// The agent loop's iteration budget — the number the model is TOLD about (#558).
// Public because the Inbox export re-states it in the reference platform's
// `[System note]` ("iteration 2 out of 6"), and that note has to quote the same
// budget the turn actually ran under.
//
// Imported from `loop-budget` directly, NOT through the `agentic-search` barrel:
// that barrel value-exports `runAgenticSearch`, so routing through it would pull
// `streamText` — the whole AI SDK — into every client bundle. `loop-budget.ts`
// has no imports at all, which is what makes the constant client-safe.
export { MAX_AGENT_ITERATIONS } from "./agentic-search/loop-budget";

// Template-variable catalog for the Flow Builder's picker + docs modal. Pure
// static data derived from the same source the runtime resolves against.
export { TEMPLATE_VARIABLES } from "./template";
export type { TemplateVariable } from "./template";

// Result shape of the builder's "Test request" action (type-only, client-safe).
export type {
  ApiRequestTestResult,
  ApiRequestErrorCode,
  ExtractedVariable,
} from "./api-request";
