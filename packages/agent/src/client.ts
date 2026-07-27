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
export type { TurnView, TurnStep, TurnPhase, ConsumeTurnOptions } from "./stream";
// The reply-part contract every chat surface renders (owned by the runtime,
// spec #194); flows through the RuntimeEvent `part` event.
export type { ChatReplyPart, RuntimeEvent, StepStage } from "./types";

// Whether a Provider Connection can embed — powers the org embedding picker
// in Settings > AI (#437). Pure predicate, no credentials, no AI SDK.
export { canEmbedWithConnection } from "./embedding-capability";

// Static model catalog for editor UI (provider labels + model lists).
export { MODEL_CATALOG, PROVIDER_NAMES } from "./catalog";

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
