import { entityRecordValuesEqual } from "./entity-records";
import type {
  AiUsageInput,
  Alert,
  AnswerVerdictInput,
  ApiIntegration,
  Assistant,
  AssistantAccessEntry,
  AssistantAccessRole,
  AssistantGoal,
  AssistantInput,
  AssistantPatch,
  BackgroundJob,
  CompostDigest,
  Concept,
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
  InboxConversation,
  Invite,
  KnowledgeCollection,
  KnowledgeSearchResult,
  LocalConnectorDevice,
  LocalConnectorPairing,
  LocalInferenceJob,
  Member,
  Memory,
  MemorySearchResult,
  MemorySubjectSummary,
  OrgApiKey,
  OrgApiKeyInput,
  Organization,
  OrganizationPatch,
  OrgBudget,
  Profile,
  ProfilePatch,
  ProviderConnection,
  Publication,
  RuntimeEventInput,
  Skill,
  Source,
  SsoConnection,
  StoredMessage,
  SupportChannel,
  TicketingIntegration,
  TrustSignal,
  UsageDailyRow,
  UsageMeterRow,
  VerifiableAnswer,
} from "@agent-hub/core";
import {
  ASSISTANT_GOAL_CAP,
  buildPublicationConfig,
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
  /** `${assistantId}:${userId}` → per-assistant role override (PRD #296). */
  assistantAccess: Map<
    string,
    { assistantId: string; userId: string; role: AssistantAccessRole; grantedAt: string; grantedBy: string | null }
  >;
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
  conversations: Map<string, Conversation>;
  messages: Map<string, StoredMessage>;
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
  /** organizationId → daily token budget. */
  orgBudgets: Map<string, OrgBudget>;
  goals: Map<string, AssistantGoal>;
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
  exportJobs: Map<string, ExportJob>;
  crawlFinalizeClaims: Map<string, Pick<CrawlFinalizeClaim, "workerId" | "now">>;
  crawlFinalizeAttemptedAt: Map<string, string>;
  collections: Map<string, KnowledgeCollection>;
  sources: Map<string, Source>;
  concepts: Map<string, Concept>;
  chunks: Map<
    string,
    {
      id: string;
      conceptId: string;
      collectionId: string;
      assistantId: string;
      content: string;
      /** Kept only so the re-embed backfill can see missing embeddings. */
      embedding: number[] | null;
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
  /** Org-level data assistant Entity selection (#668). */
  dataAssistantEntities: Map<string, string[]>;
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
    assistantAccess: new Map(),
    invites: new Map(),
    apiKeys: new Map(),
    connections: new Map(),
    embeddingConnections: new Map(),
    ssoConnections: new Map(),
    apiIntegrations: new Map(),
    conversations: new Map(),
    messages: new Map(),
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
    goals: new Map(),
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
    exportJobs: new Map(),
    crawlFinalizeClaims: new Map(),
    crawlFinalizeAttemptedAt: new Map(),
    collections: new Map(),
    sources: new Map(),
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
    dataAssistantEntities: new Map(),
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
      "Alex's personal assistant — answers questions about Alex Bianchi from his CV, portfolio website, and FAQs.",
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
      "End every answer with a new line containing exactly: — Ask me anything else about Alex! 👋",
    createdAt: at,
    updatedAt: at,
  };
  store.skills.set(skill.id, skill);
  store.assistantSkills.set(assistantId, [skill.id]);
}

/**
 * Seeds the "Alex" assistant's knowledge (FAQ, CV document, portfolio
 * website) directly into the store — bypassing the ingest pipeline, which
 * needs a running server (embeddings, crawling) this sync seed can't call.
 * Without this, every demo restart wipes the knowledge testers just added
 * through the UI, since the mock store lives only in memory.
 */
