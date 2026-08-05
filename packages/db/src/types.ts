/**
 * The `Db` interface — the data-access seam (ADR-0002), and nothing else.
 *
 * Every noun this interface traffics in is a domain type from `@agent-hub/core`;
 * this file declares only the *operations*. Two adapters implement it in
 * lockstep — `supabase.ts` (RLS-scoped) and `mock.ts` (in-memory) — and
 * `db-contract.suite.ts` runs one spec against both.
 *
 * ADR-0016 is narrowing this surface vertically (behavioural methods stay
 * first-class; plain CRUD migrates onto the generic `table()` accessor).
 * ADR-0019 cut it horizontally: the ~150 domain types this file used to declare
 * alongside `Db` now live in `@agent-hub/core`, so wanting the word `Flow` no
 * longer means depending on a Supabase adapter.
 */

import type {
  AiUsageInput,
  Alert,
  AlertType,
  AnswerVerdict,
  AnswerVerdictInput,
  ApiIntegration,
  ApiIntegrationInput,
  Assistant,
  AssistantAccessEntry,
  AssistantAccessRole,
  AssistantGoal,
  AssistantInput,
  AssistantPatch,
  BackgroundJob,
  BackgroundJobKind,
  BackgroundJobStatus,
  BudgetEnforcement,
  CompostDigest,
  Concept,
  ConceptFrontmatter,
  Conversation,
  ConversationMetadata,
  ConversationSubject,
  CrawlFinalizeBatchClaim,
  CrawlFinalizeClaim,
  CurrentOrg,
  DueCompostAssistant,
  DueRecrawlClaim,
  ExportJob,
  ExportJobFormat,
  ExportJobKind,
  ExportJobStatus,
  Flow,
  FlowInput,
  FlowPatch,
  FlowTrust,
  FlowTrustEvent,
  GoalExpectations,
  GoalStatus,
  HelpDesk,
  Improvement,
  ImprovementAssociation,
  ImprovementListItem,
  ImprovementMessageLink,
  ImprovementPatch,
  ImprovementProposal,
  ImprovementProposalPayload,
  ImprovementProposalStatus,
  InboxConversation,
  InsightsFilter,
  InsightsMessage,
  InsightsOverview,
  Invite,
  KnowledgeCollection,
  KnowledgeSearchResult,
  LocalConnectorDevice,
  LocalConnectorPairing,
  LocalInferenceJob,
  Member,
  OrgApiKey,
  OrgApiKeyInput,
  OrgBudget,
  OrgWebsiteSource,
  Organization,
  OrganizationPatch,
  Profile,
  ProfilePatch,
  ProviderConnection,
  ProviderConnectionConfig,
  ProviderConnectionProvider,
  ProviderConnectionType,
  Publication,
  PublicationConfig,
  RecrawlSchedule,
  Role,
  RuntimeEventInput,
  ServiceNowConfig,
  Skill,
  SkillInput,
  SkillPatch,
  Source,
  SourceKind,
  SourceStatus,
  SsoConnection,
  SsoConnectionConfig,
  SsoConnectionPublic,
  SsoProviderKind,
  SsoValidationStatus,
  StoredMessage,
  StoredTurnTrace,
  SupportChannel,
  SupportChannelInput,
  SupportChannelPatch,
  TicketingPlatform,
  TrustSignal,
  TrustTier,
  UsageDailyRow,
  UsageMeterRow,
  VerifiableAnswer,
  WebsiteSourceConfig,
} from "@agent-hub/core";
import type { DbTableAccessor, DbTableName } from "./table-access";

export interface Db {
  // Organizations & membership
  /**
   * Resolves the caller's active Organization. When `preferredOrgId` is
   * given, tries that org first (falls back to the caller's first
   * membership if it isn't visible to them) — used to let a platform
   * superuser browse an org they aren't a member of. Callers with a real
   * `organization_members` row get their actual per-org Role; a superuser
   * browsing an org with no membership row gets a synthetic 'owner' Role
   * (full access, not a real membership).
   */
  getCurrentOrg(preferredOrgId?: string): Promise<CurrentOrg | null>;
  /**
   * Every Organization visible to the caller under RLS — for a regular
   * Member this is just their own org(s); for a platform superuser this is
   * every Organization in the database. Powers the org switcher.
   */
  listOrganizations(): Promise<Organization[]>;
  createOrganization(name: string): Promise<string>;
  acceptInvite(token: string): Promise<string>;
  listMembers(organizationId: string): Promise<Member[]>;
  updateMemberRole(
    organizationId: string,
    userId: string,
    role: Role
  ): Promise<void>;
  removeMember(organizationId: string, userId: string): Promise<void>;
  listInvites(organizationId: string): Promise<Invite[]>;
  createInvite(
    organizationId: string,
    role: Role,
    email?: string
  ): Promise<Invite>;
  revokeInvite(inviteId: string): Promise<void>;
  /** Org name + logo — admin+ only (enforced by RLS and requireMember). */
  updateOrganization(
    organizationId: string,
    patch: OrganizationPatch
  ): Promise<Organization>;

