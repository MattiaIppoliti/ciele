/**
 * `@agent-hub/core`: the domain, and everything derivable from it.
 *
 * This package holds the vocabulary `CONTEXT.md` fixes (Organization, Assistant,
 * Member, Knowledge Collection, Source, Concept, Publication, Flow, …) as types,
 * plus the pure functions that derive facts *from* those types, flow routing,
 * OKF trust/lifecycle, the Insights read model, publication snapshots, re-crawl
 * scheduling, cost estimates. **Zero runtime dependencies, no I/O, no framework.**
 *
 * `@agent-hub/db` declares the `Db` interface over these types and depends on
 * this package. `@agent-hub/agent` runs on both. Nothing here may depend on
 * either, the arrow points one way, and that is what makes the vocabulary
 * usable without dragging an adapter behind it (ADR-0019).
 *
 * Two kinds of module here, exported two ways on purpose:
 *
 * - The **vocabulary** (`types`, `okf`) is `export *`. It has no internals to
 *   hide, its whole content *is* the vocabulary, so curating it would be
 *   ceremony, and `export *` keeps barrel and module from drifting.
 * - The **derivations** are curated, because they do have internals. The
 *   Insights read model composes seven helpers into `computeInsightsOverview`;
 *   publishing them would turn a private composition step into API that nothing
 *   locks. Export what has a consumer, and add a name when something needs it.
 */

// The domain vocabulary: every noun in CONTEXT.md, as a type.
export * from "./types";
export {
  FEEDBACK_REACTIONS,
  feedbackReactionById,
  feedbackReactionScore,
  isFeedbackReactionId,
} from "./feedback-reactions";
// The billing / plan / usage-cap vocabulary (pure types + the one shared
// warn threshold). The runtime's enterprise registry re-exports these; new
// code should import them from here.
export * from "./billing";
export { coerceEntityValue } from "./entity-values";
export { applicationConnectionOwnerType } from "./application-connections";

// Open Knowledge Format v0.2: the Concept frontmatter vocabulary and the
// read-time derivations over it (trust tier, lifecycle status, staleness).
// Never re-implement these rules, derive through them (ADR-0002).
export * from "./okf";

// --- Derivations: curated, because these modules have internals ------------

// The deterministic keyword router: the offline/no-model `matchFlow` fallback
// half of the two-engine runtime (ADR-0003). Routing only, action rendering
// lives in @agent-hub/agent.
export { matchFlow, messageFlowCandidates } from "./engine";

// Proactive triggers (page load / time on page / chat opens): which flows a
// fired client event runs, whether a nudge may be delivered into a Conversation
// again, and which actions a trigger may pair with. Routing + policy only, the
// Notification itself is rendered by @agent-hub/agent.
export {
  DEFAULT_DWELL_SECONDS,
  actionAllowedForTrigger,
  isProactiveTrigger,
  needsVisitorDeliveryHistory,
  notificationDelivery,
  proactiveDwellSeconds,
  proactiveFlowCandidates,
  proactiveTriggers,
} from "./engine";
export type {
  NotificationDeliveryContext,
  ProactiveTriggerContext,
} from "./engine";

// Objective Flow Conditions (URL, Schedule): the deterministic gate both
// routers apply through `messageFlowCandidates` before Intent Classification,
// plus the completeness rule the Flow Builder validates against so the editor
// and the runtime cannot disagree about what "configured" means (spec #550).
export {
  flowConditionDefect,
  flowConditionsAllowRouting,
} from "./flow-conditions";
export type { FlowConditionDefect, FlowRoutingContext } from "./flow-conditions";

// One rule for an admin-typed outbound link's scheme, shared by the Flow
// `show_button` action and the quick-reply editor (the widget opens the latter
// with `window.open`, which has no sanitiser in front of it).
export { externalLinkUrl } from "./external-link";

// A Flow's `api_request` credentials live in plain jsonb, so every read surface
// projects them out and every write puts the stored value back (#758).
export {
  mergeFlowSecrets,
  redactFlowSecrets,
  redactFlowsSecrets,
} from "./flow-secrets";