function seedKnowledgeDemo(store: MockStore) {
  const assistantId = "GlQMYjuZ6xcO";
  if (!store.assistants.has(assistantId)) return;
  const at = new Date().toISOString();

  const collection: KnowledgeCollection = {
    id: "col-alex-general",
    assistantId,
    name: "General knowledge",
    description: "Default collection for this assistant",
    createdAt: at,
  };
  store.collections.set(collection.id, collection);

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
      assistantId,
      content: `${input.frontmatter.title ?? input.path}\n\n${input.body}`,
      embedding: null,
    });
  }

  // FAQ — "Chi è Alex?"
  addConcept({
    id: "concept-alex-faq-chi-e",
    sourceId: null,
    path: "faq/chi-e-alex.md",
    frontmatter: {
      type: "FAQ",
      title: "Chi è Alex?",
      description: "Alex Bianchi è un ingegnere che lavora su progetti di intelligenza artificiale.",
      // Hand-written then signed off — the demo's one human-reviewed concept,
      // so the Knowledge browser shows every trust tier out of the box.
      generated: { by: okfActor.human(DEMO_MEMBER.userId), at },
      verified: [{ by: okfActor.human(DEMO_MEMBER.userId), at }],
    },
    body: "Alex Bianchi è un ingegnere che lavora su progetti legati all'intelligenza artificiale. Il suo ultimo lavoro riguarda piattaforme AI e assistenti digitali.",
  });

  // Document — CV
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
    createdAt: at,
    updatedAt: at,
  };
  store.sources.set(cvSource.id, cvSource);
  addConcept({
    id: "concept-alex-cv",
    sourceId: cvSource.id,
    path: "documents/alex-bianchi-cv.md",
    frontmatter: {
      type: "Document",
      title: "Alex Bianchi — CV",
      description: "Imported from file source \"Alex_Bianchi_CV.pdf\"",
      // Machine-drafted from the upload and never confirmed: unverified.
      generated: { by: okfActor.agent("okf-enricher", "demo"), at },
      sources: [{ id: "alex-bianchi-cv", resource: "file source \"Alex_Bianchi_CV.pdf\"", title: cvSource.name }],
    },
    body: "Alex Bianchi — Ingegnere.\n\nPercorso: Software Engineering e progetti di prodotto digitale.\n\nEsperienza: lavora su piattaforme legate all'intelligenza artificiale (AI), automazione e assistenti digitali.\n\nPortfolio personale: https://alexbianchi.example",
  });

  // The enriched CV's verbatim companion (ADR-0002): the extracted text as-is,
  // indexed so detail the rewrite above did not carry is still retrievable.
  addConcept({
    id: "concept-alex-cv-original",
    sourceId: cvSource.id,
    path: "originals/alex-bianchi-cv-pdf.md",
    frontmatter: {
      type: "Source Text",
      title: "Alex_Bianchi_CV.pdf — full text",
      description:
        'Unedited text of file source "Alex_Bianchi_CV.pdf", indexed so detail the enrichment did not carry is still retrievable.',
      generated: { by: okfActor.process("okf-verbatim-index"), at },
      sources: [{ id: "alex-bianchi-cv", resource: "file source \"Alex_Bianchi_CV.pdf\"", title: cvSource.name }],
    },
    body: "ALEX BIANCHI\nIngegnere — Software Engineering & prodotto digitale\n\nESPERIENZA\nPiattaforme di intelligenza artificiale, automazione e assistenti digitali.\nManifold Drone Synchronization — Singapore, 2019.\nArdupilot Failure — Development, 2020/2021.\n\nFORMAZIONE\nSoftware Engineering.\n\nCONTATTI\nPortfolio: https://alexbianchi.example",
  });

  // Website — alexbianchi.example portfolio, seeded as if already crawled
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
    createdAt: at,
    updatedAt: at,
  };
  store.sources.set(webSource.id, webSource);
  const projects: Array<{ slug: string; title: string; body: string }> = [
    {
      slug: "about",
      title: "About — alexbianchi.example",
      body: "Alex Bianchi — portfolio personale e professionale. Percorso in Software Engineering e prodotto digitale. Lavora su progetti di intelligenza artificiale.",
    },
    {
      slug: "ciao",
      title: "Ciao! — alexbianchi.example",
      body: "Progetto \"Ciao!\" — Software Engineering, Interaction & Development, 2025.",
    },
    {
      slug: "balance-trend-and-forecast",
      title: "Balance trend and forecast — alexbianchi.example",
      body: "Progetto \"Balance trend and forecast\" — Software Engineering, 2022.",
    },
    {
      slug: "covid-korea",
      title: "Covid Korea — alexbianchi.example",
      body: "Progetto \"Covid Korea\" — Data Science, 2021.",
    },
    {
      slug: "macos-resume-template",
      title: "macOS Resume Template — alexbianchi.example",
      body: "Progetto \"macOS Resume Template\" — Design, 2022.",
    },
    {
      slug: "ardupilot-failure",
      title: "Ardupilot Failure — alexbianchi.example",
      body: "Progetto \"Ardupilot Failure\" — Development, 2020/2021.",
    },
    {
      slug: "manifold-drone-synchronization",
      title: "Manifold Drone Synchronization — alexbianchi.example",
      body: "Progetto \"Manifold Drone Synchronization\" — Development, Singapore, 2019.",
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
}

/**
 * Seeds a working escalation path: support channels on both the IT Support
 * desk (email + live chat, auto-generate improvements on) and the Sales
 * Support desk (email always-available + phone weekdays 10:30-19:00
 * Europe/Rome) — plus the TEST assistant's desk selection and starter
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
    const collections = [...store.collections.values()].filter(
      (c) => c.assistantId === assistant.id
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
    assistantId: "Vrp47KxooVPk",
    name: "Customer onboarding",
    description: "",
    createdAt: at1(0, 0),
  });

  const conv2: Conversation = {
    id: "conv-demo-onboarding",
    assistantId: "Vrp47KxooVPk",
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

/** Store binding per DbTableMap table — the mock's one-line cost of mapping
 * a new table onto the generic accessor (ADR-0016). */
const MOCK_TABLE_STORES: {
  [K in DbTableName]: () => Map<string, DbTableRow<K>>;
} = {
  entities: () => getStore().entities,
  cookieConsentRecords: () => getStore().cookieConsentRecords,
  skills: () => getStore().skills,
  localConnectorPairings: () => getStore().localConnectorPairings,
  localConnectorDevices: () => getStore().localConnectorDevices,
  localInferenceJobs: () => getStore().localInferenceJobs,
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
      // Mirror the database FK cascade for mapped Entity rows.
      if (name === "entities") {
        for (const [recordId, record] of getStore().entityRecords) {
          if (record.entityId === id) getStore().entityRecords.delete(recordId);
        }
      }
    },
  };
}