  // Organization API keys (#618) — programmatic access credentials.
  // Admin+ only (enforced by RLS and requireMember); the secret itself never
  // passes through this seam, only its hash and displayable hint.
  listApiKeys(organizationId: string): Promise<OrgApiKey[]>;
  createApiKey(
    organizationId: string,
    input: OrgApiKeyInput
  ): Promise<OrgApiKey>;
  /** Marks the key revoked (row kept for audit). Idempotent. */
  revokeApiKey(keyId: string): Promise<void>;

  // Profile (the signed-in caller's own — Settings > Profile)
  getProfile(): Promise<Profile | null>;
  updateProfile(patch: ProfilePatch): Promise<Profile>;

  // Assistants
  listAssistants(organizationId: string): Promise<Assistant[]>;
  getAssistant(id: string): Promise<Assistant | null>;
  createAssistant(
    organizationId: string,
    input: AssistantInput
  ): Promise<Assistant>;
  updateAssistant(id: string, patch: AssistantPatch): Promise<Assistant>;
  deleteAssistant(id: string): Promise<void>;

  // Per-assistant access overrides ("Manage access" — PRD #296).
  // Reads/writes are org-Admin+ (RLS-enforced); a per-assistant admin
  // override never grants access management.
  listAssistantAccess(assistantId: string): Promise<AssistantAccessEntry[]>;
  setAssistantAccess(
    assistantId: string,
    userId: string,
    role: AssistantAccessRole
  ): Promise<void>;
  /** Back to "System Role" (removes the override row). */
  clearAssistantAccess(assistantId: string, userId: string): Promise<void>;

  // Flows
  listFlows(assistantId: string): Promise<Flow[]>;
  createFlow(assistantId: string, input: FlowInput): Promise<Flow>;
  updateFlow(id: string, patch: FlowPatch): Promise<Flow>;
  deleteFlow(id: string): Promise<void>;
  reorderFlows(assistantId: string, orderedIds: string[]): Promise<void>;

  // Help desks (org-level escalation destinations)
  listHelpDesks(organizationId: string): Promise<HelpDesk[]>;
  getHelpDesk(id: string): Promise<HelpDesk | null>;
  createHelpDesk(
    organizationId: string,
    input: { name: string; description?: string }
  ): Promise<HelpDesk>;
  updateHelpDesk(
    id: string,
    patch: {
      name?: string;
      description?: string;
      autoGenerateImprovements?: boolean;
    }
  ): Promise<HelpDesk>;
  deleteHelpDesk(id: string): Promise<void>;
  listSupportChannels(helpDeskId: string): Promise<SupportChannel[]>;
  createSupportChannel(
    helpDeskId: string,
    input: SupportChannelInput
  ): Promise<SupportChannel>;
  updateSupportChannel(
    id: string,
    patch: SupportChannelPatch
  ): Promise<SupportChannel>;
  deleteSupportChannel(id: string): Promise<void>;
  reorderSupportChannels(
    helpDeskId: string,
    orderedIds: string[]
  ): Promise<void>;
  setTicketingIntegration(
    helpDeskId: string,
    input: { platform: TicketingPlatform; name: string; config: ServiceNowConfig }
  ): Promise<HelpDesk>;
  clearTicketingIntegration(helpDeskId: string): Promise<HelpDesk>;