// Basic Interaction's deterministic tier (#566): recognise conversational
// courtesy with no model call, and pick the Flow that answers it.
export { basicInteractionFlow } from "./basic-interaction";
// Study Mode's settings-owned Flow and explicit composer command routing.
export { STUDY_MODE_FLOW_ID, studyModeFlow, studyRequestFormat } from "./study-mode";
// A Decision (#951, spec #948): the structural twins of the AI SDK's evaluation
// questions and answers, the generic derivations over them, and the pre-flight
// question map with its thresholds, routing and Thinking-line table. Pure; the
// call itself lives in `@agent-hub/agent`.
export {
  CHOICE_OPTION_CAP,
  SCORE_LEVEL_CAP,
  answeredByFallback,
  clearsThreshold,
  compositeScore,
  scoreLevel,
} from "./decision";
export type {
  AnswerFor,
  AnswersFor,
  CompositePart,
  DecisionAnswer,
  DecisionBooleanAnswer,
  DecisionBooleanQuestion,
  DecisionChoiceAnswer,
  DecisionChoiceQuestion,
  DecisionConfidence,
  DecisionQuestion,
  DecisionScoreAnswer,
  DecisionScoreQuestion,
} from "./decision";
export {
  FLOW_DEFAULT,
  FLOW_OTHER,
  FRUSTRATION_LEVELS,
  LANGUAGE_MIXED,
  LANGUAGE_OTHER,
  NONE,
  PREFLIGHT_LANGUAGES,
  PREFLIGHT_MAP_VERSION,
  PREFLIGHT_MODEL_ID,
  PREFLIGHT_QUESTION_IDS,
  PREFLIGHT_THRESHOLDS,
  REASONING_LEVELS,
  THINKING_LINES,
  buildPreflightQuestions,
  describePreflightRouting,
  foldPreflightSignals,
  frustrationLevel,
  preflightRouting,
  reasoningLevel,
  spokenLanguage,
  thinkingLine,
  thinkingOutcome,
} from "./preflight";
export {
  DEFAULT_THRESHOLD_CANDIDATES,
  cohenKappa,
  suggestThreshold,
  thresholdSweep,
} from "./preflight-calibration";
export type {
  AgreementFigures,
  CalibrationObservation,
  ThresholdPoint,
  ThresholdSuggestion,
} from "./preflight-calibration";
export {
  APPROVAL_GATE_MAP_VERSION,
  APPROVAL_GATE_QUESTION_IDS,
  APPROVAL_GATE_THRESHOLDS,
  REVERSIBILITY_OPTIONS,
  approvalReviewTitle,
  approvalVerdict,
  buildApprovalQuestions,
} from "./approval-gate";
export {
  DEDUP_CANDIDATE_LIMIT,
  IMPROVEMENT_DEDUP_THRESHOLD,
  PRIORITY_CUTS,
  PRIORITY_LEVELS,
  PRIORITY_QUESTION_IDS,
  PRIORITY_WEIGHTS,
  buildDedupQuestions,
  buildPriorityQuestions,
  dedupCandidates,
  dedupMatch,
  priorityFrom,
} from "./improvement-decisions";
export type {
  OpenImprovement,
  PriorityQuestionId,
} from "./improvement-decisions";
export {
  MAX_CLAIMS,
  TIER_ONE_THRESHOLD,
  buildClaimQuestions,
  carriesNumericFact,
  splitClaims,
  splitForTiers,
  tierOneOutcome,
} from "./verification";
export type { ClaimSplit, TierOneOutcome } from "./verification";
export type { ConversationPreflightSignals } from "./types";
export type {
  ActionApproval,
  ActionApprovalInput,
  ActionApprovalPatch,
  ApprovalReviewReason,
} from "./types";
export type {
  ApprovalDecision,
  ApprovalGateAnswers,
  ApprovalGateQuestionId,
  ApprovalGateQuestionMap,
  ApprovalSubject,
  ApprovalVerdict,
  Reversibility,
} from "./approval-gate";
export type {
  PreflightAnswers,
  PreflightCatalogue,
  PreflightDecision,
  PreflightDesk,
  PreflightFaq,
  PreflightFailure,
  PreflightLanguage,
  PreflightQuestionId,
  PreflightQuestionMap,
  PreflightRouting,
  PreflightTraceAnswer,
  PreflightTraceRecord,
  ReasoningLevel,
  ThinkingOutcome,
} from "./preflight";
export type {
  CourtesyHistoryTurn,
  CourtesyRoutingContext,
} from "./basic-interaction";

