/**
 * `@agent-hub/agent`: the chat runtime as a deep module (ADR-0005).
 *
 * This barrel is the package's **public server interface**. Everything else in
 * `src/` is implementation: a fresh reader (human or agent) reads this file to
 * know what the runtime does, and only opens the internals to change behavior.
 * There is no subpath export for internals, so a deep import does not resolve,
 * the seam is enforced by module resolution, not by a lint rule.
 *
 * Client code cannot import from here (it pulls in the AI SDK + server-only
 * deps). The client-safe surface, stream parsing and the static model catalog,
 * lives in `./client`. The local provider-CLI surface lives in
 * `./local-providers`.
 *
 * The package is framework-free: nothing here imports `next/*`. The two facts
 * it needs from its host are ports registered through `registerRuntimeHost`
 * (see `host.ts`), both with defaults that keep the runtime correct unwired.
 *
 * The exact export shape of all three barrels is locked by `interface.test.ts`,
 * so re-widening the interface is a deliberate, reviewed act rather than an
 * accident.
 */

// Host ports: the two facts the runtime needs from the process hosting it.
// Registered once at startup (apps/web does it from `instrumentation.ts`); both
// have defaults that keep the runtime correct if nobody registers anything.
export { runTriageDecision } from "./improvement-decisions";
export type { TriageDecisionResult } from "./improvement-decisions";
export { registerRuntimeHost, DEFAULT_PLATFORM_PROMPT } from "./host";
export type { RuntimeHost } from "./host";

// Conversation Turn: the one entrypoint for answering a user message.
export { streamConversationTurn, NDJSON_HEADERS } from "./turn";
export type {
  AssistantTurnInput,
  ConversationTurnInput,
  TeammateTurnInput,
} from "./turn";
// Teammate channels (#778): everything one human message sets off in a group
// thread. One entrypoint, streaming the same events a 1:1 turn does with an
// envelope saying who is speaking; the caps live in `@agent-hub/core` so they
// can be asserted without a model.
export { streamChannelChain, CHANNEL_NDJSON_HEADERS } from "./channel-turn";
export type {
  ChannelChainInput,
  ChannelTurnRequest,
  ChannelTurnResult,
  ChannelTurnRunner,
} from "./channel-turn";
export type { ChannelEvent } from "./types";
// The Agent memory layer's writer (#771): distils one turn into a durable
// learning. Exported for the cron drain's sake, like the other job entrypoints.
export { distillAgentLearning } from "./agent-learnings";
// Unattended Routine runs (#772). Public because the cron tick composes it and
// the host wires the grant-resolving port; nothing else should reach it.
export { runDueRoutines } from "./routine-runner";
export type { RoutineRunReport, RoutineRunnerDeps } from "./routine-runner";
// The AI Teammate action port (#770): the host hands the turn a list of things
// this Teammate may do, and the runtime turns each into a tool with a
// transcript card. The runtime never learns that operations exist.
export type { TeammateActionOutcome, TeammateActionTool } from "./types";

// Per-request session metadata (UA/IP/locale) for a chat request.
export { sessionMetadata } from "./session-meta";

// Knowledge ingestion: extract Source text, enqueue the ingest job, and the
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
// Reading an image, which is where "OCR" would be if Ciele had one: the
// Organization's own provider connection answers what the picture says, and
// the words join the pipeline where a PDF's text does (see `vision.ts`).
export { createVisionReader } from "./vision";
export type { VisionReader } from "./vision";
export { enqueueIngestJob, runDueIngestJobs } from "./jobs";
// The one-off verbatim re-ingest (ADR-0025), driven by a manual cron route.
export { enqueueVerbatimReingests, type VerbatimReingestReport } from "./jobs";
export { enqueueApplicationSyncJob } from "./jobs";
export {
  discoverApplicationConnectionScopes,
  revokeApplicationConnectionCredentials,
} from "./application-provider-connectors";
export type {
  ApplicationCredentials,
  ApplicationScopeOption,
} from "./application-connectors";