  // Widget SSO connections (one per organization). `encryptedSecret` is sealed
  // by the caller before `setSsoConnection` and returned only by the
  // server-side `getSsoConnection`; `getSsoConnectionPublic` is the sole
  // browser/widget-safe read.
  getSsoConnection(organizationId: string): Promise<SsoConnection | null>;
  getSsoConnectionPublic(
    organizationId: string
  ): Promise<SsoConnectionPublic | null>;
  setSsoConnection(
    organizationId: string,
    input: {
      provider: SsoProviderKind;
      config: SsoConnectionConfig;
      encryptedSecret?: string | null;
    }
  ): Promise<SsoConnection>;
  setSsoConnectionValidation(
    organizationId: string,
    status: SsoValidationStatus
  ): Promise<SsoConnection>;
  clearSsoConnection(organizationId: string): Promise<void>;

  // API integrations (one per Assistant, spec #559). The endpoint catalogue and
  // base URL are ordinary config; `encryptedCredential` is sealed by the caller
  // before `setApiIntegration` (this seam never seals) and lives in this table
  // rather than `assistants.tools` precisely so it can never travel into a
  // Publication snapshot or down to a widget client.
  getApiIntegration(assistantId: string): Promise<ApiIntegration | null>;
  setApiIntegration(input: ApiIntegrationInput): Promise<ApiIntegration>;
  deleteApiIntegration(assistantId: string): Promise<void>;

  // Provider connections
  listProviderConnections(organizationId: string): Promise<ProviderConnection[]>;
  createProviderConnection(
    organizationId: string,
    input: {
      type: ProviderConnectionType;
      provider: ProviderConnectionProvider;
      displayName?: string;
      encryptedKey?: string | null;
      keyHint?: string;
      config?: ProviderConnectionConfig;
      createdBy?: string | null;
    }
  ): Promise<ProviderConnection>;
  deleteProviderConnection(id: string): Promise<void>;
  /**
   * The connection the Organization chose to embed its knowledge, or null for
   * the runtime's automatic provider order (#437).
   */
  getEmbeddingConnectionId(organizationId: string): Promise<string | null>;
  /**
   * Pick the embedding connection, or pass null to return to the automatic
   * order. The connection must belong to the Organization.
   */
  setEmbeddingConnectionId(
    organizationId: string,
    connectionId: string | null
  ): Promise<void>;

  // Knowledge (OKF collections)
  listCollections(assistantId: string): Promise<KnowledgeCollection[]>;
  getCollection(id: string): Promise<KnowledgeCollection | null>;
  createCollection(
    assistantId: string,
    input: { name: string; description?: string }
  ): Promise<KnowledgeCollection>;
  deleteCollection(id: string): Promise<void>;
  listSources(collectionId: string): Promise<Source[]>;
  createSource(input: {
    collectionId: string;
    name: string;
    kind: SourceKind;
    config?: WebsiteSourceConfig;
    recrawlSchedule?: RecrawlSchedule;
    originalObjectPath?: string | null;
  }): Promise<Source>;
  updateSource(
    id: string,
    patch: {
      name?: string;
      status?: SourceStatus;
      error?: string;
      config?: WebsiteSourceConfig;
      recrawlSchedule?: RecrawlSchedule;
      lastCrawledAt?: string | null;
      originalObjectPath?: string | null;
    }
  ): Promise<void>;
  getSource(id: string): Promise<Source | null>;
  createBackgroundJob(input: {
    kind: BackgroundJobKind;
    sourceId?: string | null;
    payload: Record<string, unknown>;
    maxAttempts?: number;
    nextRunAt?: string;
  }): Promise<BackgroundJob>;
  listBackgroundJobsForSource(
    sourceId: string,
    kind?: BackgroundJobKind
  ): Promise<BackgroundJob[]>;
  claimBackgroundJobs(input: {
    kind: BackgroundJobKind;
    workerId: string;
    now: string;
    staleBefore: string;
    limit: number;
  }): Promise<BackgroundJob[]>;
  updateBackgroundJob(
    id: string,
    patch: {
      status?: BackgroundJobStatus;
      error?: string;
      nextRunAt?: string;
      lockedAt?: string | null;
      lockedBy?: string | null;
    }
  ): Promise<void>;

