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
  isTeammateRetired,
  rosterTeammates,
  teammateDefaultFlow,
  teammatePersonaPrompt,
  teammateRuntimeAssistant,
  teammateSearchesKnowledge,
  visibleTeammates,
} from "./teammate";
export type { TeammateKnowledgeScope, TeammateViewer } from "./teammate";

// Teammate action grants (#770): a grant row is the grant, the ceiling caps
// every granted domain at once, and approval-bypass is the one explicit
// relaxation of ADR-0017's human-accept invariant.
export {
  DEFAULT_TEAMMATE_CEILING,
  actionRefusal,
  ceilingAllowsCapability,
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
  endpointPathParams,
  resolveCatalogPath,
} from "./api-catalog";
export type {
  ApiCatalogSummary,
  ApiEndpointDetail,
  CatalogPathMatch,
  CatalogPathRefusal,
  CatalogPathRejection,
} from "./api-catalog";

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
export { effectivePageSchedule, nextCrawlDue } from "./recrawl";

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

// Short opaque ids for domain objects.
export { monotonicNow, shortId } from "./id";

// Who paid for a model call. Exhaustive over `AiCredentialKind` by construction,
// so adding a credential kind without attributing it is a compile error.
export { fundingBucket } from "./funding";
export type { FundingBucket } from "./funding";

// --- Pure helpers that are not domain derivations -------------------------
// These predate the domain move and are here for the same reason: more than one
// workspace needs them and they depend on nothing.

// AES-256-GCM sealing for stored secrets. Sealed by the app when a credential is
// saved (provider connections, SSO, session cookies), opened by the agent
// runtime when it resolves a provider credential. Only the seal/open pair is
// public: `sealSecret` is what handles the no-key case, and a caller reaching
// past it would write a row `openSecret` cannot read back.
export { sealSecret, openSecret } from "./crypto";

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