// The scheduled drains: one call per cron tick. The batch sizes, lease window
// and per-Source failure reporting are policy of the runtime, so they live here
// and the cron endpoints are auth-and-serialize adapters over these two.
export {
  sweepDueRecrawls,
  finalizeDueCrawls,
  sweepExpiredObjectAccess,
  sweepExpiredTraces,
  sweepExpiredTranscripts,
  OBJECT_ACCESS_RETENTION_DAYS,
  RECRAWL_SWEEP_BATCH_SIZE,
  CRAWL_FINALIZE_BATCH_SIZE,
} from "./scheduled";
// The pre-flight's nightly drift replay (#953): the cron tick over the
// labelled baseline, tested without a request beside the other scheduled jobs.
export { runPreflightDriftReplay } from "./preflight-drift";
export type { PreflightDriftReport } from "./preflight-drift";
// Detection-as-code over the object-access ledger (#801, CYB-19): the pure
// rules, and the cron tick that turns findings into keyed Alerts.
export {
  runSecurityDetections,
  runDetectionRules,
  detectBulkDownloads,
  detectNewAddressDownloads,
  detectRefusalProbes,
  NEW_ADDRESS_MIN_BASELINE,
  NEW_ADDRESS_BASELINE_DAYS,
  BULK_DOWNLOAD_THRESHOLD,
  REFUSAL_PROBE_THRESHOLD,
  DETECTION_WINDOW_HOURS,
} from "./security-detections";
export type {
  SecurityDetectionsReport,
  SecurityFinding,
} from "./security-detections";
export type {
  SweepDueRecrawlsReport,
  FinalizeDueCrawlsReport,
  SweepExpiredTracesReport,
  SweptRecrawlResult,
  FinalizedCrawlResult,
  SweptTraceResult,
} from "./scheduled";

// Suggested Fix: drafts a reviewable knowledge proposal for a flagged answer
// (ADR-0017). Best-effort; a drafting failure leaves a "no proposal" state.
// The drafter itself (draftImprovementProposal) is an internal the job
// handler runs; callers enqueue.
export { enqueueDraftProposalJob } from "./jobs";

// A Document's Summary (#931): one classifier-tier call over a body, made the
// first time a Member opens that Document and cached on its row. Best-effort:
// no credential or a model error returns null and the card shows an Excerpt.
export { summariseDocument, SUMMARY_INPUT_CHARS } from "./summarise-document";

// The memories backfill (#933): queue extraction for one Source's Documents
// that need it, skipping what is already fresh or already queued. Nothing
// backfills automatically, so this is the lever the console offers instead.
export { enqueueStaleDocumentMemoryExtractions } from "./jobs";

// Synced Record ingestion (#670): "sync now" enqueue for the
// sync_entity_records job kind (the due-scan + drain ride finalizeDueCrawls).
export { enqueueEntitySyncJob } from "./jobs";

// Which crawler providers the current environment can run, drives the admin
// Website Source crawler picker (e.g. Crawl4AI is only offered when its worker
// is configured). Never carries the underlying credentials.
export { websiteCrawlerCapabilities } from "./website-crawlers";
export { verifyApifyToken } from "./apify";
export type { WebsiteCrawlerCapabilities } from "./website-crawlers";

// The nightly agentic-ops drain, standing goals, the independent answer
// verifier, trust materialization and the compost loop, in that order (the
// sequencing IS the policy: tonight's verdicts feed tonight's tiers). ONE
// export for the cron route; the four loops it composes are internals.
export { runDueAgenticOps } from "./scheduled";
export type { AgenticOpsReport } from "./scheduled";