  // --- Report exports (durable, off the request path) -----------------------
  createExportJob(
    organizationId: string,
    input: {
      kind: ExportJobKind;
      format: ExportJobFormat;
      params: Record<string, unknown>;
    }
  ): Promise<ExportJob>;
  listExportJobs(organizationId: string): Promise<ExportJob[]>;
  getExportJob(id: string): Promise<ExportJob | null>;
  /**
   * Atomically claims due export jobs (cross-org, service role): stamps the
   * running status + lock so overlapping cron ticks never double-run a job.
   */
  claimDueExportJobs(input: {
    workerId: string;
    now: string;
    staleBefore: string;
    limit: number;
  }): Promise<ExportJob[]>;
  updateExportJob(
    id: string,
    patch: {
      status?: ExportJobStatus;
      error?: string;
      storagePath?: string | null;
      lockedAt?: string | null;
      lockedBy?: string | null;
    }
  ): Promise<void>;
  /** Re-queues a job for another run: clears the error, lock, and attempts. */
  requeueExportJob(id: string): Promise<void>;

  /** Atomically claims the next cross-tenant crawl-finalization batch. */
  claimProcessingCrawlSources(input: CrawlFinalizeBatchClaim): Promise<
    Array<{ sourceId: string; collectionId: string; assistantId: string }>
  >;
  /**
   * Atomically claims the next cross-tenant batch of Website Sources whose
   * per-site re-crawl cadence is due, flipping each to `processing` so it is
   * handed to the crawl pipeline exactly once. Sources already crawling or set
   * to "never" (and never-crawled Sources) are excluded, so running the sweep
   * twice in a window never double-crawls.
   */
  claimDueRecrawlSources(input: DueRecrawlClaim): Promise<
    Array<{ sourceId: string; collectionId: string; assistantId: string }>
  >;
  /** Atomically leases a processing Source to one finalizer worker. */
  claimProcessingCrawlSource(input: CrawlFinalizeClaim): Promise<boolean>;
  /** Renews a lease and proves this worker still owns it before writes. */
  renewProcessingCrawlSourceClaim(
    input: Pick<CrawlFinalizeClaim, "sourceId" | "workerId" | "now">
  ): Promise<boolean>;
  /** Releases a lease only when it is still owned by the calling worker. */
  releaseProcessingCrawlSourceClaim(
    input: Pick<CrawlFinalizeClaim, "sourceId" | "workerId">
  ): Promise<void>;
  deleteSource(id: string): Promise<void>;
  /**
   * Deletes exactly the given Concepts (and their chunks) by id, ignoring ids
   * that no longer exist. Targeting a known prior set (rather than everything
   * under a Source) lets a crawl finalizer persist the full new set of Concepts
   * first and only then retire the previous one — an atomic create-then-delete
   * replacement that never destroys last-good knowledge on a mid-ingest failure.
   * An empty list is a no-op.
   */
  deleteConceptsByIds(ids: string[]): Promise<void>;
  listConcepts(collectionId: string): Promise<Concept[]>;
  getConcept(id: string): Promise<Concept | null>;
  /**
   * Exact FAQ lookup for the widget's FAQ quick replies: the non-excluded
   * FAQ Concept (frontmatter.type = "FAQ") across the assistant's collections
   * whose question (frontmatter.title) matches case-insensitively.
   */
  findFaqConcept(
    assistantId: string,
    question: string
  ): Promise<{ concept: Concept; collectionName: string } | null>;
  /**
   * Concepts that have at least one chunk without an embedding — content
   * ingested while no embedding provider was available (or during a provider
   * outage), reachable only lexically. Feeds the re-embed backfill (#312).
   */
  listNullEmbeddingConceptIds(assistantId: string): Promise<string[]>;
  createConcept(input: {
    collectionId: string;
    sourceId: string | null;
    path: string;
    frontmatter: ConceptFrontmatter;
    body: string;
  }): Promise<Concept>;
  updateConcept(
    id: string,
    patch: { frontmatter?: ConceptFrontmatter; body?: string }
  ): Promise<Concept>;
  deleteConcept(id: string): Promise<void>;
  deleteChunksByConcept(conceptId: string): Promise<void>;
  setConceptExcluded(id: string, excluded: boolean): Promise<void>;
  /** Per-page re-crawl override; null clears it back to inheriting the site. */
  setConceptRecrawlSchedule(
    id: string,
    schedule: RecrawlSchedule | null
  ): Promise<void>;
  saveChunks(
    chunks: Array<{
      conceptId: string;
      collectionId: string;
      assistantId: string;
      content: string;
      embedding: number[] | null;
    }>
  ): Promise<void>;
  searchChunks(
    assistantId: string,
    collectionId: string | null,
    query: { embedding: number[] | null; text: string; limit?: number }
  ): Promise<KnowledgeSearchResult[]>;