// AI Teammates (#768): the persona prompt layer, the empty-scope rule, and who
// may see or edit one. Pure derivations over the row plus the asking Member, so
// the ops layer, the runtime and a server component all decide the same way.
export {
  canEditTeammate,
  canViewTeammate,
  danglingScopeAlertCopy,
  danglingSourceScopeAlertCopy,
  isSystemTeammate,
  isTeammateRetired,
  rosterTeammates,
  teammateDefaultFlow,
  teammatePersonaPrompt,
  teammateRuntimeAssistant,
  teammateSearchesKnowledge,
  visibleTeammates,
} from "./teammate";
export type { TeammateKnowledgeScope, TeammateViewer } from "./teammate";

// Human review (#841): the approval gate's state machine and its settings rule.
export {
  DEFAULT_REVIEW_EXPIRED_MESSAGE,
  DEFAULT_REVIEW_HALT_MESSAGE,
  DEFAULT_REVIEW_TIMEOUT_HOURS,
  DEFAULT_REVIEW_WAITING_MESSAGE,
  MAX_REVIEW_TIMEOUT_HOURS,
  MIN_REVIEW_TIMEOUT_HOURS,
  REVIEW_MAIL_SCOPE,
  REVIEW_SLACK_SCOPE,
  canDecideReview,
  decideReview,
  expireReview,
  humanReviewSettingsIssue,
  isReviewOverdue,
  newReviewInputField,
  normalizeAssignees,
  reviewExpiresAt,
  reviewHaltMessage,
  reviewRequestText,
  reviewTemplateVariables,
  reviewTimeoutHours,
} from "./review";
export type { ReviewDecider, ReviewRefusal, ReviewTransition } from "./review";

// The callback gate (#842): the same state machine as the review gate with a
// machine in the middle. "The first callback wins" is the whole protection
// against a replaying caller running the rest of a Flow twice.
export {
  DEFAULT_WEBHOOK_TIMEOUT_MINUTES,
  DEFAULT_WEBHOOK_WAITING_MESSAGE,
  MAX_WEBHOOK_TIMEOUT_MINUTES,
  MIN_WEBHOOK_TIMEOUT_MINUTES,
  WEBHOOK_CALLBACK_TOKEN,
  WEBHOOK_PAYLOAD_MAX_CHARS,
  expireWebhook,
  httpWebhookSettingsIssue,
  receiveWebhook,
  isWebhookOverdue,
  webhookExpiresAt,
  webhookHaltMessage,
  webhookTemplateVariables,
  webhookTimeoutMinutes,
} from "./webhook";

// The inbound-HTTP trigger (#843): which actions a Flow with a caller may run,
// what it may read about the request, and what it may answer.
export {
  DEFAULT_HTTP_FLOW_METHODS,
  HTTP_FLOW_ACTIONS,
  HTTP_FLOW_METHODS,
  flowTriggerKind,
  httpFlowMethods,
  httpFlowRequestVariables,
  isHttpTrigger,
  jsonBodyPaths,
  respondHeaders,
  respondSettingsIssue,
  respondStatus,
} from "./http-flow";
// Human review before a Connector write (#841): the Flows Agent's default as a
// rule rather than a sentence in its persona.
export { withReviewBeforeConnectorWrites } from "./review-gate";
export type { FlowTriggerKind, HttpFlowMethod, HttpFlowRequest } from "./http-flow";

// Teammate action grants (#770): a grant row is the grant, the ceiling caps
// every granted domain at once, and approval-bypass is the one explicit
// relaxation of ADR-0017's human-accept invariant.
export {
  DEFAULT_TEAMMATE_CEILING,
  actionRefusal,
  ceilingAllowsCapability,
  memberRoleRank,
  roleAllowsCapability,
  grantedDomains,
  hasGrant,
  mayAcceptSuggestedFix,
} from "./teammate-grants";
export type { TeammateActionDomain } from "./teammate-grants";