// Provider/model resolution (which LLMs an org can actually run on) and
// pre-flight validation of a provider API key.
export { providerAvailability } from "./models";
// The models a chat window may offer (allow-list ∩ the org's connections), and
// the row shape the client draws. Server-side because capability is read from
// the Provider Connections and the platform environment.
export { chatModelOptions } from "./model-options";
export type { ChatModelOption } from "./model-options";
export { validateProviderApiKey, InvalidProviderKeyError } from "./validate-key";
// "Test connection" for an OpenAI-compatible endpoint: one-token chat call +
// one embedding call (#436), drives the admin connection form.
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
// The Connector action's shared core (#839): the builder's Run node, option
// loaders and connection test, plus the Db-bound runtime the hosts pass in.
export {
  connectorAlertKey,
  dbConnectorRuntime,
  loadConnectorOptions,
  testConnectorAction,
  testConnectorConnection,
} from "./connector-request";
export type {
  ConnectorError,
  ConnectorErrorCode,
  ConnectorOption,
  ConnectorOutcome,
  ConnectorRuntime,
} from "./connector-request";
// Human review (#841): the gate's runtime, jobs, clock and signed links.
export {
  dbReviewRuntime,
  enqueueReviewResumptionJob,
  expireDueReviews,
  resumeReviewedConversation,
  reviewLinkUrl,
  runDueReviewJobs,
  verifyReviewLinkToken,
} from "./review-runtime";
export type { ReviewJobDeps, ReviewLinkVerdict } from "./review-runtime";
export type { ReviewRuntime } from "./types";

// Slack mention replies (#857): the signed event route enqueues, its
// after-response hook and the run-slack cron tick drain. The handler itself is
// registered in the job ledger and stays internal.
export {
  enqueueSlackMention,
  resolveSlackConnection,
  runDueSlackMentionJobs,
  slackKey,
} from "./slack-mentions";
export type { SlackMention } from "./slack-mentions";

// The callback gate (#842): the gate's runtime, its job, its clock, and the
// signed URL that is the anonymous caller's whole authorization.
export {
  deliverWebhookCallback,
  expireDueWebhooks,
  resumeWebhookConversation,
  runDueWebhookJobs,
  unsubscribePendingWebhooks,
  verifyWebhookCallbackToken,
  webhookCallbackUrl,
} from "./webhook-runtime";
export type { WebhookDeliveryOutcome, WebhookTokenVerdict } from "./webhook-runtime";
export type { WebhookRuntime } from "./types";

// The inbound-HTTP trigger (#843): decide whether a request may run a Flow,
// then run it and lift its answer off the end.
export { refuseHttpFlow, runHttpFlow } from "./http-flow-run";
export type { HttpFlowRefusal, HttpFlowResult } from "./http-flow-run";
export type { ApiRequestOutcome, EscalationEndpointConfig } from "./api-request";
export type { ApiRequestTestResult, ExtractedVariable } from "./api-request";

// Enterprise capability registry: the single edition-gating seam (#435). OSS
// ships no-op defaults (metering allows all; billing reports no subscription);
// the enterprise edition registers real implementations once at startup. Read
// capabilities through here so the open-core boundary stays one reviewed seam.
export {
  USAGE_WARN_FRACTION,
  getEnterpriseCapabilities,
  registerEnterpriseCapabilities,
} from "./ee";
// The alert sourceKey registry: exported so enterprise capability
// implementations (apps/web/src/ee) construct their Alert keys through the
// one namespace registry instead of ad-hoc strings (#442).
export { alertKeys } from "./health";
export type {
  EnterpriseCapabilities,
  MeteringEnforcement,
  UsageWindow,
  UsageWindowName,
  UsageMeterSnapshot,
  UsageLimitsSnapshot,
  BillingAccessor,
  BillingAccountSnapshot,
  BillingInvoice,
  BillingPaymentMethod,
  AnswerModelBasis,
  PlanCatalog,
  PlanCatalogEntry,
  PlanVolumes,
  UpgradeCheckoutInput,
  ActivationPolicy,
  ActivationState,
  UsageCheckInput,
  UsageOutcome,
  SubscriptionState,
} from "./ee";