  // Publications
  createPublication(
    assistantId: string,
    config: PublicationConfig
  ): Promise<Publication>;
  listPublications(assistantId: string): Promise<Publication[]>;
  /** Unpublish: remove every Publication so the widget goes offline until the next publish. */
  deletePublications(assistantId: string): Promise<void>;
  getLatestPublication(assistantId: string): Promise<Publication | null>;
  getPublication(id: string): Promise<Publication | null>;

  // Conversations & messages
  createConversation(input: {
    assistantId: string;
    subjectType: ConversationSubject;
    subjectId: string;
    collectionId?: string | null;
    title?: string;
    metadata?: ConversationMetadata;
  }): Promise<Conversation>;
  listConversations(
    assistantId: string,
    subjectType: ConversationSubject,
    subjectId: string
  ): Promise<Conversation[]>;
  /** All conversations across the organization's assistants (Inbox). */
  listInboxConversations(organizationId: string): Promise<InboxConversation[]>;
  getConversation(id: string): Promise<Conversation | null>;
  /** The Conversation a message belongs to (for resolving a message's graph
   * Retrieval Trace + Collection); null if the message is unknown. */
  getConversationForMessage(messageId: string): Promise<Conversation | null>;
  setConversationPinned(id: string, pinned: boolean): Promise<void>;
  /** Shallow-merges the patch into the conversation's metadata. */
  updateConversationMetadata(
    id: string,
    patch: ConversationMetadata
  ): Promise<void>;
  /** Replaces the conversation's persistent session state (runtime-only). */
  updateConversationSessionState(
    id: string,
    state: Record<string, unknown>
  ): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  listMessages(conversationId: string): Promise<StoredMessage[]>;
  /** Recent conversation messages, returned oldest-first for model history. */
  listRecentMessages(
    conversationId: string,
    limit: number
  ): Promise<StoredMessage[]>;
  appendMessage(input: {
    conversationId: string;
    role: "user" | "assistant";
    content: unknown[];
    flowId?: string | null;
    flowName?: string | null;
    /**
     * The turn's Thinking Steps, already capped and redacted by the runtime.
     * Absent (or null) for user messages and for turns that did no agentic
     * work — the Inbox renders no panel for those.
     */
    trace?: StoredTurnTrace | null;
  }): Promise<StoredMessage>;
  setMessageFeedback(messageId: string, feedback: -1 | 0 | 1): Promise<void>;
  /**
   * Organizations that opted into a trace-retention window (#573), for the
   * cron sweep. Orgs with the keep-forever default are not returned.
   */
  listTraceRetentionPolicies(): Promise<
    Array<{ organizationId: string; retentionDays: number }>
  >;
  /**
   * Strips the stored Turn Trace from this organization's messages older than
   * the cutoff; content, feedback and timestamps stay. Idempotent — a cleared
   * trace never matches again. Returns how many messages were swept.
   */
  clearExpiredTraces(organizationId: string, cutoffIso: string): Promise<number>;

  // Insights (org-wide analytics)
  /** All messages across the organization's assistants, trimmed for metrics. */
  listInsightsMessages(organizationId: string): Promise<InsightsMessage[]>;
  /** Crawled website sources across the organization. */
  listWebsiteSources(organizationId: string): Promise<OrgWebsiteSource[]>;
  /**
   * Bounded Insights Overview (KPI cards + time series + breakdowns),
   * aggregated org-side by an RLS-safe SQL function in production and computed
   * in memory by the demo adapter — never returns raw Conversations/Messages.
   */
  getInsightsOverview(
    organizationId: string,
    filters: InsightsFilter
  ): Promise<InsightsOverview>;