// Three-layer document memory + the Project layer (#771): which layer a row
// is, the injection cap, the prompt sections, and the append rule for an
// agent's own learnings. Documents injected whole, deliberately not the
// embedding recall the widget keeps for Visitors.
export {
  MEMORY_DOCUMENT_MAX_CHARS,
  appendAgentLearning,
  capMemoryDocument,
  memoryDocumentChanges,
  memoryDocumentOwner,
  memoryDocumentScope,
  memoryPromptSections,
  projectInjects,
} from "./memory-documents";
export type {
  MemoryDocumentChange,
  MemoryLayerInput,
} from "./memory-documents";
// What "live" means for a memory, written once (#926). The knowledge half
// names the two constants a page-scoped memory implies, so no caller re-checks
// `forgottenAt` by hand. The subject half is ADR-0023's shape, here ahead of
// that branch so its merge is a no-op.
export { isKnowledgeMemoryLive, isMemoryLive } from "./memory";
// Memory extraction's pure half (#930): the verbatim-quote gate that refuses an
// invented fact, the cap, and the re-crawl reconciliation that never undoes a
// Member's forget.
// Why a Document has no memories (#933): the four answers the empty state
// gives instead of "No memories yet.", derived from the extraction record.
export { memoriesEmptyState } from "./memory-empty-state";
export type { MemoriesEmptyState } from "./memory-empty-state";
export {
  KNOWLEDGE_MEMORY_CAP,
  filterExtractedMemories,
  reconcileKnowledgeMemories,
} from "./knowledge-memory-extraction";
export type {
  ExistingMemory,
  ExtractedMemory,
  FilteredMemories,
  MemoryReconciliation,
} from "./knowledge-memory-extraction";
// A Source's Documents table (#927): the status pill, derived at read time
// from the two columns that already carry the answer.
export {
  DOCUMENT_CHUNKS_PAGE_SIZE,
  SOURCE_DOCUMENTS_PAGE_SIZE,
  sourceDocumentStatus,
  sourceDocumentStatusLabel,
} from "./source-documents";
export type { SourceDocumentStatus } from "./source-documents";
// The order the two paged knowledge tables read in. Shared because each read
// exists as SQL and again in memory, and an order that differs between them
// loses rows across a page boundary rather than looking wrong.
export {
  compareOrgKnowledgeSources,
  compareSourceDocuments,
} from "./knowledge-order";
export type {
  OrgKnowledgeSourceOrder,
  SourceDocumentOrder,
} from "./knowledge-order";
export type { MemoryLifecycleFields } from "./memory";

// Near-duplicate detection for auto-filed Improvements (#767, story 15): the
// cross-conversation half of the dedup, lexical rather than embedding-based on
// purpose (see the module comment).
export {
  IMPROVEMENT_DUPLICATE_THRESHOLD,
  findDuplicateImprovement,
  titleSimilarity,
} from "./improvement-dedup";

// Routines (#772): when an unattended run is due, and how its Conversation is
// marked. The schedule is pure here so both Db implementations and the cron
// agree, and so "did this already run today" is written once.
export {
  ROUTINE_CADENCES,
  ROUTINE_OVERFETCH_MS,
  TEAMMATE_ROUTINE_CAP,
  isRoutineConversation,
  isRoutineDue,
  routineConversationMetadata,
  routineNextRun,
  routineSlotStart,
  routineTitle,
} from "./routines";

// Teammate channels (#778): who is in one, who may change it, which colleagues
// a message addressed, and when a fan-out has to stop. The mention resolver IS
// the channel perimeter, and the chain accounting is pure so "the eleventh turn
// never runs" is assertable without a model.
export {
  CHANNEL_CHAIN_TEAMMATE_TURN_CAP,
  CHANNEL_CHAIN_TURN_CAP,
  canAddToChannel,
  canAddTeammateToChannel,
  canManageChannel,
  chainCapMarker,
  chainTurnVerdict,
  channelMemberIds,
  channelRoster,
  channelPromptSection,
  channelTeammateIds,
  channelUnread,
  isChannelMember,
  memberDisplayName,
  mentionedTeammateIds,
  parseChannelMentions,
} from "./channel";
export type {
  ChainCapReason,
  ChainVerdict,
  ChannelRosterEntry,
  ChannelUnread,
} from "./channel";

