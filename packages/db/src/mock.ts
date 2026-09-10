import { entityRecordValuesEqual } from "./entity-records";
import { capPerSource, lexicalScore, lexicalTokens } from "./hybrid-search";
import {
  compareInboxConversation,
  decodeInboxCursor,
  encodeInboxCursor,
  inboxConversationMatches,
  inboxPageSize,
  isAfterInboxCursor,
} from "./inbox";
import {
  finalizeImprovementPage,
  normalizeImprovementPageInput,
} from "./improvement-pagination";
import type {
  AiUsageInput,
  Alert,
  AnswerVerdictInput,
  ApiIntegration,
  ApplicationConnection,
  ApplicationImport,
  ApplicationSource,
  ApplicationSyncRun,
  Assistant,
  AssistantGoal,
  AssistantInput,
  AssistantPatch,
  BackgroundJob,
  ChannelMessage,
  CompostDigest,
  Concept,
  ConceptFrontmatter,
  Conversation,
  CookieConsentRecord,
  CrawlFinalizeClaim,
  DefaultFlowSpec,
  DueCompostAssistant,
  Entity,
  EntityRecord,
  EntitySyncConfig,
  EntitySyncRun,
  ExportJob,
  Flow,
  FlowInput,
  FlowPatch,
  FlowTrust,
  FlowTrustEvent,
  HelpDesk,
  Improvement,
  ImprovementAssociation,
  ImprovementListItem,
  ImprovementMessageLink,
  ImprovementProposal,
  ImprovementStatus,
  InboxConversation,
  InboxFacets,
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
  MemorySubjectSummary,
  ObjectAccessEvent,
  OrgApiKey,
  OrgApiKeyInput,
  OrgBudget,
  Organization,
  OrganizationPatch,
  Profile,
  ProfilePatch,
  Project,
  ProviderConnection,
  Publication,
  RetentionSweepEvent,
  ReviewRequest,
  HttpFlowRun,
  WebhookSubscription,
  RuntimeEventInput,
  Skill,
  Source,
  SsoConnection,
  StoredMessage,
  SupportChannel,
  Teammate,
  TeammateChannel,
  TeammateChannelParticipant,
  TeammateGrant,
  TeammateRosterHidden,
  TeammateRoutine,
  TicketingIntegration,
  TrustSignal,
  UsageDailyRow,
  UsageMeterRow,
  VerifiableAnswer,
} from "@agent-hub/core";
import {
  ASSISTANT_GOAL_CAP,
  buildPublicationConfig,
  IMPROVEMENT_STATUS_VALUES,
  computeInsightsOverview,
  DEFAULT_AI_DISCLAIMER,
  DEFAULT_FLOWS,
  DEFAULT_WELCOME_MESSAGE,
  defaultChannelAvailability,
  defaultChannelConversationData,
  estimateCostEur,
  FLOW_TRUST_EVENT_RETENTION,
  GOAL_RUN_RETENTION,
  isProactiveMessage,
  MEMORIES_PER_SUBJECT_CAP,
  monotonicNow,
  nextCrawlDue,
  okfActor,
  capMemoryDocument,
  shortId,
  sortFlows,
  usageResourceOf,
} from "@agent-hub/core";

import {
  DB_TABLE_SPECS,
  newTableRowId,
  type DbTableAccessor,
  type DbTableName,
  type DbTableRow,
} from "./table-access";

import type { Db } from "./types";
import { resolveApplicationConnectionOwner } from "./application-connections";

/** Link row: an improvement associated with an assistant message. */
interface ImprovementMessageRow {
  id: string;
  improvementId: string;
  messageId: string;
  createdAt: string;
}