  // Improvements (AI-answer-quality tracker)
  listImprovements(organizationId: string): Promise<ImprovementListItem[]>;
  getImprovement(id: string): Promise<Improvement | null>;
  createImprovement(
    organizationId: string,
    input: { title: string; createdBy?: string | null; messageId?: string | null }
  ): Promise<Improvement>;
  updateImprovement(id: string, patch: ImprovementPatch): Promise<Improvement>;
  deleteImprovement(id: string): Promise<void>;
  /** The Suggested Fix drafted for an improvement, or null. */
  getImprovementProposal(improvementId: string): Promise<ImprovementProposal | null>;
  /** Creates (or replaces) the draft Suggested Fix for an improvement. */
  createImprovementProposal(input: {
    improvementId: string;
    organizationId: string;
    payload: ImprovementProposalPayload;
  }): Promise<ImprovementProposal>;
  /** Advances a Suggested Fix (accept records the created Concept; dismiss the reason). */
  updateImprovementProposal(
    id: string,
    patch: {
      status?: ImprovementProposalStatus;
      dismissReason?: string;
      acceptedConceptId?: string | null;
    }
  ): Promise<ImprovementProposal>;
  /** Flagged answers (+ conversation context) attached to an improvement. */
  listImprovementMessages(improvementId: string): Promise<ImprovementAssociation[]>;
  linkImprovementMessage(improvementId: string, messageId: string): Promise<void>;
  unlinkImprovementMessage(improvementId: string, messageId: string): Promise<void>;
  /** Improvement links for a conversation's messages (Inbox chips). */
  listConversationImprovementLinks(
    conversationId: string
  ): Promise<ImprovementMessageLink[]>;

  // Alerts (operational health)
  listAlerts(organizationId: string): Promise<Alert[]>;
  /** Newest active alerts, capped — the shell's bottom-right notification stack. */
  listActiveAlerts(organizationId: string, limit?: number): Promise<Alert[]>;
  /** Active-alert count for the sidebar badge. */
  countActiveAlerts(organizationId: string): Promise<number>;
  /** Raise an alert; refreshes the active alert with the same sourceKey instead of duplicating. */
  raiseAlert(
    organizationId: string,
    input: {
      type: AlertType;
      title: string;
      detail: string;
      sourceKey?: string | null;
    }
  ): Promise<Alert>;
  resolveAlert(id: string, resolvedBy?: string | null): Promise<Alert>;
  /** Auto-resolve active alerts with this sourceKey (underlying issue cleared). */
  resolveAlertsByKey(organizationId: string, sourceKey: string): Promise<void>;

  // AI usage ledger (cost accounting)
  /** Append usage rows for a turn; called post-commit, failures are isolated by the caller. */
  recordAiUsage(rows: AiUsageInput[]): Promise<void>;
  /** Append a runtime telemetry event (ADR-0011); post-commit, failures isolated by the caller. */
  recordRuntimeEvent(event: RuntimeEventInput): Promise<void>;
  /** Input+output tokens the organization consumed today (UTC) — the budget pre-turn check. */
  getOrgTokensUsedToday(organizationId: string): Promise<number>;
  /** Estimated EUR cost (see pricing.ts) of today's (UTC) usage — the euro budget pre-turn check. */
  getOrgCostUsedToday(organizationId: string): Promise<number>;
  /**
   * Recomputes the last `days` UTC days (today included) of the usage_daily
   * rollup from the raw ledger. Cross-org — the rollup-usage cron's write
   * path (service role). Idempotent; returns rows upserted.
   */
  rollupUsageDaily(days?: number): Promise<number>;
  /**
   * The org's daily usage for the last `days` UTC days, split by call kind
   * (chat vs embedding) and credential kind: closed days from the rollup,
   * today aggregated live from the raw ledger. Newest day first.
   */
  getOrgUsageDaily(organizationId: string, days?: number): Promise<UsageDailyRow[]>;
  /**
   * Usage over an arbitrary `[from, to)` window (ISO instants), grouped per
   * resource/credential/provider/model so the caller can price it in credits.
   * Closed days come from the rollup, the partial ends live from the raw
   * sources; the ranges are disjoint, so nothing is counted twice.
   */
  getOrgUsageMeters(
    organizationId: string,
    from: string,
    to: string
  ): Promise<UsageMeterRow[]>;
  /** Cross-org: every Knowledge Collection whose assistant uses the graph
   * engine — the datasets the nightly graph-learning cron sweeps. Service-role
   * (spans orgs), like the other cron-claim reads. */
  listActiveGraphDatasets(): Promise<
    Array<{ organizationId: string; collectionId: string }>
  >;
  /** The org's daily budget, or null when none is configured. */
  getOrgBudget(organizationId: string): Promise<OrgBudget | null>;
  /** Create or update the org's budget (admins only via RLS). */
  setOrgBudget(
    organizationId: string,
    input: {
      dailyTokenLimit: number | null;
      dailyEuroLimit: number | null;
      enforcement: BudgetEnforcement;
    }
  ): Promise<OrgBudget>;