// Teammate referral (#773): who a Teammate may hand a request to, and what the
// colleague on the other end reads when it arrives. Human-mediated by design:
// the card is an offer, and nothing runs until the Member clicks.
export {
  isReferredConversation,
  referralCandidates,
  referralContextSection,
  referralPromptSection,
  standingContextSections,
} from "./referral";
export type { ReferralCandidate } from "./referral";

// The API catalogue (spec #559): what the model is told an API integration can
// do, and whether a path it produced is one the catalogue describes. The
// validation is here rather than in the runtime because "is this path
// described?" is a fact about the catalogue, and a path it does not describe
// must never reach the network.
export {
  apiCatalogSummary,
  apiEndpointDetail,
  endpointIdempotencyExposure,
  endpointIdempotencyKey,
  endpointPathParams,
  resolveCatalogPath,
  validateEndpointIdempotency,
} from "./api-catalog";
export type {
  ApiCatalogSummary,
  ApiEndpointDetail,
  CatalogPathMatch,
  CatalogPathRefusal,
  CatalogPathRejection,
  IdempotencyRejection,
} from "./api-catalog";

// Resolving one operation out of an OpenAPI / Swagger document (#837): a fact
// about the document, so the builder's test and the runtime's request read it
// the same way.
export { resolveOpenApiOperation } from "./openapi";
export type {
  OpenApiResolution,
  OpenApiResolveError,
  ResolvedOperation,
} from "./openapi";

// The Connector catalogue (#839): catalogued actions over Application
// Connections, read by the builder, Publish and the runtime alike.
export {
  CONNECTOR_ACTIONS,
  CONNECTOR_INTERNAL_ONLY_REASON,
  CONNECTOR_PROVIDERS,
  CONNECTOR_PROVIDER_LABELS,
  connectorAction,
  connectorRunsInternalOnly,
  connectorActionsFor,
  connectorConnectionIssue,
  connectorMissingParams,
  connectorMissingScopes,
  connectorOutputVariable,
  connectorParamValue,
  connectorSettingsIssue,
  isConnectorProvider,
} from "./connector-catalog";
export type {
  ConnectorAction,
  ConnectorEffect,
  ConnectorField,
  ConnectorFieldDynamic,
  ConnectorFieldType,
  ConnectorLoader,
  ConnectorOutput,
} from "./connector-catalog";

// The Insights read model. `computeInsightsOverview` is the oracle the SQL
// aggregate `get_insights_overview` is checked against (ADR-0010); the seven
// helpers it composes stay internal, and its tests reach them directly.
export { computeInsightsOverview, colorizeOverview, isoDay } from "./insights";

// Shipped defaults for a new Assistant and for support-channel availability.
export {
  DEFAULT_AI_DISCLAIMER,
  DEFAULT_BASIC_REPLY,
  DEFAULT_FLOWS,
  DEFAULT_WELCOME_MESSAGE,
  defaultChannelAvailability,
  defaultChannelConversationData,
  normalizeChannelAvailability,
  sortFlows,
} from "./defaults";
export type { DefaultFlowSpec } from "./defaults";

// Which Assistant fields freeze into an immutable Publication snapshot.
export { buildPublicationConfig } from "./publication";

// Per-site re-crawl cadence: when a Website Source next falls due. Clock-free.
export {
  DEFAULT_PAGE_BUDGET,
  effectivePageSchedule,
  isUnlimitedPages,
  NO_PAGE_LIMIT,
  nextCrawlDue,
  pageBudget,
} from "./recrawl";

// Reads a stored message's content parts: flattened to text, and whether the
// message is a proactive Notification (the Insights accounting rule, #546).
export { isProactiveMessage, messageText } from "./message";