export const DEMO_ORG: Organization = {
  id: "demo-org",
  name: "Acme Corp (demo)",
  logoUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

export const DEMO_MEMBER: Member = {
  userId: "demo-user",
  email: "demo@ciele.local",
  role: "owner",
  username: "demo",
  firstName: null,
  lastName: null,
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

/** A handful of extra teammates so pickers (e.g. Improvement assignee) look real. */
const DEMO_TEAMMATES: Member[] = [
  { userId: "u-marco", email: "marco.iecher@example.com", role: "admin", username: "marco.iecher", firstName: null, lastName: null, avatarUrl: null, createdAt: "2026-01-02T00:00:00.000Z" },
  { userId: "u-martina", email: "martina.binacci@example.com", role: "editor", username: "martina.binacci", firstName: null, lastName: null, avatarUrl: null, createdAt: "2026-01-03T00:00:00.000Z" },
  { userId: "u-valeria", email: "valeria.agnello@example.com", role: "editor", username: "valeria.agnello", firstName: null, lastName: null, avatarUrl: null, createdAt: "2026-01-04T00:00:00.000Z" },
  { userId: "u-marianna", email: "marianna.nobile@example.com", role: "viewer", username: "marianna.nobile", firstName: null, lastName: null, avatarUrl: null, createdAt: "2026-01-05T00:00:00.000Z" },
  { userId: "u-andrea", email: "andrea.bicciolo@example.com", role: "editor", username: "andrea.bicciolo", firstName: null, lastName: null, avatarUrl: null, createdAt: "2026-01-06T00:00:00.000Z" },
];

interface MockStore {
  organization: Organization;
  profiles: Map<string, Profile>;
  assistants: Map<string, Assistant>;
  flows: Map<string, Flow>;
  helpDesks: Map<string, HelpDesk>;
  supportChannels: Map<string, SupportChannel>;
  members: Map<string, Member>;
  invites: Map<string, Invite>;
  /** Org API keys (#618); the mock keeps the hash alongside for later verify. */
  apiKeys: Map<string, OrgApiKey & { secretHash: string }>;
  connections: Map<string, ProviderConnection>;
  /** organizationId -> the connection chosen to embed its knowledge (#437). */
  embeddingConnections: Map<string, string>;
  /** Widget SSO connections, keyed by organizationId (one per org). */
  ssoConnections: Map<string, SsoConnection>;
  /** assistantId → its one API integration (spec #559). */
  apiIntegrations: Map<string, ApiIntegration>;
  teammates: Map<string, Teammate>;
  teammateGrants: Map<string, TeammateGrant>;
  teammateRosterHidden: Map<string, TeammateRosterHidden>;
  teammateRoutines: Map<string, TeammateRoutine>;
  teammateChannels: Map<string, TeammateChannel>;
  teammateChannelParticipants: Map<string, TeammateChannelParticipant>;
  /** Channel transcripts (#778); ordered by a per-channel monotonic createdAt. */
  channelMessages: Map<string, ChannelMessage>;
  projects: Map<string, Project>;
  memoryDocuments: Map<string, MemoryDocument>;
  memoryDocumentEntries: Map<string, MemoryDocumentEntry>;
  conversations: Map<string, Conversation>;
  conversationTurns: Map<
    string,
    {
      status: "running" | "completed" | "failed";
      leaseToken: string;
      lockedBy: string;
      lockedAt: string;
      assistantMessageId: string | null;
      error: string;
      updatedAt: string;
    }
  >;
  messages: Map<string, StoredMessage>;
  turnEffects: Map<
    string,
    {
      id: string;
      organizationId: string;
      conversationId: string;
      messageId: string;
      payload: unknown;
      status: "pending" | "running" | "succeeded" | "failed";
      attempts: number;
      nextRunAt: string;
      leaseToken: string | null;
      lockedAt: string | null;
      error: string;
      updatedAt: string;
    }
  >;
  improvements: Map<string, Improvement>;
  improvementMessages: Map<string, ImprovementMessageRow>;
  improvementProposals: Map<string, ImprovementProposal>;
  alerts: Map<string, Alert>;
  /** AI usage ledger rows, appended per model call (createdAt stamped on record). */
  aiUsage: (AiUsageInput & { createdAt: string })[];
  /** usage_daily rollup rows, keyed `${org}|${day}|${kind}|${credentialKind}`. */
  usageDaily: Map<string, UsageDailyAggregate>;
  /** Runtime telemetry events (ADR-0011), appended per runtime boundary. */
  runtimeEvents: (RuntimeEventInput & { createdAt: string })[];
  /** Sensitive-object access ledger (#801, CYB-05). Append-only, like the table. */
  objectAccessEvents: ObjectAccessEvent[];
  /** Retention-sweep deletion audit (#801, CYB-12). Append-only, like the table. */
  retentionSweepEvents: RetentionSweepEvent[];
  /** organizationId → daily token budget. */
  orgBudgets: Map<string, OrgBudget>;
  orgBudgetReservations: Map<
    string,
    {
      organizationId: string;
      reservedTokens: number;
      reservedEur: number;
      reservationDay: string;
      expiresAt: string;
    }
  >;
  /** organizationId -> serialized conservative euro spend for one UTC day. */
  orgBudgetSpentEur: Map<string, { day: string; eur: number }>;
  goals: Map<string, AssistantGoal>;
  reviewRequests: Map<string, ReviewRequest>;
  webhookSubscriptions: Map<string, WebhookSubscription>;
  httpFlowRuns: Map<string, HttpFlowRun>;
  /** messageId → verdict row (one per message). */
  answerVerdicts: Map<string, AnswerVerdictInput & { createdAt: string }>;
  /** messageId → verifier claim stamp (lease before grading). */
  answerVerifierClaims: Map<string, string>;
  /** `${assistantId}:${flowId}` → materialized trust row. */
  flowTrust: Map<string, FlowTrust>;
  /** Append-only tier-transition history (demotion history). */
  flowTrustEvents: FlowTrustEvent[];
  compostRuns: {
    assistantId: string;
    organizationId: string;
    windowStart: string;
    windowEnd: string;
    proposals: number;
    clean: boolean;
    createdAt: string;
  }[];
  /** Org ids that opted out of the compost loop. */
  compostOptOut: Set<string>;
  personalAiSubscriptionsAllowed: Set<string>;
  /** assistantId → compost claim stamp (lease at window start). */
  compostClaims: Map<string, string>;
  goalRuns: {
    goalId: string;
    organizationId: string;
    ranAt: string;
    pass: boolean;
    detail: string;
    durationMs: number;
  }[];
  backgroundJobs: Map<string, BackgroundJob>;
  graphLearningCursor: string | null;
  apiIdempotency: Map<string, {
    requestHash: string;
    status: "running" | "completed";
    leaseToken: string | null;
    lockedAt: string;
    expiresAt: string;
    responseStatus: number | null;
    responseBody: string | null;
    contentType: string | null;
  }>;
  sourceIngestPayloads: Map<
    string,
    {
      version: number;
      rawText: string;
      drafts: Array<{ path: string; frontmatter: ConceptFrontmatter; body: string }> | null;
      generationId: string | null;
      expectedActiveGenerationId: string | null;
      cursor: number;
    }
  >;
  exportJobs: Map<string, ExportJob>;
  crawlFinalizeClaims: Map<string, Pick<CrawlFinalizeClaim, "workerId" | "now">>;
  crawlFinalizeAttemptedAt: Map<string, string>;
  collections: Map<string, KnowledgeCollection>;
  sources: Map<string, Source>;
  applicationConnections: Map<string, ApplicationConnection>;
  applicationOAuthNonces: Map<
    string,
    { organizationId: string; memberId: string; expiresAt: string; consumedAt: string | null }
  >;
  applicationImports: Map<string, ApplicationImport>;
  applicationSources: Map<string, ApplicationSource>;
  applicationSyncRuns: Map<string, ApplicationSyncRun>;
  concepts: Map<string, Concept>;
  /** `${assistantId}:${sourceId}` → assistant↔source link (PRD #726). */
  assistantSources: Map<
    string,
    {
      assistantId: string;
      sourceId: string;
      directAccess: boolean;
      createdAt: string;
    }
  >;
  chunks: Map<
    string,
    {
      id: string;
      conceptId: string;
      collectionId: string;
      /** Retrieval scope: the assistant↔source link table alone (#733). */
      sourceId?: string | null;
      content: string;
      /** Kept only so the re-embed backfill can see missing embeddings. */
      embedding: number[] | null;
      /** Which model produced `embedding` (#801, CYB-14); the demo store is
       * lexical-only, so it is carried, never compared. */
      embeddingSpace?: string | null;
    }
  >;
  publications: Map<string, Publication>;
  skills: Map<string, Skill>;
  /** assistantId → ordered attached skill ids. */
  assistantSkills: Map<string, string[]>;
  entities: Map<string, Entity>;
  entityRecords: Map<string, EntityRecord>;
  /** Per-Entity sync sources + run reports (#670). */
  entitySyncConfigs: Map<string, EntitySyncConfig>;
  entitySyncRuns: Map<string, EntitySyncRun>;
  /** Long-term memories (#664), keyed by memory id. */
  memories: Map<string, Memory>;
  /** `${organizationId}:${subjectId}` → latest complete memory erasure. */
  memoryErasedAt: Map<string, string>;
  /** Org ids whose long-term memory toggle is on (off by default). */
  memoryEnabled: Set<string>;
  localConnectorPairings: Map<string, LocalConnectorPairing>;
  localConnectorDevices: Map<string, LocalConnectorDevice>;
  localInferenceJobs: Map<string, LocalInferenceJob>;
  cookieConsentRecords: Map<string, CookieConsentRecord>;
  /** Single-row platform settings (the platform-wide system prompt). */
  platformSettings: {
    systemPrompt: string;
    updatedBy: string | null;
    updatedAt: string;
  };
}

function seedAssistant(
  store: MockStore,
  a: Omit<
    Assistant,
    | "createdAt"
    | "updatedAt"
    | "organizationId"
    | "modelProvider"
    | "modelId"
    | "style"
    | "allowedDomains"
    | "helpDeskSettings"
    | "quickReplies"
    | "answeringStyle"
    | "simplifiedThinking"
    | "aiDisclaimer"
    | "tools"
    | "requireSignIn"
    | "knowledgeEngine"
  > &
    Partial<
      Pick<
        Assistant,
        | "createdAt"
        | "updatedAt"
        | "modelProvider"
        | "modelId"
        | "style"
        | "allowedDomains"
        | "helpDeskSettings"
        | "quickReplies"
        | "answeringStyle"
        | "simplifiedThinking"
        | "aiDisclaimer"
        | "tools"
        | "requireSignIn"
        | "knowledgeEngine"
      >
    >,
  flows?: Array<
    DefaultFlowSpec &
      Partial<
        Pick<Flow, "trigger" | "conditionLogic" | "conditions" | "actionSettings">
      >
  >
) {
  const now = new Date().toISOString();
  store.assistants.set(a.id, {
    organizationId: DEMO_ORG.id,
    modelProvider: "google",
    modelId: "gemini-3.5-flash",
    style: {},
    allowedDomains: [],
    helpDeskSettings: {},
    quickReplies: [],
    answeringStyle: "",
    simplifiedThinking: false,
    aiDisclaimer: DEFAULT_AI_DISCLAIMER,
    tools: {},
    requireSignIn: false,
    knowledgeEngine: "graph",
    createdAt: now,
    updatedAt: now,
    ...a,
  });
  const specs = flows ?? DEFAULT_FLOWS;
  specs.forEach((f, i) => {
    const id = shortId();
    store.flows.set(id, {
      id,
      assistantId: a.id,
      position: i,
      trigger: "message",
      triggerSettings: {},
      conditionLogic: "any",
      conditions: [],
      actionSettings: {},
      ...f,
    });
  });
}

/** Demo escalation destinations mirroring a cross-sector support landscape. */
const HELP_DESK_SEEDS: Array<Pick<HelpDesk, "name" | "description">> = [
  {
    name: "Sales Support",
    description:
      "Sales Support helps prospects and customers with product fit, pricing questions, procurement steps, demo requests, and handoffs to account teams for deeper commercial conversations.",
  },
  {
    name: "Central Support",
    description: "Main support desk for general inquiries and triage.",
  },
  {
    name: "IT Support",
    description:
      "The IT Support Helpdesk assists employees and customers with access issues, software troubleshooting, network support, and guidance on using internal digital tools efficiently.",
  },
  {
    name: "Knowledge Support",
    description:
      "Knowledge Support helps users find documentation, navigate resources, understand official materials, and route unclear content questions to the right owner.",
  },
  {
    name: "Customer Operations",
    description:
      "Supports customers with administrative procedures such as records, account updates, billing questions, and subscription changes.",
  },
  {
    name: "People Support",
    description:
      "People Support helps employees with workplace questions, wellbeing resources, policy guidance, and confidential routes to the right internal team.",
  },
];

/** The store shape with every field at its zero value (demo rows are seeded on
 * top by `createStore`). Kept separate so `getStore`'s HMR backfill can read the
 * full field list off the declaration instead of a hand-kept list. */
function emptyStore(): MockStore {
  return {
    organization: { ...DEMO_ORG },
    profiles: new Map(
      [DEMO_MEMBER, ...DEMO_TEAMMATES].map((m) => [
        m.userId,
        {
          userId: m.userId,
          email: m.email,
          username: m.username ?? "",
          firstName: m.firstName ?? "",
          lastName: m.lastName ?? "",
          avatarUrl: m.avatarUrl,
        } satisfies Profile,
      ] as const)
    ),
    assistants: new Map(),
    flows: new Map(),
    helpDesks: new Map(),
    supportChannels: new Map(),
    members: new Map(
      [DEMO_MEMBER, ...DEMO_TEAMMATES].map((m) => [m.userId, m] as const)
    ),
    invites: new Map(),
    apiKeys: new Map(),
    connections: new Map(),
    embeddingConnections: new Map(),
    ssoConnections: new Map(),
    apiIntegrations: new Map(),
    teammates: new Map(),
    teammateGrants: new Map(),
    teammateRosterHidden: new Map(),
    teammateRoutines: new Map(),
    teammateChannels: new Map(),
    teammateChannelParticipants: new Map(),
    channelMessages: new Map(),
    projects: new Map(),
    memoryDocuments: new Map(),
    memoryDocumentEntries: new Map(),
    conversations: new Map(),
    conversationTurns: new Map(),
    messages: new Map(),
    turnEffects: new Map(),
    improvements: new Map(),
    improvementMessages: new Map(),
    improvementProposals: new Map(),
    alerts: new Map(),
    // A little seeded usage so the demo build shows a populated Usage page
    // instead of an empty state: two model calls on the platform default and
    // one completed crawl, which is also the only place the crawl meter can be
    // seen without a real crawler credential.
    aiUsage: [
      {
        organizationId: DEMO_ORG.id,
        assistantId: null,
        stage: "generate",
        provider: "google",
        modelId: "gemini-3.5-flash",
        credentialKind: "platform",
        inputTokens: 184_000,
        outputTokens: 12_400,
        createdAt: new Date().toISOString(),
      },
      {
        organizationId: DEMO_ORG.id,
        assistantId: null,
        stage: "embed",
        provider: "openai",
        modelId: "text-embedding-3-small",
        credentialKind: "platform",
        inputTokens: 640_000,
        outputTokens: 0,
        createdAt: new Date().toISOString(),
      },
    ],
    usageDaily: new Map(),
    objectAccessEvents: [],
    retentionSweepEvents: [],
    runtimeEvents: [
      {
        organizationId: DEMO_ORG.id,
        assistantId: null,
        kind: "crawl",
        status: "succeeded",
        crawlerProvider: "crawl4ai",
        pageCount: 320,
        createdAt: new Date().toISOString(),
      },
    ],
    orgBudgets: new Map(),
    orgBudgetReservations: new Map(),
    orgBudgetSpentEur: new Map(),
    goals: new Map(),
    reviewRequests: new Map(),
    webhookSubscriptions: new Map(),
    httpFlowRuns: new Map(),
    goalRuns: [],
    answerVerdicts: new Map(),
    answerVerifierClaims: new Map(),
    flowTrust: new Map(),
    flowTrustEvents: [],
    compostRuns: [],
    compostOptOut: new Set(),
    personalAiSubscriptionsAllowed: new Set(),
    compostClaims: new Map(),
    backgroundJobs: new Map(),
    graphLearningCursor: null,
    apiIdempotency: new Map(),
    sourceIngestPayloads: new Map(),
    exportJobs: new Map(),
    crawlFinalizeClaims: new Map(),
    crawlFinalizeAttemptedAt: new Map(),
    collections: new Map(),
    sources: new Map(),
    applicationConnections: new Map(),
    applicationOAuthNonces: new Map(),
    applicationImports: new Map(),
    applicationSources: new Map(),
    applicationSyncRuns: new Map(),
    assistantSources: new Map(),
    concepts: new Map(),
    chunks: new Map(),
    publications: new Map(),
    skills: new Map(),
    assistantSkills: new Map(),
    entities: new Map(),
    entityRecords: new Map(),
    entitySyncConfigs: new Map(),
    entitySyncRuns: new Map(),
    memories: new Map(),
    memoryErasedAt: new Map(),
    memoryEnabled: new Set(),
    localConnectorPairings: new Map(),
    localConnectorDevices: new Map(),
    localInferenceJobs: new Map(),
    cookieConsentRecords: new Map(),
    platformSettings: {
      systemPrompt: "",
      updatedBy: null,
      updatedAt: new Date().toISOString(),
    },
  };
}

function createStore(): MockStore {
  const store = emptyStore();

  seedAssistant(store, {
    id: "Vrp47KxooVPk",
    title: "Ciele Support Assistant",
    nickname: "Ciele AI",
    description: "",
    welcomeMessage: DEFAULT_WELCOME_MESSAGE,
    suggestedQuestions: [],
    chatLauncherEnabled: true,
  });

  seedAssistant(store, {
    id: "GlQMYjuZ6xcO",
    title: "Alex",
    nickname: "AlexAI",
    description:
      "Alex's personal assistant, answers questions about Alex Bianchi from his CV, portfolio website, and FAQs.",
    welcomeMessage: DEFAULT_WELCOME_MESSAGE,
    suggestedQuestions: [],
    chatLauncherEnabled: true,
  });

  const seededAt = new Date().toISOString();
  for (const seed of HELP_DESK_SEEDS) {
    const id = shortId();
    store.helpDesks.set(id, {
      id,
      organizationId: DEMO_ORG.id,
      ...seed,
      autoGenerateImprovements: false,
      ticketingIntegration: null,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
  }

  seedInboxDemo(store);
  seedAlertsDemo(store);
  seedExportsDemo(store);
  seedEscalationDemo(store);
  seedKnowledgeDemo(store);
  seedSkillsDemo(store);
  seedPublications(store);

  return store;
}

/**
 * Seeds one org Skill and attaches it to the "Alex" assistant, so the
 * Tools & Skills section isn't empty in demo mode (the in-memory mock store
 * resets every server restart, wiping anything created through the UI).
 */
function seedSkillsDemo(store: MockStore) {
  const assistantId = "GlQMYjuZ6xcO";
  if (!store.assistants.has(assistantId)) return;
  const at = new Date().toISOString();
  const skill: Skill = {
    id: "skill-alex-signoff",
    organizationId: DEMO_ORG.id,
    name: "Friendly sign-off",
    description: "Ends every answer with a warm, on-brand closing line.",
    prompt:
      "End every answer with a new line containing exactly: Ask me anything else about Alex! 👋",
    createdAt: at,
    updatedAt: at,
  };
  store.skills.set(skill.id, skill);
  store.assistantSkills.set(assistantId, [skill.id]);
}

/**
 * Seeds the "Alex" assistant's knowledge (FAQ, CV document, portfolio
 * website) directly into the store, bypassing the ingest pipeline, which
 * needs a running server (embeddings, crawling) this sync seed can't call.
 * Without this, every demo restart wipes the knowledge testers just added
 * through the UI, since the mock store lives only in memory.
 */
/**
 * The ingestion pipeline's usage-attribution assistant for a Source: its
 * earliest link (mirrors the claim RPCs' derivation); "" when unlinked.
 */
function earliestLinkedAssistantId(store: MockStore, sourceId: string): string {
  return (
    [...store.assistantSources.values()]
      .filter((l) => l.sourceId === sourceId)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) ||
          a.assistantId.localeCompare(b.assistantId)
      )[0]?.assistantId ?? ""
  );
}

/**
 * Insights inputs for the in-memory adapter only. Production aggregates
 * these org-side in the `get_insights_overview` SQL RPC, so they are not on
 * the `Db` seam; exported for `insights-adapter.test.ts` (the oracle parity
 * check).
 */
export function listMockInsightsMessages(organizationId: string) {
  const store = getStore();
  const orgConversations = new Set(
    [...store.conversations.values()]
      .filter(
        (c) =>
          // A Teammate-owned Conversation has no Assistant and is not part of
          // the Visitor population (#767, story 31).
          c.assistantId !== null &&
          store.assistants.get(c.assistantId)?.organizationId ===
            organizationId
      )
      .map((c) => c.id)
  );
  return [...store.messages.values()]
    .filter((m) => orgConversations.has(m.conversationId))
    .map((m) => ({
      conversationId: m.conversationId,
      role: m.role,
      feedback: m.feedback,
      createdAt: m.createdAt,
      proactive: isProactiveMessage(m.content),
    }));
}

/** See {@link listMockInsightsMessages}: mock-only Insights input. */
export function listMockWebsiteSources(organizationId: string) {
  const store = getStore();
  return [...store.sources.values()].flatMap((source) => {
    if (source.kind !== "website") return [];
    const collection = store.collections.get(source.collectionId);
    if (collection?.organizationId !== organizationId) return [];
    return [
      {
        id: source.id,
        assistantId: earliestLinkedAssistantId(store, source.id),
        name: source.name,
        url: source.config.url ?? "",
      },
    ];
  });
}

/**
 * The claim RPC's due set: published assistants in opted-in orgs whose last
 * compost run predates `dueBefore`, oldest-run first. Private to
 * `claimDueCompostAssistants`, claiming is the only way to consume it.
 */
function listDueCompostAssistants(
  store: MockStore,
  dueBefore: string
): DueCompostAssistant[] {
  const due: DueCompostAssistant[] = [];
  for (const assistant of store.assistants.values()) {
    if (store.compostOptOut.has(assistant.organizationId)) continue;
    const published = [...store.publications.values()].some(
      (p) => p.assistantId === assistant.id
    );
    if (!published) continue;
    const lastRun = store.compostRuns
      .filter((r) => r.assistantId === assistant.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (lastRun && lastRun.createdAt >= dueBefore) continue;
    due.push({
      assistantId: assistant.id,
      organizationId: assistant.organizationId,
      lastRunAt: lastRun?.createdAt ?? null,
    });
  }
  return due.sort((a, b) =>
    (a.lastRunAt ?? "").localeCompare(b.lastRunAt ?? "")
  );
}

function seedKnowledgeDemo(store: MockStore) {
  const assistantId = "GlQMYjuZ6xcO";
  if (!store.assistants.has(assistantId)) return;
  const at = new Date().toISOString();

  const collection: KnowledgeCollection = {
    id: "col-alex-general",
    organizationId: store.assistants.get(assistantId)?.organizationId ?? "",
    name: "General knowledge",
    description: "Default collection for this assistant",
    createdAt: at,
  };
  store.collections.set(collection.id, collection);

  /** Links a Source to the demo assistant, retrieval reach is link-only. */
  function linkSource(sourceId: string) {
    store.assistantSources.set(`${assistantId}:${sourceId}`, {
      assistantId,
      sourceId,
      directAccess: false,
      createdAt: at,
    });
  }

  /** Persists one Concept + its lexically-searchable chunk (mock search is lexical-only). */
  function addConcept(input: {
    id: string;
    sourceId: string | null;
    path: string;
    frontmatter: Concept["frontmatter"];
    body: string;
  }) {
    const concept: Concept = {
      id: input.id,
      collectionId: collection.id,
      sourceId: input.sourceId,
      generationId: input.sourceId
        ? store.sources.get(input.sourceId)?.activeGenerationId ?? null
        : null,
      path: input.path,
      frontmatter: input.frontmatter,
      body: input.body,
      excluded: false,
      recrawlSchedule: null,
      createdAt: at,
    };
    store.concepts.set(concept.id, concept);
    const chunkId = shortId();
    store.chunks.set(chunkId, {
      id: chunkId,
      conceptId: concept.id,
      collectionId: collection.id,
      sourceId: input.sourceId,
      content: `${input.frontmatter.title ?? input.path}\n\n${input.body}`,
      embedding: null,
    });
  }

  // FAQ, "Chi è Alex?". Post-backfill parity (#728): every FAQ owns its
  // synthetic `faq` Source, so the demo store mirrors a migrated database.
  const faqSource: Source = {
    id: "faqsrc-concept-alex-faq-chi-e",
    collectionId: collection.id,
    name: "Chi è Alex?",
    kind: "faq",
    status: "ready",
    error: "",
    config: {},
    recrawlSchedule: "never",
    lastCrawledAt: null,
    originalObjectPath: null,
    activeGenerationId: crypto.randomUUID(),
    createdAt: at,
    updatedAt: at,
  };
  store.sources.set(faqSource.id, faqSource);
  linkSource(faqSource.id);
  addConcept({
    id: "concept-alex-faq-chi-e",
    sourceId: faqSource.id,
    path: "faq/chi-e-alex.md",
    frontmatter: {
      type: "FAQ",
      title: "Chi è Alex?",
      description: "Alex Bianchi è un ingegnere che lavora su progetti di intelligenza artificiale.",
      // Hand-written then signed off, the demo's one human-reviewed concept,
      // so the Knowledge browser shows every trust tier out of the box.
      generated: { by: okfActor.human(DEMO_MEMBER.userId), at },
      verified: [{ by: okfActor.human(DEMO_MEMBER.userId), at }],
    },
    body: "Alex Bianchi è un ingegnere che lavora su progetti legati all'intelligenza artificiale. Il suo ultimo lavoro riguarda piattaforme AI e assistenti digitali.",
  });

  // Document: CV
  const cvSource: Source = {
    id: "src-alex-cv",
    collectionId: collection.id,
    name: "Alex_Bianchi_CV.pdf",
    kind: "file",
    status: "ready",
    error: "",
    config: {},
    recrawlSchedule: "never",
    lastCrawledAt: null,
    originalObjectPath: null,
    activeGenerationId: crypto.randomUUID(),
    createdAt: at,
    updatedAt: at,
  };
  store.sources.set(cvSource.id, cvSource);
  linkSource(cvSource.id);
  addConcept({
    id: "concept-alex-cv",
    sourceId: cvSource.id,
    path: "documents/alex-bianchi-cv.md",
    frontmatter: {
      type: "Document",
      title: "Alex Bianchi, CV",
      description: "Imported from file source \"Alex_Bianchi_CV.pdf\"",
      // Machine-drafted from the upload and never confirmed: unverified.
      generated: { by: okfActor.agent("okf-enricher", "demo"), at },
      sources: [{ id: "alex-bianchi-cv", resource: "file source \"Alex_Bianchi_CV.pdf\"", title: cvSource.name }],
    },
    body: "Alex Bianchi, Ingegnere.\n\nPercorso: Software Engineering e progetti di prodotto digitale.\n\nEsperienza: lavora su piattaforme legate all'intelligenza artificiale (AI), automazione e assistenti digitali.\n\nPortfolio personale: https://alexbianchi.example",
  });

  // The enriched CV's verbatim companion (ADR-0002): the extracted text as-is,
  // indexed so detail the rewrite above did not carry is still retrievable.
  addConcept({
    id: "concept-alex-cv-original",
    sourceId: cvSource.id,
    path: "originals/alex-bianchi-cv-pdf.md",
    frontmatter: {
      type: "Source Text",
      title: "Alex_Bianchi_CV.pdf, full text",
      description:
        'Unedited text of file source "Alex_Bianchi_CV.pdf", indexed so detail the enrichment did not carry is still retrievable.',
      generated: { by: okfActor.process("okf-verbatim-index"), at },
      sources: [{ id: "alex-bianchi-cv", resource: "file source \"Alex_Bianchi_CV.pdf\"", title: cvSource.name }],
    },
    body: "ALEX BIANCHI\nIngegnere, Software Engineering & prodotto digitale\n\nESPERIENZA\nPiattaforme di intelligenza artificiale, automazione e assistenti digitali.\nManifold Drone Synchronization, Singapore, 2019.\nArdupilot Failure, Development, 2020/2021.\n\nFORMAZIONE\nSoftware Engineering.\n\nCONTATTI\nPortfolio: https://alexbianchi.example",
  });

  // Website: alexbianchi.example portfolio, seeded as if already crawled
  const webSource: Source = {
    id: "src-alex-website",
    collectionId: collection.id,
    name: "Sito di Alex",
    kind: "website",
    status: "ready",
    error: "",
    config: { url: "https://alexbianchi.example" },
    recrawlSchedule: "weekly",
    lastCrawledAt: at,
    originalObjectPath: null,
    activeGenerationId: crypto.randomUUID(),
    createdAt: at,
    updatedAt: at,
  };
  store.sources.set(webSource.id, webSource);
  linkSource(webSource.id);
  const projects: Array<{ slug: string; title: string; body: string }> = [
    {
      slug: "about",
      title: "About, alexbianchi.example",
      body: "Alex Bianchi, portfolio personale e professionale. Percorso in Software Engineering e prodotto digitale. Lavora su progetti di intelligenza artificiale.",
    },
    {
      slug: "ciao",
      title: "Ciao! alexbianchi.example",
      body: "Progetto \"Ciao!\", Software Engineering, Interaction & Development, 2025.",
    },
    {
      slug: "balance-trend-and-forecast",
      title: "Balance trend and forecast, alexbianchi.example",
      body: "Progetto \"Balance trend and forecast\", Software Engineering, 2022.",
    },
    {
      slug: "covid-korea",
      title: "Covid Korea, alexbianchi.example",
      body: "Progetto \"Covid Korea\", Data Science, 2021.",
    },
    {
      slug: "macos-resume-template",
      title: "macOS Resume Template, alexbianchi.example",
      body: "Progetto \"macOS Resume Template\", Design, 2022.",
    },
    {
      slug: "ardupilot-failure",
      title: "Ardupilot Failure, alexbianchi.example",
      body: "Progetto \"Ardupilot Failure\", Development, 2020/2021.",
    },
    {
      slug: "manifold-drone-synchronization",
      title: "Manifold Drone Synchronization, alexbianchi.example",
      body: "Progetto \"Manifold Drone Synchronization\", Development, Singapore, 2019.",
    },
  ];
  for (const project of projects) {
    addConcept({
      id: `concept-alex-web-${project.slug}`,
      sourceId: webSource.id,
      path: `web/${project.slug}.md`,
      frontmatter: {
        type: "Web Page",
        title: project.title,
        description: `https://alexbianchi.example/${project.slug}`,
        resource: `https://alexbianchi.example/${project.slug}`,
        generated: { by: okfActor.process("website-crawl"), at },
        sources: [
          {
            id: project.slug,
            resource: `https://alexbianchi.example/${project.slug}`,
            title: project.title,
          },
        ],
      },
      body: project.body,
    });
  }

  // Post-contract parity: retrieval is link-based, so every demo Source
  // carries its assistant link (direct access stays off by default).
  for (const source of store.sources.values()) {
    if (source.collectionId !== collection.id) continue;
    store.assistantSources.set(`${assistantId}:${source.id}`, {
      assistantId,
      sourceId: source.id,
      directAccess: false,
      createdAt: at,
    });
  }
}

/**
 * Seeds a working escalation path: support channels on both the IT Support
 * desk (email + live chat, auto-generate improvements on) and the Sales
 * Support desk (email always-available + phone weekdays 10:30-19:00
 * Europe/Rome), plus the TEST assistant's desk selection and starter
 * quick-reply buttons, so the widget can chat and escalate out of the box.
 * `seedPublications` (called after this) captures the enriched assistant.
 */
function seedEscalationDemo(store: MockStore) {
  const itSupport = [...store.helpDesks.values()].find(
    (d) => d.name === "IT Support"
  );
  const salesSupport = [...store.helpDesks.values()].find(
    (d) => d.name === "Sales Support"
  );
  const assistant = store.assistants.get("Vrp47KxooVPk");
  const at = new Date().toISOString();

  if (itSupport) {
    store.helpDesks.set(itSupport.id, {
      ...itSupport,
      autoGenerateImprovements: true,
    });

    const channelBase = {
      helpDeskId: itSupport.id,
      enabled: true,
      formTitle: "",
      form: [],
      confirmationMessage: "",
      conversationData: defaultChannelConversationData(),
      availability: defaultChannelAvailability(),
      createdAt: at,
      updatedAt: at,
    };
    const channels: SupportChannel[] = [
      {
        ...channelBase,
        id: "ch-demo-email",
        kind: "email",
        name: "Email IT Support",
        position: 0,
        config: { destinationEmail: "it-support@example.com" },
        formTitle: "Helpdesk form",
        form: [
          {
            id: "ch-demo-email-f1",
            type: "user_email",
            label: "Email",
            required: true,
            useAsReplyTo: true,
            showInForm: true,
          },
          {
            id: "ch-demo-email-f2",
            type: "short_text",
            label: "Subject",
            placeholder: "Enter text",
            required: true,
            showInForm: true,
          },
          {
            id: "ch-demo-email-f3",
            type: "long_text",
            label: "Description",
            placeholder: "Describe your issue",
            required: true,
            showInForm: true,
          },
        ],
        confirmationMessage:
          "Thanks! The IT team will reply to your email shortly.",
      },
      {
        ...channelBase,
        id: "ch-demo-livechat",
        kind: "live_chat",
        name: "Live chat",
        position: 1,
        config: { url: "https://support.example.com/live-chat" },
      },
    ];
    for (const c of channels) store.supportChannels.set(c.id, c);
  }

  if (salesSupport) {
    const emailId = shortId();
    store.supportChannels.set(emailId, {
      id: emailId,
      helpDeskId: salesSupport.id,
      kind: "email",
      name: "Email",
      position: 0,
      enabled: true,
      config: { destinationEmail: "sales@example.com" },
      formTitle: "Send us a message",
      form: [],
      confirmationMessage: "",
      conversationData: defaultChannelConversationData(),
      availability: defaultChannelAvailability(),
      createdAt: at,
      updatedAt: at,
    });

    const callAvailability = defaultChannelAvailability();
    callAvailability.mode = "limited";
    callAvailability.timezone = "Europe/Rome";
    for (const day of [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
    ] as const) {
      callAvailability.hours[day] = {
        enabled: true,
        ranges: [
          {
            id: `${day}-shift`,
            opensHour: 10,
            opensMinute: 30,
            closesHour: 19,
            closesMinute: 0,
          },
        ],
      };
    }
    const callId = shortId();
    store.supportChannels.set(callId, {
      id: callId,
      helpDeskId: salesSupport.id,
      kind: "phone",
      name: "Call",
      position: 1,
      enabled: true,
      config: { phoneNumber: "+39 06 8522 5990", phoneCountry: "IT" },
      formTitle: "Send us a message",
      form: [],
      confirmationMessage: "",
      conversationData: defaultChannelConversationData(),
      availability: callAvailability,
      createdAt: at,
      updatedAt: at,
    });
  }

  if (assistant && (itSupport || salesSupport)) {
    const selectedIds = [itSupport?.id, salesSupport?.id].filter(
      (id): id is string => Boolean(id)
    );
    store.assistants.set(assistant.id, {
      ...assistant,
      helpDeskSettings: {
        aiRecommended: true,
        contactButtonLabel: "Contact support",
        selectedIds,
      },
      quickReplies: [
        {
          id: "qr-demo-product",
          label: "Product setup",
          type: "send_text",
          text: "How do I set up my workspace?",
        },
        {
          id: "qr-demo-escalate",
          label: "Talk to support",
          type: "escalation",
        },
        {
          id: "qr-demo-site",
          label: "Product website",
          type: "external_link",
          url: "https://ciele.app",
        },
      ],
    });
  }
}

/** Seeds one active and one resolved alert so the Alerts page has data. */
function seedAlertsDemo(store: MockStore) {
  const hoursAgo = (h: number) =>
    new Date(Date.now() - h * 3_600_000).toISOString();
  const alerts: Alert[] = [
    {
      id: "alert-demo-crm",
      organizationId: DEMO_ORG.id,
      type: "integration",
      title: "CRM API access token expired",
      detail:
        "The stored access token for the CRM integration was rejected (HTTP 401). Customer record sync is paused until the credentials are updated.",
      status: "active",
      sourceKey: "integration:crm-demo",
      detectedAt: hoursAgo(26),
      resolvedAt: null,
      resolvedBy: null,
    },
    {
      id: "alert-demo-crawl",
      organizationId: DEMO_ORG.id,
      type: "crawl",
      title: "Website crawl failed: Help Center",
      detail:
        "Crawl of https://help.example.com timed out after 30s on 12 of 40 pages. The site may be rate-limiting requests.",
      status: "resolved",
      sourceKey: "website-source:demo-library",
      detectedAt: hoursAgo(70),
      resolvedAt: hoursAgo(44),
      resolvedBy: "u-marco",
    },
  ];
  for (const a of alerts) store.alerts.set(a.id, a);
}

/**
 * Seeds a coherent Insights -> Exports list covering every UI state: a
 * finished export with a stored artifact, one still running, and one that
 * failed with a reason (retryable). The offline demo has no cron/storage, so
 * these are static fixtures rather than jobs the runner produced.
 */
function seedExportsDemo(store: MockStore) {
  const minutesAgo = (m: number) =>
    new Date(Date.now() - m * 60_000).toISOString();
  const params = {
    kind: "insights_overview",
    from: "2026-06-11",
    to: "2026-07-11",
    aggregate: "daily",
  };
  const jobs: ExportJob[] = [
    {
      id: "export-demo-done",
      organizationId: DEMO_ORG.id,
      kind: "insights_overview",
      status: "done",
      format: "csv",
      params,
      storagePath: `org/${DEMO_ORG.id}/exports/export-demo-done.csv`,
      error: "",
      attempts: 1,
      maxAttempts: 3,
      lockedAt: null,
      lockedBy: null,
      createdAt: minutesAgo(42),
      updatedAt: minutesAgo(41),
    },
    {
      id: "export-demo-running",
      organizationId: DEMO_ORG.id,
      kind: "insights_overview",
      status: "running",
      format: "csv",
      params,
      storagePath: null,
      error: "",
      attempts: 1,
      maxAttempts: 3,
      lockedAt: minutesAgo(1),
      lockedBy: "cron-run-exports",
      createdAt: minutesAgo(2),
      updatedAt: minutesAgo(1),
    },
    {
      id: "export-demo-error",
      organizationId: DEMO_ORG.id,
      kind: "insights_overview",
      status: "error",
      format: "csv",
      params,
      storagePath: null,
      error: "Report generation timed out after 3 attempts",
      attempts: 3,
      maxAttempts: 3,
      lockedAt: null,
      lockedBy: null,
      createdAt: minutesAgo(180),
      updatedAt: minutesAgo(150),
    },
  ];
  for (const job of jobs) store.exportJobs.set(job.id, job);
}

/**
 * Every demo assistant ships already published (version 1 of its live
 * config), so the public widget works out of the box in demo mode.
 */
function seedPublications(store: MockStore) {
  const at = new Date().toISOString();
  for (const assistant of store.assistants.values()) {
    const flows = sortFlows(
      [...store.flows.values()].filter((f) => f.assistantId === assistant.id)
    );
    const linkedCollectionIds = new Set<string>();
    for (const link of store.assistantSources.values()) {
      if (link.assistantId !== assistant.id) continue;
      const source = store.sources.get(link.sourceId);
      if (source) linkedCollectionIds.add(source.collectionId);
    }
    const collections = [...store.collections.values()].filter((c) =>
      linkedCollectionIds.has(c.id)
    );
    const id = shortId();
    store.publications.set(id, {
      id,
      assistantId: assistant.id,
      version: 1,
      config: buildPublicationConfig(assistant, flows, collections),
      createdAt: at,
    });
  }
}

/**
 * Seeds one demo Inbox conversation on the TEST assistant and a matching
 * Improvement linked to its final answer, so the Inbox, "Improve Answer" flow,
 * and Improvements Kanban all have realistic data out of the box.
 */
function seedInboxDemo(store: MockStore) {
  const at = (h: number, m: number) =>
    new Date(Date.UTC(2026, 6, 3, h, m, 0)).toISOString();

  const conversation: Conversation = {
    id: "conv-demo-support",
    assistantId: "Vrp47KxooVPk",
    teammateId: null,
    subjectType: "visitor",
    subjectId: "anon-2f9c",
    collectionId: null,
    title: "ciao",
    metadata: {
      launchUrl: "https://widget.example.com/assistants/Vrp47KxooVPk",
      ip: "82.84.243.55",
      os: "Macintosh",
      browser: "Google Chrome",
      language: "en-GB",
      location: "IT",
      city: "Rome",
      resolution: "1470x923",
      escalated: false,
    },
    sessionState: {},
    sessionVersion: 0,
    pinned: false,
    createdAt: at(7, 44),
    updatedAt: at(7, 45),
  };
  store.conversations.set(conversation.id, conversation);

  const messages: StoredMessage[] = [
    {
      id: "msg-demo-welcome",
      conversationId: conversation.id,
      role: "assistant",
      content: [
        {
          type: "text",
          action: "fallback",
          text: "Hi! I'm Ciele AI.\n\nI can help you find product information, support resources, account guidance, and the right team to contact. What would you like to know?",
        },
      ],
      flowId: null,
      flowName: null,
      feedback: 0,
      trace: null,
      createdAt: at(7, 44),
    },
    {
      id: "msg-demo-ciao",
      conversationId: conversation.id,
      role: "user",
      content: [{ type: "text", text: "ciao" }],
      flowId: null,
      flowName: null,
      feedback: 0,
      trace: null,
      createdAt: at(7, 45),
    },
    {
      id: "msg-demo-hello",
      conversationId: conversation.id,
      role: "assistant",
      content: [
        {
          type: "text",
          action: "search_knowledge",
          text: "Hello! How can I help you with product information, account questions, or support services today?",
        },
        { type: "sources", action: "search_knowledge", sources: [] },
        {
          type: "help_desk",
          action: "suggest_help_desk",
          label: "Contact support",
        },
      ],
      flowId: null,
      flowName: "Default behavior",
      feedback: 0,
      // Demo trace: the Thinking panel has to have something to render in the
      // Supabase-less demo build, which is where this feature gets reviewed.
      trace: {
        searchCount: 1,
        steps: [
          {
            id: "step-1",
            kind: "step",
            label: "Classifying intent",
            stage: "classify",
            status: "done",
            detail: "Matched flow “Default behavior”",
          },
          {
            id: "step-2",
            kind: "thought",
            label:
              "The visitor greeted me without asking anything specific. I should introduce what I can help with rather than searching for “ciao”, but a quick look at the knowledge base tells me which topics to offer.",
            status: "done",
          },
          {
            id: "call-demo-1",
            kind: "tool",
            tool: "searchKnowledge",
            label: "Searching knowledge for “getting started”",
            input: { query: "getting started" },
            status: "done",
            detail: "2 concepts found",
            durationMs: 412,
          },
          {
            id: "call-demo-2",
            kind: "tool",
            tool: "readyToAnswer",
            label: "Getting ready to answer…",
            input: { status: "answer" },
            status: "done",
            detail: "Ready to answer",
            result: { status: "answer" },
            durationMs: 0,
          },
        ],
      },
      createdAt: at(7, 45),
    },
  ];
  for (const m of messages) store.messages.set(m.id, m);

  const improvement: Improvement = {
    id: "imp-demo-hello",
    organizationId: DEMO_ORG.id,
    seq: 1,
    title: "Hello!",
    description: "",
    status: "to_do",
    priority: "low",
    tags: ["Generico"],
    assigneeId: null,
    dueDate: null,
    projectId: null,
    createdBy: "u-marco",
    createdAt: at(7, 47),
    updatedAt: at(7, 47),
  };
  store.improvements.set(improvement.id, improvement);
  store.improvementMessages.set("impmsg-demo", {
    id: "impmsg-demo",
    improvementId: improvement.id,
    messageId: "msg-demo-hello",
    createdAt: at(7, 47),
  });

  // A second, named-member conversation anchored to a product collection, so
  // the Inbox shows both an anonymous visitor and a known customer with a
  // collection chip.
  const at1 = (h: number, m: number) =>
    new Date(Date.UTC(2026, 6, 1, h, m, 0)).toISOString();

  store.collections.set("col-onboarding", {
    id: "col-onboarding",
    organizationId:
      store.assistants.get("Vrp47KxooVPk")?.organizationId ?? "",
    name: "Customer onboarding",
    description: "",
    createdAt: at1(0, 0),
  });

  const conv2: Conversation = {
    id: "conv-demo-onboarding",
    assistantId: "Vrp47KxooVPk",
    teammateId: null,
    subjectType: "member",
    subjectId: "u-claudio",
    collectionId: "col-onboarding",
    title: "Find onboarding checklist",
    metadata: {
      userName: "Claudio Stanzione",
      userRole: "Customer",
      userEmail: "claudio.stanzione@example.com",
      launchUrl: "https://widget.example.com/assistants/Vrp47KxooVPk",
      ip: "93.44.12.10",
      os: "Windows",
      browser: "Microsoft Edge",
      language: "it-IT",
      location: "IT",
      city: "Milan",
      resolution: "1920x1080",
      escalated: false,
    },
    sessionState: {},
    sessionVersion: 0,
    pinned: false,
    createdAt: at1(14, 30),
    updatedAt: at1(14, 31),
  };
  store.conversations.set(conv2.id, conv2);

  const onboardingMessages: StoredMessage[] = [
    {
      id: "msg-onboarding-q",
      conversationId: conv2.id,
      role: "user",
      content: [
        { type: "text", text: "Where can I find the onboarding checklist?" },
      ],
      flowId: null,
      flowName: null,
      feedback: 0,
      trace: null,
      createdAt: at1(14, 30),
    },
    {
      id: "msg-onboarding-a",
      conversationId: conv2.id,
      role: "assistant",
      content: [
        {
          type: "text",
          action: "search_knowledge",
          text: "Here is the onboarding checklist for your workspace. It covers account setup, invite links, knowledge sources, support routing, and publishing the widget.",
        },
        {
          type: "sources",
          action: "search_knowledge",
          sources: [
            {
              conceptTitle: "Workspace onboarding checklist",
              collectionName: "Customer onboarding",
              sourceName: "Onboarding.pdf",
            },
          ],
        },
      ],
      flowId: null,
      flowName: "Search knowledge",
      feedback: 1,
      // A multi-search turn, so the demo also shows the ×N pill and a clipped
      // reasoning step.
      trace: {
        searchCount: 2,
        truncated: false,
        steps: [
          {
            id: "step-1",
            kind: "step",
            label: "Generating answer",
            stage: "generate",
            status: "done",
            detail: "Model: gpt-4o-mini",
          },
          {
            id: "call-onb-1",
            kind: "tool",
            tool: "searchKnowledge",
            label: "Searching knowledge for “onboarding checklist”",
            input: { queries: ["onboarding checklist"] },
            status: "done",
            detail: "1 concept found",
            durationMs: 388,
            iteration: 1,
          },
          {
            id: "step-2",
            kind: "thought",
            label:
              "One concept came back and it is the checklist itself, but it does not say whether publishing the widget is part of it. One more search on “publish widget” before I answer.",
            status: "done",
          },
          {
            // A batched call: two queries, one iteration (#558).
            id: "call-onb-2",
            kind: "tool",
            tool: "searchKnowledge",
            label:
              "Searching knowledge for:\n- publish widget\n- embed snippet",
            input: { queries: ["publish widget", "embed snippet"] },
            status: "done",
            detail: "2 concepts found",
            durationMs: 341,
            iteration: 2,
          },
        ],
      },
      createdAt: at1(14, 31),
    },
  ];
  for (const m of onboardingMessages) store.messages.set(m.id, m);
}

// Survive Next.js dev-server HMR by stashing the store on globalThis.
const globalForMock = globalThis as unknown as { __agentHubMock?: MockStore };

/** Every field the store shape declares. Read once off `emptyStore` so a field
 * added to `MockStore` is backfilled below without anyone remembering to. */
const STORE_FIELDS = Object.keys(emptyStore()) as (keyof MockStore)[];

/**
 * Throw the store away so the next read re-seeds the demo data. The store is
 * process-global on purpose (it has to survive dev-server HMR), which makes it
 * shared state for any test that mutates through `mockDb`; this is how such a
 * test gets isolation without reaching for that global itself.
 */
export function resetMockStore(): void {
  globalForMock.__agentHubMock = createStore();
}

function getStore(): MockStore {
  globalForMock.__agentHubMock ??= createStore();
  const store = globalForMock.__agentHubMock;
  // A field added to `MockStore` after a dev-server store was stashed is absent
  // on that warm store, and reading it throws. Refill from a fresh empty shape.
  const missing = STORE_FIELDS.filter((field) => store[field] === undefined);
  if (missing.length > 0) {
    const fresh = emptyStore();
    for (const field of missing) {
      Object.assign(store, { [field]: fresh[field] });
    }
  }
  for (const [id, assistant] of store.assistants) {
    if (
      !assistant.style ||
      !assistant.allowedDomains ||
      !assistant.helpDeskSettings ||
      !assistant.quickReplies
    ) {
      store.assistants.set(id, {
        ...assistant,
        quickReplies: assistant.quickReplies ?? [],
        style: assistant.style ?? {},
        allowedDomains: assistant.allowedDomains ?? [],
        helpDeskSettings: assistant.helpDeskSettings ?? {},
      });
    }
  }
  for (const [id, source] of store.sources) {
    if (
      !source.config ||
      !source.updatedAt ||
      source.recrawlSchedule === undefined ||
      source.lastCrawledAt === undefined ||
      source.originalObjectPath === undefined
    ) {
      store.sources.set(id, {
        ...source,
        config: source.config ?? {},
        updatedAt: source.updatedAt ?? source.createdAt,
        recrawlSchedule: source.recrawlSchedule ?? "never",
        lastCrawledAt: source.lastCrawledAt ?? null,
        originalObjectPath: source.originalObjectPath ?? null,
      });
    }
  }
  for (const [id, concept] of store.concepts) {
    if (concept.excluded === undefined || concept.recrawlSchedule === undefined) {
      store.concepts.set(id, {
        ...concept,
        excluded: concept.excluded ?? false,
        recrawlSchedule: concept.recrawlSchedule ?? null,
      });
    }
  }
  for (const [id, flow] of store.flows) {
    if (
      !flow.trigger ||
      !flow.conditions ||
      !flow.actionSettings ||
      !flow.triggerSettings
    ) {
      store.flows.set(id, {
        ...flow,
        trigger: flow.trigger ?? "message",
        triggerSettings: flow.triggerSettings ?? {},
        conditionLogic: flow.conditionLogic ?? "any",
        conditions: flow.conditions ?? [],
        actionSettings: flow.actionSettings ?? {},
      });
    }
  }
  for (const [id, conversation] of store.conversations) {
    if (!conversation.metadata || conversation.pinned === undefined) {
      store.conversations.set(id, {
        ...conversation,
        metadata: conversation.metadata ?? {},
        pinned: conversation.pinned ?? false,
      });
    }
  }
  for (const [id, channel] of store.supportChannels) {
    if (!channel.conversationData || !channel.availability) {
      store.supportChannels.set(id, {
        ...channel,
        conversationData: channel.conversationData ?? defaultChannelConversationData(),
        availability: channel.availability ?? defaultChannelAvailability(),
      });
    }
  }
  return store;
}

/**
 * The Assistant behind a Conversation, or undefined when there is none: a
 * Teammate Conversation is owned by a Teammate, so every read that reaches for
 * an Assistant (Inbox joins, Insights population, trust signals) simply misses
 * and the Conversation drops out of that read (#768).
 */
/**
 * Deleting a Conversation, and everything the schema's cascades take with it:
 * its messages, and the Improvement links those messages carry. Written once
 * so the retention sweep and the Inbox delete button agree.
 */
function dropConversation(store: MockStore, id: string): void {
  store.conversations.delete(id);
  for (const [messageId, message] of store.messages) {
    if (message.conversationId !== id) continue;
    store.messages.delete(messageId);
    for (const [linkId, link] of store.improvementMessages) {
      if (link.messageId === messageId) store.improvementMessages.delete(linkId);
    }
  }
}

function assistantOfConversation(
  conversation: Pick<Conversation, "assistantId">
): Assistant | undefined {
  return conversation.assistantId
    ? getStore().assistants.get(conversation.assistantId)
    : undefined;
}

/** Store binding per DbTableMap table, the mock's one-line cost of mapping
 * a new table onto the generic accessor (ADR-0016). */
const MOCK_TABLE_STORES: {
  [K in DbTableName]: () => Map<string, DbTableRow<K>>;
} = {
  entities: () => getStore().entities,
  cookieConsentRecords: () => getStore().cookieConsentRecords,
  skills: () => getStore().skills,
  teammates: () => getStore().teammates,
  teammateGrants: () => getStore().teammateGrants,
  teammateRosterHidden: () => getStore().teammateRosterHidden,
  teammateRoutines: () => getStore().teammateRoutines,
  teammateChannels: () => getStore().teammateChannels,
  teammateChannelParticipants: () =>
    getStore().teammateChannelParticipants,
  projects: () => getStore().projects,
  localConnectorPairings: () => getStore().localConnectorPairings,
  localConnectorDevices: () => getStore().localConnectorDevices,
  localInferenceJobs: () => getStore().localInferenceJobs,
  assistantGoals: () => getStore().goals,
  reviewRequests: () => getStore().reviewRequests,
  webhookSubscriptions: () => getStore().webhookSubscriptions,
  httpFlowRuns: () => getStore().httpFlowRuns,
};

/**
 * The FK cascades the database performs and this implementation has to mirror,
 * or the contract suite catches the two disagreeing (as it did when Teammate
 * grants arrived). Declared in one table rather than as a branch inside
 * `delete`, so a new `on delete cascade` costs a line here and nothing else.
 *
 * Only *mapped* children need an entry: a child reached through a behavioural
 * `Db` method already deletes explicitly.
 */
const MOCK_CASCADES: Partial<
  Record<
    DbTableName,
    readonly {
      rows: () => Map<string, unknown>;
      column: string;
      /** `delete` mirrors `on delete cascade`; `null` mirrors `set null`. */
      onDelete?: "delete" | "null";
    }[]
  >
> = {
  entities: [
    { rows: () => getStore().entityRecords as Map<string, unknown>, column: "entityId" },
  ],
  teammates: [
    {
      rows: () => getStore().teammateGrants as Map<string, unknown>,
      column: "teammateId",
    },
    {
      rows: () => getStore().memoryDocuments as Map<string, unknown>,
      column: "teammateId",
    },
    {
      rows: () => getStore().teammateRoutines as Map<string, unknown>,
      column: "teammateId",
    },
    {
      rows: () => getStore().teammateRosterHidden as Map<string, unknown>,
      column: "teammateId",
    },
    {
      // Hard-deleting a Teammate takes its seat in every channel; its past
      // messages stay, with `authorTeammateId` nulled below, because the
      // thread's history is not the Teammate's to take with it (#778).
      rows: () => getStore().teammateChannelParticipants as Map<string, unknown>,
      column: "teammateId",
    },
    {
      rows: () => getStore().channelMessages as Map<string, unknown>,
      column: "authorTeammateId",
      onDelete: "null",
    },
  ],
  teammateChannels: [
    {
      rows: () => getStore().teammateChannelParticipants as Map<string, unknown>,
      column: "channelId",
    },
    {
      rows: () => getStore().channelMessages as Map<string, unknown>,
      column: "channelId",
    },
  ],
  projects: [
    {
      rows: () => getStore().memoryDocuments as Map<string, unknown>,
      column: "projectId",
    },
    {
      // `on delete set null`: losing a Project detaches the Teammates that
      // read it rather than deleting them with it.
      rows: () => getStore().teammates as Map<string, unknown>,
      column: "projectId",
      onDelete: "null",
    },
    {
      // Same rule for a channel: losing the Project unbinds the thread rather
      // than deleting it.
      rows: () => getStore().teammateChannels as Map<string, unknown>,
      column: "projectId",
      onDelete: "null",
    },
    {
      // And for an Improvement: what was wrong with an answer outlives the
      // Project it was filed under.
      rows: () => getStore().improvements as Map<string, unknown>,
      column: "projectId",
      onDelete: "null",
    },
  ],
};

function mockTable<K extends DbTableName>(name: K): DbTableAccessor<K> {
  const spec = DB_TABLE_SPECS[name];
  const store = MOCK_TABLE_STORES[name] as () => Map<string, DbTableRow<K>>;
  const defined = (values: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(values).filter(([, value]) => value !== undefined)
    );
  return {
    async list(filter = {}, options) {
      const orderBy = options?.orderBy ?? spec.orderBy;
      const ascending = options?.ascending ?? spec.ascending;
      const fields = (row: DbTableRow<K>) =>
        row as unknown as Record<string, unknown>;
      const rows = [...store().values()].filter((row) =>
        Object.entries(filter).every(
          ([key, value]) => value === undefined || fields(row)[key] === value
        )
      );
      rows.sort((a, b) => {
        const av = fields(a)[orderBy] as string;
        const bv = fields(b)[orderBy] as string;
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return ascending ? cmp : -cmp;
      });
      return options?.limit === undefined ? rows : rows.slice(0, options.limit);
    },

    async get(id) {
      return store().get(id) ?? null;
    },

    async insert(values) {
      const now = new Date().toISOString();
      const row = {
        createdAt: now,
        ...(spec.touchesUpdatedAt ? { updatedAt: now } : {}),
        ...spec.defaults,
        ...defined(values as unknown as Record<string, unknown>),
        id: newTableRowId(spec),
      } as unknown as DbTableRow<K> & { id: string };
      store().set(row.id, row);
      return row;
    },

    async update(id, patch) {
      const current = store().get(id);
      if (!current) throw new Error(`${name} row ${id} not found`);
      const updated = {
        ...current,
        ...defined(patch),
        ...(spec.touchesUpdatedAt ? { updatedAt: new Date().toISOString() } : {}),
      } as DbTableRow<K>;
      store().set(id, updated);
      return updated;
    },

    async delete(id) {
      store().delete(id);
      for (const { rows, column, onDelete = "delete" } of MOCK_CASCADES[name] ?? []) {
        for (const [childId, child] of rows()) {
          const record = child as Record<string, unknown>;
          if (record[column] !== id) continue;
          if (onDelete === "null") rows().set(childId, { ...record, [column]: null });
          else rows().delete(childId);
        }
      }
    },
  };
}

/** Whether a stored document belongs to the owner a read named (#771). */
function ownerMatches(
  doc: Pick<MemoryDocument, "memberId" | "teammateId" | "projectId">,
  owner: MemoryDocumentOwner
): boolean {
  if (owner.scope === "user") return doc.memberId === owner.memberId;
  if (owner.scope === "agent") return doc.teammateId === owner.teammateId;
  return doc.projectId === owner.projectId;
}

/** One usage_daily rollup row (org retained for scoping the report reads). */
interface UsageDailyAggregate extends UsageDailyRow {
  organizationId: string;
}

/**
 * Maps a raw ledger row's pipeline stage to a usage kind. Mirrors the SQL
 * rollup's `case when stage = 'embed' then 'embedding' else 'chat'`, the two
 * must stay in lockstep (migration 20260720100000_usage_recording.sql).
 */
function usageKindOfStage(stage: AiUsageInput["stage"]): UsageDailyRow["kind"] {
  return stage === "embed" ? "embedding" : "chat";
}

/**
 * Aggregates raw ledger rows for `organizationId` (all orgs when null) into the
 * (org, day, kind, credentialKind) grouping the SQL rollup produces, keeping
 * only rows in [startDay, endDay). The single grouping seam both the rollup
 * write and the live-today read go through, so their semantics can't drift.
 */
function aggregateLedger(
  ledger: (AiUsageInput & { createdAt: string })[],
  bounds: { organizationId?: string; startDay: string; endDay: string }
): Map<string, UsageDailyAggregate> {
  const groups = new Map<string, UsageDailyAggregate>();
  for (const u of ledger) {
    if (bounds.organizationId && u.organizationId !== bounds.organizationId) {
      continue;
    }
    const day = u.createdAt.slice(0, 10);
    if (day < bounds.startDay || day >= bounds.endDay) continue;
    const key = `${u.organizationId}|${day}|${usageKindOfStage(u.stage)}|${u.credentialKind ?? "unknown"}|${u.provider}|${u.modelId}`;
    let row = groups.get(key);
    if (!row) {
      row = {
        organizationId: u.organizationId,
        day,
        kind: usageKindOfStage(u.stage),
        credentialKind: u.credentialKind ?? "unknown",
        provider: u.provider,
        modelId: u.modelId,
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        units: 0,
      };
      groups.set(key, row);
    }
    row.calls += 1;
    row.inputTokens += u.inputTokens;
    row.outputTokens += u.outputTokens;
  }
  return groups;
}

/**
 * Aggregates completed crawls into the same rollup shape: the unit is pages, the
 * provider is the crawler that ran, and the funding is always the platform's
 * (every crawler credential is the app's own). Mirrors the SQL rollup's crawl
 * branch, including ignoring failed and empty crawls, they produced no metered
 * unit, and pages are what the allowance is denominated in.
 */
function aggregateCrawls(
  events: (RuntimeEventInput & { createdAt: string })[],
  bounds: { organizationId?: string; startDay: string; endDay: string }
): Map<string, UsageDailyAggregate> {
  const groups = new Map<string, UsageDailyAggregate>();
  for (const e of events) {
    if (e.kind !== "crawl" || e.status !== "succeeded") continue;
    const pages = e.pageCount ?? 0;
    if (pages <= 0) continue;
    if (bounds.organizationId && e.organizationId !== bounds.organizationId) {
      continue;
    }
    const day = e.createdAt.slice(0, 10);
    if (day < bounds.startDay || day >= bounds.endDay) continue;
    const provider = e.crawlerProvider ?? "unknown";
    const key = `${e.organizationId}|${day}|crawl|platform|${provider}|`;
    let row = groups.get(key);
    if (!row) {
      row = {
        organizationId: e.organizationId,
        day,
        kind: "crawl",
        credentialKind: "platform",
        provider,
        modelId: "",
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        units: 0,
      };
      groups.set(key, row);
    }
    row.calls += 1;
    row.units += pages;
  }
  return groups;
}

function usageDailyRowOf(row: UsageDailyAggregate): UsageDailyRow {
  return {
    day: row.day,
    kind: row.kind,
    credentialKind: row.credentialKind,
    provider: row.provider,
    modelId: row.modelId,
    units: row.units,
    calls: row.calls,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
  };
}

/** UTC day (YYYY-MM-DD) `back` days before today; 0 = today. */
/** Milliseconds at the start of the UTC day containing `iso`. */
function startOfUtcDayMs(iso: string): number {
  const at = new Date(Date.parse(iso));
  at.setUTCHours(0, 0, 0, 0);
  return at.getTime();
}

/**
 * Splits an arbitrary [from, to) window into the part the day-grained rollup can
 * answer and the parts that must come live from the raw sources. Mirrors the
 * `cuts` CTE in org_usage_meters: whole closed days from the rollup, the partial
 * day at each end (and all of today) live, the ranges disjoint so nothing is
 * counted twice. A window with no whole closed day in it collapses to live-only.
 */
function usageWindowCuts(from: string, to: string): { cutLo: number; cutHi: number } {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const dayStart = startOfUtcDayMs(from);
  const firstFullDay = fromMs === dayStart ? dayStart : dayStart + 86_400_000;
  const rollupEnd = Math.min(
    startOfUtcDayMs(to),
    startOfUtcDayMs(new Date().toISOString())
  );
  return rollupEnd > firstFullDay
    ? { cutLo: firstFullDay, cutHi: rollupEnd }
    : { cutLo: toMs, cutHi: toMs };
}

function utcDayBack(back: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Mock-side materialization behind the bounded Inbox read model. */
function inboxConversationRows(organizationId: string): InboxConversation[] {
  const store = getStore();
  const messages = [...store.messages.values()];
  return [...store.conversations.values()]
    .filter(
      (conversation) =>
        conversation.assistantId !== null &&
        store.assistants.get(conversation.assistantId)?.organizationId ===
          organizationId,
    )
    .map((conversation): InboxConversation => {
      const { sessionState: _sessionState, ...summary } = conversation;
      const own = messages.filter(
        (message) => message.conversationId === conversation.id,
      );
      const flowNames = [
        ...new Set(
          own.map((message) => message.flowName).filter((name): name is string => !!name),
        ),
      ];
      const feedback = own.some((message) => message.feedback === 1)
        ? 1
        : own.some((message) => message.feedback === -1)
          ? -1
          : 0;
      return {
        ...summary,
        assistantTitle:
          (conversation.assistantId &&
            store.assistants.get(conversation.assistantId)?.title) ||
          "",
        collectionName: conversation.collectionId
          ? (store.collections.get(conversation.collectionId)?.name ?? null)
          : null,
        messageCount: own.length,
        flowNames,
        notificationOnly:
          own.length > 0 && own.every((message) => isProactiveMessage(message.content)),
        feedback,
      };
    })
    .sort(compareInboxConversation);
}

export const mockDb: Db = {
  // --- Organizations & membership (single demo org) -------------------

  async getCurrentOrg() {
    return { organization: getStore().organization, role: DEMO_MEMBER.role };
  },

  async listOrganizations() {
    return [getStore().organization];
  },

  async createOrganization() {
    return DEMO_ORG.id;
  },

  async updateOrganization(_organizationId, patch: OrganizationPatch) {
    const store = getStore();
    store.organization = {
      ...store.organization,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.logoUrl !== undefined ? { logoUrl: patch.logoUrl } : {}),
      ...(patch.traceRetentionDays !== undefined
        ? { traceRetentionDays: patch.traceRetentionDays }
        : {}),
      ...(patch.transcriptRetentionDays !== undefined
        ? { transcriptRetentionDays: patch.transcriptRetentionDays }
        : {}),
    };
    return store.organization;
  },

  async getProfile() {
    return getStore().profiles.get(DEMO_MEMBER.userId) ?? null;
  },

  async updateProfile(patch: ProfilePatch) {
    const store = getStore();
    const current = store.profiles.get(DEMO_MEMBER.userId) ?? {
      userId: DEMO_MEMBER.userId,
      email: DEMO_MEMBER.email,
      username: "",
      firstName: "",
      lastName: "",
      avatarUrl: null,
    };
    const updated: Profile = {
      ...current,
      ...(patch.username !== undefined ? { username: patch.username } : {}),
      ...(patch.firstName !== undefined ? { firstName: patch.firstName } : {}),
      ...(patch.lastName !== undefined ? { lastName: patch.lastName } : {}),
      ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
    };
    store.profiles.set(DEMO_MEMBER.userId, updated);
    const member = store.members.get(DEMO_MEMBER.userId);
    if (member) {
      store.members.set(DEMO_MEMBER.userId, {
        ...member,
        username: updated.username,
        firstName: updated.firstName,
        lastName: updated.lastName,
        avatarUrl: updated.avatarUrl,
      });
    }
    return updated;
  },

  async acceptInvite() {
    return DEMO_ORG.id;
  },

  async listMembers() {
    return [...getStore().members.values()];
  },

  async getMemberRole(_orgId, userId) {
    return getStore().members.get(userId)?.role ?? null;
  },

  async updateMemberRole(_orgId, userId, role) {
    const store = getStore();
    const member = store.members.get(userId);
    if (member) store.members.set(userId, { ...member, role });
  },

  async removeMember(_orgId, userId) {
    getStore().members.delete(userId);
  },

  async listInvites() {
    return [...getStore().invites.values()];
  },

  async createInvite(organizationId, role, email) {
    const invite: Invite = {
      id: shortId(),
      organizationId,
      email: email ?? "",
      role,
      token: shortId() + shortId(),
      createdAt: new Date().toISOString(),
    };
    getStore().invites.set(invite.id, invite);
    return invite;
  },

  async revokeInvite(inviteId) {
    getStore().invites.delete(inviteId);
  },

  // --- Organization API keys (#618) --------------------------------------

  async listApiKeys(organizationId) {
    return [...getStore().apiKeys.values()]
      .filter((key) => key.organizationId === organizationId)
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
      .map(({ secretHash: _secretHash, ...apiKey }) => apiKey);
  },

  async createApiKey(organizationId, input: OrgApiKeyInput) {
    const stored: OrgApiKey & { secretHash: string } = {
      id: shortId(),
      organizationId,
      name: input.name,
      secretHint: input.secretHint,
      role: input.role,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      secretHash: input.secretHash,
    };
    getStore().apiKeys.set(stored.id, stored);
    const { secretHash: _secretHash, ...apiKey } = stored;
    return apiKey;
  },

  async revokeApiKey(keyId) {
    const key = getStore().apiKeys.get(keyId);
    if (key && !key.revokedAt) key.revokedAt = new Date().toISOString();
  },

  async getApiKeyByHash(secretHash) {
    for (const stored of getStore().apiKeys.values()) {
      if (stored.secretHash === secretHash) {
        const { secretHash: _secretHash, ...apiKey } = stored;
        return apiKey;
      }
    }
    return null;
  },

  async touchApiKeyLastUsed(keyId) {
    const key = getStore().apiKeys.get(keyId);
    if (key) key.lastUsedAt = new Date().toISOString();
  },

  // --- Assistants -------------------------------------------------------

  async listAssistants(organizationId) {
    return [...getStore().assistants.values()]
      .filter((a) => a.organizationId === organizationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  },

  async listAssistantsPage(organizationId, input) {
    const limit = Math.max(1, Math.min(Math.trunc(input.limit), 100));
    const ordered = [...getStore().assistants.values()]
      .filter((assistant) => assistant.organizationId === organizationId)
      // Code-unit order, matching the `>` cursor filter below (same defect as
      // listEntitiesPage: localeCompare orders "-" differently).
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const nextIndex = input.cursor
      ? ordered.findIndex((assistant) => assistant.id > input.cursor!)
      : 0;
    const start = nextIndex < 0 ? ordered.length : nextIndex;
    const slice = ordered.slice(Math.max(0, start), Math.max(0, start) + limit + 1);
    const hasMore = slice.length > limit;
    const items = slice.slice(0, limit);
    return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
  },

  async listAssistantShellSummaries(organizationId) {
    return (await mockDb.listAssistants(organizationId)).map((assistant) => ({
      id: assistant.id,
      title: assistant.title,
      nickname: assistant.nickname,
      brandColor: assistant.style.brandColor ?? null,
      avatarUrl: assistant.avatarUrl ?? null,
    }));
  },

  async getAssistant(id) {
    return getStore().assistants.get(id) ?? null;
  },

  async createAssistant(organizationId, input: AssistantInput) {
    const now = new Date().toISOString();
    const assistant: Assistant = {
      id: shortId(),
      organizationId,
      title: input.title,
      nickname: input.nickname ?? input.title,
      description: input.description ?? "",
      welcomeMessage: DEFAULT_WELCOME_MESSAGE,
      aiDisclaimer: DEFAULT_AI_DISCLAIMER,
      suggestedQuestions: [],
      quickReplies: [],
      answeringStyle: "",
      simplifiedThinking: false,
      chatLauncherEnabled: true,
      modelProvider: "google",
      modelId: "gemini-3.5-flash",
      style: {},
      allowedDomains: [],
      helpDeskSettings: {},
      tools: {},
      requireSignIn: false,
      knowledgeEngine: "graph",
      createdAt: now,
      updatedAt: now,
    };
    const store = getStore();
    store.assistants.set(assistant.id, assistant);
    DEFAULT_FLOWS.forEach((f, i) => {
      const id = shortId();
      store.flows.set(id, {
        id,
        assistantId: assistant.id,
        position: i,
        trigger: "message",
        triggerSettings: {},
        conditionLogic: "any",
        conditions: [],
        actionSettings: {},
        ...f,
      });
    });
    return assistant;
  },

  async updateAssistant(id, patch: AssistantPatch) {
    const store = getStore();
    const current = store.assistants.get(id);
    if (!current) throw new Error(`Assistant ${id} not found`);
    const updated: Assistant = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    store.assistants.set(id, updated);
    return updated;
  },

  async deleteAssistant(id) {
    const store = getStore();
    store.assistants.delete(id);
    for (const [fid, f] of store.flows) {
      if (f.assistantId === id) store.flows.delete(fid);
    }
    for (const [key, link] of store.assistantSources) {
      if (link.assistantId === id) store.assistantSources.delete(key);
    }
  },

  async listFlows(assistantId) {
    return sortFlows(
      [...getStore().flows.values()].filter((f) => f.assistantId === assistantId)
    );
  },

  async getFlow(id) {
    return getStore().flows.get(id) ?? null;
  },

  async createFlow(assistantId, input: FlowInput) {
    const store = getStore();
    const siblings = [...store.flows.values()].filter(
      (f) => f.assistantId === assistantId && !f.isDefault
    );
    const flow: Flow = {
      id: shortId(),
      assistantId,
      name: input.name,
      description: input.description ?? "",
      builtIn: false,
      enabled: true,
      position: siblings.length,
      trigger: input.trigger ?? "message",
      triggerSettings: input.triggerSettings ?? {},
      conditionLogic: input.conditionLogic ?? "any",
      conditions: input.conditions ?? [],
      actions: input.actions ?? ["search_knowledge"],
      actionSettings: input.actionSettings ?? {},
      customMessage: input.customMessage ?? "",
      isDefault: false,
    };
    store.flows.set(flow.id, flow);
    return flow;
  },

  async updateFlow(id, patch: FlowPatch) {
    const store = getStore();
    const current = store.flows.get(id);
    if (!current) throw new Error(`Flow ${id} not found`);
    const updated: Flow = { ...current, ...patch };
    store.flows.set(id, updated);
    return updated;
  },

  async deleteFlow(id) {
    getStore().flows.delete(id);
  },

  async reorderFlows(assistantId, orderedIds) {
    const store = getStore();
    orderedIds.forEach((id, i) => {
      const flow = store.flows.get(id);
      if (flow && flow.assistantId === assistantId && !flow.isDefault) {
        store.flows.set(id, { ...flow, position: i });
      }
    });
  },

  // --- Help desks ---------------------------------------------------------

  async listHelpDesks(organizationId) {
    return [...getStore().helpDesks.values()]
      .filter((d) => d.organizationId === organizationId)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async getHelpDesk(id) {
    return getStore().helpDesks.get(id) ?? null;
  },

  async createHelpDesk(organizationId, input) {
    const now = new Date().toISOString();
    const desk: HelpDesk = {
      id: shortId(),
      organizationId,
      name: input.name,
      description: input.description ?? "",
      autoGenerateImprovements: false,
      ticketingIntegration: null,
      createdAt: now,
      updatedAt: now,
    };
    getStore().helpDesks.set(desk.id, desk);
    return desk;
  },

  async updateHelpDesk(id, patch) {
    const store = getStore();
    const current = store.helpDesks.get(id);
    if (!current) throw new Error(`Help desk ${id} not found`);
    const updated: HelpDesk = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    store.helpDesks.set(id, updated);
    return updated;
  },

  async deleteHelpDesk(id) {
    const store = getStore();
    store.helpDesks.delete(id);
    for (const [cid, channel] of store.supportChannels) {
      if (channel.helpDeskId === id) store.supportChannels.delete(cid);
    }
  },

  async listSupportChannels(helpDeskId) {
    return [...getStore().supportChannels.values()]
      .filter((c) => c.helpDeskId === helpDeskId)
      .sort((a, b) => a.position - b.position);
  },

  async createSupportChannel(helpDeskId, input) {
    const store = getStore();
    const siblings = [...store.supportChannels.values()].filter(
      (c) => c.helpDeskId === helpDeskId
    );
    const now = new Date().toISOString();
    const channel: SupportChannel = {
      id: shortId(),
      helpDeskId,
      kind: input.kind,
      name: input.name,
      position: siblings.length,
      enabled: true,
      config: input.config ?? {},
      formTitle: input.formTitle ?? "Send us a message",
      form: input.form ?? [],
      confirmationMessage: input.confirmationMessage ?? "",
      conversationData: input.conversationData ?? defaultChannelConversationData(),
      availability: input.availability ?? defaultChannelAvailability(),
      createdAt: now,
      updatedAt: now,
    };
    store.supportChannels.set(channel.id, channel);
    return channel;
  },

  async updateSupportChannel(id, patch) {
    const store = getStore();
    const current = store.supportChannels.get(id);
    if (!current) throw new Error(`Support channel ${id} not found`);
    const updated: SupportChannel = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    store.supportChannels.set(id, updated);
    return updated;
  },

  async deleteSupportChannel(id) {
    getStore().supportChannels.delete(id);
  },

  async reorderSupportChannels(helpDeskId, orderedIds) {
    const store = getStore();
    orderedIds.forEach((id, i) => {
      const channel = store.supportChannels.get(id);
      if (channel && channel.helpDeskId === helpDeskId) {
        store.supportChannels.set(id, { ...channel, position: i });
      }
    });
  },

  async setTicketingIntegration(helpDeskId, input) {
    const store = getStore();
    const current = store.helpDesks.get(helpDeskId);
    if (!current) throw new Error(`Help desk ${helpDeskId} not found`);
    const integration: TicketingIntegration = {
      id: shortId(),
      platform: input.platform,
      name: input.name,
      connectedAt: new Date().toISOString(),
      config: input.config,
    };
    const updated: HelpDesk = {
      ...current,
      ticketingIntegration: integration,
      updatedAt: new Date().toISOString(),
    };
    store.helpDesks.set(helpDeskId, updated);
    return updated;
  },

  async clearTicketingIntegration(helpDeskId) {
    const store = getStore();
    const current = store.helpDesks.get(helpDeskId);
    if (!current) throw new Error(`Help desk ${helpDeskId} not found`);
    const updated: HelpDesk = {
      ...current,
      ticketingIntegration: null,
      updatedAt: new Date().toISOString(),
    };
    store.helpDesks.set(helpDeskId, updated);
    return updated;
  },

  // --- Widget SSO connections -------------------------------------------

  async getSsoConnection(organizationId) {
    return getStore().ssoConnections.get(organizationId) ?? null;
  },

  async getSsoConnectionPublic(organizationId) {
    const current = getStore().ssoConnections.get(organizationId);
    return current ? { provider: current.provider } : null;
  },

  async setSsoConnection(organizationId, input) {
    const store = getStore();
    const now = new Date().toISOString();
    const existing = store.ssoConnections.get(organizationId);
    // One connection per org: replace wholesale, resetting validation.
    const connection: SsoConnection = {
      id: existing?.id ?? shortId(),
      organizationId,
      provider: input.provider,
      config: input.config,
      encryptedSecret: input.encryptedSecret ?? null,
      validationStatus: "unvalidated",
      validatedAt: null,
      // Preserve first-connected time across rotations (matches the SQL upsert).
      connectedAt: existing?.connectedAt ?? now,
      updatedAt: now,
    };
    store.ssoConnections.set(organizationId, connection);
    return connection;
  },

  async setSsoConnectionValidation(organizationId, status) {
    const store = getStore();
    const current = store.ssoConnections.get(organizationId);
    if (!current)
      throw new Error(`SSO connection for org ${organizationId} not found`);
    const updated: SsoConnection = {
      ...current,
      validationStatus: status,
      validatedAt: status === "unvalidated" ? null : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.ssoConnections.set(organizationId, updated);
    return updated;
  },

  async clearSsoConnection(organizationId) {
    getStore().ssoConnections.delete(organizationId);
  },

  // --- API integrations (spec #559) --------------------------------------

  async getApiIntegration(assistantId) {
    return getStore().apiIntegrations.get(assistantId) ?? null;
  },

  async setApiIntegration(input) {
    const store = getStore();
    const now = new Date().toISOString();
    const existing = store.apiIntegrations.get(input.assistantId);
    const integration: ApiIntegration = {
      assistantId: input.assistantId,
      organizationId: input.organizationId,
      name: input.name,
      baseUrl: input.baseUrl,
      authType: input.authType,
      authHeaderName: input.authHeaderName ?? "",
      authUsername: input.authUsername ?? "",
      // Omitted keeps the stored credential (matches the SQL upsert, which
      // leaves the column out of the row entirely); null clears it.
      encryptedCredential:
        input.encryptedCredential === undefined
          ? (existing?.encryptedCredential ?? null)
          : input.encryptedCredential,
      endpoints: input.endpoints,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    store.apiIntegrations.set(input.assistantId, integration);
    return integration;
  },

  async deleteApiIntegration(assistantId) {
    getStore().apiIntegrations.delete(assistantId);
  },

  // --- Provider connections ---------------------------------------------

  async listProviderConnections(organizationId) {
    const store = getStore();
    const chosen = store.embeddingConnections.get(organizationId) ?? null;
    return [...store.connections.values()]
      .filter((c) => c.organizationId === organizationId)
      .map((c) => ({ ...c, preferredForEmbedding: c.id === chosen }));
  },

  async getEmbeddingConnectionId(organizationId) {
    return getStore().embeddingConnections.get(organizationId) ?? null;
  },

  async setEmbeddingConnectionId(organizationId, connectionId) {
    const store = getStore();
    if (connectionId) {
      const connection = store.connections.get(connectionId);
      if (!connection || connection.organizationId !== organizationId) {
        throw new Error("connection does not belong to this organization");
      }
      store.embeddingConnections.set(organizationId, connectionId);
    } else {
      store.embeddingConnections.delete(organizationId);
    }
  },

  async createProviderConnection(organizationId, input) {
    const connection: ProviderConnection = {
      id: shortId(),
      organizationId,
      type: input.type,
      provider: input.provider,
      displayName: input.displayName ?? "",
      encryptedKey: input.encryptedKey ?? null,
      keyHint: input.keyHint ?? "",
      config: input.config ?? {},
      createdBy: input.createdBy ?? null,
      createdAt: new Date().toISOString(),
      // A new connection never silently becomes the embedding choice.
      preferredForEmbedding: false,
    };
    getStore().connections.set(connection.id, connection);
    return connection;
  },

  async deleteProviderConnection(id) {
    const store = getStore();
    const connection = store.connections.get(id);
    store.connections.delete(id);
    // Mirrors the FK's `on delete set null`: losing the chosen connection
    // returns the org to the automatic embedding order (#437).
    if (connection && store.embeddingConnections.get(connection.organizationId) === id) {
      store.embeddingConnections.delete(connection.organizationId);
    }
  },

  // --- Knowledge (OKF collections) ------------------------------------------

  async listOrgCollections(organizationId) {
    return [...getStore().collections.values()]
      .filter((c) => c.organizationId === organizationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  },

  async listCollections(assistantId) {
    // Derived membership (PRD #726 contract): the Collections holding
    // Sources linked to this Assistant.
    const store = getStore();
    const collectionIds = new Set<string>();
    for (const link of store.assistantSources.values()) {
      if (link.assistantId !== assistantId) continue;
      const source = store.sources.get(link.sourceId);
      if (source) collectionIds.add(source.collectionId);
    }
    return [...store.collections.values()]
      .filter((c) => collectionIds.has(c.id))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  },

  async getCollection(id) {
    return getStore().collections.get(id) ?? null;
  },

  async getOrCreateOrgLibraryCollection(organizationId) {
    const store = getStore();
    const id = `org-library-${organizationId}`;
    const existing = store.collections.get(id);
    if (existing) return existing;
    const collection: KnowledgeCollection = {
      id,
      organizationId,
      name: "Knowledge Library",
      description: "Organization-wide knowledge added from the Knowledge hub",
      createdAt: new Date().toISOString(),
    };
    store.collections.set(id, collection);
    return collection;
  },

  async createCollection(assistantId, input) {
    const store = getStore();
    const collection: KnowledgeCollection = {
      id: shortId(),
      organizationId: store.assistants.get(assistantId)?.organizationId ?? "",
      name: input.name,
      description: input.description ?? "",
      createdAt: new Date().toISOString(),
    };
    store.collections.set(collection.id, collection);
    return collection;
  },

  async deleteCollection(id) {
    const store = getStore();
    store.collections.delete(id);
    for (const [sid, s] of store.sources)
      if (s.collectionId === id) {
        store.sources.delete(sid);
        for (const [key, link] of store.assistantSources)
          if (link.sourceId === sid) store.assistantSources.delete(key);
      }
    for (const [cid, c] of store.concepts)
      if (c.collectionId === id) store.concepts.delete(cid);
    for (const [kid, k] of store.chunks)
      if (k.collectionId === id) store.chunks.delete(kid);
  },

  async listSources(collectionId) {
    return [...getStore().sources.values()]
      .filter((s) => s.collectionId === collectionId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  },

  async createSource(input) {
    const store = getStore();
    const now = new Date().toISOString();
    const source: Source = {
      id: input.id ?? shortId(),
      collectionId: input.collectionId,
      name: input.name,
      kind: input.kind,
      status: "processing",
      error: "",
      config: input.config ?? {},
      recrawlSchedule: input.recrawlSchedule ?? "never",
      lastCrawledAt: null,
      originalObjectPath: input.originalObjectPath ?? null,
      activeGenerationId: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    store.sources.set(source.id, source);
    // No implicit link: callers (the ops layer) link Assistants explicitly,
    // mirroring the supabase adapter (PRD #726 contract).
    return source;
  },

  async updateSource(id, patch) {
    const store = getStore();
    const source = store.sources.get(id);
    if (source)
      store.sources.set(id, {
        ...source,
        ...patch,
        updatedAt: new Date().toISOString(),
      });
  },

  async getSource(id) {
    return getStore().sources.get(id) ?? null;
  },

  async createApplicationOAuthNonce(input) {
    getStore().applicationOAuthNonces.set(input.nonce, {
      organizationId: input.organizationId,
      memberId: input.memberId,
      expiresAt: input.expiresAt,
      consumedAt: null,
    });
  },

  async consumeApplicationOAuthNonce(input) {
    const current = getStore().applicationOAuthNonces.get(input.nonce);
    if (
      !current ||
      current.consumedAt ||
      current.organizationId !== input.organizationId ||
      current.memberId !== input.memberId ||
      current.expiresAt <= input.consumedAt
    ) {
      return false;
    }
    getStore().applicationOAuthNonces.set(input.nonce, {
      ...current,
      consumedAt: input.consumedAt,
    });
    return true;
  },

  async listApplicationConnections(organizationId) {
    return [...getStore().applicationConnections.values()]
      .filter((connection) => connection.organizationId === organizationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((connection) => ({ ...connection, sealedCredentials: "" }));
  },

  async getApplicationConnection(id) {
    return getStore().applicationConnections.get(id) ?? null;
  },

  async getSafeApplicationConnection(id) {
    const connection = getStore().applicationConnections.get(id);
    return connection ? { ...connection, sealedCredentials: "" } : null;
  },

  async createApplicationConnection(input) {
    const now = new Date().toISOString();
    const owner = resolveApplicationConnectionOwner(
      input.provider,
      input.ownerMemberId
    );
    const connection: ApplicationConnection = {
      id: shortId(),
      organizationId: input.organizationId,
      ...owner,
      provider: input.provider,
      name: input.name,
      status: "connected",
      sealedCredentials: input.sealedCredentials,
      scopes: input.scopes ?? [],
      providerAccountId: input.providerAccountId ?? null,
      metadata: input.metadata ?? {},
      error: "",
      lastConnectedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    getStore().applicationConnections.set(connection.id, connection);
    return connection;
  },

  async updateApplicationConnection(id, patch) {
    const store = getStore();
    const current = store.applicationConnections.get(id);
    if (!current) return;
    store.applicationConnections.set(id, {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  },

  async deleteApplicationConnection(id) {
    const store = getStore();
    store.applicationConnections.delete(id);
    for (const applicationImport of [...store.applicationImports.values()]) {
      if (applicationImport.connectionId === id) {
        await mockDb.deleteApplicationImport(applicationImport.id);
      }
    }
  },

  async listApplicationImports(organizationId) {
    return [...getStore().applicationImports.values()]
      .filter((applicationImport) => applicationImport.organizationId === organizationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async getApplicationImport(id) {
    return getStore().applicationImports.get(id) ?? null;
  },

  async acquireApplicationImportSync(id, organizationId) {
    const store = getStore();
    const current = store.applicationImports.get(id);
    if (
      !current ||
      current.organizationId !== organizationId ||
      !current.enabled
    ) {
      return null;
    }
    const acquired: ApplicationImport = {
      ...current,
      status: "syncing",
      error: "",
      updatedAt: new Date().toISOString(),
    };
    store.applicationImports.set(id, acquired);
    return acquired;
  },

  async createApplicationImport(input) {
    const now = new Date().toISOString();
    const applicationImport: ApplicationImport = {
      id: shortId(),
      organizationId: input.organizationId,
      connectionId: input.connectionId,
      collectionId: input.collectionId,
      name: input.name,
      config: input.config ?? {},
      cadence: input.cadence ?? "manual",
      enabled: input.enabled ?? true,
      status: "idle",
      checkpoint: {},
      error: "",
      lastSyncedAt: null,
      nextSyncAt: null,
      reservedBytes: 0,
      assistantIds: [...new Set(input.assistantIds ?? [])],
      createdAt: now,
      updatedAt: now,
    };
    getStore().applicationImports.set(applicationImport.id, applicationImport);
    return applicationImport;
  },

  async updateApplicationImport(id, patch) {
    const store = getStore();
    const current = store.applicationImports.get(id);
    if (!current) return;
    if (patch.config !== undefined && current.status === "syncing") {
      throw new Error(
        "Wait for the current synchronization before editing this Import"
      );
    }
    if (patch.resetSources) {
      const removedAt = new Date().toISOString();
      for (const [key, mapping] of store.applicationSources) {
        if (mapping.importId !== id || !mapping.sourceId) continue;
        await mockDb.deleteSource(mapping.sourceId);
        store.applicationSources.set(key, {
          ...mapping,
          sourceId: null,
          removedAt,
          updatedAt: removedAt,
        });
      }
    }
    const { resetSources: _resetSources, ...storedPatch } = patch;
    store.applicationImports.set(id, {
      ...current,
      ...storedPatch,
      assistantIds:
        patch.assistantIds === undefined
          ? current.assistantIds
          : [...new Set(patch.assistantIds)],
      reservedBytes: patch.resetSources ? 0 : current.reservedBytes,
      updatedAt: new Date().toISOString(),
    });
    if (patch.assistantIds !== undefined) {
      for (const mapping of store.applicationSources.values()) {
        if (mapping.importId === id && mapping.sourceId) {
          await mockDb.setSourceAssistantLinks(mapping.sourceId, patch.assistantIds);
        }
      }
    }
  },

  async deleteApplicationImport(id) {
    const store = getStore();
    store.applicationImports.delete(id);
    for (const [key, mapping] of store.applicationSources) {
      if (mapping.importId !== id) continue;
      store.applicationSources.delete(key);
      if (mapping.sourceId) await mockDb.deleteSource(mapping.sourceId);
    }
    for (const [key, run] of store.applicationSyncRuns) {
      if (run.importId === id) store.applicationSyncRuns.delete(key);
    }
  },

  async listDueApplicationImports(now, limit) {
    const nowMs = new Date(now).getTime();
    return [...getStore().applicationImports.values()]
      .filter(
        (applicationImport) =>
          applicationImport.enabled &&
          (applicationImport.status === "syncing" ||
            (applicationImport.cadence === "daily" &&
              (!applicationImport.nextSyncAt ||
                new Date(applicationImport.nextSyncAt).getTime() <= nowMs)))
      )
      .sort((a, b) =>
        (a.nextSyncAt ?? "").localeCompare(b.nextSyncAt ?? "")
      )
      .slice(0, limit);
  },

  async listApplicationSources(importId) {
    return [...getStore().applicationSources.values()]
      .filter((mapping) => mapping.importId === importId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async upsertApplicationSource(input) {
    const store = getStore();
    const key = `${input.importId}:${input.remoteId}`;
    const now = new Date().toISOString();
    const current = store.applicationSources.get(key);
    const mapping: ApplicationSource = {
      id: current?.id ?? shortId(),
      importId: input.importId,
      sourceId: input.sourceId,
      remoteId: input.remoteId,
      canonicalUrl: input.canonicalUrl ?? null,
      revision: input.revision ?? null,
      contentHash: input.contentHash,
      contentBytes: input.contentBytes ?? 0,
      remoteMimeType: input.remoteMimeType ?? null,
      remoteUpdatedAt: input.remoteUpdatedAt ?? null,
      lastSeenAt: input.lastSeenAt,
      removedAt: null,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    store.applicationSources.set(key, mapping);
    return mapping;
  },

  async reserveApplicationKnowledgeBytes(input) {
    const store = getStore();
    const target = store.applicationImports.get(input.importId);
    if (
      !target ||
      target.organizationId !== input.organizationId ||
      !target.enabled
    ) {
      return false;
    }
    const otherBytes = [...store.applicationImports.values()]
      .filter(
        (item) =>
          item.organizationId === input.organizationId &&
          item.id !== input.importId
      )
      .reduce((sum, item) => sum + item.reservedBytes, 0);
    if (otherBytes + input.projectedBytes > input.limitBytes) return false;
    store.applicationImports.set(input.importId, {
      ...target,
      reservedBytes: input.projectedBytes,
      updatedAt: new Date().toISOString(),
    });
    return true;
  },

  async syncApplicationSourceAssistantScope(importId, sourceId) {
    const applicationImport = getStore().applicationImports.get(importId);
    if (!applicationImport) throw new Error("Application Import not found");
    await mockDb.setSourceAssistantLinks(sourceId, applicationImport.assistantIds);
  },

  async markApplicationSourceRemoved(importId, remoteId, removedAt) {
    const store = getStore();
    const key = `${importId}:${remoteId}`;
    const mapping = store.applicationSources.get(key);
    if (!mapping) return;
    store.applicationSources.set(key, {
      ...mapping,
      removedAt,
      updatedAt: new Date().toISOString(),
    });
  },

  async recordApplicationSyncRun(importId, input) {
    const run: ApplicationSyncRun = { id: shortId(), importId, ...input };
    getStore().applicationSyncRuns.set(run.id, run);
    return run;
  },

  async listApplicationSyncRuns(importId) {
    return [...getStore().applicationSyncRuns.values()]
      .filter((run) => run.importId === importId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  },

  async listApplicationOperationalState(organizationId) {
    const imports = await mockDb.listApplicationImports(organizationId);
    return Promise.all(
      imports.map(async (applicationImport) => ({
        importId: applicationImport.id,
        lastRun: (await mockDb.listApplicationSyncRuns(applicationImport.id))[0] ?? null,
        sourceCount: (await mockDb.listApplicationSources(applicationImport.id))
          .filter((mapping) => mapping.sourceId).length,
      }))
    );
  },

  async getApplicationHealthSummary(organizationId) {
    const connections = await mockDb.listApplicationConnections(organizationId);
    const imports = await mockDb.listApplicationImports(organizationId);
    return {
      connected: connections.filter((item) => item.status === "connected").length,
      pending: connections.filter((item) => item.status === "pending").length,
      attention:
        connections.filter((item) => ["error", "reauthorization_required"].includes(item.status)).length +
        imports.filter((item) => item.status === "error").length,
      syncing: imports.filter((item) => item.status === "syncing").length,
      ready: imports.filter((item) => item.status === "ready").length,
    };
  },

  async createBackgroundJob(input) {
    if (input.id) {
      const existing = getStore().backgroundJobs.get(input.id);
      if (existing) return existing;
    }
    const now = new Date().toISOString();
    const payload = input.payload;
    const source = input.sourceId
      ? getStore().sources.get(input.sourceId)
      : null;
    const sourceCollection = source
      ? getStore().collections.get(source.collectionId)
      : null;
    const payloadCollection =
      typeof payload.collectionId === "string"
        ? getStore().collections.get(payload.collectionId)
        : null;
    const payloadSource =
      typeof payload.sourceId === "string"
        ? getStore().sources.get(payload.sourceId)
        : null;
    const payloadSourceCollection = payloadSource
      ? getStore().collections.get(payloadSource.collectionId)
      : null;
    const payloadAssistant =
      typeof payload.assistantId === "string"
        ? getStore().assistants.get(payload.assistantId)
        : null;
    const payloadConcept =
      typeof payload.conceptId === "string"
        ? getStore().concepts.get(payload.conceptId)
        : null;
    const payloadConceptCollection = payloadConcept
      ? getStore().collections.get(payloadConcept.collectionId)
      : null;
    const improvement =
      typeof payload.improvementId === "string"
        ? getStore().improvements.get(payload.improvementId)
        : null;
    const entity =
      typeof payload.entityId === "string"
        ? getStore().entities.get(payload.entityId)
        : null;
    const conversation =
      typeof payload.conversationId === "string"
        ? getStore().conversations.get(payload.conversationId)
        : null;
    const message =
      typeof payload.messageId === "string"
        ? getStore().messages.get(payload.messageId)
        : null;
    const messageConversation = message
      ? getStore().conversations.get(message.conversationId)
      : null;
    const payloadTeammate =
      typeof payload.teammateId === "string"
        ? getStore().teammates.get(payload.teammateId)
        : null;
    const conversationOrganization = (
      item: Conversation | null | undefined
    ) =>
      item?.assistantId
        ? getStore().assistants.get(item.assistantId)?.organizationId
        : item?.teammateId
          ? getStore().teammates.get(item.teammateId)?.organizationId
          : undefined;
    if (input.sourceId && !source)
      throw new Error("Background job Source not found");
    if (
      typeof payload.collectionId === "string" &&
      !payloadCollection &&
      !(
        input.organizationId &&
        payload.kind === "graph_sync_concept" &&
        payload.op === "purge"
      )
    ) throw new Error("Background job Collection not found");
    if (typeof payload.improvementId === "string" && !improvement)
      throw new Error("Background job Improvement not found");
    if (typeof payload.entityId === "string" && !entity)
      throw new Error("Background job Entity not found");
    if (typeof payload.conversationId === "string" && !conversation)
      throw new Error("Background job Conversation not found");
    if (typeof payload.sourceId === "string" && !payloadSource)
      throw new Error("Background job payload Source not found");
    if (typeof payload.assistantId === "string" && !payloadAssistant)
      throw new Error("Background job Assistant not found");
    if (
      typeof payload.conceptId === "string" &&
      !payloadConcept &&
      !(payload.kind === "graph_sync_concept" && payload.op === "remove")
    )
      throw new Error("Background job Concept not found");
    if (typeof payload.messageId === "string" && !message)
      throw new Error("Background job Message not found");
    if (typeof payload.teammateId === "string" && !payloadTeammate)
      throw new Error("Background job Teammate not found");
    if (input.sourceId && payloadSource && input.sourceId !== payloadSource.id)
      throw new Error("Background job Source references disagree");
    if (
      payloadSource &&
      typeof payload.collectionId === "string" &&
      payloadSource.collectionId !== payload.collectionId
    ) throw new Error("Background job Source belongs to another Collection");
    if (
      payloadConcept &&
      typeof payload.collectionId === "string" &&
      payloadConcept.collectionId !== payload.collectionId
    ) throw new Error("Background job Concept belongs to another Collection");
    if (
      message &&
      typeof payload.conversationId === "string" &&
      message.conversationId !== payload.conversationId
    ) throw new Error("Background job Message belongs to another Conversation");
    if (
      payloadTeammate &&
      conversation &&
      conversation.teammateId !== payloadTeammate.id
    ) throw new Error("Background job Conversation belongs to another Teammate");
    if (
      improvement &&
      message &&
      ![...getStore().improvementMessages.values()].some(
        (link) =>
          link.improvementId === improvement.id && link.messageId === message.id
      )
    ) throw new Error("Background job Message is not linked to Improvement");
    const referencedOrganizations = [
      typeof payload.organizationId === "string" ? payload.organizationId : null,
      sourceCollection?.organizationId,
      payloadCollection?.organizationId,
      payloadSourceCollection?.organizationId,
      payloadAssistant?.organizationId,
      payloadConceptCollection?.organizationId,
      improvement?.organizationId,
      entity?.organizationId,
      conversationOrganization(conversation),
      conversationOrganization(messageConversation),
      payloadTeammate?.organizationId,
    ].filter((value): value is string => Boolean(value));
    if (new Set(referencedOrganizations).size > 1) {
      throw new Error("Background job references cross Organization boundaries");
    }
    const referencedOrganization = referencedOrganizations[0];
    if (
      input.organizationId &&
      referencedOrganization &&
      input.organizationId !== referencedOrganization
    ) {
      throw new Error("Background job references cross Organization boundaries");
    }
    const organizationId = input.organizationId ?? referencedOrganization;
    if (!organizationId) throw new Error("Background job organization could not be resolved");
    const job: BackgroundJob = {
      id: input.id ?? shortId(),
      organizationId,
      kind: input.kind,
      sourceId: input.sourceId ?? null,
      status: "queued",
      payload,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      nextRunAt: input.nextRunAt ?? now,
      lockedAt: null,
      lockedBy: null,
      leaseToken: null,
      error: "",
      createdAt: now,
      updatedAt: now,
    };
    getStore().backgroundJobs.set(job.id, job);
    return job;
  },

  async stageSourceIngestJob(input) {
    const store = getStore();
    for (const [id, job] of store.backgroundJobs) {
      if (
        job.kind === "ingest_source" &&
        job.sourceId === input.sourceId &&
        (job.status === "queued" || job.status === "running")
      ) {
        store.backgroundJobs.set(id, {
          ...job,
          status: "failed",
          error: "Superseded by a newer Source revision",
          lockedAt: null,
          lockedBy: null,
          leaseToken: null,
        });
      }
    }
    const versions = [...store.sourceIngestPayloads.entries()]
      .filter(([key]) => key.startsWith(`${input.sourceId}:`))
      .map(([, payload]) => payload.version);
    const version = Math.max(0, ...versions) + 1;
    store.sourceIngestPayloads.set(`${input.sourceId}:${version}`, {
      version,
      rawText: input.rawText,
      drafts: null,
      generationId: null,
      expectedActiveGenerationId: null,
      cursor: 0,
    });
    await this.createBackgroundJob({
      kind: "ingest_source",
      sourceId: input.sourceId,
      payload: {
        kind: "ingest_source",
        assistantId: input.assistantId,
        collectionId: input.collectionId,
        sourceId: input.sourceId,
        payloadVersion: version,
      },
    });
    return version;
  },

  async upgradeLegacySourceIngestJob(input) {
    const store = getStore();
    const job = store.backgroundJobs.get(input.jobId);
    if (
      !job ||
      job.status !== "running" ||
      job.leaseToken !== input.leaseToken ||
      job.sourceId !== input.sourceId
    ) {
      return null;
    }
    const versions = [...store.sourceIngestPayloads.entries()]
      .filter(([key]) => key.startsWith(`${input.sourceId}:`))
      .map(([, payload]) => payload.version);
    const version = Math.max(0, ...versions) + 1;
    store.sourceIngestPayloads.set(`${input.sourceId}:${version}`, {
      version,
      rawText: input.rawText,
      drafts: null,
      generationId: null,
      expectedActiveGenerationId: null,
      cursor: 0,
    });
    store.backgroundJobs.set(input.jobId, {
      ...job,
      payload: {
        kind: "ingest_source",
        assistantId: input.assistantId,
        collectionId: input.collectionId,
        sourceId: input.sourceId,
        payloadVersion: version,
      },
      updatedAt: input.now,
    });
    return version;
  },

  async getSourceIngestPayload(sourceId, version) {
    const payloads = [...getStore().sourceIngestPayloads.entries()]
      .filter(([key]) => key.startsWith(`${sourceId}:`))
      .map(([, payload]) => payload)
      .filter((payload) => version === undefined || payload.version === version)
      .sort((a, b) => b.version - a.version);
    const payload = payloads[0];
    return payload
      ? { version: payload.version, rawText: payload.rawText, drafts: payload.drafts }
      : null;
  },

  async initializeSourceIngestAttempt(input) {
    const job = getStore().backgroundJobs.get(input.jobId);
    if (
      !job ||
      job.status !== "running" ||
      job.leaseToken !== input.leaseToken ||
      job.sourceId !== input.sourceId ||
      Number(job.payload.payloadVersion) !== input.version
    ) {
      return null;
    }
    const key = `${input.sourceId}:${input.version}`;
    const payload = getStore().sourceIngestPayloads.get(key);
    if (!payload) throw new Error("Ingest payload not found");
    if (!payload.drafts) {
      const source = getStore().sources.get(input.sourceId);
      if (!source) throw new Error("Ingest Source not found");
      payload.drafts = structuredClone(input.drafts);
      payload.generationId = crypto.randomUUID();
      payload.expectedActiveGenerationId = source.activeGenerationId;
      payload.cursor = 0;
    }
    return {
      drafts: structuredClone(payload.drafts),
      generationId: payload.generationId!,
      expectedActiveGenerationId: payload.expectedActiveGenerationId!,
      cursor: payload.cursor,
    };
  },

  async checkpointSourceIngestCursor(input) {
    const job = getStore().backgroundJobs.get(input.jobId);
    const payload = getStore().sourceIngestPayloads.get(
      `${input.sourceId}:${input.version}`
    );
    if (
      !job ||
      job.status !== "running" ||
      job.leaseToken !== input.leaseToken ||
      job.sourceId !== input.sourceId ||
      Number(job.payload.payloadVersion) !== input.version ||
      !payload ||
      payload.generationId !== input.generationId ||
      input.cursor < payload.cursor
    ) {
      return false;
    }
    payload.cursor = input.cursor;
    return true;
  },

  async commitSourceIngestGeneration(input) {
    const job = getStore().backgroundJobs.get(input.jobId);
    if (
      !job ||
      job.status !== "running" ||
      job.leaseToken !== input.leaseToken ||
      job.sourceId !== input.sourceId ||
      Number(job.payload.payloadVersion) !== input.version
    ) {
      return false;
    }
    return this.commitSourceKnowledgeGeneration({
      sourceId: input.sourceId,
      expectedActiveGenerationId: input.expectedActiveGenerationId,
      generationId: input.generationId,
    });
  },

  async listBackgroundJobsForSource(sourceId, kind) {
    return [...getStore().backgroundJobs.values()]
      .filter((job) => job.sourceId === sourceId && (!kind || job.kind === kind))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  async claimBackgroundJobs(input) {
    const store = getStore();
    const claimed: BackgroundJob[] = [];
    const eligible = [...store.backgroundJobs.values()].filter((job) => {
      if (job.kind !== input.kind) return false;
      const queuedAndDue = job.status === "queued" && job.nextRunAt <= input.now;
      const runningAndStale =
        job.status === "running" && Boolean(job.lockedAt) && job.lockedAt! <= input.staleBefore;
      return queuedAndDue || runningAndStale;
    });
    const groups = new Map<string, BackgroundJob[]>();
    for (const job of eligible) {
      const tenant = job.organizationId;
      const group = groups.get(tenant) ?? [];
      group.push(job);
      groups.set(job.organizationId, group);
    }
    for (const group of groups.values()) {
      group.sort((a, b) =>
        (a.status === "queued" ? a.nextRunAt : a.lockedAt!)
          .localeCompare(b.status === "queued" ? b.nextRunAt : b.lockedAt!)
      );
    }
    const ordered: BackgroundJob[] = [];
    for (let position = 0; ordered.length < eligible.length; position += 1) {
      for (const group of groups.values()) if (group[position]) ordered.push(group[position]);
    }
    for (const job of ordered) {
      if (claimed.length >= input.limit) break;
      const updated: BackgroundJob = {
        ...job,
        status: "running",
        attempts:
          job.status === "running" && job.attempts >= job.maxAttempts
            ? job.attempts
            : job.attempts + 1,
        lockedAt: input.now,
        lockedBy: input.workerId,
        leaseToken: crypto.randomUUID(),
        error: "",
        updatedAt: input.now,
      };
      store.backgroundJobs.set(job.id, updated);
      claimed.push(updated);
    }
    return claimed;
  },

  async claimTerminalBackgroundJobs(input) {
    const store = getStore();
    const claimed: BackgroundJob[] = [];
    for (const job of store.backgroundJobs.values()) {
      const terminalLease =
        job.kind === input.kind &&
        job.status === "running" &&
        Boolean(job.lockedAt) &&
        job.lockedAt! <= input.staleBefore &&
        job.attempts >= job.maxAttempts;
      if (!terminalLease) continue;
      if (claimed.length >= Math.max(input.limit, 0)) break;
      const updated: BackgroundJob = {
        ...job,
        error: "Worker lease expired after final attempt",
        lockedAt: input.now,
        lockedBy: input.workerId,
        leaseToken: crypto.randomUUID(),
        updatedAt: input.now,
      };
      store.backgroundJobs.set(job.id, updated);
      claimed.push(updated);
    }
    return claimed;
  },

  async settleBackgroundJob(input) {
    const store = getStore();
    const job = store.backgroundJobs.get(input.id);
    if (
      !job ||
      job.status !== "running" ||
      job.leaseToken !== input.leaseToken
    ) {
      return false;
    }
    store.backgroundJobs.set(input.id, {
      ...job,
      status: input.outcome.status,
      error: "error" in input.outcome ? input.outcome.error : "",
      nextRunAt:
        input.outcome.status === "queued"
          ? input.outcome.nextRunAt
          : job.nextRunAt,
      lockedAt: null,
      lockedBy: null,
      leaseToken: null,
      updatedAt: input.now,
    });
    return true;
  },

  async settleApplicationSyncJobSuccess(input) {
    const store = getStore();
    const job = store.backgroundJobs.get(input.id);
    if (
      !job ||
      job.status !== "running" ||
      job.leaseToken !== input.leaseToken
    ) {
      return false;
    }
    try {
      store.backgroundJobs.set(input.id, {
        ...job,
        status: "succeeded",
        error: "",
        lockedAt: null,
        lockedBy: null,
        leaseToken: null,
        updatedAt: input.now,
      });
      const applicationImport = store.applicationImports.get(input.importId);
      if (applicationImport?.enabled && applicationImport.status === "syncing") {
        await this.createApplicationSyncJobIfAbsent({
          importId: input.importId,
          organizationId: input.organizationId,
          nextRunAt: input.now,
          maxConcurrent: input.maxConcurrent,
        });
      }
    } catch (error) {
      store.backgroundJobs.set(input.id, job);
      throw error;
    }
    return true;
  },

  async renewBackgroundJobLease(input) {
    const store = getStore();
    const job = store.backgroundJobs.get(input.id);
    if (!job || job.status !== "running" || job.leaseToken !== input.leaseToken) {
      return false;
    }
    store.backgroundJobs.set(input.id, {
      ...job,
      lockedAt: input.now,
      updatedAt: input.now,
    });
    return true;
  },

  async claimApiIdempotency(input) {
    const store = getStore();
    for (const [key, row] of store.apiIdempotency) {
      if (row.status === "completed" && row.expiresAt <= input.now) {
        store.apiIdempotency.delete(key);
      }
    }
    const mapKey = `${input.scope}\n${input.key}`;
    const existing = store.apiIdempotency.get(mapKey);
    if (existing) {
      if (existing.requestHash !== input.requestHash) return { status: "conflict" };
      if (existing.status === "completed") {
        return {
          status: "completed",
          responseStatus: existing.responseStatus!,
          responseBody: existing.responseBody!,
          contentType: existing.contentType!,
        };
      }
      if (existing.lockedAt > input.staleBefore) return { status: "running" };
    }
    const leaseToken = crypto.randomUUID();
    store.apiIdempotency.set(mapKey, {
      requestHash: input.requestHash,
      status: "running",
      leaseToken,
      lockedAt: input.now,
      expiresAt: input.expiresAt,
      responseStatus: null,
      responseBody: null,
      contentType: null,
    });
    return { status: "claimed", leaseToken };
  },

  async completeApiIdempotency(input) {
    const mapKey = `${input.scope}\n${input.key}`;
    const row = getStore().apiIdempotency.get(mapKey);
    if (!row || row.status !== "running" || row.leaseToken !== input.leaseToken) {
      return false;
    }
    getStore().apiIdempotency.set(mapKey, {
      ...row,
      status: "completed",
      leaseToken: null,
      responseStatus: input.responseStatus,
      responseBody: input.responseBody,
      contentType: input.contentType,
    });
    return true;
  },

  async releaseApiIdempotency(input) {
    const mapKey = `${input.scope}\n${input.key}`;
    const row = getStore().apiIdempotency.get(mapKey);
    if (!row || row.status !== "running" || row.leaseToken !== input.leaseToken) {
      return false;
    }
    getStore().apiIdempotency.delete(mapKey);
    return true;
  },

  async getWorkQueueHealth(now) {
    const store = getStore();
    type Health = {
      due: number;
      running: number;
      scheduled: number;
      failed: number;
      oldestDueAt: string | null;
    };
    const empty = (): Health => ({
      due: 0,
      running: 0,
      scheduled: 0,
      failed: 0,
      oldestDueAt: null,
    });
    const backgroundJobs: Record<string, Health> = {};
    const organizations: Record<
      string,
      { backgroundJobs: Record<string, Health>; turnEffects: Health }
    > = {};
    for (const job of store.backgroundJobs.values()) {
      const org = (organizations[job.organizationId] ??= {
        backgroundJobs: {},
        turnEffects: empty(),
      });
      const global = (backgroundJobs[job.kind] ??= empty());
      const local = (org.backgroundJobs[job.kind] ??= empty());
      for (const health of [global, local]) {
        if (job.status === "running") health.running += 1;
        else if (job.status === "failed" || job.attempts >= job.maxAttempts) {
          health.failed += 1;
        } else if (job.nextRunAt <= now) {
          health.due += 1;
          if (!health.oldestDueAt || job.nextRunAt < health.oldestDueAt) {
            health.oldestDueAt = job.nextRunAt;
          }
        } else health.scheduled += 1;
      }
    }
    const turnEffects = empty();
    for (const effect of store.turnEffects.values()) {
      const org = (organizations[effect.organizationId] ??= {
        backgroundJobs: {},
        turnEffects: empty(),
      });
      for (const health of [turnEffects, org.turnEffects]) {
        if (effect.status === "running") health.running += 1;
        else if (effect.status === "failed") health.failed += 1;
        else if (effect.status === "pending" && effect.nextRunAt <= now) {
          health.due += 1;
          if (!health.oldestDueAt || effect.nextRunAt < health.oldestDueAt) {
            health.oldestDueAt = effect.nextRunAt;
          }
        } else if (effect.status === "pending") health.scheduled += 1;
      }
    }
    return {
      backgroundJobs,
      turnEffects,
      organizations,
    };
  },

  async sweepRuntimeLedgers(now, limit) {
    const store = getStore();
    const cap = Math.max(0, Math.min(limit, 5000));
    let backgroundJobs = 0;
    const jobCutoff = new Date(new Date(now).getTime() - 30 * 86_400_000).toISOString();
    for (const [id, job] of [...store.backgroundJobs].sort(
      ([aId, a], [bId, b]) =>
        a.updatedAt.localeCompare(b.updatedAt) || aId.localeCompare(bId)
    )) {
      if (backgroundJobs >= cap) break;
      if (
        (job.status === "succeeded" || job.status === "failed") &&
        job.updatedAt < jobCutoff
      ) {
        store.backgroundJobs.delete(id);
        backgroundJobs += 1;
      }
    }
    let conversationTurns = 0;
    const turnCutoff = new Date(new Date(now).getTime() - 7 * 86_400_000).toISOString();
    for (const [key, turn] of [...store.conversationTurns].sort(
      ([aKey, a], [bKey, b]) =>
        a.updatedAt.localeCompare(b.updatedAt) || aKey.localeCompare(bKey)
    )) {
      if (conversationTurns >= cap) break;
      if (
        (turn.status === "completed" || turn.status === "failed") &&
        turn.updatedAt < turnCutoff
      ) {
        store.conversationTurns.delete(key);
        conversationTurns += 1;
      }
    }
    let turnEffects = 0;
    for (const [id, effect] of [...store.turnEffects].sort(
      ([aId, a], [bId, b]) =>
        a.updatedAt.localeCompare(b.updatedAt) || aId.localeCompare(bId)
    )) {
      if (turnEffects >= cap) break;
      if (
        (effect.status === "succeeded" || effect.status === "failed") &&
        effect.updatedAt < jobCutoff
      ) {
        store.turnEffects.delete(id);
        turnEffects += 1;
      }
    }
    let apiIdempotencyKeys = 0;
    for (const [key, row] of [...store.apiIdempotency].sort(
      ([aKey, a], [bKey, b]) =>
        a.expiresAt.localeCompare(b.expiresAt) || aKey.localeCompare(bKey)
    )) {
      if (apiIdempotencyKeys >= cap) break;
      if (row.expiresAt <= now) {
        store.apiIdempotency.delete(key);
        apiIdempotencyKeys += 1;
      }
    }
    const generationCutoff = new Date(
      new Date(now).getTime() - 86_400_000,
    ).toISOString();
    const generations = new Map<
      string,
      { sourceId: string; generationId: string; newestAt: string }
    >();
    for (const concept of store.concepts.values()) {
      if (!concept.sourceId || !concept.generationId) continue;
      const source = store.sources.get(concept.sourceId);
      if (!source || source.activeGenerationId === concept.generationId) continue;
      const checkpointGeneration = (
        source.config as Record<string, unknown>
      ).crawlIngestGenerationId;
      if (checkpointGeneration === concept.generationId) continue;
      const resumable = [...store.sourceIngestPayloads.values()].some(
        (payload) =>
          payload.generationId === concept.generationId &&
          [...store.backgroundJobs.values()].some(
            (job) =>
              job.sourceId === concept.sourceId &&
              job.kind === "ingest_source" &&
              (job.status === "queued" || job.status === "running"),
          ),
      );
      if (resumable) continue;
      const key = `${concept.sourceId}\n${concept.generationId}`;
      const current = generations.get(key);
      if (!current || current.newestAt < concept.createdAt) {
        generations.set(key, {
          sourceId: concept.sourceId,
          generationId: concept.generationId,
          newestAt: concept.createdAt,
        });
      }
    }
    const staleGenerations = [...generations.values()]
      .filter((generation) => generation.newestAt < generationCutoff)
      .sort(
        (a, b) =>
          a.newestAt.localeCompare(b.newestAt) ||
          a.sourceId.localeCompare(b.sourceId) ||
          a.generationId.localeCompare(b.generationId),
      )
      .slice(0, Math.min(cap, 100));
    for (const generation of staleGenerations) {
      await this.deleteSourceKnowledgeGeneration(
        generation.sourceId,
        generation.generationId,
      );
    }
    return {
      backgroundJobs,
      conversationTurns,
      turnEffects,
      apiIdempotencyKeys,
      sourceGenerations: staleGenerations.length,
    };
  },

  async createExportJob(organizationId, input) {
    const now = new Date().toISOString();
    const job: ExportJob = {
      id: shortId(),
      organizationId,
      kind: input.kind,
      status: "queued",
      format: input.format,
      params: input.params,
      storagePath: null,
      error: "",
      attempts: 0,
      maxAttempts: 3,
      lockedAt: null,
      lockedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    getStore().exportJobs.set(job.id, job);
    return job;
  },

  async listExportJobs(organizationId) {
    return [...getStore().exportJobs.values()]
      .filter((job) => job.organizationId === organizationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  async getExportJob(id) {
    return getStore().exportJobs.get(id) ?? null;
  },

  async claimDueExportJobs({ workerId, now, staleBefore, limit }) {
    const store = getStore();
    const due = [...store.exportJobs.values()]
      .filter((job) => {
        const queued = job.status === "queued" && job.attempts < job.maxAttempts;
        const runningStale =
          job.status === "running" &&
          job.lockedAt !== null &&
          job.lockedAt < staleBefore;
        return queued || runningStale;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
    return due.map((job) => {
      const claimed: ExportJob = {
        ...job,
        status: "running",
        attempts: job.attempts + 1,
        lockedAt: now,
        lockedBy: workerId,
        error: "",
        updatedAt: now,
      };
      store.exportJobs.set(job.id, claimed);
      return claimed;
    });
  },

  async updateExportJob(id, patch) {
    const store = getStore();
    const job = store.exportJobs.get(id);
    if (!job) return;
    store.exportJobs.set(id, {
      ...job,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  },

  async requeueExportJob(id) {
    const store = getStore();
    const job = store.exportJobs.get(id);
    if (!job) return;
    store.exportJobs.set(id, {
      ...job,
      status: "queued",
      attempts: 0,
      error: "",
      storagePath: null,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date().toISOString(),
    });
  },

  async claimProcessingCrawlSources(input) {
    const store = getStore();
    const rows: Array<{
      sourceId: string;
      collectionId: string;
      assistantId: string;
      attemptedAt: string | null;
      createdAt: string;
    }> = [];
    for (const source of store.sources.values()) {
      if (source.status !== "processing") continue;
      if (source.kind !== "website" && source.kind !== "url") continue;
      if (!source.config.crawlRunId) continue;
      const activeClaim = store.crawlFinalizeClaims.get(source.id);
      if (activeClaim && activeClaim.now > input.staleBefore) continue;
      const collection = store.collections.get(source.collectionId);
      if (!collection) continue;
      rows.push({
        sourceId: source.id,
        collectionId: source.collectionId,
        assistantId: earliestLinkedAssistantId(store, source.id),
        attemptedAt: store.crawlFinalizeAttemptedAt.get(source.id) ?? null,
        createdAt: source.createdAt,
      });
    }
    const claimed = rows
      .sort(
        (a, b) =>
          (a.attemptedAt ?? "").localeCompare(b.attemptedAt ?? "") ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.sourceId.localeCompare(b.sourceId)
      )
      .slice(0, input.limit);
    for (const row of claimed) {
      store.crawlFinalizeClaims.set(row.sourceId, {
        workerId: input.workerId,
        now: input.now,
      });
      store.crawlFinalizeAttemptedAt.set(row.sourceId, input.now);
    }
    return claimed.map(({ attemptedAt: _attemptedAt, createdAt: _createdAt, ...row }) => row);
  },

  async claimDueRecrawlSources(input) {
    const store = getStore();
    const rows: Array<{
      sourceId: string;
      collectionId: string;
      assistantId: string;
      lastCrawledAt: string;
      createdAt: string;
    }> = [];
    for (const source of store.sources.values()) {
      if (source.status !== "ready") continue;
      if (source.kind !== "website" && source.kind !== "url") continue;
      if (source.recrawlSchedule === "never" || !source.lastCrawledAt) continue;
      const due = nextCrawlDue(source.recrawlSchedule, source.lastCrawledAt);
      if (!due || due > input.now) continue;
      const collection = store.collections.get(source.collectionId);
      if (!collection) continue;
      rows.push({
        sourceId: source.id,
        collectionId: source.collectionId,
        assistantId: earliestLinkedAssistantId(store, source.id),
        lastCrawledAt: source.lastCrawledAt,
        createdAt: source.createdAt,
      });
    }
    const claimed = rows
      .sort(
        (a, b) =>
          a.lastCrawledAt.localeCompare(b.lastCrawledAt) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.sourceId.localeCompare(b.sourceId)
      )
      .slice(0, Math.max(input.limit, 0));
    for (const row of claimed) {
      const source = store.sources.get(row.sourceId);
      if (!source) continue;
      const config = { ...source.config };
      delete config.crawlRunId;
      delete config.crawlDatasetId;
      delete config.resolvedCrawlerProvider;
      store.sources.set(row.sourceId, {
        ...source,
        status: "processing",
        error: "",
        config,
        updatedAt: input.now,
      });
      store.crawlFinalizeClaims.delete(row.sourceId);
    }
    return claimed.map(({ lastCrawledAt: _lastCrawledAt, createdAt: _createdAt, ...row }) => row);
  },

  async claimProcessingCrawlSource(input) {
    const store = getStore();
    const source = store.sources.get(input.sourceId);
    if (!source || source.status !== "processing") return false;
    const current = store.crawlFinalizeClaims.get(input.sourceId);
    if (current && current.now > input.staleBefore) return false;
    store.crawlFinalizeClaims.set(input.sourceId, {
      workerId: input.workerId,
      now: input.now,
    });
    store.crawlFinalizeAttemptedAt.set(input.sourceId, input.now);
    return true;
  },

  async renewProcessingCrawlSourceClaim({ sourceId, workerId, now }) {
    const store = getStore();
    if (store.sources.get(sourceId)?.status !== "processing") return false;
    const claim = store.crawlFinalizeClaims.get(sourceId);
    if (claim?.workerId !== workerId) return false;
    store.crawlFinalizeClaims.set(sourceId, { workerId, now });
    return true;
  },

  async releaseProcessingCrawlSourceClaim({ sourceId, workerId }) {
    const claims = getStore().crawlFinalizeClaims;
    if (claims.get(sourceId)?.workerId === workerId) claims.delete(sourceId);
  },

  async deleteSource(id) {
    const store = getStore();
    store.sources.delete(id);
    store.crawlFinalizeClaims.delete(id);
    store.crawlFinalizeAttemptedAt.delete(id);
    for (const [key, link] of store.assistantSources)
      if (link.sourceId === id) store.assistantSources.delete(key);
    for (const [jobId, job] of store.backgroundJobs)
      if (job.sourceId === id) store.backgroundJobs.delete(jobId);
    for (const [key, mapping] of store.applicationSources)
      if (mapping.sourceId === id)
        store.applicationSources.set(key, {
          ...mapping,
          sourceId: null,
          updatedAt: new Date().toISOString(),
        });
    for (const [cid, c] of store.concepts)
      if (c.sourceId === id) {
        store.concepts.delete(cid);
        for (const [kid, k] of store.chunks)
          if (k.conceptId === cid) store.chunks.delete(kid);
      }
  },

  async deleteConceptsByIds(ids) {
    const store = getStore();
    for (const id of ids) {
      if (!store.concepts.delete(id)) continue;
      for (const [kid, k] of store.chunks)
        if (k.conceptId === id) store.chunks.delete(kid);
    }
  },

  async deleteSourceKnowledgeGeneration(sourceId, generationId) {
    const store = getStore();
    const deleted: string[] = [];
    for (const [id, concept] of store.concepts) {
      if (
        concept.sourceId !== sourceId ||
        concept.generationId !== generationId ||
        concept.generationId === store.sources.get(sourceId)?.activeGenerationId
      ) {
        continue;
      }
      store.concepts.delete(id);
      deleted.push(id);
      for (const [chunkId, chunk] of store.chunks)
        if (chunk.conceptId === id) store.chunks.delete(chunkId);
    }
    return deleted;
  },

  async commitSourceKnowledgeGeneration(input) {
    const store = getStore();
    const source = store.sources.get(input.sourceId);
    if (
      !source ||
      source.activeGenerationId !== input.expectedActiveGenerationId ||
      ![...store.concepts.values()].some(
        (concept) =>
          concept.sourceId === input.sourceId &&
          concept.generationId === input.generationId
      )
    ) {
      return false;
    }
    store.sources.set(source.id, {
      ...source,
      activeGenerationId: input.generationId,
      updatedAt: new Date().toISOString(),
    });
    return true;
  },

  async listConcepts(collectionId) {
    return [...getStore().concepts.values()]
      .filter((c) => c.collectionId === collectionId)
      .filter((c) => {
        if (!c.sourceId) return true;
        return (
          c.generationId ===
          getStore().sources.get(c.sourceId)?.activeGenerationId
        );
      })
      .sort((a, b) => (a.path < b.path ? -1 : 1));
  },

  async listAssistantFaqOptions(assistantId) {
    const store = getStore();
    return [...store.concepts.values()]
      .filter((concept) =>
        concept.sourceId &&
        store.assistantSources.has(`${assistantId}:${concept.sourceId}`) &&
        concept.generationId === store.sources.get(concept.sourceId)?.activeGenerationId &&
        !concept.excluded && concept.frontmatter.type === "FAQ"
      )
      .flatMap((concept) => {
        const question = concept.frontmatter.title;
        return typeof question === "string" && question.trim()
          ? [{ id: concept.id, question }]
          : [];
      })
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  },

  async listConceptPage(collectionId, input) {
    return [...getStore().concepts.values()]
      .filter((concept) => concept.collectionId === collectionId)
      .filter((concept) => {
        if (!concept.sourceId) return true;
        return concept.generationId ===
          getStore().sources.get(concept.sourceId)?.activeGenerationId;
      })
      .filter((concept) => !input.afterId || concept.id > input.afterId)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, Math.max(1, Math.min(input.limit, 500)));
  },

  async getConcept(id) {
    const store = getStore();
    const concept = store.concepts.get(id);
    if (!concept) return null;
    if (
      concept.sourceId &&
      concept.generationId !==
        store.sources.get(concept.sourceId)?.activeGenerationId
    ) {
      return null;
    }
    return concept;
  },

  async listNullEmbeddingConceptIds(assistantId) {
    // Post-contract (#733): the assistant's corpus is its linked Sources, so
    // the re-embed sweep scopes the same way.
    const store = getStore();
    const ids = new Set<string>();
    for (const chunk of store.chunks.values()) {
      if (chunk.embedding !== null) continue;
      const concept = store.concepts.get(chunk.conceptId);
      if (
        concept?.sourceId &&
        concept.generationId !==
          store.sources.get(concept.sourceId)?.activeGenerationId
      )
        continue;
      if (
        chunk.sourceId &&
        store.assistantSources.has(`${assistantId}:${chunk.sourceId}`)
      )
        ids.add(chunk.conceptId);
    }
    return [...ids];
  },

  async findFaqConcept(assistantId, question) {
    // Post-contract reach: a FAQ answers for the Assistants its Source is
    // linked to.
    const store = getStore();
    const normalized = question.trim().toLowerCase();
    if (!normalized) return null;
    for (const concept of store.concepts.values()) {
      if (
        concept.sourceId &&
        concept.generationId !==
          store.sources.get(concept.sourceId)?.activeGenerationId
      )
        continue;
      if (concept.excluded) continue;
      if (concept.frontmatter.type !== "FAQ") continue;
      if ((concept.frontmatter.title ?? "").trim().toLowerCase() !== normalized)
        continue;
      if (
        !concept.sourceId ||
        !store.assistantSources.has(`${assistantId}:${concept.sourceId}`)
      )
        continue;
      const collection = store.collections.get(concept.collectionId);
      if (!collection) continue;
      return { concept, collectionName: collection.name };
    }
    return null;
  },

  async createConcept(input) {
    if (input.generationId && input.sourceId) {
      const existing = [...getStore().concepts.values()].find(
        (concept) =>
          concept.sourceId === input.sourceId &&
          concept.generationId === input.generationId &&
          concept.path === input.path
      );
      if (existing) {
        const updated = {
          ...existing,
          frontmatter: input.frontmatter,
          body: input.body,
        };
        getStore().concepts.set(existing.id, updated);
        return updated;
      }
    }
    const concept: Concept = {
      id: shortId(),
      collectionId: input.collectionId,
      sourceId: input.sourceId,
      generationId:
        input.generationId ??
        (input.sourceId
          ? getStore().sources.get(input.sourceId)?.activeGenerationId ?? null
          : null),
      path: input.path,
      frontmatter: input.frontmatter,
      body: input.body,
      excluded: false,
      recrawlSchedule: null,
      createdAt: new Date().toISOString(),
    };
    getStore().concepts.set(concept.id, concept);
    return concept;
  },

  async updateConcept(id, patch) {
    const store = getStore();
    const concept = store.concepts.get(id);
    if (!concept) throw new Error(`Concept ${id} not found`);
    const updated: Concept = {
      ...concept,
      frontmatter: patch.frontmatter ?? concept.frontmatter,
      body: patch.body ?? concept.body,
    };
    store.concepts.set(id, updated);
    return updated;
  },

  async deleteConcept(id) {
    const store = getStore();
    store.concepts.delete(id);
    for (const [kid, k] of store.chunks)
      if (k.conceptId === id) store.chunks.delete(kid);
  },

  async deleteChunksByConcept(conceptId) {
    const store = getStore();
    for (const [kid, k] of store.chunks)
      if (k.conceptId === conceptId) store.chunks.delete(kid);
  },

  async setConceptExcluded(id, excluded) {
    const store = getStore();
    const concept = store.concepts.get(id);
    if (concept) store.concepts.set(id, { ...concept, excluded });
  },

  async setConceptRecrawlSchedule(id, schedule) {
    const store = getStore();
    const concept = store.concepts.get(id);
    if (concept) store.concepts.set(id, { ...concept, recrawlSchedule: schedule });
  },

  async saveChunks(chunks) {
    const store = getStore();
    for (const chunk of chunks) {
      const id = shortId();
      store.chunks.set(id, {
        id,
        conceptId: chunk.conceptId,
        collectionId: chunk.collectionId,
        sourceId: chunk.sourceId ?? null,
        content: chunk.content,
        embedding: chunk.embedding ?? null,
        embeddingSpace: chunk.embeddingSpace ?? null,
      });
    }
  },

  async searchChunks(assistantId, collectionId, query) {
    const store = getStore();
    // Lexical scoring only (the demo store has no vectors): the shared
    // token-overlap score from hybrid-search.ts.
    const tokens = lexicalTokens(query.text);
    const results: KnowledgeSearchResult[] = [];
    for (const chunk of store.chunks.values()) {
      // Post-contract (#733): the link table is the whole retrieval scope,
      // a chunk answers for exactly the Assistants its Source is linked to.
      if (
        !chunk.sourceId ||
        !store.assistantSources.has(`${assistantId}:${chunk.sourceId}`)
      )
        continue;
      if (collectionId && chunk.collectionId !== collectionId) continue;
      const similarity = lexicalScore(chunk.content, tokens);
      if (similarity === 0) continue;
      const concept = store.concepts.get(chunk.conceptId);
      // Excluded concepts never surface in retrieval (mirrors match_chunks'
      // SQL filter), even if their chunks were retained.
      if (concept?.excluded) continue;
      if (
        concept?.sourceId &&
        concept.generationId !==
          store.sources.get(concept.sourceId)?.activeGenerationId
      )
        continue;
      const collection = store.collections.get(chunk.collectionId);
      const source = concept?.sourceId
        ? store.sources.get(concept.sourceId)
        : undefined;
      const link = source
        ? store.assistantSources.get(`${assistantId}:${source.id}`)
        : undefined;
      results.push({
        conceptId: chunk.conceptId,
        conceptTitle: concept?.frontmatter.title ?? concept?.path ?? "Concept",
        conceptPath: concept?.path ?? "",
        collectionId: chunk.collectionId,
        collectionName: collection?.name ?? "",
        sourceName: source?.name ?? null,
        sourceId: source?.id ?? null,
        directAccess:
          source?.kind === "file" &&
          source.originalObjectPath !== null &&
          link?.directAccess === true,
        resourceUrl: concept?.frontmatter.resource ?? null,
        content: chunk.content,
        similarity,
      });
    }
    // Same shaping rule the Supabase implementation applies (#801, CYB-14):
    // one Source may not take the whole window from the one that answers.
    return capPerSource(
      results.sort((a, b) => b.similarity - a.similarity),
      query.limit ?? 6
    );
  },

  async searchCollectionChunks(organizationId, collectionIds, query) {
    const store = getStore();
    if (collectionIds.length === 0) return [];
    const scope = new Set(collectionIds);
    const tokens = lexicalTokens(query.text);
    const results: KnowledgeSearchResult[] = [];
    for (const chunk of store.chunks.values()) {
      if (!scope.has(chunk.collectionId)) continue;
      const collection = store.collections.get(chunk.collectionId);
      // Tenancy is the Collection's, not the caller's word for it: a scope
      // naming another org's Collection retrieves nothing.
      if (collection?.organizationId !== organizationId) continue;
      const similarity = lexicalScore(chunk.content, tokens);
      if (similarity === 0) continue;
      const concept = store.concepts.get(chunk.conceptId);
      if (concept?.excluded) continue;
      if (
        concept?.sourceId &&
        concept.generationId !==
          store.sources.get(concept.sourceId)?.activeGenerationId
      )
        continue;
      const source = concept?.sourceId
        ? store.sources.get(concept.sourceId)
        : undefined;
      results.push({
        conceptId: chunk.conceptId,
        conceptTitle: concept?.frontmatter.title ?? concept?.path ?? "Concept",
        conceptPath: concept?.path ?? "",
        collectionId: chunk.collectionId,
        collectionName: collection?.name ?? "",
        sourceName: source?.name ?? null,
        sourceId: source?.id ?? null,
        // Direct access is a per-Assistant grant on a link row (#733); a
        // Teammate search has no Assistant, so a cited file is never handed
        // out as a signed original here.
        directAccess: false,
        resourceUrl: concept?.frontmatter.resource ?? null,
        content: chunk.content,
        similarity,
      });
    }
    // Same shaping rule the Supabase implementation applies (#801, CYB-14):
    // one Source may not take the whole window from the one that answers.
    return capPerSource(
      results.sort((a, b) => b.similarity - a.similarity),
      query.limit ?? 6
    );
  },

  async searchSourceChunks(organizationId, sourceIds, query) {
    const store = getStore();
    if (sourceIds.length === 0) return [];
    const scope = new Set(sourceIds);
    const tokens = lexicalTokens(query.text);
    const results: KnowledgeSearchResult[] = [];
    for (const chunk of store.chunks.values()) {
      // A chunk with no Source is unreachable by a Source-scoped search, the
      // same rule assistant retrieval already applies (#733).
      if (!chunk.sourceId || !scope.has(chunk.sourceId)) continue;
      const collection = store.collections.get(chunk.collectionId);
      // Tenancy is the Collection's: a Source reaches its Organization through
      // the Collection it sits in, never through the caller's word for it.
      if (collection?.organizationId !== organizationId) continue;
      const similarity = lexicalScore(chunk.content, tokens);
      if (similarity === 0) continue;
      const concept = store.concepts.get(chunk.conceptId);
      if (concept?.excluded) continue;
      const source = store.sources.get(chunk.sourceId);
      results.push({
        conceptId: chunk.conceptId,
        conceptTitle: concept?.frontmatter.title ?? concept?.path ?? "Concept",
        conceptPath: concept?.path ?? "",
        collectionId: chunk.collectionId,
        collectionName: collection?.name ?? "",
        sourceName: source?.name ?? null,
        sourceId: source?.id ?? null,
        // No Assistant, so no per-(assistant, source) Direct access grant.
        directAccess: false,
        resourceUrl: concept?.frontmatter.resource ?? null,
        content: chunk.content,
        similarity,
      });
    }
    // Same shaping rule the Supabase implementation applies (#801, CYB-14):
    // one Source may not take the whole window from the one that answers.
    return capPerSource(
      results.sort((a, b) => b.similarity - a.similarity),
      query.limit ?? 6
    );
  },

  // --- Publications ---------------------------------------------------------

  async createPublication(assistantId, config) {
    const store = getStore();
    const versions = [...store.publications.values()]
      .filter((p) => p.assistantId === assistantId)
      .map((p) => p.version);
    const publication: Publication = {
      id: shortId(),
      assistantId,
      version: Math.max(0, ...versions) + 1,
      config,
      createdAt: new Date().toISOString(),
    };
    store.publications.set(publication.id, publication);
    return publication;
  },

  async listPublications(assistantId) {
    return [...getStore().publications.values()]
      .filter((p) => p.assistantId === assistantId)
      .sort((a, b) => b.version - a.version);
  },

  async deletePublications(assistantId) {
    const store = getStore();
    for (const publication of [...store.publications.values()]) {
      if (publication.assistantId === assistantId) {
        store.publications.delete(publication.id);
      }
    }
  },

  async getLatestPublication(assistantId) {
    const all = await this.listPublications(assistantId);
    return all[0] ?? null;
  },

  async getPublication(id) {
    return getStore().publications.get(id) ?? null;
  },

  // --- Conversations & messages -------------------------------------------

  async createConversation(input) {
    if (input.id) {
      const existing = getStore().conversations.get(input.id);
      if (existing) return existing;
    }
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: input.id ?? shortId(),
      assistantId: input.assistantId ?? null,
      teammateId: input.teammateId ?? null,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      collectionId: input.collectionId ?? null,
      title: input.title ?? "",
      metadata: input.metadata ?? {},
      sessionState: {},
      sessionVersion: 0,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    getStore().conversations.set(conversation.id, conversation);
    return conversation;
  },

  async listConversations(assistantId, subjectType, subjectId) {
    return [...getStore().conversations.values()]
      .filter(
        (c) =>
          c.assistantId === assistantId &&
          c.subjectType === subjectType &&
          c.subjectId === subjectId
      )
      .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
  },

  async listTeammateConversations(teammateId, subjectId) {
    return [...getStore().conversations.values()]
      .filter((c) => c.teammateId === teammateId && c.subjectId === subjectId)
      .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
  },

  async getInboxPage(organizationId, query) {
    const limit = inboxPageSize(query.limit);
    const cursor = decodeInboxCursor(query.cursor);
    const matching = inboxConversationRows(organizationId)
      .filter((conversation) => inboxConversationMatches(conversation, query))
      .filter((conversation) => !cursor || isAfterInboxCursor(conversation, cursor))
      .sort(compareInboxConversation);
    const page = matching.slice(0, limit);
    const last = page.at(-1);
    return {
      conversations: page,
      nextCursor:
        matching.length > limit && last
          ? encodeInboxCursor({ updatedAt: last.updatedAt, id: last.id })
          : null,
    };
  },

  async getInboxFacets(organizationId): Promise<InboxFacets> {
    const conversations = inboxConversationRows(organizationId);
    const unique = (values: Array<string | null | undefined>) =>
      [...new Set(values.filter((value): value is string => Boolean(value)))]
        .sort()
        .slice(0, 200);
    return {
      locations: unique(conversations.map((row) => row.metadata.location)),
      cities: unique(conversations.map((row) => row.metadata.city)),
      roles: unique(conversations.map((row) => row.metadata.userRole)),
      languages: unique(conversations.map((row) => row.metadata.language)),
      workflows: unique(conversations.flatMap((row) => row.flowNames)),
    };
  },

  async getInboxConversationReview(conversationId) {
    const [messages, improvementLinks, answerVerdicts] = await Promise.all([
      mockDb.listMessages(conversationId),
      mockDb.listConversationImprovementLinks(conversationId),
      mockDb.listConversationAnswerVerdicts(conversationId),
    ]);
    return { messages, improvementLinks, answerVerdicts };
  },

  async getConversation(id) {
    return getStore().conversations.get(id) ?? null;
  },

  async getConversationForMessage(messageId) {
    const store = getStore();
    const message = store.messages.get(messageId);
    if (!message) return null;
    return store.conversations.get(message.conversationId) ?? null;
  },

  async listActiveGraphDatasets() {
    // Post-contract, Collections reach Assistants only through the link
    // table: a Collection is an active graph dataset when any Assistant
    // linked to one of its Sources runs the graph engine.
    const store = getStore();
    const byCollection = new Map<string, string>();
    for (const link of store.assistantSources.values()) {
      const assistant = store.assistants.get(link.assistantId);
      if (!assistant || (assistant.knowledgeEngine ?? "graph") !== "graph")
        continue;
      const source = store.sources.get(link.sourceId);
      if (source)
        byCollection.set(source.collectionId, assistant.organizationId);
    }
    return [...byCollection].map(([collectionId, organizationId]) => ({
      organizationId,
      collectionId,
    }));
  },

  async claimActiveGraphDatasets(limit) {
    const store = getStore();
    const datasets = (await this.listActiveGraphDatasets()).sort((a, b) =>
      a.collectionId.localeCompare(b.collectionId)
    );
    if (datasets.length === 0 || limit <= 0) return [];
    const start = store.graphLearningCursor
      ? Math.max(
          datasets.findIndex((item) => item.collectionId > store.graphLearningCursor!),
          0,
        )
      : 0;
    const rotated = [...datasets.slice(start), ...datasets.slice(0, start)];
    const claimed = rotated.slice(0, Math.min(limit, datasets.length));
    store.graphLearningCursor = claimed.at(-1)?.collectionId ?? null;
    return claimed;
  },

  async setConversationPinned(id, pinned) {
    const store = getStore();
    const conversation = store.conversations.get(id);
    if (conversation) store.conversations.set(id, { ...conversation, pinned });
  },

  async setConversationLegalHold(id, legalHold) {
    const store = getStore();
    const conversation = store.conversations.get(id);
    if (conversation) store.conversations.set(id, { ...conversation, legalHold });
  },

  async updateConversationMetadata(id, patch) {
    const store = getStore();
    const conversation = store.conversations.get(id);
    if (conversation) {
      store.conversations.set(id, {
        ...conversation,
        metadata: { ...conversation.metadata, ...patch },
      });
    }
  },

  async decideReviewRequest(id, patch) {
    const store = getStore();
    const current = store.reviewRequests.get(id);
    if (!current || current.status !== "pending") return null;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    store.reviewRequests.set(id, next);
    return next;
  },

  async settleWebhookSubscription(id, patch) {
    const store = getStore();
    const current = store.webhookSubscriptions.get(id);
    if (!current || current.status !== "pending") return null;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    store.webhookSubscriptions.set(id, next);
    return next;
  },

  async updateConversationSessionState(id, state) {
    const store = getStore();
    const conversation = store.conversations.get(id);
    if (conversation) {
      store.conversations.set(id, { ...conversation, sessionState: state });
    }
  },

  async mergeConversationSessionState(input) {
    const store = getStore();
    const conversation = store.conversations.get(input.id);
    if (!conversation || conversation.sessionVersion !== input.expectedVersion) {
      return false;
    }
    const nextState = { ...conversation.sessionState };
    for (const [key, value] of Object.entries(input.patch)) {
      const current = nextState[key];
      if (
        current &&
        value &&
        typeof current === "object" &&
        typeof value === "object" &&
        !Array.isArray(current) &&
        !Array.isArray(value)
      ) {
        nextState[key] = { ...current, ...value };
      } else if (key === "memory" && Array.isArray(value)) {
        const existing = Array.isArray(current) ? current : [];
        nextState[key] = [...new Set([...existing, ...value])].slice(-20);
      } else {
        nextState[key] = value;
      }
    }
    store.conversations.set(input.id, {
      ...conversation,
      sessionState: nextState,
      sessionVersion: conversation.sessionVersion + 1,
    });
    return true;
  },

  async claimConversationTurn(input) {
    const key = `${input.conversationId}:${input.requestId}`;
    const turns = getStore().conversationTurns;
    const existing = turns.get(key);
    if (!existing) {
      const leaseToken = crypto.randomUUID();
      turns.set(key, {
        status: "running",
        leaseToken,
        lockedBy: input.workerId,
        lockedAt: input.now,
        assistantMessageId: null,
        error: "",
        updatedAt: input.now,
      });
      return { status: "claimed" as const, leaseToken, assistantMessageId: null };
    }
    if (existing.status === "completed") {
      return {
        status: "completed" as const,
        leaseToken: null,
        assistantMessageId: existing.assistantMessageId,
      };
    }
    if (existing.status === "running" && existing.lockedAt > input.staleBefore) {
      return { status: "running" as const, leaseToken: null, assistantMessageId: null };
    }
    const leaseToken = crypto.randomUUID();
    turns.set(key, {
      ...existing,
      status: "running",
      leaseToken,
      lockedBy: input.workerId,
      lockedAt: input.now,
      error: "",
      updatedAt: input.now,
    });
    return { status: "claimed" as const, leaseToken, assistantMessageId: null };
  },

  async completeConversationTurn(input) {
    const key = `${input.conversationId}:${input.requestId}`;
    const turns = getStore().conversationTurns;
    const turn = turns.get(key);
    if (
      !turn ||
      turn.status !== "running" ||
      turn.leaseToken !== input.leaseToken
    ) {
      return false;
    }
    turns.set(key, {
      ...turn,
      status: "completed",
      assistantMessageId: input.assistantMessageId,
      lockedAt: input.now,
      updatedAt: input.now,
    });
    return true;
  },

  async commitConversationTurn(input) {
    const store = getStore();
    const key = `${input.conversationId}:${input.requestId}`;
    const turn = store.conversationTurns.get(key);
    if (!turn || turn.status !== "running" || turn.leaseToken !== input.leaseToken) {
      return null;
    }
    const existing = [...store.messages.values()].find(
      (message) =>
        message.conversationId === input.conversationId &&
        message.role === "assistant" &&
        (message as StoredMessage & { requestId?: string }).requestId ===
          input.requestId
    );
    const message: StoredMessage =
      existing ?? {
        id: shortId(),
        conversationId: input.conversationId,
        role: "assistant",
        content: input.content,
        flowId: input.flowId ?? null,
        flowName: input.flowName ?? null,
        feedback: 0,
        trace: input.trace ?? null,
        createdAt: input.now,
      };
    (message as StoredMessage & { requestId?: string }).requestId = input.requestId;
    store.messages.set(message.id, message);
    if (!existing && input.deferredEffects?.length) {
      const conversation = store.conversations.get(input.conversationId);
      const organizationId = conversation?.assistantId
        ? store.assistants.get(conversation.assistantId)?.organizationId
        : conversation?.teammateId
          ? store.teammates.get(conversation.teammateId)?.organizationId
          : undefined;
      if (!organizationId) throw new Error("Conversation organization not found");
      input.deferredEffects.forEach((payload) => {
        const id = crypto.randomUUID();
        store.turnEffects.set(id, {
          id,
          organizationId,
          conversationId: input.conversationId,
          messageId: message.id,
          payload,
          status: "pending",
          attempts: 0,
          nextRunAt: input.now,
          leaseToken: null,
          lockedAt: null,
          error: "",
          updatedAt: input.now,
        });
      });
    }
    store.conversationTurns.set(key, {
      ...turn,
      status: "completed",
      assistantMessageId: message.id,
      lockedAt: input.now,
    });
    return message;
  },

  async failConversationTurn(input) {
    const key = `${input.conversationId}:${input.requestId}`;
    const turns = getStore().conversationTurns;
    const turn = turns.get(key);
    if (
      !turn ||
      turn.status !== "running" ||
      turn.leaseToken !== input.leaseToken
    ) {
      return false;
    }
    turns.set(key, {
      ...turn,
      status: "failed",
      error: input.error,
      lockedAt: input.now,
      updatedAt: input.now,
    });
    return true;
  },

  async deleteConversation(id) {
    dropConversation(getStore(), id);
  },

  async listMessages(conversationId) {
    return [...getStore().messages.values()]
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  },

  async getMessage(id) {
    return getStore().messages.get(id) ?? null;
  },

  async listRecentMessages(conversationId, limit) {
    return [...getStore().messages.values()]
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .slice(-limit);
  },

  async appendMessage(input) {
    const store = getStore();
    if (input.requestId) {
      const existing = [...store.messages.values()].find(
        (message) =>
          message.conversationId === input.conversationId &&
          message.role === input.role &&
          (message as StoredMessage & { requestId?: string }).requestId ===
            input.requestId
      );
      if (existing) return existing;
    }
    const message: StoredMessage = {
      id: shortId(),
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      flowId: input.flowId ?? null,
      flowName: input.flowName ?? null,
      feedback: 0,
      trace: input.trace ?? null,
      createdAt: new Date().toISOString(),
    };
    if (input.requestId) {
      (message as StoredMessage & { requestId?: string }).requestId =
        input.requestId;
    }
    store.messages.set(message.id, message);
    if (input.role === "assistant" && input.deferredEffects?.length) {
      const conversation = store.conversations.get(input.conversationId);
      const organizationId = conversation?.assistantId
        ? store.assistants.get(conversation.assistantId)?.organizationId
        : conversation?.teammateId
          ? store.teammates.get(conversation.teammateId)?.organizationId
          : undefined;
      if (!organizationId) throw new Error("Conversation organization not found");
      input.deferredEffects.forEach((payload) => {
        const id = crypto.randomUUID();
        store.turnEffects.set(id, {
          id,
          organizationId,
          conversationId: input.conversationId,
          messageId: message.id,
          payload,
          status: "pending",
          attempts: 0,
          nextRunAt: message.createdAt,
          leaseToken: null,
          lockedAt: null,
          error: "",
          updatedAt: message.createdAt,
        });
      });
    }
    const conversation = store.conversations.get(input.conversationId);
    if (conversation) {
      store.conversations.set(conversation.id, {
        ...conversation,
        updatedAt: message.createdAt,
      });
    }
    return message;
  },

  async claimTurnEffects(input) {
    const cap = Math.max(1, Math.min(Math.floor(input.limit), 100));
    const eligible = [...getStore().turnEffects.values()]
      .filter(
        (effect) =>
          (!input.messageId || effect.messageId === input.messageId) &&
          ((effect.status === "pending" && effect.nextRunAt <= input.now) ||
            (effect.status === "running" &&
              effect.lockedAt !== null &&
              effect.lockedAt <= input.staleBefore))
      )
      .sort((a, b) =>
        a.nextRunAt === b.nextRunAt
          ? a.id.localeCompare(b.id)
          : a.nextRunAt.localeCompare(b.nextRunAt)
      );
    const byOrg = new Map<string, typeof eligible>();
    for (const effect of eligible) {
      const group = byOrg.get(effect.organizationId) ?? [];
      group.push(effect);
      byOrg.set(effect.organizationId, group);
    }
    const fair: typeof eligible = [];
    for (let position = 0; fair.length < eligible.length; position += 1) {
      for (const group of byOrg.values()) if (group[position]) fair.push(group[position]);
    }
    return fair
      .slice(0, cap)
      .map((effect) => {
        const leaseToken = crypto.randomUUID();
        const claimed = {
          ...effect,
          status: "running" as const,
          attempts: effect.attempts + 1,
          leaseToken,
          lockedAt: input.now,
          updatedAt: input.now,
        };
        getStore().turnEffects.set(effect.id, claimed);
        return {
          id: claimed.id,
          organizationId: claimed.organizationId,
          conversationId: claimed.conversationId,
          messageId: claimed.messageId,
          payload: claimed.payload,
          attempts: claimed.attempts,
          leaseToken,
        };
      });
  },

  async appendConversationReferral(id, referral) {
    const store = getStore();
    const conversation = store.conversations.get(id);
    if (!conversation) return;
    store.conversations.set(id, {
      ...conversation,
      metadata: {
        ...conversation.metadata,
        referredTo: [...(conversation.metadata.referredTo ?? []), referral],
      },
    });
  },

  async settleTurnEffect(input) {
    const effects = getStore().turnEffects;
    const effect = effects.get(input.id);
    if (
      !effect ||
      effect.status !== "running" ||
      effect.leaseToken !== input.leaseToken
    ) {
      return false;
    }
    effects.set(input.id, {
      ...effect,
      status: input.succeeded
        ? "succeeded"
        : effect.attempts >= 5
          ? "failed"
          : "pending",
      nextRunAt: input.succeeded
        ? effect.nextRunAt
        : new Date(
            new Date(input.now).getTime() + Math.max(1, effect.attempts) * 60_000
          ).toISOString(),
      leaseToken: null,
      lockedAt: null,
      error: input.succeeded ? "" : input.error ?? "",
      updatedAt: input.now,
    });
    return true;
  },

  async appendChannelMessage(input) {
    const store = getStore();
    // Strictly increasing per channel: a reply and the marker behind it are
    // written in the same millisecond, and the transcript has to read back in
    // the order they were written (see the Db doc comment).
    const latest = [...store.channelMessages.values()]
      .filter((message) => message.channelId === input.channelId)
      .reduce<string | null>(
        (newest, message) =>
          !newest || message.createdAt > newest ? message.createdAt : newest,
        null
      );
    const now = new Date().toISOString();
    const createdAt =
      latest && latest >= now
        ? new Date(new Date(latest).getTime() + 1).toISOString()
        : now;
    const message: ChannelMessage = {
      id: shortId(),
      organizationId: input.organizationId,
      channelId: input.channelId,
      authorType: input.authorType,
      authorUserId: input.authorUserId ?? null,
      authorTeammateId: input.authorTeammateId ?? null,
      content: input.content,
      mentions: input.mentions ?? [],
      chainId: input.chainId ?? null,
      trace: input.trace ?? null,
      createdAt,
    };
    store.channelMessages.set(message.id, message);
    const channel = store.teammateChannels.get(input.channelId);
    if (channel) {
      // The roster sorts by last activity, so the channel row moves with its
      // transcript the way a Conversation does.
      store.teammateChannels.set(channel.id, {
        ...channel,
        updatedAt: createdAt,
      });
    }
    return message;
  },

  async listChannelMessages(channelId, limit = 100) {
    return [...getStore().channelMessages.values()]
      .filter((message) => message.channelId === channelId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .slice(-limit);
  },

  async listChannelMessageWindows(channelIds, limitPerChannel = 30) {
    const wanted = new Set(channelIds);
    const byChannel = new Map<string, ChannelMessage[]>();
    for (const message of getStore().channelMessages.values()) {
      if (!wanted.has(message.channelId)) continue;
      const rows = byChannel.get(message.channelId);
      if (rows) rows.push(message);
      else byChannel.set(message.channelId, [message]);
    }
    return channelIds.flatMap((channelId) =>
      (byChannel.get(channelId) ?? [])
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
        .slice(-limitPerChannel)
    );
  },

  async listChannelChainMessages(channelId, chainId) {
    return [...getStore().channelMessages.values()]
      .filter(
        (message) =>
          message.channelId === channelId && message.chainId === chainId
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  },

  async setMessageFeedback(messageId, feedback) {
    const store = getStore();
    const message = store.messages.get(messageId);
    if (message) store.messages.set(messageId, { ...message, feedback });
  },

  async listTraceRetentionPolicies() {
    const store = getStore();
    const retentionDays = store.organization.traceRetentionDays;
    return retentionDays
      ? [{ organizationId: store.organization.id, retentionDays }]
      : [];
  },

  async listTranscriptRetentionPolicies() {
    const store = getStore();
    const retentionDays = store.organization.transcriptRetentionDays;
    return retentionDays
      ? [{ organizationId: store.organization.id, retentionDays }]
      : [];
  },

  async deleteExpiredConversations(organizationId, cutoffIso) {
    const store = getStore();
    const cutoff = Date.parse(cutoffIso);
    let deleted = 0;
    for (const [id, conversation] of [...store.conversations]) {
      // Last activity, not creation: a thread still in use is not expired
      // however long ago it was opened. `appendMessage` moves `updatedAt`.
      if (Date.parse(conversation.updatedAt) >= cutoff) continue;
      if (conversation.legalHold) continue;
      const assistant = assistantOfConversation(conversation);
      const teammate = conversation.teammateId
        ? store.teammates.get(conversation.teammateId)
        : undefined;
      const owner = assistant?.organizationId ?? teammate?.organizationId;
      if (owner !== organizationId) continue;
      // Through the same deletion the button uses, so the sweep and a manual
      // delete cannot leave different debris behind.
      dropConversation(store, id);
      deleted += 1;
    }
    return deleted;
  },

  async clearExpiredTraces(organizationId, cutoffIso) {
    const store = getStore();
    const cutoff = Date.parse(cutoffIso);
    let cleared = 0;
    for (const [id, message] of store.messages) {
      if (!message.trace) continue;
      if (Date.parse(message.createdAt) >= cutoff) continue;
      const conversation = store.conversations.get(message.conversationId);
      const assistant = conversation
        ? assistantOfConversation(conversation)
        : undefined;
      if (assistant?.organizationId !== organizationId) continue;
      store.messages.set(id, { ...message, trace: null });
      cleared += 1;
    }
    return cleared;
  },

  // --- Improvements ---------------------------------------------------

  async listImprovements(organizationId) {
    const store = getStore();
    return [...store.improvements.values()]
      .filter((i) => i.organizationId === organizationId)
      .map((i): ImprovementListItem => ({
        ...i,
        messageCount: [...store.improvementMessages.values()].filter(
          (l) => l.improvementId === i.id
        ).length,
      }))
      .sort((a, b) => b.seq - a.seq);
  },

  async listImprovementsPage(organizationId, input) {
    const { limit, beforeSeq, status } = normalizeImprovementPageInput(input);
    const all = await this.listImprovements(organizationId);
    const ordered = status ? all.filter((item) => item.status === status) : all;
    const matchingIndex =
      beforeSeq !== null
        ? ordered.findIndex((item) => item.seq < beforeSeq)
        : 0;
    const start = matchingIndex === -1 ? ordered.length : matchingIndex;
    const slice = ordered.slice(start, start + limit + 1);
    return finalizeImprovementPage(slice, limit);
  },

  async countImprovementsByStatus(organizationId) {
    const counts = Object.fromEntries(
      IMPROVEMENT_STATUS_VALUES.map((status) => [status, 0]),
    ) as Record<ImprovementStatus, number>;
    for (const improvement of getStore().improvements.values()) {
      if (improvement.organizationId === organizationId) {
        counts[improvement.status] += 1;
      }
    }
    return counts;
  },

  async getImprovement(id) {
    return getStore().improvements.get(id) ?? null;
  },

  async createImprovement(organizationId, input) {
    const store = getStore();
    const nextSeq =
      [...store.improvements.values()]
        .filter((i) => i.organizationId === organizationId)
        .reduce((max, i) => Math.max(max, i.seq), 0) + 1;
    const now = new Date().toISOString();
    const improvement: Improvement = {
      id: shortId(),
      organizationId,
      seq: nextSeq,
      title: input.title,
      description: "",
      status: "to_do",
      priority: "none",
      tags: [],
      assigneeId: null,
      dueDate: null,
      projectId: null,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    };
    store.improvements.set(improvement.id, improvement);
    if (input.messageId) {
      const linkId = shortId();
      store.improvementMessages.set(linkId, {
        id: linkId,
        improvementId: improvement.id,
        messageId: input.messageId,
        createdAt: now,
      });
    }
    return improvement;
  },

  async updateImprovement(id, patch) {
    const store = getStore();
    const current = store.improvements.get(id);
    if (!current) throw new Error(`Improvement ${id} not found`);
    const updated: Improvement = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    store.improvements.set(id, updated);
    return updated;
  },

  async deleteImprovement(id) {
    const store = getStore();
    store.improvements.delete(id);
    for (const [lid, link] of store.improvementMessages) {
      if (link.improvementId === id) store.improvementMessages.delete(lid);
    }
    for (const [pid, proposal] of store.improvementProposals) {
      if (proposal.improvementId === id) store.improvementProposals.delete(pid);
    }
  },

  async getImprovementProposal(improvementId) {
    const store = getStore();
    return (
      [...store.improvementProposals.values()].find(
        (p) => p.improvementId === improvementId
      ) ?? null
    );
  },

  async listDueRoutineCandidates({ before, limit }) {
    return [...getStore().teammateRoutines.values()]
      .filter(
        (routine) =>
          routine.enabled && (!routine.lastRunAt || routine.lastRunAt < before)
      )
      .sort((a, b) => (a.lastRunAt ?? "").localeCompare(b.lastRunAt ?? ""))
      .slice(0, limit);
  },

  async claimTeammateRoutine(id, expectedLastRunAt, now) {
    const store = getStore();
    const routine = store.teammateRoutines.get(id);
    // Compare-and-set: another tick that already stamped it wins, and this one
    // gets null rather than a second run.
    if (!routine || (routine.lastRunAt ?? null) !== expectedLastRunAt) return null;
    const claimed = { ...routine, lastRunAt: now, updatedAt: now };
    store.teammateRoutines.set(id, claimed);
    return claimed;
  },

  async recordTeammateRoutineRun(id, input) {
    const store = getStore();
    const routine = store.teammateRoutines.get(id);
    if (!routine) return;
    // Outcome columns only: the instruction may have been edited while the run
    // was in flight, and a run record must not put the old one back.
    store.teammateRoutines.set(id, {
      ...routine,
      lastStatus: input.status,
      lastDetail: input.detail.slice(0, 1000),
    });
  },

  async getMemoryDocument(organizationId, owner) {
    return (
      [...getStore().memoryDocuments.values()].find(
        (doc) => doc.organizationId === organizationId && ownerMatches(doc, owner)
      ) ?? null
    );
  },

  async writeMemoryDocument(input) {
    const store = getStore();
    // Monotonic, not `Date.now()`: two writes in one millisecond would tie, and
    // "newest first" would then be decided by whatever order the map happened
    // to yield. The same coin flip 98c5df54 fixed for another list.
    const now = new Date(monotonicNow()).toISOString();
    const existing = [...store.memoryDocuments.values()].find(
      (doc) =>
        doc.organizationId === input.organizationId &&
        ownerMatches(doc, input.owner)
    );
    const body = capMemoryDocument(input.body);
    const document: MemoryDocument = existing
      ? { ...existing, body, updatedAt: now }
      : {
          id: shortId(),
          organizationId: input.organizationId,
          memberId: input.owner.scope === "user" ? input.owner.memberId : null,
          teammateId:
            input.owner.scope === "agent" ? input.owner.teammateId : null,
          projectId:
            input.owner.scope === "project" ? input.owner.projectId : null,
          scope: input.owner.scope,
          body,
          createdAt: now,
          updatedAt: now,
        };
    store.memoryDocuments.set(document.id, document);
    // The history entry is not optional: a body that changed with no record of
    // who changed it is exactly the write nobody can audit or revert.
    const entryId = shortId();
    store.memoryDocumentEntries.set(entryId, {
      id: entryId,
      organizationId: input.organizationId,
      documentId: document.id,
      teammateId: input.teammateId ?? null,
      authorId: input.authorId ?? null,
      note: input.note ?? "",
      bodyBefore: existing?.body ?? "",
      createdAt: now,
    });
    return document;
  },

  async listMemoryDocumentEntries(documentId, limit = 50) {
    return [...getStore().memoryDocumentEntries.values()]
      .filter((entry) => entry.documentId === documentId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  },

  async revertMemoryDocument(input) {
    const store = getStore();
    const entry = store.memoryDocumentEntries.get(input.entryId);
    if (!entry) throw new Error("No such memory history entry");
    const document = store.memoryDocuments.get(entry.documentId);
    if (!document) throw new Error("No such memory document");
    const now = new Date(monotonicNow()).toISOString();
    const restored: MemoryDocument = {
      ...document,
      body: entry.bodyBefore,
      updatedAt: now,
    };
    store.memoryDocuments.set(restored.id, restored);
    const entryId = shortId();
    store.memoryDocumentEntries.set(entryId, {
      id: entryId,
      organizationId: document.organizationId,
      documentId: document.id,
      teammateId: null,
      authorId: input.authorId ?? null,
      note: "Reverted an earlier write",
      bodyBefore: document.body,
      createdAt: now,
    });
    return restored;
  },

  async getImprovementProposalById(id) {
    return getStore().improvementProposals.get(id) ?? null;
  },

  async createImprovementProposal(input) {
    const store = getStore();
    // At most one live proposal per improvement, replace any prior draft.
    for (const [pid, proposal] of store.improvementProposals) {
      if (proposal.improvementId === input.improvementId) {
        store.improvementProposals.delete(pid);
      }
    }
    const now = new Date().toISOString();
    const proposal: ImprovementProposal = {
      id: shortId(),
      organizationId: input.organizationId,
      improvementId: input.improvementId,
      status: "draft",
      payload: input.payload,
      dismissReason: "",
      acceptedConceptId: null,
      createdAt: now,
      updatedAt: now,
    };
    store.improvementProposals.set(proposal.id, proposal);
    return proposal;
  },

  async updateImprovementProposal(id, patch) {
    const store = getStore();
    const current = store.improvementProposals.get(id);
    if (!current) throw new Error(`Improvement proposal ${id} not found`);
    const updated: ImprovementProposal = {
      ...current,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.dismissReason !== undefined ? { dismissReason: patch.dismissReason } : {}),
      ...(patch.acceptedConceptId !== undefined
        ? { acceptedConceptId: patch.acceptedConceptId }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    store.improvementProposals.set(id, updated);
    return updated;
  },

  async listImprovementMessages(improvementId) {
    const store = getStore();
    const allMessages = [...store.messages.values()];
    return [...store.improvementMessages.values()]
      .filter((l) => l.improvementId === improvementId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .flatMap((link): ImprovementAssociation[] => {
        const message = store.messages.get(link.messageId);
        if (!message) return [];
        const conversation = store.conversations.get(message.conversationId);
        if (!conversation) return [];
        const own = allMessages
          .filter((m) => m.conversationId === conversation.id)
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
        const assistant = assistantOfConversation(conversation);
        const enriched: InboxConversation = {
          ...conversation,
          assistantTitle: assistant?.title ?? "",
          collectionName: conversation.collectionId
            ? (store.collections.get(conversation.collectionId)?.name ?? null)
            : null,
          messageCount: own.length,
          flowNames: [
            ...new Set(own.map((m) => m.flowName).filter((n): n is string => !!n)),
          ],
          notificationOnly:
            own.length > 0 && own.every((m) => isProactiveMessage(m.content)),
          feedback: own.some((m) => m.feedback === 1)
            ? 1
            : own.some((m) => m.feedback === -1)
              ? -1
              : 0,
        };
        return [
          {
            linkId: link.id,
            messageId: link.messageId,
            conversationId: conversation.id,
            message,
            transcript: own,
            conversation: enriched,
          },
        ];
      });
  },

  async getImprovementAssociationPage(improvementId, page = {}) {
    const offset = Math.max(0, Math.floor(page.offset ?? 0));
    const limit = Math.max(1, Math.min(Math.floor(page.limit ?? 1), 10));
    const all = await mockDb.listImprovementMessages(improvementId);
    const associations = all.slice(offset, offset + limit);
    return {
      associations,
      total: all.length,
      offset,
      nextOffset: offset + associations.length < all.length ? offset + limit : null,
    };
  },

  async linkImprovementMessage(improvementId, messageId) {
    const store = getStore();
    const exists = [...store.improvementMessages.values()].some(
      (l) => l.improvementId === improvementId && l.messageId === messageId
    );
    if (exists) return;
    const linkId = shortId();
    store.improvementMessages.set(linkId, {
      id: linkId,
      improvementId,
      messageId,
      createdAt: new Date().toISOString(),
    });
  },

  async unlinkImprovementMessage(improvementId, messageId) {
    const store = getStore();
    for (const [lid, link] of store.improvementMessages) {
      if (link.improvementId === improvementId && link.messageId === messageId) {
        store.improvementMessages.delete(lid);
      }
    }
  },

  async listConversationImprovementLinks(conversationId) {
    const store = getStore();
    const messageIds = new Set(
      [...store.messages.values()]
        .filter((m) => m.conversationId === conversationId)
        .map((m) => m.id)
    );
    return [...store.improvementMessages.values()]
      .filter((l) => messageIds.has(l.messageId))
      .flatMap((link): ImprovementMessageLink[] => {
        const improvement = store.improvements.get(link.improvementId);
        if (!improvement) return [];
        return [
          {
            messageId: link.messageId,
            improvementId: improvement.id,
            seq: improvement.seq,
            title: improvement.title,
          },
        ];
      });
  },

  // --- Org-level knowledge hub (PRD #726) ---------------------------------

  async listOrgKnowledgeSources(organizationId, filter) {
    const store = getStore();
    const query = (filter.query ?? "").trim().toLowerCase();
    const matches = [...store.sources.values()].filter((source) => {
      if (!filter.kinds.includes(source.kind)) return false;
      const collection = store.collections.get(source.collectionId);
      if (collection?.organizationId !== organizationId) return false;
      if (filter.status && source.status !== filter.status) return false;
      if (query && !source.name.toLowerCase().includes(query)) return false;
      if (
        filter.assistantId &&
        !store.assistantSources.has(`${filter.assistantId}:${source.id}`)
      )
        return false;
      return true;
    });
    matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

    const statusCounts = { processing: 0, ready: 0, error: 0 };
    for (const source of matches) statusCounts[source.status] += 1;

    const pageSize = filter.pageSize ?? 25;
    const page = filter.page ?? 1;
    const slice = matches.slice((page - 1) * pageSize, page * pageSize);

    const items = slice.map((source) => {
      let conceptCount = 0;
      let answerPreview = "";
      for (const concept of store.concepts.values()) {
        if (concept.sourceId !== source.id) continue;
        if (concept.generationId !== source.activeGenerationId) continue;
        conceptCount += 1;
        if (source.kind === "faq" && !answerPreview)
          answerPreview = concept.body.slice(0, 200);
      }
      const linkedAssistants = [...store.assistantSources.values()]
        .filter((link) => link.sourceId === source.id)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((link) => ({
          assistantId: link.assistantId,
          assistantName: store.assistants.get(link.assistantId)?.title ?? "",
          directAccess: link.directAccess,
        }));
      return {
        id: source.id,
        collectionId: source.collectionId,
        name: source.name,
        kind: source.kind,
        status: source.status,
        error: source.error,
        config: source.config,
        lastCrawledAt: source.lastCrawledAt,
        originalObjectPath: source.originalObjectPath,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        conceptCount,
        answerPreview,
        linkedAssistants,
      };
    });

    return { items, total: matches.length, statusCounts };
  },

  async listOrgKnowledgeSourceOptions(organizationId, filter) {
    const store = getStore();
    const sources = [...store.sources.values()]
      .filter((source) =>
        filter.kinds.includes(source.kind) &&
        store.collections.get(source.collectionId)?.organizationId === organizationId
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    return {
      items: sources.slice(0, filter.limit).map((source) => ({
        id: source.id,
        name: source.name,
        kind: source.kind,
        collectionId: source.collectionId,
      })),
      total: sources.length,
    };
  },

  async listOrgFaqs(organizationId) {
    const store = getStore();
    const page = await mockDb.listOrgKnowledgeSources(organizationId, {
      kinds: ["faq"],
      pageSize: Number.MAX_SAFE_INTEGER,
    });
    return page.items.map((item) => {
      let answer = "";
      for (const concept of store.concepts.values()) {
        if (
          concept.sourceId === item.id &&
          concept.generationId ===
            store.sources.get(item.id)?.activeGenerationId
        ) {
          answer = concept.body;
          break;
        }
      }
      return { sourceId: item.id, question: item.name, answer };
    });
  },

  async listConceptsBySource(sourceId, limit) {
    const store = getStore();
    return [...getStore().concepts.values()]
      .filter(
        (c) =>
          c.sourceId === sourceId &&
          c.generationId === store.sources.get(sourceId)?.activeGenerationId
      )
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .slice(0, limit ?? 500);
  },

  async listAssistantSourceIds(assistantId) {
    const store = getStore();
    return [...store.assistantSources.values()]
      .filter((link) => link.assistantId === assistantId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((link) => link.sourceId);
  },

  async listSourceAssistantLinks(sourceId) {
    const store = getStore();
    return [...store.assistantSources.values()]
      .filter((link) => link.sourceId === sourceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((link) => ({
        assistantId: link.assistantId,
        assistantName: store.assistants.get(link.assistantId)?.title ?? "",
        directAccess: link.directAccess,
      }));
  },

  async setSourceAssistantLinks(sourceId, assistantIds) {
    const store = getStore();
    const wanted = new Set(assistantIds);
    for (const [key, link] of store.assistantSources) {
      if (link.sourceId === sourceId && !wanted.has(link.assistantId))
        store.assistantSources.delete(key);
    }
    const now = new Date().toISOString();
    for (const assistantId of wanted) {
      const key = `${assistantId}:${sourceId}`;
      if (store.assistantSources.has(key)) continue; // keeps direct_access
      store.assistantSources.set(key, {
        assistantId,
        sourceId,
        directAccess: false,
        createdAt: now,
      });
    }
  },

  async setSourceDirectAccess(sourceId, assistantId, directAccess) {
    const store = getStore();
    const link = store.assistantSources.get(`${assistantId}:${sourceId}`);
    if (link)
      store.assistantSources.set(`${assistantId}:${sourceId}`, {
        ...link,
        directAccess,
      });
  },

  async getInsightsOverview(organizationId, filters) {
    const [conversations, assistants] = await Promise.all([
      Promise.resolve(inboxConversationRows(organizationId)),
      mockDb.listAssistants(organizationId),
    ]);
    return computeInsightsOverview(
      conversations,
      listMockInsightsMessages(organizationId),
      assistants,
      listMockWebsiteSources(organizationId),
      filters
    );
  },

  // --- Alerts -----------------------------------------------------------

  async listAlerts(organizationId) {
    const store = getStore();
    return [...store.alerts.values()]
      .filter((a) => a.organizationId === organizationId)
      .sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : -1));
  },

  async listActiveAlerts(organizationId, limit = 5) {
    const store = getStore();
    return [...store.alerts.values()]
      .filter((a) => a.organizationId === organizationId && a.status === "active")
      .sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : -1))
      .slice(0, limit);
  },

  async countActiveAlerts(organizationId) {
    const store = getStore();
    return [...store.alerts.values()].filter(
      (a) => a.organizationId === organizationId && a.status === "active"
    ).length;
  },

  async raiseAlert(organizationId, input) {
    const store = getStore();
    const now = new Date().toISOString();
    if (input.sourceKey) {
      const existing = [...store.alerts.values()].find(
        (a) =>
          a.organizationId === organizationId &&
          a.sourceKey === input.sourceKey &&
          a.status === "active"
      );
      if (existing) {
        const refreshed: Alert = {
          ...existing,
          type: input.type,
          title: input.title,
          detail: input.detail,
          detectedAt: now,
        };
        store.alerts.set(refreshed.id, refreshed);
        return refreshed;
      }
    }
    const alert: Alert = {
      id: shortId(),
      organizationId,
      type: input.type,
      title: input.title,
      detail: input.detail,
      status: "active",
      sourceKey: input.sourceKey ?? null,
      detectedAt: now,
      resolvedAt: null,
      resolvedBy: null,
    };
    store.alerts.set(alert.id, alert);
    return alert;
  },

  async resolveAlert(id, resolvedBy) {
    const store = getStore();
    const current = store.alerts.get(id);
    if (!current) throw new Error(`Alert ${id} not found`);
    const resolved: Alert = {
      ...current,
      status: "resolved",
      resolvedAt: new Date().toISOString(),
      resolvedBy: resolvedBy ?? null,
    };
    store.alerts.set(id, resolved);
    return resolved;
  },

  async resolveAlertsByKey(organizationId, sourceKey) {
    const store = getStore();
    const now = new Date().toISOString();
    for (const [id, alert] of store.alerts) {
      if (
        alert.organizationId === organizationId &&
        alert.sourceKey === sourceKey &&
        alert.status === "active"
      ) {
        store.alerts.set(id, {
          ...alert,
          status: "resolved",
          resolvedAt: now,
          resolvedBy: null,
        });
      }
    }
  },

  // --- AI usage ledger -------------------------------------------------------

  async recordAiUsage(rows) {
    const store = getStore();
    const createdAt = new Date().toISOString();
    for (const row of rows) store.aiUsage.push({ ...row, createdAt });
  },

  async getOrgTokensUsedToday(organizationId) {
    const store = getStore();
    const dayStart = new Date().toISOString().slice(0, 10);
    return store.aiUsage
      .filter(
        (u) =>
          u.organizationId === organizationId &&
          u.createdAt.slice(0, 10) === dayStart
      )
      .reduce((sum, u) => sum + u.inputTokens + u.outputTokens, 0);
  },

  async getOrgCostUsedToday(organizationId) {
    const store = getStore();
    const dayStart = new Date().toISOString().slice(0, 10);
    return store.aiUsage
      .filter(
        (u) =>
          u.organizationId === organizationId &&
          u.createdAt.slice(0, 10) === dayStart
      )
      .reduce(
        (sum, u) =>
          sum + estimateCostEur(u.provider, u.modelId, u.inputTokens, u.outputTokens),
        0
      );
  },

  async rollupUsageDaily(days = 2) {
    const store = getStore();
    // Recompute the window from the raw ledger, same grouping as the SQL
    // rollup, idempotent by construction. endDay = tomorrow includes today.
    const bounds = {
      startDay: utcDayBack(Math.max(days, 1) - 1),
      endDay: utcDayBack(-1),
    };
    const groups = aggregateLedger(store.aiUsage, bounds);
    const crawls = aggregateCrawls(store.runtimeEvents, bounds);
    for (const [key, row] of groups) store.usageDaily.set(key, row);
    for (const [key, row] of crawls) store.usageDaily.set(key, row);
    return groups.size + crawls.size;
  },

  async getOrgUsageDaily(organizationId, days = 30) {
    const store = getStore();
    const today = utcDayBack(0);
    const startDay = utcDayBack(Math.max(days, 1) - 1);
    // Closed days come from the rollup; today is aggregated live from the raw
    // ledger (the two ranges are disjoint, so no double counting).
    const rows: UsageDailyRow[] = [];
    for (const row of store.usageDaily.values()) {
      if (row.organizationId !== organizationId) continue;
      if (row.day >= today || row.day < startDay) continue;
      rows.push(usageDailyRowOf(row));
    }
    const liveBounds = {
      organizationId,
      startDay: today,
      endDay: utcDayBack(-1),
    };
    for (const row of aggregateLedger(store.aiUsage, liveBounds).values()) {
      rows.push(usageDailyRowOf(row));
    }
    for (const row of aggregateCrawls(store.runtimeEvents, liveBounds).values()) {
      rows.push(usageDailyRowOf(row));
    }
    return rows.sort(
      (a, b) =>
        b.day.localeCompare(a.day) ||
        a.kind.localeCompare(b.kind) ||
        a.credentialKind.localeCompare(b.credentialKind) ||
        a.provider.localeCompare(b.provider) ||
        a.modelId.localeCompare(b.modelId)
    );
  },

  async getOrgUsageMeters(organizationId, from, to) {
    const store = getStore();
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    const { cutLo, cutHi } = usageWindowCuts(from, to);
    const liveLo = Math.min(cutLo, toMs);
    const liveHi = Math.max(cutHi, fromMs);
    // Instants, never ISO strings: two spellings of the same moment must not
    // compare differently, and lexicographic order is not chronological order.
    const inLiveRange = (createdAt: string): boolean => {
      const at = Date.parse(createdAt);
      return (at >= fromMs && at < liveLo) || (at >= liveHi && at < toMs);
    };

    const meters = new Map<string, UsageMeterRow>();
    const add = (
      row: Omit<UsageMeterRow, "resource"> & { kind: UsageDailyRow["kind"] }
    ) => {
      const resource = usageResourceOf(row.kind);
      const key = `${resource}|${row.credentialKind}|${row.provider}|${row.modelId}`;
      const at =
        meters.get(key) ??
        ({
          resource,
          credentialKind: row.credentialKind,
          provider: row.provider,
          modelId: row.modelId,
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          units: 0,
        } satisfies UsageMeterRow);
      at.calls += row.calls;
      at.inputTokens += row.inputTokens;
      at.outputTokens += row.outputTokens;
      at.units += row.units;
      meters.set(key, at);
    };

    // Whole closed days, from the rollup.
    const dayLo = new Date(cutLo).toISOString().slice(0, 10);
    const dayHi = new Date(cutHi).toISOString().slice(0, 10);
    for (const row of store.usageDaily.values()) {
      if (row.organizationId !== organizationId) continue;
      if (row.day < dayLo || row.day >= dayHi) continue;
      add(row);
    }
    // Partial ends, live from the raw sources.
    for (const u of store.aiUsage) {
      if (u.organizationId !== organizationId) continue;
      if (!inLiveRange(u.createdAt)) continue;
      add({
        kind: usageKindOfStage(u.stage),
        credentialKind: u.credentialKind ?? "unknown",
        provider: u.provider,
        modelId: u.modelId,
        calls: 1,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        units: 0,
      });
    }
    for (const e of store.runtimeEvents) {
      if (e.organizationId !== organizationId) continue;
      if (e.kind !== "crawl" || e.status !== "succeeded") continue;
      const pages = e.pageCount ?? 0;
      if (pages <= 0) continue;
      if (!inLiveRange(e.createdAt)) continue;
      add({
        kind: "crawl",
        credentialKind: "platform",
        provider: e.crawlerProvider ?? "unknown",
        modelId: "",
        calls: 1,
        inputTokens: 0,
        outputTokens: 0,
        units: pages,
      });
    }
    return [...meters.values()];
  },

  async recordRuntimeEvent(event) {
    const store = getStore();
    store.runtimeEvents.push({ ...event, createdAt: new Date().toISOString() });
  },

  async recordObjectAccess(event) {
    const store = getStore();
    // Absent optionals normalize to null, matching what the table stores: a
    // contract suite that lets the two implementations disagree about
    // `undefined` vs `null` is a suite that proves nothing about either.
    store.objectAccessEvents.push({
      ...event,
      actorId: event.actorId ?? null,
      sourceId: event.sourceId ?? null,
      bytes: event.bytes ?? null,
      ip: event.ip ?? null,
      userAgent: event.userAgent ?? null,
      requestId: event.requestId ?? null,
      id: shortId(),
      createdAt: new Date().toISOString(),
    });
  },

  async listObjectAccessEvents(organizationId, options) {
    const offset = options?.offset ?? 0;
    // `filter` already returns a fresh array, so reversing it in place is safe.
    return getStore()
      .objectAccessEvents.filter(
        (item) =>
          item.organizationId === organizationId &&
          (!options?.objectPath || item.objectPath === options.objectPath) &&
          (!options?.sinceIso || item.createdAt >= options.sinceIso)
      )
      .reverse()
      .slice(offset, offset + (options?.limit ?? 100));
  },

  async purgeExpiredObjectAccessEvents(cutoffIso) {
    const store = getStore();
    const before = store.objectAccessEvents.length;
    store.objectAccessEvents = store.objectAccessEvents.filter(
      (event) => event.createdAt >= cutoffIso
    );
    return before - store.objectAccessEvents.length;
  },

  async recordRetentionSweep(event) {
    const store = getStore();
    // Absent optionals normalize to null, matching what the table stores.
    store.retentionSweepEvents.push({
      ...event,
      deleted: event.deleted ?? null,
      error: event.error ?? null,
      id: shortId(),
      createdAt: new Date().toISOString(),
    });
  },

  async listRetentionSweepEvents(organizationId, options) {
    return getStore()
      .retentionSweepEvents.filter((item) => item.organizationId === organizationId)
      .slice()
      .reverse()
      .slice(0, options?.limit ?? 100);
  },

  async getOrgBudget(organizationId) {
    return getStore().orgBudgets.get(organizationId) ?? null;
  },

  async setOrgBudget(organizationId, input) {
    const store = getStore();
    const budget: OrgBudget = {
      organizationId,
      dailyTokenLimit: input.dailyTokenLimit,
      dailyEuroLimit: input.dailyEuroLimit,
      enforcement: input.enforcement,
    };
    store.orgBudgets.set(organizationId, budget);
    return budget;
  },

  async reserveOrgBudget(input) {
    const store = getStore();
    const budget = store.orgBudgets.get(input.organizationId);
    if (!budget || budget.enforcement !== "block") return null;
    const reservationDay = input.now.slice(0, 10);
    const priorSpent = store.orgBudgetSpentEur.get(input.organizationId);
    const spentEur =
      priorSpent?.day === reservationDay
        ? Math.max(priorSpent.eur, input.observedCostEur)
        : Math.max(0, input.observedCostEur);
    store.orgBudgetSpentEur.set(input.organizationId, {
      day: reservationDay,
      eur: spentEur,
    });
    for (const [id, reservation] of store.orgBudgetReservations) {
      if (reservation.expiresAt <= input.now) store.orgBudgetReservations.delete(id);
    }
    const active = [...store.orgBudgetReservations.values()].filter(
      (reservation) =>
        reservation.organizationId === input.organizationId &&
        reservation.reservationDay === reservationDay &&
        reservation.expiresAt > input.now
    );
    const usedTokens = store.aiUsage
      .filter(
        (row) =>
          row.organizationId === input.organizationId &&
          row.createdAt.slice(0, 10) === reservationDay
      )
      .reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0);
    const reservedTokens = active.reduce(
      (sum, reservation) => sum + reservation.reservedTokens,
      0
    );
    const reservedEur = active.reduce(
      (sum, reservation) => sum + reservation.reservedEur,
      0
    );
    if (
      budget.dailyTokenLimit !== null &&
      usedTokens + reservedTokens + Math.max(1, input.maxTokens) >
        budget.dailyTokenLimit
    ) {
      return null;
    }
    if (
      budget.dailyEuroLimit !== null &&
      spentEur + reservedEur + Math.max(0.000001, input.maxEur) >
        budget.dailyEuroLimit
    ) {
      return null;
    }
    const id = crypto.randomUUID();
    store.orgBudgetReservations.set(id, {
      organizationId: input.organizationId,
      reservedTokens:
        budget.dailyTokenLimit === null
          ? 0
          : Math.max(1, input.maxTokens),
      reservedEur:
        budget.dailyEuroLimit === null
          ? 0
          : Math.max(0.000001, input.maxEur),
      reservationDay,
      expiresAt: input.expiresAt,
    });
    return id;
  },

  async releaseOrgBudgetReservation(id) {
    return getStore().orgBudgetReservations.delete(id);
  },

  async settleOrgBudgetReservation(id, rows) {
    const store = getStore();
    const reservation = store.orgBudgetReservations.get(id);
    if (!reservation) return false;
    const createdAt = new Date().toISOString();
    store.aiUsage.push(
      ...rows.map((row) => ({
        ...row,
        organizationId: reservation.organizationId,
        createdAt,
      }))
    );
    const current = store.orgBudgetSpentEur.get(reservation.organizationId);
    const settlementDay = createdAt.slice(0, 10);
    store.orgBudgetSpentEur.set(reservation.organizationId, {
      day: settlementDay,
      eur:
        (current?.day === settlementDay ? current.eur : 0) +
        reservation.reservedEur,
    });
    store.orgBudgetReservations.delete(id);
    return true;
  },

  // --- Standing goals --------------------------------------------------------

  async createAssistantGoal(assistantId, input) {
    const store = getStore();
    const assistant = store.assistants.get(assistantId);
    if (!assistant) throw new Error(`Assistant ${assistantId} not found`);
    const existing = [...store.goals.values()].filter(
      (g) => g.assistantId === assistantId
    );
    if (existing.length >= ASSISTANT_GOAL_CAP) {
      throw new Error(
        `This assistant already has ${ASSISTANT_GOAL_CAP} goals, remove one first.`
      );
    }
    return mockTable("assistantGoals").insert({
      organizationId: assistant.organizationId,
      assistantId,
      question: input.question,
      expectations: input.expectations,
    });
  },

  async claimDueAssistantGoals({ dueBefore, limit }) {
    const store = getStore();
    const now = new Date().toISOString();
    const due = [...store.goals.values()]
      .filter(
        (g) =>
          g.status === "active" &&
          (g.lastRunAt === null || g.lastRunAt < dueBefore)
      )
      .sort((a, b) => (a.lastRunAt ?? "").localeCompare(b.lastRunAt ?? ""))
      .slice(0, limit);
    return due.map((g) => {
      const claimed: AssistantGoal = { ...g, lastRunAt: now };
      store.goals.set(g.id, claimed);
      return claimed;
    });
  },

  // --- Answer verification ----------------------------------------------------

  async listUnverifiedAnswers({ limit }) {
    const store = getStore();
    const candidates: VerifiableAnswer[] = [];
    for (const m of store.messages.values()) {
      if (m.role !== "assistant") continue;
      if (store.answerVerdicts.has(m.id)) continue;
      const parts = m.content as { type?: string; action?: string; text?: string }[];
      const generative = parts.some(
        (p) => p.type === "text" && p.action === "search_knowledge"
      );
      if (!generative) continue;
      const conversation = store.conversations.get(m.conversationId);
      if (!conversation) continue;
      const assistant = assistantOfConversation(conversation);
      if (!assistant) continue;
      const question =
        [...store.messages.values()]
          .filter(
            (mm) =>
              mm.conversationId === m.conversationId &&
              mm.role === "user" &&
              mm.createdAt < m.createdAt
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
          ?.content.map((p) => (p as { text?: string }).text ?? "")
          .join("\n") ?? null;
      candidates.push({
        messageId: m.id,
        conversationId: m.conversationId,
        assistantId: assistant.id,
        organizationId: assistant.organizationId,
        flowId: m.flowId ?? null,
        flowName: m.flowName ?? null,
        content: parts,
        question,
        createdAt: m.createdAt,
      });
    }
    // Priority sampling: human signals first, 👎, then escalated
    // conversations, then newest.
    const rank = (c: VerifiableAnswer): number => {
      const message = getStore().messages.get(c.messageId);
      if (message?.feedback === -1) return 0;
      const conversation = getStore().conversations.get(c.conversationId);
      if (conversation?.metadata?.escalated === true) return 1;
      return 2;
    };
    return candidates
      .sort(
        (a, b) =>
          rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt)
      )
      .slice(0, limit);
  },

  async listConversationAnswerVerdicts(conversationId) {
    const store = getStore();
    return [...store.answerVerdicts.values()]
      .filter((v) => {
        const message = store.messages.get(v.messageId);
        return message?.conversationId === conversationId;
      })
      .map((v) => ({
        messageId: v.messageId,
        verdict: v.verdict,
        reason: v.reason,
        createdAt: v.createdAt,
      }));
  },

  async claimUnverifiedAnswers({ limit, staleBefore }) {
    const store = getStore();
    // Same candidates and priority order as listUnverifiedAnswers, minus any
    // that already carry a fresh claim (a stale claim is re-claimable).
    const candidates = (await this.listUnverifiedAnswers({ limit: 1_000 }))
      .filter((c) => {
        const claim = store.answerVerifierClaims.get(c.messageId);
        return claim === undefined || claim < staleBefore;
      })
      .slice(0, limit);
    const now = new Date().toISOString();
    for (const c of candidates) {
      store.answerVerifierClaims.set(c.messageId, now);
    }
    return candidates;
  },

  async releaseAnswerVerifierClaim(messageId) {
    getStore().answerVerifierClaims.delete(messageId);
  },

  async recordAnswerVerdict(input) {
    const store = getStore();
    if (store.answerVerdicts.has(input.messageId)) return false;
    store.answerVerdicts.set(input.messageId, {
      ...input,
      createdAt: new Date().toISOString(),
    });
    return true;
  },

  // --- Flow trust ledger -------------------------------------------------------

  async listTrustSignals({ limit }) {
    const store = getStore();
    const signals: TrustSignal[] = [];
    for (const v of store.answerVerdicts.values()) {
      if (!v.flowId || !v.assistantId) continue;
      signals.push({
        organizationId: v.organizationId,
        assistantId: v.assistantId,
        flowId: v.flowId,
        messageId: v.messageId,
        pass: v.verdict === "pass",
        reason: v.reason,
        createdAt: v.createdAt,
      });
    }
    for (const m of store.messages.values()) {
      if (m.role !== "assistant" || m.feedback === 0 || !m.flowId) continue;
      if (store.answerVerdicts.has(m.id)) continue; // the verdict wins
      const generative = (m.content as { type?: string; action?: string }[]).some(
        (p) => p.type === "text" && p.action === "search_knowledge"
      );
      if (!generative) continue;
      const conversation = store.conversations.get(m.conversationId);
      const assistant = conversation
        ? assistantOfConversation(conversation)
        : null;
      if (!assistant) continue;
      signals.push({
        organizationId: assistant.organizationId,
        assistantId: assistant.id,
        flowId: m.flowId,
        messageId: m.id,
        pass: m.feedback === 1,
        reason: "visitor feedback",
        createdAt: m.createdAt,
      });
    }
    return signals
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  },

  async upsertFlowTrust(input) {
    const store = getStore();
    const key = `${input.assistantId}:${input.flowId}`;
    const previousTier = store.flowTrust.get(key)?.tier ?? null;
    store.flowTrust.set(key, {
      ...input,
      previousTier,
      computedAt: new Date().toISOString(),
    });
    return { previousTier };
  },

  async listFlowTrust(assistantId) {
    return [...getStore().flowTrust.values()].filter(
      (t) => t.assistantId === assistantId
    );
  },

  async getFlowTrust(assistantId, flowId) {
    return getStore().flowTrust.get(`${assistantId}:${flowId}`) ?? null;
  },

  async recordFlowTrustEvent(input) {
    const store = getStore();
    store.flowTrustEvents.push({
      ...input,
      createdAt: new Date().toISOString(),
    });
    // Capped retention per flow, like the goal-run ledger.
    const forFlow = store.flowTrustEvents.filter(
      (e) => e.assistantId === input.assistantId && e.flowId === input.flowId
    );
    if (forFlow.length > FLOW_TRUST_EVENT_RETENTION) {
      let dropped = forFlow.length - FLOW_TRUST_EVENT_RETENTION;
      store.flowTrustEvents = store.flowTrustEvents.filter((e) => {
        if (
          dropped > 0 &&
          e.assistantId === input.assistantId &&
          e.flowId === input.flowId
        ) {
          dropped -= 1;
          return false;
        }
        return true;
      });
    }
  },

  async listFlowTrustEvents(assistantId, flowId) {
    // Newest first. Two transitions materialized in the same millisecond
    // (createdAt ties) fall back to insertion order so the later event still
    // sorts first, keeping the order deterministic.
    return getStore()
      .flowTrustEvents.map((e, index) => ({ e, index }))
      .filter(
        ({ e }) => e.assistantId === assistantId && e.flowId === flowId
      )
      .sort(
        (a, b) => b.e.createdAt.localeCompare(a.e.createdAt) || b.index - a.index
      )
      .map(({ e }) => e);
  },

  // --- Compost loop -----------------------------------------------------------

  async claimDueCompostAssistants({ dueBefore, staleBefore, limit }) {
    const store = getStore();
    // The due set minus any assistant with a fresh claim (a stale claim is
    // re-claimable), then stamp the claim at window start.
    const due = listDueCompostAssistants(store, dueBefore)
      .filter((d) => {
        const claim = store.compostClaims.get(d.assistantId);
        return claim === undefined || claim < staleBefore;
      })
      .slice(0, limit);
    const now = new Date().toISOString();
    for (const d of due) {
      store.compostClaims.set(d.assistantId, now);
    }
    return due;
  },

  async getCompostDigest(assistantId, since) {
    const store = getStore();
    const digest: CompostDigest = {
      failedVerdicts: [],
      thumbsDown: [],
      escalatedConversations: 0,
      refusals: 0,
      goalViolations: [],
      demotedFlows: [],
    };
    const conversationIds = new Set(
      [...store.conversations.values()]
        .filter((c) => c.assistantId === assistantId)
        .map((c) => c.id)
    );
    for (const v of store.answerVerdicts.values()) {
      if (v.assistantId !== assistantId || v.verdict !== "fail") continue;
      if (v.createdAt < since) continue;
      const message = store.messages.get(v.messageId);
      digest.failedVerdicts.push({
        messageId: v.messageId,
        conversationId: message?.conversationId ?? "",
        reason: v.reason,
      });
    }
    for (const m of store.messages.values()) {
      if (!conversationIds.has(m.conversationId) || m.createdAt < since) continue;
      if (m.role !== "assistant") continue;
      const parts = m.content as { type?: string; action?: string; text?: string }[];
      if (m.feedback === -1) {
        digest.thumbsDown.push({
          messageId: m.id,
          conversationId: m.conversationId,
          text: parts.find((p) => p.type === "text")?.text ?? "",
        });
      }
      if (parts.some((p) => p.type === "text" && p.action === "refusal")) {
        digest.refusals += 1;
      }
    }
    for (const c of store.conversations.values()) {
      if (
        c.assistantId === assistantId &&
        c.metadata?.escalated === true &&
        c.updatedAt >= since
      ) {
        digest.escalatedConversations += 1;
      }
    }
    for (const g of store.goals.values()) {
      if (
        g.assistantId === assistantId &&
        g.lastResult === "fail" &&
        (g.lastRunAt ?? "") >= since
      ) {
        digest.goalViolations.push({
          question: g.question,
          detail: g.lastDetail ?? "",
        });
      }
    }
    // Demotions come from the append-only event ledger, not the nightly
    // snapshot, so a demotion mid-window still counts even if a later
    // materialization overwrote the snapshot back to a higher tier.
    for (const e of store.flowTrustEvents) {
      if (
        e.assistantId === assistantId &&
        e.toTier === "watch" &&
        (e.fromTier === "auto" || e.fromTier === "queue") &&
        e.createdAt >= since
      ) {
        digest.demotedFlows.push({
          flowId: e.flowId,
          runs: e.runs,
          passes: e.passes,
        });
      }
    }
    return digest;
  },

  async recordCompostRun(input) {
    getStore().compostRuns.push({
      ...input,
      createdAt: new Date().toISOString(),
    });
  },

  async setCompostOptOut(organizationId, optOut) {
    const store = getStore();
    if (optOut) store.compostOptOut.add(organizationId);
    else store.compostOptOut.delete(organizationId);
  },

  async getCompostOptOut(organizationId) {
    return getStore().compostOptOut.has(organizationId);
  },

  async setPersonalAiSubscriptionsAllowed(organizationId, allowed) {
    const store = getStore();
    if (allowed) store.personalAiSubscriptionsAllowed.add(organizationId);
    else store.personalAiSubscriptionsAllowed.delete(organizationId);
  },

  async getPersonalAiSubscriptionsAllowed(organizationId) {
    return getStore().personalAiSubscriptionsAllowed.has(organizationId);
  },

  async recordAssistantGoalRun(goalId, input) {
    const store = getStore();
    const goal = store.goals.get(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);
    store.goalRuns.push({
      goalId,
      organizationId: goal.organizationId,
      ranAt: new Date().toISOString(),
      pass: input.pass,
      detail: input.detail,
      durationMs: input.durationMs,
    });
    const forGoal = store.goalRuns.filter((r) => r.goalId === goalId);
    if (forGoal.length > GOAL_RUN_RETENTION) {
      const cutoff = forGoal.length - GOAL_RUN_RETENTION;
      let dropped = 0;
      store.goalRuns = store.goalRuns.filter((r) => {
        if (r.goalId === goalId && dropped < cutoff) {
          dropped += 1;
          return false;
        }
        return true;
      });
    }
    store.goals.set(goalId, {
      ...goal,
      lastRunAt: new Date().toISOString(),
      lastResult: input.pass ? "pass" : "fail",
      lastDetail: input.detail || null,
    });
  },

  // --- Local-connector relay (service-role only) -----------------------------

  async consumeLocalConnectorPairing({ codeHash, origin, now }) {
    const store = getStore();
    for (const [id, pairing] of store.localConnectorPairings) {
      if (
        pairing.codeHash === codeHash &&
        pairing.origin === origin &&
        pairing.usedAt === null &&
        pairing.expiresAt > now
      ) {
        const consumed = { ...pairing, usedAt: now };
        store.localConnectorPairings.set(id, consumed);
        return consumed;
      }
    }
    return null;
  },

  async listFreshLocalConnectorDevices(input) {
    const rows = [...getStore().localConnectorDevices.values()]
      .filter(
        (device) =>
          device.organizationId === input.organizationId &&
          device.userId === input.userId &&
          device.origin === input.origin &&
          device.revokedAt === null &&
          device.lastSeenAt !== null &&
          device.lastSeenAt >= input.seenAfter
      )
      .sort((a, b) =>
        a.lastSeenAt! < b.lastSeenAt! ? 1 : a.lastSeenAt! > b.lastSeenAt! ? -1 : 0
      );
    return input.limit === undefined ? rows : rows.slice(0, input.limit);
  },

  async claimNextLocalInferenceJob({ deviceId, now, sweep = true }) {
    const store = getStore();
    if (sweep) {
      for (const [id, job] of store.localInferenceJobs) {
        if (job.deviceId === deviceId && job.expiresAt < now) {
          store.localInferenceJobs.delete(id);
        }
      }
    }
    const pending = [...store.localInferenceJobs.values()]
      .filter(
        (job) =>
          job.deviceId === deviceId &&
          job.status === "pending" &&
          job.expiresAt > now
      )
      .sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
      )[0];
    if (!pending) return null;
    const claimed: LocalInferenceJob = {
      ...pending,
      status: "claimed",
      claimedAt: now,
    };
    store.localInferenceJobs.set(pending.id, claimed);
    return claimed;
  },

  async completeLocalInferenceJob(input) {
    const store = getStore();
    const job = store.localInferenceJobs.get(input.jobId);
    if (!job || job.deviceId !== input.deviceId || job.status !== "claimed") {
      return false;
    }
    const failed = Boolean(input.error);
    store.localInferenceJobs.set(input.jobId, {
      ...job,
      status: failed ? "failed" : "completed",
      result: input.result ?? null,
      error: input.error ?? null,
      completedAt: input.now,
    });
    return true;
  },

  // --- Platform settings (single row) ----------------------------------------

  async getPlatformSystemPromptOverride() {
    return getStore().platformSettings.systemPrompt;
  },

  async setPlatformSystemPrompt(prompt, updatedBy) {
    getStore().platformSettings = {
      systemPrompt: prompt,
      updatedBy,
      updatedAt: new Date().toISOString(),
    };
  },

  // --- Skills (reusable prompt templates) -----------------------------------
  // Plain CRUD moved to `table("skills")` (ADR-0016 stage 3); the delete
  // stays named for its assistant_skills cascade below.

  async deleteSkill(id) {
    const store = getStore();
    store.skills.delete(id);
    for (const [assistantId, ids] of store.assistantSkills) {
      store.assistantSkills.set(
        assistantId,
        ids.filter((skillId) => skillId !== id)
      );
    }
  },

  async listAssistantSkills(assistantId) {
    const store = getStore();
    return (store.assistantSkills.get(assistantId) ?? [])
      .map((id) => store.skills.get(id))
      .filter((s): s is Skill => !!s);
  },

  async setAssistantSkills(assistantId, skillIds) {
    getStore().assistantSkills.set(assistantId, [...skillIds]);
  },

  // --- Entities + Records (#663) ----------------------------------------

  async upsertEntityRecords(entityId, rows) {
    const store = getStore();
    const now = new Date().toISOString();
    const byKey = new Map(
      [...store.entityRecords.values()]
        .filter((r) => r.entityId === entityId)
        .map((r) => [r.key, r])
    );
    let written = 0;
    for (const row of rows) {
      const existing = byKey.get(row.key);
      if (existing) {
        if (entityRecordValuesEqual(existing.values, row.values)) continue;
        store.entityRecords.set(existing.id, {
          ...existing,
          values: row.values,
          updatedAt: now,
        });
        written += 1;
      } else {
        const record: EntityRecord = {
          id: shortId(),
          entityId,
          key: row.key,
          values: row.values,
          createdAt: now,
          updatedAt: now,
        };
        store.entityRecords.set(record.id, record);
        byKey.set(record.key, record);
        written += 1;
      }
    }
    return written;
  },

  async listEntityRecords(entityId, opts) {
    const limit = opts?.limit ?? 50;
    const offset = opts?.offset ?? 0;
    return [...getStore().entityRecords.values()]
      .filter((r) => r.entityId === entityId)
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .slice(offset, offset + limit);
  },

  async countEntityRecords(entityId) {
    return [...getStore().entityRecords.values()].filter(
      (r) => r.entityId === entityId
    ).length;
  },

  async queryEntityRecords(entityId, query) {
    const filters = Object.entries(query.filters ?? {});
    const search = query.search?.trim().toLowerCase();
    const textKeys = new Set(
      (getStore().entities.get(entityId)?.attributes ?? [])
        .filter((attribute) => attribute.type === "text")
        .map((attribute) => attribute.key)
    );
    return [...getStore().entityRecords.values()]
      .filter((r) => r.entityId === entityId)
      .filter((r) => filters.every(([key, value]) => r.values[key] === value))
      .filter(
        (r) =>
          !search ||
          Object.entries(r.values).some(
            ([key, value]) =>
              textKeys.has(key) &&
              value != null &&
              String(value).toLowerCase().includes(search)
          )
      )
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .slice(0, query.limit ?? 20);
  },

  // --- Long-term memories (#664) ----------------------------------------

  async getMemoryEnabled(organizationId) {
    return getStore().memoryEnabled.has(organizationId);
  },

  async setMemoryEnabled(organizationId, enabled) {
    const store = getStore();
    if (enabled) store.memoryEnabled.add(organizationId);
    else store.memoryEnabled.delete(organizationId);
  },

  async upsertMemories(subject, items) {
    const store = getStore();
    const { organizationId, subjectId } = subject;
    const erasedAt = store.memoryErasedAt.get(`${organizationId}:${subjectId}`);
    const existing = new Set(
      [...store.memories.values()]
        .filter((m) => m.organizationId === organizationId && m.subjectId === subjectId)
        .map((m) => m.text)
    );
    let inserted = 0;
    for (const item of items) {
      const sourceConversation = item.conversationId
        ? store.conversations.get(item.conversationId)
        : null;
      if (
        erasedAt &&
        sourceConversation &&
        sourceConversation.createdAt <= erasedAt
      ) {
        continue;
      }
      const text = item.text.trim();
      if (!text || existing.has(text)) continue;
      existing.add(text);
      const memory: Memory = {
        id: shortId(),
        organizationId,
        subjectId,
        text,
        conversationId: item.conversationId ?? null,
        createdAt: new Date(monotonicNow()).toISOString(),
      };
      store.memories.set(memory.id, memory);
      inserted += 1;
    }
    // Cap enforcement: drop-oldest beyond MEMORIES_PER_SUBJECT_CAP.
    const all = [...store.memories.values()]
      .filter((m) => m.organizationId === organizationId && m.subjectId === subjectId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    for (const stale of all.slice(0, Math.max(0, all.length - MEMORIES_PER_SUBJECT_CAP))) {
      store.memories.delete(stale.id);
    }
    return inserted;
  },

  async listMemories({ organizationId, subjectId }) {
    return [...getStore().memories.values()]
      .filter((m) => m.organizationId === organizationId && m.subjectId === subjectId)
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
  },

  async deleteMemory(id) {
    getStore().memories.delete(id);
  },

  async getMemory(id) {
    return getStore().memories.get(id) ?? null;
  },

  // --- Synced Record ingestion (#670) ------------------------------------

  async getEntitySyncConfig(entityId) {
    return getStore().entitySyncConfigs.get(entityId) ?? null;
  },

  async upsertEntitySyncConfig(entityId, input) {
    const store = getStore();
    const existing = store.entitySyncConfigs.get(entityId);
    const config: EntitySyncConfig = {
      entityId,
      url: input.url,
      sealedHeaders: input.sealedHeaders ?? null,
      cadenceHours: input.cadenceHours,
      prune: input.prune,
      mapping: { ...input.mapping },
      lastSyncedAt: existing?.lastSyncedAt ?? null,
    };
    store.entitySyncConfigs.set(entityId, config);
    return config;
  },

  async deleteEntitySyncConfig(entityId) {
    getStore().entitySyncConfigs.delete(entityId);
  },

  async markEntitySynced(entityId, at) {
    const store = getStore();
    const config = store.entitySyncConfigs.get(entityId);
    if (config) store.entitySyncConfigs.set(entityId, { ...config, lastSyncedAt: at });
  },

  async listDueEntitySyncConfigs(now) {
    const store = getStore();
    const due: Array<{ entityId: string; organizationId: string }> = [];
    for (const config of store.entitySyncConfigs.values()) {
      const entity = store.entities.get(config.entityId);
      if (!entity) continue;
      if (config.lastSyncedAt) {
        const nextAt =
          new Date(config.lastSyncedAt).getTime() +
          config.cadenceHours * 3_600_000;
        if (nextAt > new Date(now).getTime()) continue;
      }
      due.push({ entityId: config.entityId, organizationId: entity.organizationId });
    }
    return due;
  },

  async recordEntitySyncRun(entityId, run) {
    const store = getStore();
    const record: EntitySyncRun = {
      id: shortId(),
      entityId,
      status: run.status,
      upserted: run.upserted,
      pruned: run.pruned,
      rejected: [...run.rejected],
      error: run.error ?? null,
      finishedAt: new Date(monotonicNow()).toISOString(),
    };
    store.entitySyncRuns.set(record.id, record);
    return record;
  },

  async createApplicationSyncJobIfAbsent(input) {
    const activeJobs = [...getStore().backgroundJobs.values()].filter(
      (job) =>
        job.kind === "sync_application_import" &&
        (job.status === "queued" || job.status === "running") &&
        job.payload.organizationId === input.organizationId
    );
    if (activeJobs.some((job) => job.payload.importId === input.importId)) return false;
    if (activeJobs.length >= (input.maxConcurrent ?? 3)) return false;
    await mockDb.createBackgroundJob({
      kind: "sync_application_import",
      payload: { kind: "sync_application_import", ...input },
      nextRunAt: input.nextRunAt,
    });
    return true;
  },

  async cancelApplicationSyncJobs(importId, reason) {
    const store = getStore();
    for (const [id, job] of store.backgroundJobs) {
      if (
        job.kind === "sync_application_import" &&
        job.status === "queued" &&
        job.payload.importId === importId
      ) {
        store.backgroundJobs.set(id, {
          ...job,
          status: "failed",
          error: reason,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  },

  async commitEntitySync(input) {
    const store = getStore();
    const config = store.entitySyncConfigs.get(input.entityId);
    if (!config) throw new Error("Entity sync config not found");
    if (config.lastSyncedAt !== input.expectedLastSyncedAt) {
      return this.recordEntitySyncRun(input.entityId, {
        status: "failed",
        upserted: 0,
        pruned: 0,
        rejected: input.rejected,
        error: "Superseded by a newer sync",
      });
    }
    const upserted = await this.upsertEntityRecords(input.entityId, input.rows);
    const pruned =
      input.prune && input.rows.length > 0
        ? await this.pruneEntityRecords(
            input.entityId,
            input.rows.map((row) => row.key)
          )
        : 0;
    store.entitySyncConfigs.set(input.entityId, {
      ...config,
      lastSyncedAt: input.at,
    });
    return this.recordEntitySyncRun(input.entityId, {
      status: "succeeded",
      upserted,
      pruned,
      rejected: input.rejected,
      error: null,
    });
  },

  async listEntitySyncRuns(entityId, limit = 20) {
    return [...getStore().entitySyncRuns.values()]
      .filter((r) => r.entityId === entityId)
      // Newest first, `id` breaking a tie, matching the adapter's
      // `finished_at desc, id desc`. The stamps are monotonic, so the
      // tiebreaker never fires here; it keeps the two sorts one rule.
      .sort(
        (a, b) =>
          b.finishedAt.localeCompare(a.finishedAt) || b.id.localeCompare(a.id)
      )
      .slice(0, limit);
  },

  async pruneEntityRecords(entityId, seenKeys) {
    const store = getStore();
    const seen = new Set(seenKeys);
    let removed = 0;
    for (const [id, record] of store.entityRecords) {
      if (record.entityId !== entityId) continue;
      if (seen.has(record.key)) continue;
      store.entityRecords.delete(id);
      removed += 1;
    }
    return removed;
  },

  async listMemorySubjects(organizationId) {
    const store = getStore();
    const bySubject = new Map<string, { count: number; last: string }>();
    for (const memory of store.memories.values()) {
      if (memory.organizationId !== organizationId) continue;
      const entry = bySubject.get(memory.subjectId);
      if (!entry) {
        bySubject.set(memory.subjectId, { count: 1, last: memory.createdAt });
      } else {
        entry.count += 1;
        if (memory.createdAt > entry.last) entry.last = memory.createdAt;
      }
    }
    const claimFor = (subjectId: string): string | null => {
      let claim: string | null = null;
      let latest = "";
      for (const conversation of store.conversations.values()) {
        if (conversation.subjectType !== "sso") continue;
        if (conversation.subjectId !== subjectId) continue;
        const assistant = assistantOfConversation(conversation);
        if (assistant?.organizationId !== organizationId) continue;
        const value = conversation.metadata.ssoClaimValue;
        if (value && conversation.createdAt > latest) {
          latest = conversation.createdAt;
          claim = value;
        }
      }
      return claim;
    };
    const summaries: MemorySubjectSummary[] = [...bySubject.entries()].map(
      ([subjectId, entry]) => ({
        subjectId,
        claimValue: claimFor(subjectId),
        memoryCount: entry.count,
        lastMemoryAt: entry.last,
      })
    );
    return summaries.sort((a, b) => (a.lastMemoryAt > b.lastMemoryAt ? -1 : 1));
  },

  async listMemorySubjectsPage(organizationId, input) {
    const limit = Math.max(1, Math.min(Math.trunc(input.limit), 100));
    const ordered = await this.listMemorySubjects(organizationId);
    let after: [string, string] | null = null;
    if (input.cursor) {
      try {
        const decoded = JSON.parse(input.cursor) as [string, string];
        if (typeof decoded[0] !== "string" || typeof decoded[1] !== "string") {
          throw new Error("Invalid memory subject cursor");
        }
        after = decoded;
      } catch {
        throw new Error("Invalid memory subject cursor");
      }
    }
    const remaining = after
      ? ordered.filter(
          (item) =>
            item.lastMemoryAt < after![0] ||
            (item.lastMemoryAt === after![0] && item.subjectId > after![1])
        )
      : ordered;
    const slice = remaining.slice(0, limit + 1);
    const hasMore = slice.length > limit;
    const items = slice.slice(0, limit);
    return {
      items,
      nextCursor: hasMore
        ? JSON.stringify([items.at(-1)!.lastMemoryAt, items.at(-1)!.subjectId])
        : null,
    };
  },

  async listEntitiesPage(organizationId, input) {
    const limit = Math.max(1, Math.min(Math.trunc(input.limit), 100));
    const ordered = [...getStore().entities.values()]
      .filter((entity) => entity.organizationId === organizationId)
      // Code-unit order, because the cursor filter below uses `>`. localeCompare
      // here made the two comparisons disagree for ids containing "-" (locale
      // collation shifts punctuation), so the page after the cursor could come
      // back empty for an id the sort had placed later.
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const nextIndex = input.cursor
      ? ordered.findIndex((entity) => entity.id > input.cursor!)
      : 0;
    const start = nextIndex < 0 ? ordered.length : nextIndex;
    const slice = ordered.slice(Math.max(0, start), Math.max(0, start) + limit + 1);
    const hasMore = slice.length > limit;
    const items = slice.slice(0, limit);
    return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
  },

  async deleteSubjectMemories({ organizationId, subjectId }) {
    const store = getStore();
    store.memoryErasedAt.set(
      `${organizationId}:${subjectId}`,
      new Date(monotonicNow()).toISOString()
    );
    for (const [id, memory] of store.memories) {
      if (memory.organizationId === organizationId && memory.subjectId === subjectId) {
        store.memories.delete(id);
      }
    }
  },

  async searchMemories({ organizationId, subjectId }, query) {
    // Lexical scoring only (the demo store has no vectors): the shared
    // token-overlap score from hybrid-search.ts.
    const tokens = lexicalTokens(query.text);
    const results: MemorySearchResult[] = [];
    for (const memory of getStore().memories.values()) {
      if (memory.organizationId !== organizationId) continue;
      if (memory.subjectId !== subjectId) continue;
      const similarity = lexicalScore(memory.text, tokens);
      if (similarity === 0) continue;
      results.push({
        id: memory.id,
        text: memory.text,
        similarity,
      });
    }
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, query.limit ?? 5);
  },

  // --- Generic table access (ADR-0016) ---------------------------------

  table(name) {
    return mockTable(name);
  },
};