  // Standing goals (scheduled golden-question checks)
  listAssistantGoals(assistantId: string): Promise<AssistantGoal[]>;
  /** Throws when the assistant already has ASSISTANT_GOAL_CAP goals. */
  createAssistantGoal(
    assistantId: string,
    input: { question: string; expectations: GoalExpectations }
  ): Promise<AssistantGoal>;
  updateAssistantGoal(
    id: string,
    patch: Partial<{
      question: string;
      expectations: GoalExpectations;
      status: GoalStatus;
    }>
  ): Promise<AssistantGoal>;
  deleteAssistantGoal(id: string): Promise<void>;
  /**
   * Atomically claims due, active goals (cross-org, service role): stamps
   * last_run_at as the lease so concurrent ticks never double-run a goal.
   * Returned rows still carry the previous last_result/last_detail.
   */
  claimDueAssistantGoals(input: {
    dueBefore: string;
    limit: number;
  }): Promise<AssistantGoal[]>;
  /** Appends a run to the goal ledger (capped retention) and updates the goal's last result. */
  recordAssistantGoalRun(
    goalId: string,
    input: { pass: boolean; detail: string; durationMs: number }
  ): Promise<void>;

  // Answer verification (independent verifier)
  /**
   * Newest generative answers without a verdict (cross-org, service role).
   * Verbatim/fallback/refusal-only messages are never returned.
   */
  listUnverifiedAnswers(input: { limit: number }): Promise<VerifiableAnswer[]>;
  /**
   * Atomically claims unverified generative answers before grading (cross-org,
   * service role): stamps a per-message claim so concurrent ticks never
   * double-grade. A claim older than `staleBefore` is re-claimable, so a
   * crashed run retries on the next tick. The one-verdict-per-message
   * constraint stays the final backstop.
   */
  claimUnverifiedAnswers(input: {
    limit: number;
    staleBefore: string;
  }): Promise<VerifiableAnswer[]>;
  /**
   * Releases a verifier claim without recording a verdict, so the next tick
   * can re-grade immediately (the tick chose not to, or could not, grade it).
   * Only an abrupt crash leaves a claim to expire on its own.
   */
  releaseAnswerVerifierClaim(messageId: string): Promise<void>;
  /** Records the verdict; returns false when the message was already verified (idempotence). */
  recordAnswerVerdict(input: AnswerVerdictInput): Promise<boolean>;
  /** Verdicts for a conversation's messages (Inbox transcript badges). */
  listConversationAnswerVerdicts(
    conversationId: string
  ): Promise<AnswerVerdict[]>;

  // Flow trust ledger (earned autonomy tiers)
  /** Graded signals newest-first (cross-org, service role): verdicts + unverdicted explicit feedback. */
  listTrustSignals(input: { limit: number }): Promise<TrustSignal[]>;
  /** Upserts one materialized row; returns the tier it replaced (null on first materialization). */
  upsertFlowTrust(
    input: Omit<FlowTrust, "previousTier" | "computedAt">
  ): Promise<{ previousTier: TrustTier | null }>;
  listFlowTrust(assistantId: string): Promise<FlowTrust[]>;
  getFlowTrust(assistantId: string, flowId: string): Promise<FlowTrust | null>;
  /**
   * Appends a tier-transition event to the demotion-history ledger (service
   * role), applying capped retention. Called once per genuine transition
   * during nightly materialization.
   */
  recordFlowTrustEvent(input: {
    organizationId: string;
    assistantId: string;
    flowId: string;
    fromTier: TrustTier | null;
    toTier: TrustTier;
    runs: number;
    passes: number;
  }): Promise<void>;
  /** Tier-transition history for one Flow, newest first. */
  listFlowTrustEvents(
    assistantId: string,
    flowId: string
  ): Promise<FlowTrustEvent[]>;