/** One usage_daily rollup row (org retained for scoping the report reads). */
interface UsageDailyAggregate extends UsageDailyRow {
  organizationId: string;
}

/**
 * Maps a raw ledger row's pipeline stage to a usage kind. Mirrors the SQL
 * rollup's `case when stage = 'embed' then 'embedding' else 'chat'` — the two
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
 * branch, including ignoring failed and empty crawls — they produced no metered
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

  async updateMemberRole(_orgId, userId, role) {
    const store = getStore();
    const member = store.members.get(userId);
    if (member) store.members.set(userId, { ...member, role });
  },

  async removeMember(_orgId, userId) {
    const store = getStore();
    store.members.delete(userId);
    // Mirrors the DB trigger: leaving the org clears per-assistant overrides.
    for (const [key, a] of store.assistantAccess) {
      if (a.userId === userId) store.assistantAccess.delete(key);
    }
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
    for (const [key, a] of store.assistantAccess) {
      if (a.assistantId === id) store.assistantAccess.delete(key);
    }
  },

  // --- Assistant access overrides (PRD #296) -----------------------------

  async listAssistantAccess(assistantId) {
    const store = getStore();
    return [...store.assistantAccess.values()]
      .filter((a) => a.assistantId === assistantId)
      .sort((a, b) => a.grantedAt.localeCompare(b.grantedAt))
      .map((a) => {
        const member = store.members.get(a.userId);
        return {
          userId: a.userId,
          email: member?.email ?? "",
          username: member?.username ?? null,
          firstName: member?.firstName ?? null,
          lastName: member?.lastName ?? null,
          avatarUrl: member?.avatarUrl ?? null,
          role: a.role,
          grantedAt: a.grantedAt,
          grantedBy: a.grantedBy,
        } satisfies AssistantAccessEntry;
      });
  },

  async setAssistantAccess(assistantId, userId, role) {
    getStore().assistantAccess.set(`${assistantId}:${userId}`, {
      assistantId,
      userId,
      role,
      grantedAt: new Date().toISOString(),
      grantedBy: DEMO_MEMBER.userId,
    });
  },

  async clearAssistantAccess(assistantId, userId) {
    getStore().assistantAccess.delete(`${assistantId}:${userId}`);
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

  async listCollections(assistantId) {
    return [...getStore().collections.values()]
      .filter((c) => c.assistantId === assistantId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  },

  async getCollection(id) {
    return getStore().collections.get(id) ?? null;
  },

  async createCollection(assistantId, input) {
    const collection: KnowledgeCollection = {
      id: shortId(),
      assistantId,
      name: input.name,
      description: input.description ?? "",
      createdAt: new Date().toISOString(),
    };
    getStore().collections.set(collection.id, collection);
    return collection;
  },

  async deleteCollection(id) {
    const store = getStore();
    store.collections.delete(id);
    for (const [sid, s] of store.sources)
      if (s.collectionId === id) store.sources.delete(sid);
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
    const now = new Date().toISOString();
    const source: Source = {
      id: shortId(),
      collectionId: input.collectionId,
      name: input.name,
      kind: input.kind,
      status: "processing",
      error: "",
      config: input.config ?? {},
      recrawlSchedule: input.recrawlSchedule ?? "never",
      lastCrawledAt: null,
      originalObjectPath: input.originalObjectPath ?? null,
      createdAt: now,
      updatedAt: now,
    };
    getStore().sources.set(source.id, source);
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

  async createBackgroundJob(input) {
    const now = new Date().toISOString();
    const job: BackgroundJob = {
      id: shortId(),
      kind: input.kind,
      sourceId: input.sourceId ?? null,
      status: "queued",
      payload: input.payload,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      nextRunAt: input.nextRunAt ?? now,
      lockedAt: null,
      lockedBy: null,
      error: "",
      createdAt: now,
      updatedAt: now,
    };
    getStore().backgroundJobs.set(job.id, job);
    return job;
  },

  async listBackgroundJobsForSource(sourceId, kind) {
    return [...getStore().backgroundJobs.values()]
      .filter((job) => job.sourceId === sourceId && (!kind || job.kind === kind))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  async claimBackgroundJobs(input) {
    const store = getStore();
    const claimed: BackgroundJob[] = [];
    for (const job of store.backgroundJobs.values()) {
      if (claimed.length >= input.limit) break;
      if (job.kind !== input.kind) continue;
      const queuedAndDue =
        job.status === "queued" && job.nextRunAt <= input.now;
      const runningAndStale =
        job.status === "running" &&
        Boolean(job.lockedAt) &&
        job.lockedAt! <= input.staleBefore;
      if (!queuedAndDue && !runningAndStale) continue;
      if (!runningAndStale && job.attempts >= job.maxAttempts) continue;

      const updated: BackgroundJob = {
        ...job,
        status: "running",
        attempts:
          runningAndStale && job.attempts >= job.maxAttempts
            ? job.attempts
            : job.attempts + 1,
        lockedAt: input.now,
        lockedBy: input.workerId,
        error: "",
        updatedAt: input.now,
      };
      store.backgroundJobs.set(job.id, updated);
      claimed.push(updated);
    }
    return claimed;
  },

  async updateBackgroundJob(id, patch) {
    const store = getStore();
    const job = store.backgroundJobs.get(id);
    if (!job) return;
    store.backgroundJobs.set(id, {
      ...job,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
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
        assistantId: collection.assistantId,
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
        assistantId: collection.assistantId,
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
    for (const [jobId, job] of store.backgroundJobs)
      if (job.sourceId === id) store.backgroundJobs.delete(jobId);
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

  async listConcepts(collectionId) {
    return [...getStore().concepts.values()]
      .filter((c) => c.collectionId === collectionId)
      .sort((a, b) => (a.path < b.path ? -1 : 1));
  },

  async getConcept(id) {
    return getStore().concepts.get(id) ?? null;
  },

  async listNullEmbeddingConceptIds(assistantId) {
    const store = getStore();
    const ids = new Set<string>();
    for (const chunk of store.chunks.values()) {
      if (chunk.assistantId !== assistantId) continue;
      if (chunk.embedding === null) ids.add(chunk.conceptId);
    }
    return [...ids];
  },

  async findFaqConcept(assistantId, question) {
    const store = getStore();
    const normalized = question.trim().toLowerCase();
    if (!normalized) return null;
    for (const concept of store.concepts.values()) {
      if (concept.excluded) continue;
      if (concept.frontmatter.type !== "FAQ") continue;
      if ((concept.frontmatter.title ?? "").trim().toLowerCase() !== normalized)
        continue;
      const collection = store.collections.get(concept.collectionId);
      if (!collection || collection.assistantId !== assistantId) continue;
      return { concept, collectionName: collection.name };
    }
    return null;
  },

  async createConcept(input) {
    const concept: Concept = {
      id: shortId(),
      collectionId: input.collectionId,
      sourceId: input.sourceId,
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
        assistantId: chunk.assistantId,
        content: chunk.content,
        embedding: chunk.embedding ?? null,
      });
    }
  },

  async searchChunks(assistantId, collectionId, query) {
    const store = getStore();
    const tokens = query.text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2);
    const results: KnowledgeSearchResult[] = [];
    for (const chunk of store.chunks.values()) {
      if (chunk.assistantId !== assistantId) continue;
      if (collectionId && chunk.collectionId !== collectionId) continue;
      const haystack = chunk.content.toLowerCase();
      const hits = tokens.filter((t) => haystack.includes(t)).length;
      if (hits === 0) continue;
      const concept = store.concepts.get(chunk.conceptId);
      // Excluded concepts never surface in retrieval (mirrors match_chunks'
      // SQL filter), even if their chunks were retained.
      if (concept?.excluded) continue;
      const collection = store.collections.get(chunk.collectionId);
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
        resourceUrl: concept?.frontmatter.resource ?? null,
        content: chunk.content,
        similarity: hits / Math.max(tokens.length, 1),
      });
    }
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, query.limit ?? 6);
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
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: shortId(),
      assistantId: input.assistantId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      collectionId: input.collectionId ?? null,
      title: input.title ?? "",
      metadata: input.metadata ?? {},
      sessionState: {},
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

  async listInboxConversations(organizationId) {
    const store = getStore();
    const messages = [...store.messages.values()];
    return [...store.conversations.values()]
      .filter(
        (c) =>
          store.assistants.get(c.assistantId)?.organizationId === organizationId
      )
      .map((c): InboxConversation => {
        const own = messages.filter((m) => m.conversationId === c.id);
        const flowNames = [
          ...new Set(own.map((m) => m.flowName).filter((n): n is string => !!n)),
        ];
        const feedback = own.some((m) => m.feedback === 1)
          ? 1
          : own.some((m) => m.feedback === -1)
            ? -1
            : 0;
        return {
          ...c,
          assistantTitle: store.assistants.get(c.assistantId)?.title ?? "",
          collectionName: c.collectionId
            ? (store.collections.get(c.collectionId)?.name ?? null)
            : null,
          messageCount: own.length,
          flowNames,
          notificationOnly:
            own.length > 0 && own.every((m) => isProactiveMessage(m.content)),
          feedback,
        };
      })
      .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
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
    const store = getStore();
    const graphOrgByAssistant = new Map(
      [...store.assistants.values()]
        .filter((a) => (a.knowledgeEngine ?? "graph") === "graph")
        .map((a) => [a.id, a.organizationId])
    );
    return [...store.collections.values()]
      .filter((c) => graphOrgByAssistant.has(c.assistantId))
      .map((c) => ({
        organizationId: graphOrgByAssistant.get(c.assistantId) as string,
        collectionId: c.id,
      }));
  },

  async setConversationPinned(id, pinned) {
    const store = getStore();
    const conversation = store.conversations.get(id);
    if (conversation) store.conversations.set(id, { ...conversation, pinned });
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

  async updateConversationSessionState(id, state) {
    const store = getStore();
    const conversation = store.conversations.get(id);
    if (conversation) {
      store.conversations.set(id, { ...conversation, sessionState: state });
    }
  },

  async deleteConversation(id) {
    const store = getStore();
    store.conversations.delete(id);
    for (const [mid, m] of store.messages) {
      if (m.conversationId === id) store.messages.delete(mid);
    }
  },

  async listMessages(conversationId) {
    return [...getStore().messages.values()]
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  },

  async listRecentMessages(conversationId, limit) {
    return [...getStore().messages.values()]
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .slice(-limit);
  },

  async appendMessage(input) {
    const store = getStore();
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
    store.messages.set(message.id, message);
    const conversation = store.conversations.get(input.conversationId);
    if (conversation) {
      store.conversations.set(conversation.id, {
        ...conversation,
        updatedAt: message.createdAt,
      });
    }
    return message;
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

  async clearExpiredTraces(organizationId, cutoffIso) {
    const store = getStore();
    const cutoff = Date.parse(cutoffIso);
    let cleared = 0;
    for (const [id, message] of store.messages) {
      if (!message.trace) continue;
      if (Date.parse(message.createdAt) >= cutoff) continue;
      const conversation = store.conversations.get(message.conversationId);
      const assistant = conversation
        ? store.assistants.get(conversation.assistantId)
        : undefined;
      if (assistant?.organizationId !== organizationId) continue;
      store.messages.set(id, { ...message, trace: null });
      cleared += 1;
    }
    return cleared;
  },

  async listInsightsMessages(organizationId) {
    const store = getStore();
    const orgConversations = new Set(
      [...store.conversations.values()]
        .filter(
          (c) =>
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

  async createImprovementProposal(input) {
    const store = getStore();
    // At most one live proposal per improvement — replace any prior draft.
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
        const assistant = store.assistants.get(conversation.assistantId);
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

  async listWebsiteSources(organizationId) {
    const store = getStore();
    return [...store.sources.values()].flatMap((source) => {
      if (source.kind !== "website") return [];
      const collection = store.collections.get(source.collectionId);
      const assistant = collection
        ? store.assistants.get(collection.assistantId)
        : undefined;
      if (assistant?.organizationId !== organizationId) return [];
      return [
        {
          id: source.id,
          assistantId: assistant.id,
          name: source.name,
          url: source.config.url ?? "",
        },
      ];
    });
  },

  async getInsightsOverview(organizationId, filters) {
    const [conversations, messages, assistants, channels] = await Promise.all([
      mockDb.listInboxConversations(organizationId),
      mockDb.listInsightsMessages(organizationId),
      mockDb.listAssistants(organizationId),
      mockDb.listWebsiteSources(organizationId),
    ]);
    return computeInsightsOverview(conversations, messages, assistants, channels, filters);
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
    // Recompute the window from the raw ledger — same grouping as the SQL
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

  // --- Standing goals --------------------------------------------------------

  async listAssistantGoals(assistantId) {
    return [...getStore().goals.values()]
      .filter((g) => g.assistantId === assistantId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },

  async createAssistantGoal(assistantId, input) {
    const store = getStore();
    const assistant = store.assistants.get(assistantId);
    if (!assistant) throw new Error(`Assistant ${assistantId} not found`);
    const existing = [...store.goals.values()].filter(
      (g) => g.assistantId === assistantId
    );
    if (existing.length >= ASSISTANT_GOAL_CAP) {
      throw new Error(
        `This assistant already has ${ASSISTANT_GOAL_CAP} goals — remove one first.`
      );
    }
    const goal: AssistantGoal = {
      id: shortId(),
      organizationId: assistant.organizationId,
      assistantId,
      question: input.question,
      status: "active",
      expectations: input.expectations,
      lastRunAt: null,
      lastResult: null,
      lastDetail: null,
      createdAt: new Date().toISOString(),
    };
    store.goals.set(goal.id, goal);
    return goal;
  },

  async updateAssistantGoal(id, patch) {
    const store = getStore();
    const current = store.goals.get(id);
    if (!current) throw new Error(`Goal ${id} not found`);
    const updated: AssistantGoal = {
      ...current,
      question: patch.question ?? current.question,
      expectations: patch.expectations ?? current.expectations,
      status: patch.status ?? current.status,
    };
    store.goals.set(id, updated);
    return updated;
  },

  async deleteAssistantGoal(id) {
    getStore().goals.delete(id);
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
      const assistant = store.assistants.get(conversation.assistantId);
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
    // Priority sampling: human signals first — 👎, then escalated
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
        ? store.assistants.get(conversation.assistantId)
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

  async listDueCompostAssistants({ dueBefore, limit }) {
    const store = getStore();
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
    return due
      .sort((a, b) => (a.lastRunAt ?? "").localeCompare(b.lastRunAt ?? ""))
      .slice(0, limit);
  },

  async claimDueCompostAssistants({ dueBefore, staleBefore, limit }) {
    const store = getStore();
    // The due set minus any assistant with a fresh claim (a stale claim is
    // re-claimable), then stamp the claim at window start.
    const due = (
      await this.listDueCompostAssistants({ dueBefore, limit: 1_000 })
    )
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
    // snapshot — so a demotion mid-window still counts even if a later
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

  async claimNextLocalInferenceJob({ deviceId, now }) {
    const store = getStore();
    for (const [id, job] of store.localInferenceJobs) {
      if (job.deviceId === deviceId && job.expiresAt < now) {
        store.localInferenceJobs.delete(id);
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

  async listSkills(organizationId) {
    return [...getStore().skills.values()]
      .filter((s) => s.organizationId === organizationId)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  },

  async createSkill(organizationId, input) {
    const now = new Date().toISOString();
    const skill: Skill = {
      id: shortId(),
      organizationId,
      name: input.name,
      description: input.description ?? "",
      prompt: input.prompt,
      createdAt: now,
      updatedAt: now,
    };
    getStore().skills.set(skill.id, skill);
    return skill;
  },

  async updateSkill(id, patch) {
    const store = getStore();
    const current = store.skills.get(id);
    if (!current) throw new Error(`Skill ${id} not found`);
    const updated: Skill = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    store.skills.set(id, updated);
    return updated;
  },

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

  async listEntitySyncRuns(entityId, limit = 20) {
    return [...getStore().entitySyncRuns.values()]
      .filter((r) => r.entityId === entityId)
      .sort((a, b) => (a.finishedAt > b.finishedAt ? -1 : 1))
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

  async getDataAssistantEntityIds(organizationId) {
    return getStore().dataAssistantEntities.get(organizationId) ?? [];
  },

  async setDataAssistantEntityIds(organizationId, entityIds) {
    getStore().dataAssistantEntities.set(organizationId, [...entityIds]);
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
        const assistant = store.assistants.get(conversation.assistantId);
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
    // Lexical scoring only (the demo store has no vectors) — token overlap,
    // mirroring the mock searchChunks.
    const tokens = query.text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 2);
    const results: MemorySearchResult[] = [];
    for (const memory of getStore().memories.values()) {
      if (memory.organizationId !== organizationId) continue;
      if (memory.subjectId !== subjectId) continue;
      const haystack = memory.text.toLowerCase();
      const hits = tokens.filter((t) => haystack.includes(t)).length;
      if (hits === 0) continue;
      results.push({
        id: memory.id,
        text: memory.text,
        similarity: hits / Math.max(tokens.length, 1),
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
