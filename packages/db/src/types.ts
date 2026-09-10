/**
 * The `Db` interface, the data-access seam (ADR-0002), and nothing else.
 *
 * Every noun this interface traffics in is a domain type from `@agent-hub/core`;
 * this file declares only the *operations*. Two adapters implement it in
 * lockstep, `supabase.ts` (RLS-scoped) and `mock.ts` (in-memory), and
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
  ApplicationConnection,
  ApplicationConnectionStatus,
  ApplicationImport,
  ApplicationImportCadence,
  ApplicationImportStatus,
  ApplicationProvider,
  ApplicationSource,
  ApplicationSyncRun,
  Assistant,
  AssistantGoal,
  AssistantInput,
  AssistantPatch,
  AssistantShellSummary,
  AssistantSourceLink,
  BackgroundJob,
  BackgroundJobKind,
  BudgetEnforcement,
  ChannelAuthorType,
  ChannelMessage,
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
  Entity,
  EntityRecord,
  EntityRecordQuery,
  EntityRecordValue,
  EntitySyncConfig,
  EntitySyncConfigInput,
  EntitySyncRun,
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
  HelpDesk,
  Improvement,
  ImprovementAssociation,
  ImprovementAssociationPage,
  ImprovementListItem,
  ImprovementMessageLink,
  ImprovementPatch,
  ImprovementProposal,
  ImprovementProposalPayload,
  ImprovementProposalStatus,
  ImprovementStatus,
  InboxConversationReview,
  InboxFacets,
  InboxPage,
  InboxQuery,
  InsightsFilter,
  InsightsOverview,
  Invite,
  KnowledgeCollection,
  KnowledgeSearchResult,
  LocalConnectorDevice,
  LocalConnectorPairing,
  LocalInferenceJob,
  Member,
  Memory,
  MemoryDocument,
  MemoryDocumentEntry,
  MemoryDocumentOwner,
  MemorySearchResult,
  MemorySubjectRef,
  MemorySubjectSummary,
  ObjectAccessEvent,
  ObjectAccessEventInput,
  OrgApiKey,
  OrgApiKeyInput,
  OrgBudget,
  OrgFaqEntry,
  OrgKnowledgeSourceFilter,
  OrgKnowledgeSourcePage,
  OrgKnowledgeSourceOptions,
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
  RetentionSweepEvent,
  RetentionSweepEventInput,
  ReviewRequest,
  WebhookSubscription,
  Role,
  RoutineRunStatus,
  RuntimeEventInput,
  ServiceNowConfig,
  Skill,
  Source,
  SourceConfig,
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
  TeammateRoutine,
  TicketingPlatform,
  TrustSignal,
  TrustTier,
  UsageDailyRow,
  UsageMeterRow,
  VerifiableAnswer,
} from "@agent-hub/core";
import type { DbTableAccessor, DbTableName } from "./table-access";

export interface Db {
  // Organizations & membership
  /**
   * Resolves the caller's active Organization. When `preferredOrgId` is
   * given, tries that org first (falls back to the caller's first
   * membership if it isn't visible to them), used to let a platform
   * superuser browse an org they aren't a member of. Callers with a real
   * `organization_members` row get their actual per-org Role; a superuser
   * browsing an org with no membership row gets a synthetic 'owner' Role
   * (full access, not a real membership).
   */
  getCurrentOrg(
    preferredOrgId?: string,
    authenticatedUserId?: string
  ): Promise<CurrentOrg | null>;
  /**
   * Every Organization visible to the caller under RLS, for a regular
   * Member this is just their own org(s); for a platform superuser this is
   * every Organization in the database. Powers the org switcher.
   */
  listOrganizations(): Promise<Organization[]>;
  createOrganization(name: string): Promise<string>;
  acceptInvite(token: string): Promise<string>;
  listMembers(organizationId: string): Promise<Member[]>;
  /**
   * One member's current Role, or null when they are not a member. The
   * narrow read the /api/v1 auth seam runs per request (#801, CYB-04):
   * fetching the whole roster to check one creator made every keyed request
   * pay a query that scales with org size.
   */
  getMemberRole(organizationId: string, userId: string): Promise<Role | null>;
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
  /** Org name + logo, admin+ only (enforced by RLS and requireMember). */
  updateOrganization(
    organizationId: string,
    patch: OrganizationPatch
  ): Promise<Organization>;

  // Organization API keys (#618): programmatic access credentials.
  // Admin+ only (enforced by RLS and requireMember); the secret itself never
  // passes through this seam, only its hash and displayable hint.
  listApiKeys(organizationId: string): Promise<OrgApiKey[]>;
  createApiKey(
    organizationId: string,
    input: OrgApiKeyInput
  ): Promise<OrgApiKey>;
  /** Marks the key revoked (row kept for audit). Idempotent. */
  revokeApiKey(keyId: string): Promise<void>;
  /**
   * Auth-time lookup for /api/v1: the presented secret is hashed and looked
   * up verbatim. Returns revoked keys too, the auth seam is what turns
   * `revokedAt` into a 401, so the decision stays in one place.
   */
  getApiKeyByHash(secretHash: string): Promise<OrgApiKey | null>;
  /** Stamps `lastUsedAt` = now. Best-effort; never blocks a request. */
  touchApiKeyLastUsed(keyId: string): Promise<void>;

  // Profile (the signed-in caller's own, Settings > Profile)
  getProfile(authenticatedUserId?: string): Promise<Profile | null>;
  updateProfile(patch: ProfilePatch): Promise<Profile>;

  // Assistants
  listAssistants(organizationId: string): Promise<Assistant[]>;
  listAssistantsPage(
    organizationId: string,
    input: { limit: number; cursor?: string | null }
  ): Promise<{ items: Assistant[]; nextCursor: string | null }>;
  listAssistantShellSummaries(
    organizationId: string
  ): Promise<AssistantShellSummary[]>;
  getAssistant(id: string): Promise<Assistant | null>;
  createAssistant(
    organizationId: string,
    input: AssistantInput
  ): Promise<Assistant>;
  updateAssistant(id: string, patch: AssistantPatch): Promise<Assistant>;
  deleteAssistant(id: string): Promise<void>;

  // Flows
  listFlows(assistantId: string): Promise<Flow[]>;
  getFlow(id: string): Promise<Flow | null>;
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
  /**
   * Derived membership (PRD #726): the Collections holding Sources linked to
   * the Assistant. A Collection with no linked Source is not listed.
   */
  listCollections(assistantId: string): Promise<KnowledgeCollection[]>;
  /**
   * Every Collection the Organization owns, oldest first. Unlike
   * `listCollections`, membership is not derived from an Assistant's links:
   * this is the Library as a whole, which is what a picker choosing a
   * Teammate's Knowledge Scope has to offer (#768).
   */
  listOrgCollections(organizationId: string): Promise<KnowledgeCollection[]>;
  /**
   * The per-org "Knowledge Library" default collection hub-created items land
   * in (PRD #726), deterministic per organization, created on first use (the
   * backfill migration seeds it for orgs that existed then).
   */
  getOrCreateOrgLibraryCollection(
    organizationId: string
  ): Promise<KnowledgeCollection>;
  getCollection(id: string): Promise<KnowledgeCollection | null>;
  /**
   * Creates an org-owned Collection in the Assistant's Organization (the
   * assistant is the org anchor only; Collections have no owning assistant).
   */
  createCollection(
    assistantId: string,
    input: { name: string; description?: string }
  ): Promise<KnowledgeCollection>;
  deleteCollection(id: string): Promise<void>;
  listSources(collectionId: string): Promise<Source[]>;
  /**
   * When the Collection has a legacy owning assistant, the new Source is
   * auto-linked to it (direct access off), so assistant-editor add flows keep
   * answering without an explicit linking step (PRD #726). Org-owned
   * Collections ("" assistant) create the Source unlinked, the hub's add
   * flows set links explicitly.
   */
  createSource(input: {
    /** Optional stable identity for idempotent external-source materialization. */
    id?: string;
    collectionId: string;
    name: string;
    kind: SourceKind;
    config?: SourceConfig;
    recrawlSchedule?: RecrawlSchedule;
    originalObjectPath?: string | null;
  }): Promise<Source>;
  updateSource(
    id: string,
    patch: {
      name?: string;
      status?: SourceStatus;
      error?: string;
      config?: SourceConfig;
      recrawlSchedule?: RecrawlSchedule;
      lastCrawledAt?: string | null;
      originalObjectPath?: string | null;
    }
  ): Promise<void>;
  getSource(id: string): Promise<Source | null>;

  // Application knowledge connectors
  createApplicationOAuthNonce(input: {
    nonce: string;
    organizationId: string;
    memberId: string;
    expiresAt: string;
  }): Promise<void>;
  /** Atomically consumes a nonce; false means missing, expired, mismatched, or replayed. */
  consumeApplicationOAuthNonce(input: {
    nonce: string;
    organizationId: string;
    memberId: string;
    consumedAt: string;
  }): Promise<boolean>;
  listApplicationConnections(
    organizationId: string
  ): Promise<ApplicationConnection[]>;
  getSafeApplicationConnection(id: string): Promise<ApplicationConnection | null>;
  getApplicationConnection(id: string): Promise<ApplicationConnection | null>;
  createApplicationConnection(input: {
    organizationId: string;
    /** Required only for Member-owned providers; omitted for Organization-owned providers. */
    ownerMemberId?: string | null;
    provider: ApplicationProvider;
    name: string;
    sealedCredentials: string;
    scopes?: string[];
    providerAccountId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<ApplicationConnection>;
  updateApplicationConnection(
    id: string,
    patch: {
      ownerType?: ApplicationConnection["ownerType"];
      ownerMemberId?: string | null;
      name?: string;
      status?: ApplicationConnectionStatus;
      sealedCredentials?: string;
      scopes?: string[];
      providerAccountId?: string | null;
      metadata?: Record<string, unknown>;
      error?: string;
      lastConnectedAt?: string | null;
    }
  ): Promise<void>;
  deleteApplicationConnection(id: string): Promise<void>;
  listApplicationImports(organizationId: string): Promise<ApplicationImport[]>;
  getApplicationImport(id: string): Promise<ApplicationImport | null>;
  /** Atomically locks an enabled Import and transitions it to syncing. */
  acquireApplicationImportSync(
    id: string,
    organizationId: string
  ): Promise<ApplicationImport | null>;
  createApplicationImport(input: {
    organizationId: string;
    connectionId: string;
    collectionId: string;
    name: string;
    config?: Record<string, unknown>;
    cadence?: ApplicationImportCadence;
    enabled?: boolean;
    assistantIds?: string[];
  }): Promise<ApplicationImport>;
  updateApplicationImport(
    id: string,
    patch: {
      name?: string;
      config?: Record<string, unknown>;
      cadence?: ApplicationImportCadence;
      enabled?: boolean;
      status?: ApplicationImportStatus;
      checkpoint?: Record<string, unknown>;
      error?: string;
      lastSyncedAt?: string | null;
      nextSyncAt?: string | null;
      assistantIds?: string[];
      /** Atomically tombstones materialized Sources before a provider scope change. */
      resetSources?: boolean;
    }
  ): Promise<void>;
  deleteApplicationImport(id: string): Promise<void>;
  listDueApplicationImports(now: string, limit: number): Promise<ApplicationImport[]>;
  listApplicationSources(importId: string): Promise<ApplicationSource[]>;
  upsertApplicationSource(input: {
    importId: string;
    sourceId: string;
    remoteId: string;
    canonicalUrl?: string | null;
    revision?: string | null;
    contentHash: string;
    contentBytes?: number;
    remoteMimeType?: string | null;
    remoteUpdatedAt?: string | null;
    lastSeenAt: string;
  }): Promise<ApplicationSource>;
  /** Atomically reserves this Import's projected share of the Organization byte limit. */
  reserveApplicationKnowledgeBytes(input: {
    importId: string;
    organizationId: string;
    projectedBytes: number;
    limitBytes: number;
  }): Promise<boolean>;
  /** Links one materialized Source from the Import's current scope atomically. */
  syncApplicationSourceAssistantScope(importId: string, sourceId: string): Promise<void>;
  markApplicationSourceRemoved(
    importId: string,
    remoteId: string,
    removedAt: string
  ): Promise<void>;
  recordApplicationSyncRun(
    importId: string,
    input: Omit<ApplicationSyncRun, "id" | "importId">
  ): Promise<ApplicationSyncRun>;
  listApplicationSyncRuns(importId: string): Promise<ApplicationSyncRun[]>;
  listApplicationOperationalState(organizationId: string): Promise<Array<{
    importId: string;
    lastRun: ApplicationSyncRun | null;
    sourceCount: number;
  }>>;
  getApplicationHealthSummary(organizationId: string): Promise<{
    connected: number;
    pending: number;
    attention: number;
    syncing: number;
    ready: number;
  }>;

  createBackgroundJob(input: {
    /** Stable caller key; duplicate creates return the existing ledger row. */
    id?: string;
    organizationId?: string;
    kind: BackgroundJobKind;
    sourceId?: string | null;
    payload: Record<string, unknown>;
    maxAttempts?: number;
    nextRunAt?: string;
  }): Promise<BackgroundJob>;
  /** Atomically de-duplicates active jobs for one Application Import. */
  createApplicationSyncJobIfAbsent(input: {
    importId: string;
    organizationId: string;
    nextRunAt: string;
    maxConcurrent?: number;
  }): Promise<boolean>;
  /** Fails queued jobs for an Import; running work is fenced by its enabled check. */
  cancelApplicationSyncJobs(importId: string, reason: string): Promise<void>;
  stageSourceIngestJob(input: {
    assistantId: string;
    collectionId: string;
    sourceId: string;
    rawText: string;
  }): Promise<number>;
  /** Converts a claimed pre-versioning job in place; null means its lease was lost. */
  upgradeLegacySourceIngestJob(input: {
    jobId: string;
    leaseToken: string;
    assistantId: string;
    collectionId: string;
    sourceId: string;
    rawText: string;
    now: string;
  }): Promise<number | null | "schema_lag">;
  getSourceIngestPayload(
    sourceId: string,
    version?: number
  ): Promise<{
    version: number;
    rawText: string;
    drafts: Array<{ path: string; frontmatter: ConceptFrontmatter; body: string }> | null;
  } | null>;
  /** Freezes one ingest attempt only while this job lease is current. */
  initializeSourceIngestAttempt(input: {
    jobId: string;
    leaseToken: string;
    sourceId: string;
    version: number;
    drafts: Array<{ path: string; frontmatter: ConceptFrontmatter; body: string }>;
  }): Promise<{
    drafts: Array<{ path: string; frontmatter: ConceptFrontmatter; body: string }>;
    generationId: string;
    expectedActiveGenerationId: string;
    cursor: number;
  } | null>;
  /** Advances a frozen ingest attempt only while this job lease is current. */
  checkpointSourceIngestCursor(input: {
    jobId: string;
    leaseToken: string;
    sourceId: string;
    version: number;
    generationId: string;
    cursor: number;
  }): Promise<boolean>;
  /** Commits a frozen generation only while the exact ingest lease still owns it. */
  commitSourceIngestGeneration(input: {
    jobId: string;
    leaseToken: string;
    sourceId: string;
    version: number;
    expectedActiveGenerationId: string;
    generationId: string;
  }): Promise<boolean>;
  listBackgroundJobsForSource(
    sourceId: string,
    kind?: BackgroundJobKind
  ): Promise<BackgroundJob[]>;
  /** Claims runnable work through the rollout-stable legacy claim contract. */
  claimBackgroundJobs(input: {
    kind: BackgroundJobKind;
    workerId: string;
    now: string;
    staleBefore: string;
    limit: number;
  }): Promise<BackgroundJob[]>;
  /** Leases stale final-attempt jobs so terminal cleanup can be retried durably. */
  claimTerminalBackgroundJobs(input: {
    kind: BackgroundJobKind;
    workerId: string;
    now: string;
    staleBefore: string;
    limit: number;
  }): Promise<BackgroundJob[]>;
  /** Extends one job lease only while the same claim generation still owns it. */
  renewBackgroundJobLease(input: {
    id: string;
    leaseToken: string;
    now: string;
  }): Promise<boolean>;
  /**
   * Settles one claimed job only while its lease generation is still current.
   * False means another worker reclaimed the job; the stale result is ignored.
   */
  settleBackgroundJob(input: {
    id: string;
    leaseToken: string;
    now: string;
    outcome:
      | { status: "succeeded" }
      | { status: "failed"; error: string }
      | { status: "queued"; error: string; nextRunAt: string };
  }): Promise<boolean>;
  /** Atomically wins an Application Import lease and queues its continuation. */
  settleApplicationSyncJobSuccess(input: {
    id: string;
    leaseToken: string;
    importId: string;
    organizationId: string;
    now: string;
    maxConcurrent: number;
  }): Promise<boolean>;
  claimApiIdempotency(input: {
    scope: string;
    key: string;
    requestHash: string;
    now: string;
    staleBefore: string;
    expiresAt: string;
  }): Promise<
    | { status: "claimed"; leaseToken: string }
    | { status: "running" | "conflict" }
    | { status: "completed"; responseStatus: number; responseBody: string; contentType: string }
  >;
  completeApiIdempotency(input: {
    scope: string;
    key: string;
    leaseToken: string;
    responseStatus: number;
    responseBody: string;
    contentType: string;
    now: string;
  }): Promise<boolean>;
  releaseApiIdempotency(input: {
    scope: string;
    key: string;
    leaseToken: string;
  }): Promise<boolean>;
  getWorkQueueHealth(now: string): Promise<{
    backgroundJobs: Record<
      string,
      {
        due: number;
        running?: number;
        scheduled?: number;
        failed?: number;
        oldestDueAt: string | null;
      }
    >;
    turnEffects: {
      due: number;
      running?: number;
      scheduled?: number;
      failed?: number;
      oldestDueAt: string | null;
    };
    organizations?: Record<string, unknown>;
  }>;
  /** Bounded retention sweep for internal runtime ledgers. Service-role only. */
  sweepRuntimeLedgers(
    now: string,
    limit: number
  ): Promise<{
    backgroundJobs: number;
    conversationTurns: number;
    turnEffects: number;
    apiIdempotencyKeys: number;
    sourceGenerations: number;
  }>;

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
   * first and only then retire the previous one, an atomic create-then-delete
   * replacement that never destroys last-good knowledge on a mid-ingest failure.
   * An empty list is a no-op.
   */
  deleteConceptsByIds(ids: string[]): Promise<void>;
  /** Removes one uncommitted or retired generation without touching the active one. */
  deleteSourceKnowledgeGeneration(
    sourceId: string,
    generationId: string
  ): Promise<string[]>;
  /**
   * Atomically switches retrieval to a fully staged generation. A false result
   * means the expected active generation changed and this writer lost the CAS.
   */
  commitSourceKnowledgeGeneration(input: {
    sourceId: string;
    expectedActiveGenerationId: string;
    generationId: string;
  }): Promise<boolean>;
  listConcepts(collectionId: string): Promise<Concept[]>;
  /** Active, non-excluded FAQ titles reachable through Assistant Knowledge Links; no bodies. */
  listAssistantFaqOptions(assistantId: string): Promise<{ id: string; question: string }[]>;
  /** Stable id-cursor page of active Concepts for bounded inventory scans. */
  listConceptPage(
    collectionId: string,
    input: { afterId?: string; limit: number }
  ): Promise<Concept[]>;
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
   * Concepts that have at least one chunk without an embedding, content
   * ingested while no embedding provider was available (or during a provider
   * outage), reachable only lexically. Feeds the re-embed backfill (#312).
   */
  listNullEmbeddingConceptIds(assistantId: string): Promise<string[]>;
  createConcept(input: {
    collectionId: string;
    sourceId: string | null;
    /** Present only while staging a Source replacement; staged rows stay hidden. */
    generationId?: string;
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
      /**
       * The chunk's Source (PRD #726). Retrieval scopes chunks by the
       * assistant↔source link table alone (#733); a null-source chunk (a
       * Concept with no Source) is unreachable by design.
       */
      sourceId?: string | null;
      content: string;
      embedding: number[] | null;
      /**
       * Which model produced `embedding`, as `provider:model` (#801, CYB-14).
       * Null when the chunk carries no embedding, or for rows that predate
       * the column; retrieval treats null as the current space.
       */
      embeddingSpace?: string | null;
    }>
  ): Promise<void>;
  searchChunks(
    assistantId: string,
    collectionId: string | null,
    query: { embedding: number[] | null; text: string; limit?: number; embeddingSpace?: string | null }
  ): Promise<KnowledgeSearchResult[]>;

  /**
   * The Teammate half of retrieval (#768): the same hybrid search, scoped by a
   * set of Knowledge Collections in one Organization instead of by an
   * Assistant's linked Sources. An empty `collectionIds` returns nothing and
   * makes no query, the caller that wanted everything has to say which
   * Collections it means.
   */
  searchCollectionChunks(
    organizationId: string,
    collectionIds: string[],
    query: { embedding: number[] | null; text: string; limit?: number; embeddingSpace?: string | null }
  ): Promise<KnowledgeSearchResult[]>;

  /**
   * The other half of a Teammate's Knowledge Scope: individual Library Sources
   * (a website, a file, an FAQ) rather than whole Collections.
   *
   * Same contract as {@link searchCollectionChunks} in every respect that
   * matters, tenancy is decided by the database (a Source reaches its
   * Organization through its Collection, never through the caller's word for
   * it), an empty `sourceIds` returns nothing and makes no query, and the hits
   * carry the same Concept → Source citation shape (ADR-0002). The caller
   * unions the two; neither knows about the other.
   */
  searchSourceChunks(
    organizationId: string,
    sourceIds: string[],
    query: { embedding: number[] | null; text: string; limit?: number; embeddingSpace?: string | null }
  ): Promise<KnowledgeSearchResult[]>;

  // --- Org-level knowledge hub (PRD #726) -----------------------------------
  /**
   * One hub-table page of the Organization's Sources: per-kind tabs via
   * `filter.kinds`, plus search / status / linked-assistant filters and
   * 1-based pagination. Rows carry linked-assistant chips, Concept counts,
   * and (for FAQ Sources) an answer excerpt.
   */
  listOrgKnowledgeSources(
    organizationId: string,
    filter: OrgKnowledgeSourceFilter
  ): Promise<OrgKnowledgeSourcePage>;
  listOrgKnowledgeSourceOptions(
    organizationId: string,
    filter: { kinds: SourceKind[]; limit: number }
  ): Promise<OrgKnowledgeSourceOptions>;
  /**
   * The ids of the Sources linked to this Assistant, its retrieval corpus.
   * Post-contract (#733/#741) reach is the link set alone: a Collection is
   * org-owned and may hold Sources this Assistant never answers from, so an
   * assistant-scoped read narrows with this, never with a collectionId.
   */
  listAssistantSourceIds(assistantId: string): Promise<string[]>;
  /** The Assistants a Source is linked to (with per-assistant Direct access). */
  listSourceAssistantLinks(sourceId: string): Promise<AssistantSourceLink[]>;
  /**
   * Replaces the Source's full linked-assistant set. Links kept across the
   * call preserve their Direct access flag; new links start with it off.
   */
  setSourceAssistantLinks(
    sourceId: string,
    assistantIds: string[]
  ): Promise<void>;
  /** Flips Direct access on one existing (assistant, source) link. */
  setSourceDirectAccess(
    sourceId: string,
    assistantId: string,
    directAccess: boolean
  ): Promise<void>;
  /** Every FAQ with its full answer, newest first, the org-wide CSV export. */
  listOrgFaqs(organizationId: string): Promise<OrgFaqEntry[]>;
  /**
   * A Source's Concepts, path-ordered, the hub's "View knowledge source"
   * pages list. Bounded (default 500) so one 10k-page site can't flood the
   * modal payload.
   */
  listConceptsBySource(sourceId: string, limit?: number): Promise<Concept[]>;

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
  /**
   * Exactly one owner: `assistantId` for widget/Preview traffic, `teammateId`
   * for a Teammate chat (#768). Passing both, or neither, is a caller bug the
   * database refuses through its check constraint.
   */
  createConversation(input: {
    /** Stable id used by the first turn so request retries reuse its thread. */
    id?: string;
    assistantId?: string | null;
    teammateId?: string | null;
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
  /**
   * One Member's thread history with one Teammate, newest first. Separate from
   * `listConversations` because the owner is a different column, not because
   * the read differs: a Teammate only ever talks to Members, so the subject
   * type is implied.
   */
  listTeammateConversations(
    teammateId: string,
    subjectId: string
  ): Promise<Conversation[]>;
  /**
   * Append one message to a Teammate channel's transcript (#778).
   *
   * A behavioural method rather than a `table()` entry for one reason: the
   * transcript has an order, and two messages written in the same millisecond
   * (a reply and the chain-cap marker behind it) must read back in the order
   * they were written. Both implementations therefore guarantee a strictly
   * increasing `createdAt` per channel, which is what makes the generic
   * accessor's single-key sort insufficient here.
   */
  appendChannelMessage(input: {
    organizationId: string;
    channelId: string;
    authorType: ChannelAuthorType;
    authorUserId?: string | null;
    authorTeammateId?: string | null;
    content: unknown[];
    /** Everybody the message addressed: Members and Teammates alike. */
    mentions?: string[];
    /** The human message this belongs to; null on that message itself. */
    chainId?: string | null;
    trace?: StoredTurnTrace | null;
  }): Promise<ChannelMessage>;
  /**
   * The channel's most recent messages, oldest-first, capped (default 100).
   * Oldest-first because the caller renders a transcript, not a feed.
   */
  listChannelMessages(
    channelId: string,
    limit?: number
  ): Promise<ChannelMessage[]>;
  /** One bounded tail per Channel in a single adapter read. */
  listChannelMessageWindows(
    channelIds: string[],
    limitPerChannel?: number
  ): Promise<ChannelMessage[]>;
  /**
   * Every message one human message set off, oldest-first.
   *
   * Separate from the transcript read because the caps are counted from it: a
   * chain has to be accounted exactly, and slicing it out of "the last N
   * messages" would silently under-count on a busy channel.
   */
  listChannelChainMessages(
    channelId: string,
    chainId: string
  ): Promise<ChannelMessage[]>;
  /** One server-filtered, cursor-bounded Inbox window. */
  getInboxPage(organizationId: string, query: InboxQuery): Promise<InboxPage>;
  /** Org-wide values offered by Inbox filter controls. */
  getInboxFacets(organizationId: string): Promise<InboxFacets>;
  /** Transcript, Improvement links and verdicts for one selected Conversation. */
  getInboxConversationReview(
    conversationId: string
  ): Promise<InboxConversationReview>;
  getConversation(id: string): Promise<Conversation | null>;
  /** The Conversation a message belongs to (for resolving a message's graph
   * Retrieval Trace + Collection); null if the message is unknown. */
  getConversationForMessage(messageId: string): Promise<Conversation | null>;
  setConversationPinned(id: string, pinned: boolean): Promise<void>;
  /**
   * Puts one Conversation beyond the reach of the retention sweep, or releases
   * it (#801, CYB-12). A preservation obligation is per conversation, so
   * honouring one must not mean turning retention off for the organization.
   */
  setConversationLegalHold(id: string, legalHold: boolean): Promise<void>;
  /** Shallow-merges the patch into the conversation's metadata. */
  updateConversationMetadata(
    id: string,
    patch: ConversationMetadata
  ): Promise<void>;
  /**
   * Close a Human review request (#841) only if it is still pending: the
   * compare-and-set behind "first decision wins". Returns the closed row, or
   * null when another decision (or the expiry sweep) got there first.
   */
  decideReviewRequest(
    id: string,
    patch: Pick<ReviewRequest, "status" | "decision" | "decidedBy" | "decidedByName" | "decidedAt">
  ): Promise<ReviewRequest | null>;
  /**
   * Closes a pending webhook subscription (#842) exactly once: the row is
   * written only while still `pending`, so of two racing callbacks, or a
   * callback racing the expiry sweep, exactly one transition lands and the
   * other reads null. The same compare-and-set as `decideReviewRequest`; a
   * read-then-write here was the hole that let a sweep flip a just-received
   * row to expired and drop its payload.
   */
  settleWebhookSubscription(
    id: string,
    patch: Pick<WebhookSubscription, "status"> &
      Partial<Pick<WebhookSubscription, "payload" | "receivedAt">>
  ): Promise<WebhookSubscription | null>;
  /** Atomically appends one forward referral link to conversation metadata. */
  appendConversationReferral(
    id: string,
    referral: NonNullable<ConversationMetadata["referredTo"]>[number]
  ): Promise<void>;
  /** Replaces the conversation's persistent session state (runtime-only). */
  updateConversationSessionState(
    id: string,
    state: Record<string, unknown>
  ): Promise<void>;
  /** CAS-merges a session patch; false means the caller must reload/retry. */
  mergeConversationSessionState(input: {
    id: string;
    expectedVersion: number;
    patch: Record<string, unknown>;
  }): Promise<boolean>;
  claimConversationTurn(input: {
    conversationId: string;
    requestId: string;
    workerId: string;
    now: string;
    staleBefore: string;
  }): Promise<{
    status: "claimed" | "running" | "completed";
    leaseToken: string | null;
    assistantMessageId: string | null;
  }>;
  completeConversationTurn(input: {
    conversationId: string;
    requestId: string;
    leaseToken: string;
    assistantMessageId: string;
    now: string;
  }): Promise<boolean>;
  /** Fenced atomic commit: assistant message, outbox rows, and turn completion. */
  commitConversationTurn(input: {
    conversationId: string;
    requestId: string;
    leaseToken: string;
    content: unknown[];
    flowId?: string | null;
    flowName?: string | null;
    trace?: StoredTurnTrace | null;
    deferredEffects?: unknown[];
    now: string;
  }): Promise<StoredMessage | null>;
  failConversationTurn(input: {
    conversationId: string;
    requestId: string;
    leaseToken: string;
    error: string;
    now: string;
  }): Promise<boolean>;
  deleteConversation(id: string): Promise<void>;
  listMessages(conversationId: string): Promise<StoredMessage[]>;
  getMessage(id: string): Promise<StoredMessage | null>;
  /** Recent conversation messages, returned oldest-first for model history. */
  listRecentMessages(
    conversationId: string,
    limit: number
  ): Promise<StoredMessage[]>;
  appendMessage(input: {
    conversationId: string;
    /** Stable per-turn id; one message per role is persisted for a replay. */
    requestId?: string;
    role: "user" | "assistant";
    content: unknown[];
    flowId?: string | null;
    flowName?: string | null;
    /**
     * The turn's Thinking Steps, already capped and redacted by the runtime.
     * Absent (or null) for user messages and for turns that did no agentic
     * work, the Inbox renders no panel for those.
     */
    trace?: StoredTurnTrace | null;
    /** Serializable effects atomically enqueued with an assistant message. */
    deferredEffects?: unknown[];
  }): Promise<StoredMessage>;
  claimTurnEffects(input: {
    messageId?: string | null;
    workerId: string;
    now: string;
    staleBefore: string;
    limit: number;
  }): Promise<
    Array<{
      id: string;
      organizationId: string;
      conversationId: string;
      messageId: string;
      payload: unknown;
      attempts: number;
      leaseToken: string;
    }>
  >;
  settleTurnEffect(input: {
    id: string;
    leaseToken: string;
    now: string;
    succeeded: boolean;
    error?: string;
  }): Promise<boolean>;
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
   * the cutoff; content, feedback and timestamps stay. Idempotent, a cleared
   * trace never matches again. Returns how many messages were swept.
   */
  clearExpiredTraces(organizationId: string, cutoffIso: string): Promise<number>;
  /**
   * Every organization that opted into a transcript-retention window (#801,
   * CYB-12). Cross-org, the nightly sweep's read; organizations that kept the
   * default (keep forever) are absent rather than present with a null.
   */
  listTranscriptRetentionPolicies(): Promise<
    Array<{ organizationId: string; retentionDays: number }>
  >;
  /**
   * Deletes this organization's Conversations older than the cutoff, messages
   * and links included, skipping any under legal hold. Idempotent, a deleted
   * conversation never matches again. Returns how many were removed.
   */
  deleteExpiredConversations(
    organizationId: string,
    cutoffIso: string
  ): Promise<number>;

  // Insights (org-wide analytics)
  /**
   * Bounded Insights Overview (KPI cards + time series + breakdowns),
   * aggregated org-side by an RLS-safe SQL function in production and computed
   * in memory by the demo adapter, never returns raw Conversations/Messages.
   */
  getInsightsOverview(
    organizationId: string,
    filters: InsightsFilter
  ): Promise<InsightsOverview>;

  // Improvements (AI-answer-quality tracker)
  listImprovements(organizationId: string): Promise<ImprovementListItem[]>;
  /**
   * One page of the board, newest `seq` first; `cursor` is the last seq of the
   * previous page. `status` narrows the page to one lane, which is how the
   * board pages each lane on its own instead of windowing the whole tracker.
   */
  listImprovementsPage(
    organizationId: string,
    input: { limit: number; cursor?: string | null; status?: ImprovementStatus }
  ): Promise<{ items: ImprovementListItem[]; nextCursor: string | null }>;
  /** Authoritative lane sizes, every status present even when zero. */
  countImprovementsByStatus(
    organizationId: string
  ): Promise<Record<ImprovementStatus, number>>;
  getImprovement(id: string): Promise<Improvement | null>;
  createImprovement(
    organizationId: string,
    input: { title: string; createdBy?: string | null; messageId?: string | null }
  ): Promise<Improvement>;
  updateImprovement(id: string, patch: ImprovementPatch): Promise<Improvement>;
  deleteImprovement(id: string): Promise<void>;
  /** The Suggested Fix drafted for an improvement, or null. */
  getImprovementProposal(improvementId: string): Promise<ImprovementProposal | null>;
  /**
   * The same row addressed by its own id. Exists because a proposal is
   * *updated* by proposal id, and the org-pinned view (which stands in for RLS
   * when the caller has no usable session, #770) has to answer "whose is this?"
   * before it lets that update through.
   */
  getImprovementProposalById(id: string): Promise<ImprovementProposal | null>;
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
  // Routines (#772). The CRUD rides `table("teammateRoutines")`; these two do
  // not, because a lease and a run record are not mechanical column writes.
  /**
   * Enabled routines that *might* be due (cross-org, service role): last run
   * absent or older than the loosest cadence window. The exact per-routine
   * rule is `isRoutineDue` in the domain package, applied by the caller, so
   * the schedule is written once rather than once per adapter.
   */
  listDueRoutineCandidates(input: {
    before: string;
    limit: number;
  }): Promise<TeammateRoutine[]>;
  /**
   * Compare-and-set the lease: stamps `lastRunAt` only if it still holds the
   * value the caller read, and returns null when another tick got there first.
   * That is what keeps two overlapping cron ticks from running one routine
   * twice, without a separate lock table.
   */
  claimTeammateRoutine(
    id: string,
    expectedLastRunAt: string | null,
    now: string
  ): Promise<TeammateRoutine | null>;
  /** Records how a run ended. Touches only the outcome columns. */
  recordTeammateRoutineRun(
    id: string,
    input: { status: RoutineRunStatus; detail: string }
  ): Promise<void>;

  // Memory documents (#771): the three prompt-injected layers and their
  // history. Behavioural rather than a mapped table, because a write is an
  // upsert plus an append plus a size cap, and a revert reads the history back.
  /**
   * One layer's document, or null when nobody has written it yet. Absent is a
   * real state, not an error: it is what every Member and every Teammate starts
   * with, and it injects nothing.
   */
  getMemoryDocument(
    organizationId: string,
    owner: MemoryDocumentOwner
  ): Promise<MemoryDocument | null>;
  /**
   * Replace a layer's body and record who did it.
   *
   * One method rather than create + update + log, because the three must not
   * come apart: a body that changed with no history entry is exactly the write
   * a Member could not audit or revert. Creates the document on first write.
   */
  writeMemoryDocument(input: {
    organizationId: string;
    owner: MemoryDocumentOwner;
    body: string;
    /** What the writer says it did, kept on the history entry. */
    note?: string;
    /** The Teammate that wrote it; null when a Member edited it themselves. */
    teammateId?: string | null;
    /** The Member it is attributed to. */
    authorId?: string | null;
  }): Promise<MemoryDocument>;
  /** The write history, newest first. */
  listMemoryDocumentEntries(
    documentId: string,
    limit?: number
  ): Promise<MemoryDocumentEntry[]>;
  /**
   * Restore the body as it stood before one entry, and record *that* as a new
   * entry. History is append-only: undoing a write is another write, so the
   * record still shows both.
   */
  revertMemoryDocument(input: {
    entryId: string;
    authorId?: string | null;
  }): Promise<MemoryDocument>;

  /** Flagged answers (+ conversation context) attached to an improvement. */
  listImprovementMessages(improvementId: string): Promise<ImprovementAssociation[]>;
  getImprovementAssociationPage(
    improvementId: string,
    page?: { offset?: number; limit?: number }
  ): Promise<ImprovementAssociationPage>;
  linkImprovementMessage(improvementId: string, messageId: string): Promise<void>;
  unlinkImprovementMessage(improvementId: string, messageId: string): Promise<void>;
  /** Improvement links for a conversation's messages (Inbox chips). */
  listConversationImprovementLinks(
    conversationId: string
  ): Promise<ImprovementMessageLink[]>;

  // Alerts (operational health)
  listAlerts(organizationId: string): Promise<Alert[]>;
  /** Newest active alerts, capped, the shell's bottom-right notification stack. */
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

  // Sensitive-object access ledger (#801, CYB-05). Append-only: there is no
  // update or delete, here or in the table's policies.
  /**
   * Record one attempt to read a private object. Written by the proxy that
   * served (or refused) it, on the service-role client: a Member must not be
   * able to write their own audit trail.
   */
  recordObjectAccess(event: ObjectAccessEventInput): Promise<void>;
  /**
   * Newest first. Reading the ledger is an administrative act. `offset` pages
   * a window longer than one `limit`: the detection tick walks a whole
   * baseline horizon page by page rather than trusting one page to hold it.
   */
  listObjectAccessEvents(
    organizationId: string,
    options?: { limit?: number; offset?: number; objectPath?: string; sinceIso?: string }
  ): Promise<ObjectAccessEvent[]>;

  // Retention-sweep deletion audit (#801, CYB-12). Append-only, like the
  // access ledger: there is no update or delete, here or in the policies.
  /**
   * Record one organization's retention tick: the policy that ran, its
   * window, and what it removed (or the error that stopped it). Written by
   * the cron on the service role; the audit must outlive the deletion.
   */
  recordRetentionSweep(event: RetentionSweepEventInput): Promise<void>;
  /**
   * Deletes ledger rows older than the cutoff, every organization at once
   * (#801, CYB-19): operational retention for security telemetry that carries
   * IP and user agent, not a tenant policy. Service-role only in practice,
   * the table has no delete policy. Returns how many rows went.
   */
  purgeExpiredObjectAccessEvents(cutoffIso: string): Promise<number>;
  /** The audit trail, newest first. Admin-read (RLS rank 3). */
  listRetentionSweepEvents(
    organizationId: string,
    options?: { limit?: number }
  ): Promise<RetentionSweepEvent[]>;
  /** Input+output tokens the organization consumed today (UTC), the budget pre-turn check. */
  getOrgTokensUsedToday(organizationId: string): Promise<number>;
  /** Estimated EUR cost (see pricing.ts) of today's (UTC) usage, the euro budget pre-turn check. */
  getOrgCostUsedToday(organizationId: string): Promise<number>;
  /**
   * Recomputes the last `days` UTC days (today included) of the usage_daily
   * rollup from the raw ledger. Cross-org, the rollup-usage cron's write
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
   * engine, the datasets the nightly graph-learning cron sweeps. Service-role
   * (spans orgs), like the other cron-claim reads. */
  listActiveGraphDatasets(): Promise<
    Array<{ organizationId: string; collectionId: string }>
  >;
  /** Atomically rotates through one bounded cron batch of active graph datasets. */
  claimActiveGraphDatasets(limit: number): Promise<
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
  reserveOrgBudget(input: {
    organizationId: string;
    maxTokens: number;
    maxEur: number;
    observedCostEur: number;
    now: string;
    expiresAt: string;
  }): Promise<string | null>;
  /** Atomically records the turn's usage and releases its hard-budget reservation. */
  settleOrgBudgetReservation(id: string, rows: AiUsageInput[]): Promise<boolean>;
  releaseOrgBudgetReservation(id: string): Promise<boolean>;

  // Standing goals (scheduled golden-question checks)
  /** Throws when the assistant already has ASSISTANT_GOAL_CAP goals. */
  createAssistantGoal(
    assistantId: string,
    input: { question: string; expectations: GoalExpectations }
  ): Promise<AssistantGoal>;
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
  /** The assistant's exhaust since `since`, every input optional by construction. */
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

  // Local-connector relay (server-only; requires a service-role Db, the
  // relay tables carry no RLS policies, so RLS-scoped clients see nothing).
  /**
   * Atomically consumes the unused, unexpired pairing matching the hashed
   * code + origin (a one-time compare-and-set on `usedAt`). Returns the
   * consumed pairing, or null when no such pairing exists / it was already
   * used / it expired, the three cases are indistinguishable by design.
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
   * the connector claimed its job, expired work must not linger), then
   * atomically claims its oldest pending unexpired job (pending → claimed).
   * Returns the claimed job, or null when there is no work or a concurrent
   * claim won.
   */
  claimNextLocalInferenceJob(input: {
    deviceId: string;
    now: string;
    /**
     * Whether this claim also deletes the device's expired jobs. The sweep
     * exists so an abandoned prompt cannot linger, but it does not need to
     * run on every 1s poll: the relay gates it to the heartbeat cadence, so
     * an expired prompt lives at most HEARTBEAT_MS longer. Defaults to true.
     */
    sweep?: boolean;
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

  // Platform settings (single-row, service-role only, org members can
  // neither read nor write; see docs/agentic-chat-runtime.md)
  /** The stored platform-wide system-prompt override ("" = use the shipped default). */
  getPlatformSystemPromptOverride(): Promise<string>;
  /** Persists the platform prompt override, stamping the editing owner. */
  setPlatformSystemPrompt(prompt: string, updatedBy: string): Promise<void>;

  // Skills (reusable org-level prompt templates). Plain CRUD lives on
  // `table("skills")` (ADR-0016 stage 3); only the delete stays named, the
  // mock detaches assistant_skills by hand where Postgres cascades.
  deleteSkill(id: string): Promise<void>;
  /** Skills attached to an assistant, in attachment order. */
  listAssistantSkills(assistantId: string): Promise<Skill[]>;
  /** Replaces the assistant's attached-skill set (ordered). */
  setAssistantSkills(assistantId: string, skillIds: string[]): Promise<void>;

  // Entity CRUD is mechanical and lives at table("entities") (ADR-0016).
  // Record ingestion/query methods remain behavioural seams.
  upsertEntityRecords(
    entityId: string,
    rows: Array<{ key: string; values: Record<string, EntityRecordValue> }>
  ): Promise<number>;
  listEntityRecords(
    entityId: string,
    opts?: { limit?: number; offset?: number }
  ): Promise<EntityRecord[]>;
  countEntityRecords(entityId: string): Promise<number>;
  queryEntityRecords(
    entityId: string,
    query: EntityRecordQuery
  ): Promise<EntityRecord[]>;

  getMemoryEnabled(organizationId: string): Promise<boolean>;
  setMemoryEnabled(organizationId: string, enabled: boolean): Promise<void>;
  upsertMemories(
    subject: MemorySubjectRef,
    items: Array<{
      text: string;
      embedding: number[] | null;
      conversationId?: string | null;
    }>
  ): Promise<number>;
  listMemories(subject: MemorySubjectRef): Promise<Memory[]>;
  getMemory(id: string): Promise<Memory | null>;
  /** Subjects holding memories in the organization, newest activity first. */
  listMemorySubjects(organizationId: string): Promise<MemorySubjectSummary[]>;
  listMemorySubjectsPage(
    organizationId: string,
    input: { limit: number; cursor?: string | null }
  ): Promise<{ items: MemorySubjectSummary[]; nextCursor: string | null }>;
  listEntitiesPage(
    organizationId: string,
    input: { limit: number; cursor?: string | null }
  ): Promise<{ items: Entity[]; nextCursor: string | null }>;
  deleteMemory(id: string): Promise<void>;
  deleteSubjectMemories(subject: MemorySubjectRef): Promise<void>;
  searchMemories(
    subject: MemorySubjectRef,
    query: { embedding: number[] | null; text: string; limit?: number }
  ): Promise<MemorySearchResult[]>;

  getEntitySyncConfig(entityId: string): Promise<EntitySyncConfig | null>;
  upsertEntitySyncConfig(
    entityId: string,
    input: EntitySyncConfigInput
  ): Promise<EntitySyncConfig>;
  deleteEntitySyncConfig(entityId: string): Promise<void>;
  markEntitySynced(entityId: string, at: string): Promise<void>;
  listDueEntitySyncConfigs(
    now: string
  ): Promise<Array<{ entityId: string; organizationId: string }>>;
  recordEntitySyncRun(
    entityId: string,
    run: Omit<EntitySyncRun, "id" | "entityId" | "finishedAt">
  ): Promise<EntitySyncRun>;
  /** Atomically replaces one fetched sync snapshot and records its run. */
  commitEntitySync(input: {
    entityId: string;
    expectedLastSyncedAt: string | null;
    rows: Array<{ key: string; values: Record<string, EntityRecordValue> }>;
    prune: boolean;
    rejected: string[];
    at: string;
  }): Promise<EntitySyncRun>;
  listEntitySyncRuns(entityId: string, limit?: number): Promise<EntitySyncRun[]>;
  pruneEntityRecords(entityId: string, seenKeys: string[]): Promise<number>;

  // Generic table access (ADR-0016): the seam the plain CRUD passthroughs
  // above migrate onto. Only tables in DbTableMap are reachable; behavioural
  // methods (leases, counters, dedup, sealed credentials) stay first-class.
  table<K extends DbTableName>(name: K): DbTableAccessor<K>;
}