  // Compost loop (weekly exhaust → proposed Improvements)
  /** Published assistants in opted-in orgs whose last compost run predates dueBefore. */
  listDueCompostAssistants(input: {
    dueBefore: string;
    limit: number;
  }): Promise<DueCompostAssistant[]>;
  /**
   * Atomically claims due assistants for a compost pass (cross-org, service
   * role): stamps a per-assistant claim at window start so a second tick in the
   * same window sees the assistant as not-due before any digest or model call.
   * A claim older than `staleBefore` is re-claimable, so a crashed run retries
   * next window.
   */
  claimDueCompostAssistants(input: {
    dueBefore: string;
    staleBefore: string;
    limit: number;
  }): Promise<DueCompostAssistant[]>;
  /** The assistant's exhaust since `since` — every input optional by construction. */
  getCompostDigest(assistantId: string, since: string): Promise<CompostDigest>;
  /** Records the run (idempotence marker + clean-week evidence). */
  recordCompostRun(input: {
    assistantId: string;
    organizationId: string;
    windowStart: string;
    windowEnd: string;
    proposals: number;
    clean: boolean;
  }): Promise<void>;
  /** Per-org compost opt-out (default opted in). */
  setCompostOptOut(organizationId: string, optOut: boolean): Promise<void>;
  /** Whether the org has opted out of the compost loop (default false). */
  getCompostOptOut(organizationId: string): Promise<boolean>;
  /** Whether Members may use their own local AI subscription in Preview. */
  setPersonalAiSubscriptionsAllowed(organizationId: string, allowed: boolean): Promise<void>;
  /** Personal local AI subscriptions are disabled by default per Organization. */
  getPersonalAiSubscriptionsAllowed(organizationId: string): Promise<boolean>;

  // Local-connector relay (server-only; requires a service-role Db — the
  // relay tables carry no RLS policies, so RLS-scoped clients see nothing).
  /**
   * Atomically consumes the unused, unexpired pairing matching the hashed
   * code + origin (a one-time compare-and-set on `usedAt`). Returns the
   * consumed pairing, or null when no such pairing exists / it was already
   * used / it expired — the three cases are indistinguishable by design.
   */
  consumeLocalConnectorPairing(input: {
    codeHash: string;
    origin: string;
    now: string;
  }): Promise<LocalConnectorPairing | null>;
  /**
   * Non-revoked devices of this member paired to this origin and seen since
   * `seenAfter`, newest-seen first. Devices that never reported a heartbeat
   * (`lastSeenAt` null) are excluded.
   */
  listFreshLocalConnectorDevices(input: {
    organizationId: string;
    userId: string;
    origin: string;
    seenAfter: string;
    limit?: number;
  }): Promise<LocalConnectorDevice[]>;
  /**
   * Deletes the device's expired jobs (a server request may disappear after
   * the connector claimed its job — expired work must not linger), then
   * atomically claims its oldest pending unexpired job (pending → claimed).
   * Returns the claimed job, or null when there is no work or a concurrent
   * claim won.
   */
  claimNextLocalInferenceJob(input: {
    deviceId: string;
    now: string;
  }): Promise<LocalInferenceJob | null>;
  /**
   * Records the connector's outcome for a job it claimed: claimed → failed
   * when `error` is set, claimed → completed otherwise. The update is scoped
   * to the owning device and the claimed status, so a stale or foreign
   * completion is a no-op; returns whether a row transitioned.
   */
  completeLocalInferenceJob(input: {
    jobId: string;
    deviceId: string;
    result?: Record<string, unknown> | null;
    error?: string | null;
    now: string;
  }): Promise<boolean>;

  // Platform settings (single-row, service-role only — org members can
  // neither read nor write; see docs/agentic-chat-runtime.md)
  /** The stored platform-wide system-prompt override ("" = use the shipped default). */
  getPlatformSystemPromptOverride(): Promise<string>;
  /** Persists the platform prompt override, stamping the editing owner. */
  setPlatformSystemPrompt(prompt: string, updatedBy: string): Promise<void>;

  // Skills (reusable org-level prompt templates)
  listSkills(organizationId: string): Promise<Skill[]>;
  createSkill(organizationId: string, input: SkillInput): Promise<Skill>;
  updateSkill(id: string, patch: SkillPatch): Promise<Skill>;
  deleteSkill(id: string): Promise<void>;
  /** Skills attached to an assistant, in attachment order. */
  listAssistantSkills(assistantId: string): Promise<Skill[]>;
  /** Replaces the assistant's attached-skill set (ordered). */
  setAssistantSkills(assistantId: string, skillIds: string[]): Promise<void>;

  // Generic table access (ADR-0016) — the seam the plain CRUD passthroughs
  // above migrate onto. Only tables in DbTableMap are reachable; behavioural
  // methods (leases, counters, dedup, sealed credentials) stay first-class.
  table<K extends DbTableName>(name: K): DbTableAccessor<K>;
}