// `AgenticTrace`: the reference platform's flat bracketed turn trace, produced
// only at export time from the structured Thinking Steps we actually store, and
// read back by the round-trip test that keeps the two representations honest.
export { parseAgenticTrace, serializeAgenticTrace } from "./agentic-trace";
export type {
  AgenticTraceMarker,
  AgenticTraceSegment,
  SerializeAgenticTraceInput,
} from "./agentic-trace";

// Per-model token prices and the cost estimate derived from them.
export { estimateCostEur } from "./pricing";

// Credits: the cost unit plan allowances are denominated in. Only the
// conversion is public; the rate tables behind it stay package-private so
// there is one place a price list is read.
export { CREDIT_EUR, creditsFor, isFreeCrawler } from "./pricing";
export type { MeteredUnit } from "./pricing";

// Where the credits went (#848): the pivot from the ledger's spender grain
// onto one ranked list. Grouping by a single dimension at a time is the rule
// that keeps a row attributed to both a Teammate and a Member from being
// counted twice.
export { rankSpenders, spenderDimensions } from "./usage-spenders";
export type { SpenderTotal, UsageSpenderDimension } from "./usage-spenders";

// Short opaque ids for domain objects.
export { monotonicNow, shortId } from "./id";

// Who paid for a model call. Exhaustive over `AiCredentialKind` by construction,
// so adding a credential kind without attributing it is a compile error.
export {
  crawlCredentialKind,
  crawlMeterCredentialKind,
  fundingBucket,
} from "./funding";
export type { FundingBucket } from "./funding";

// --- Pure helpers that are not domain derivations -------------------------
// These predate the domain move and are here for the same reason: more than one
// workspace needs them and they depend on nothing.

// AES-256-GCM sealing for stored secrets. Sealed by the app when a credential is
// saved (provider connections, SSO, session cookies), opened by the agent
// runtime when it resolves a provider credential. `encryptSecret` stays private
// so a caller cannot reach past the pair and write a row `openSecret` cannot
// read back; `isLegacyPlaintextSecret` identifies rows the removed no-key
// fallback wrote, which a rotation has to find before it can re-seal them.
export { sealSecret, openSecret, isLegacyPlaintextSecret } from "./crypto";

// What an uploaded file actually is, before a parser reads it (#801, CYB-09):
// magic-byte agreement with the claimed extension, and the two things an
// OOXML package can carry that a document has no use for.
export {
  documentExtension,
  triageDocument,
  zipDirectory,
  DOCUMENT_TRIAGE_VERSION,
  type DocumentTriage,
  type DocumentTriageCode,
  type TriageEvidence,
  type ZipEntry,
} from "./document-triage";

// Organization API key secrets (#618): mint, hash, and hint. Verification is
// a hash lookup, so the same trio serves the web app now and /api/v1 later.
export {
  API_KEY_PREFIX,
  apiKeySecretHint,
  generateApiKeySecret,
  hashApiKeySecret,
} from "./api-keys";

// Reads a message off a thrown value: including the plain objects PostgREST
// throws instead of Error instances.
export { thrownMessage } from "./thrown-message";

// The Slack conversational opt-in (#857): the parser every surface shares
// and the readiness predicate the dialog, the save and the worker agree on.
export {
  SLACK_BOT_SCOPES,
  SLACK_CHANNEL_ID,
  slackBotConfig,
  slackBotReady,
} from "./slack-bot";
export type { SlackBotConfig } from "./slack-bot";
export { isOpenImprovement } from "./improvements";

// Per-message model choice: the allow-list an Assistant or Teammate offers,
// and the one rule that turns a client's string into the model a turn runs.
export {
  modelChoices,
  modelSelector,
  parseModelSelector,
  resolveRequestedModel,
  sameModel,
} from "./model-choice";
export type { ModelRef } from "./model-choice";

// Files attached to a chat message (read into text at intake; the bytes are
// never stored). The prompt fence lives with the type, because "this is their
// material, not your brief" is a runtime rule rather than one app's copy.
export {
  ATTACHMENT_MAX_CHARS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  attachmentContextSection,
} from "./attachments";
export type { ChatAttachment } from "./attachments";
