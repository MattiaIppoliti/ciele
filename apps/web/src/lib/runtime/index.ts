/**
 * Runtime — the chat runtime as a deep, gray-box module (ADR-0005).
 *
 * This barrel is the module's **public server interface**. Everything else in
 * `lib/runtime/` is implementation: a fresh reader (human or agent) reads this
 * file to know what the runtime does, and only opens the internals to change
 * behavior. Importing `@/lib/runtime/<internal>` from outside this folder is a
 * lint error (see `apps/web/eslint.config.mjs`) — go through this interface.
 *
 * Client code cannot import from here (it pulls in the AI SDK + server-only
 * deps). The client-safe surface — stream parsing and the static model catalog
 * — lives in `./client`.
 *
 * The exact export shape is locked by `interface.test.ts`, so re-widening the
 * interface is a deliberate, reviewed act rather than an accident.
 */

// Conversation Turn — the one entrypoint for answering a user message.
export { streamConversationTurn, NDJSON_HEADERS } from "./turn";
export type { ConversationTurnInput } from "./turn";

// Per-request session metadata (UA/IP/locale) for a chat request.
export { sessionMetadata } from "./session-meta";

// Knowledge ingestion — extract Source text, enqueue the ingest job, and the
// concept/embedding + website-crawl primitives the server actions drive.
export {
  persistConcept,
  embedConcept,
  beginWebsiteCrawl,
  CRAWL_FINALIZE_LEASE_MS,
  finalizeWebsiteCrawl,
  restartWebsiteCrawl,
  updateWebsiteSourceConfiguration,
} from "./ingest";
export { extractSourceText } from "./extract";
export { enqueueIngestJob, runDueIngestJobs } from "./jobs";

// Graph-sync ledger — keeps each Collection's derived Knowledge Graph in step
// with its OKF Concepts (ADR-0017). Inert without a graph worker.
export {
  backfillCollectionToGraph,
  enqueueGraphSyncJob,
  runDueGraphSyncJobs,
} from "./jobs";

// Graph learning loop — feedback on graph-served answers re-weights retrieval
// (ADR-0017). Inert without a graph worker; fail-soft with auto-resolving Alerts.
export { feedbackScore, forwardGraphFeedback, runGraphLearning } from "./graph-feedback";

// Suggested Fix — drafts a reviewable knowledge proposal for a flagged answer
// (ADR-0017). Best-effort; a drafting failure leaves a "no proposal" state.
export { enqueueDraftProposalJob, runDueProposalJobs } from "./jobs";
export { draftImprovementProposal } from "./improvement-proposal";

// Which crawler providers the current environment can run — drives the admin
// Website Source crawler picker (e.g. Crawl4AI is only offered when its worker
// is configured). Never carries the underlying credentials.
export { websiteCrawlerCapabilities } from "./website-crawlers";
export type { WebsiteCrawlerCapabilities } from "./website-crawlers";

// Standing goals — the scheduled re-verification loop (golden questions run
// headlessly against the latest Publication; failures raise Alerts).
export { runDueGoalEvals } from "./goal-runner";

// Independent answer verifier — fresh-context grading of recent generative
// answers against their cited Concepts (nothing grades its own homework).
export { runDueAnswerVerifications } from "./verifier";

// Flow trust ledger — nightly rolling-pass-rate materialization into earned
// tiers (auto/queue/watch); demotions raise auto-resolving Alerts.
export { runTrustMaterialization } from "./trust";

// Compost loop — weekly exhaust digested into at most 3 proposed
// Improvements per assistant (human signature = the kanban; never auto-applies).
export { runCompostPass } from "./compost";

// Provider/model resolution (which LLMs an org can actually run on) and
// pre-flight validation of a provider API key.
export { providerAvailability } from "./models";
export { validateProviderApiKey, InvalidProviderKeyError } from "./validate-key";
// "Test connection" for an OpenAI-compatible endpoint: one-token chat call +
// one embedding call (#436) — drives the admin connection form.
export { testOpenAiCompatibleConnection } from "./test-openai-compatible";
export type {
  OpenAiCompatibleTestInput,
  OpenAiCompatibleTestResult,
} from "./test-openai-compatible";

// The one email transport (also used internally by deferred effects).
export { sendEmail } from "./email";
export type { EmailMessage, EmailDelivery, EmailTransport } from "./email";

// Builder "Test request": run an api_request config with sample values.
export { testApiRequest, sendEscalationApiRequest } from "./api-request";
export type { ApiRequestOutcome, EscalationEndpointConfig } from "./api-request";
export type { ApiRequestTestResult, ExtractedVariable } from "./api-request";

// Enterprise capability registry — the single edition-gating seam (#435). OSS
// ships no-op defaults (metering allows all; billing reports no subscription);
// the enterprise edition registers real implementations once at startup. Read
// capabilities through here so the open-core boundary stays one reviewed seam.
export {
  getEnterpriseCapabilities,
  registerEnterpriseCapabilities,
} from "./ee";
// The alert sourceKey registry — exported so enterprise capability
// implementations (apps/web/src/ee) construct their Alert keys through the
// one namespace registry instead of ad-hoc strings (#442).
export { alertKeys } from "./health";
export type {
  EnterpriseCapabilities,
  MeteringEnforcement,
  BillingAccessor,
  ActivationPolicy,
  ActivationState,
  UsageCheckInput,
  UsageOutcome,
  SubscriptionState,
} from "./ee";
