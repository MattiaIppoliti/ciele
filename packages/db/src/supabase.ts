import type { SupabaseClient } from "@supabase/supabase-js";
import {
  RETRIEVAL_OVERFETCH,
  capPerSource,
  hybridRetrieve,
  lexicalTokens,
  LEXICAL_SIMILARITY,
} from "./hybrid-search";
import {
  finalizeImprovementPage,
  normalizeImprovementPageInput,
} from "./improvement-pagination";
import type {
  Alert,
  AlertStatus,
  Organization,
  MemoryDocument,
  MemoryDocumentEntry,
  MemoryDocumentOwner,
  TeammateRoutine,
  AlertType,
  ApiEndpointSpec,
  ApiIntegration,
  ApiIntegrationAuthType,
  ApplicationConnection,
  ApplicationImport,
  ApplicationSource,
  ApplicationSyncRun,
  Assistant,
  AssistantGoal,
  AssistantPatch,
  AssistantTools,
  BackgroundJob,
  ChannelAvailability,
  ChannelAuthorType,
  ChannelConversationData,
  ChannelMessage,
  ChannelFormField,
  ChannelKind,
  Concept,
  ConceptFrontmatter,
  Conversation,
  ConversationMetadata,
  Entity,
  EntityRecord,
  EntityRecordValue,
  EntitySyncConfig,
  EntitySyncRun,
  ExportJob,
  Flow,
  FlowAction,
  FlowActionSettings,
  FlowCondition,
  FlowConditionLogic,
  FlowPatch,
  FlowTrigger,
  FlowTriggerSettings,
  FlowTrust,
  FlowTrustEvent,
  HelpDesk,
  HelpDeskSettings,
  Improvement,
  ImprovementAssociation,
  ImprovementListItem,
  ImprovementMessageLink,
  ImprovementPriority,
  ImprovementProposal,
  ImprovementProposalPayload,
  ImprovementProposalStatus,
  ImprovementStatus,
  InboxConversation,
  InboxConversationReview,
  InboxFacets,
  InboxPage,
  InsightsOverview,
  Invite,
  KnowledgeCollection,
  KnowledgeEngine,
  KnowledgeSearchResult,
  LocalConnectorDevice,
  LocalConnectorPairing,
  LocalInferenceJob,
  Member,
  Memory,
  MemorySubjectSummary,
  OrgApiKey,
  OrgApiKeyInput,
  OrganizationPatch,
  Profile,
  ProfilePatch,
  Provider,
  ProviderConnection,
  ProviderConnectionConfig,
  ProviderConnectionProvider,
  ProviderConnectionType,
  Publication,
  PublicationConfig,
  QuickReplyButton,
  RecrawlSchedule,
  Role,
  Skill,
  Source,
  SsoConnection,
  SsoConnectionConfig,
  SsoProviderKind,
  SsoValidationStatus,
  StoredMessage,
  StoredTurnTrace,
  SupportChannel,
  SupportChannelConfig,
  TicketingIntegration,
  UsageDailyRow,
  UsageMeterRow,
  UsageKind,
  WidgetStyle,
} from "@agent-hub/core";
import {
  ASSISTANT_GOAL_CAP,
  capMemoryDocument,
  colorizeOverview,
  DEFAULT_AI_DISCLAIMER,
  DEFAULT_FLOWS,
  DEFAULT_WELCOME_MESSAGE,
  defaultChannelConversationData,
  estimateCostEur,
  FLOW_TRUST_EVENT_RETENTION,
  GOAL_RUN_RETENTION,
  IMPROVEMENT_STATUS_VALUES,
  isProactiveMessage,
  MEMORIES_PER_SUBJECT_CAP,
  memoryDocumentScope,
  monotonicNow,
  normalizeChannelAvailability,
  shortId,
  sortFlows,
} from "@agent-hub/core";

import {
  DB_TABLE_SPECS,
  camelToSnakeKey,
  domainToRow,
  newTableRowId,
  rowToDomain,
  type DbTableAccessor,
  type DbTableName,
  type DbTableRow,
} from "./table-access";
import { entityRecordValuesEqual } from "./entity-records";
import {
  decodeInboxCursor,
  encodeInboxCursor,
  inboxPageSize,
} from "./inbox";
import type { Db } from "./types";
import { resolveApplicationConnectionOwner } from "./application-connections";

function isSchemaLagError(error: unknown): boolean {
  const value = error as { code?: string; message?: string } | null;
  return (
    value?.code === "42883" ||
    value?.code === "42703" ||
    value?.code === "PGRST202" ||
    value?.code === "PGRST204" ||
    /does not exist|schema cache/i.test(value?.message ?? "")
  );
}

/**
 * The organization columns the current schema has, and the set one migration
 * behind it (`transcript_retention_days` landed in 20260830130000). Every
 * organization read tries the first and falls back to the second on a
 * schema-lag error, because these reads run on every request and the Vercel
 * deploy is live minutes before the CI migrate job (supabase/CLAUDE.md).
 */
const ORGANIZATION_COLUMNS =
  "id, name, logo_url, trace_retention_days, transcript_retention_days, created_at";
const ORGANIZATION_COLUMNS_LEGACY =
  "id, name, logo_url, trace_retention_days, created_at";

interface OrganizationRow {
  id: string;
  name: string;
  logo_url: string | null;
  trace_retention_days: number | null;
  /** Absent when the row was read with the legacy column list. */
  transcript_retention_days?: number | null;
  created_at: string;
}

function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logo_url,
    traceRetentionDays: row.trace_retention_days,
    transcriptRetentionDays: row.transcript_retention_days ?? null,
    createdAt: row.created_at,
  };
}

interface AssistantRow {
  id: string;
  organization_id: string;
  title: string;
  nickname: string;
  description: string;
  avatar_url: string | null;
  welcome_message: string;
  ai_disclaimer: string | null;
  suggested_questions: string[];
  quick_replies: QuickReplyButton[] | null;
  answering_style: string | null;
  simplified_thinking: boolean | null;
  chat_launcher_enabled: boolean;
  model_provider: Provider;
  model_id: string;
  style: WidgetStyle | null;
  allowed_domains: string[] | null;
  help_desk_settings: HelpDeskSettings | null;
  tools: AssistantTools | null;
  require_sign_in: boolean | null;
  knowledge_engine: KnowledgeEngine | null;
  created_at: string;
  updated_at: string;
}

interface HelpDeskRow {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  auto_generate_improvements: boolean | null;
  ticketing_integration: TicketingIntegration | null;
  created_at: string;
  updated_at: string;
}

function toHelpDesk(row: HelpDeskRow): HelpDesk {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description ?? "",
    autoGenerateImprovements: row.auto_generate_improvements ?? false,
    ticketingIntegration: row.ticketing_integration ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

interface SupportChannelRow {
  id: string;
  help_desk_id: string;
  kind: ChannelKind;
  name: string;
  position: number;
  enabled: boolean;
  config: SupportChannelConfig | null;
  form_title: string | null;
  form: ChannelFormField[] | null;
  confirmation_message: string | null;
  conversation_data: ChannelConversationData | null;
  availability: ChannelAvailability | null;
  created_at: string;
  updated_at: string;
}

function toSupportChannel(row: SupportChannelRow): SupportChannel {
  return {
    id: row.id,
    helpDeskId: row.help_desk_id,
    kind: row.kind,
    name: row.name,
    position: row.position,
    enabled: row.enabled,
    config: row.config ?? {},
    formTitle: row.form_title ?? "Send us a message",
    form: row.form ?? [],
    confirmationMessage: row.confirmation_message ?? "",
    conversationData: row.conversation_data ?? defaultChannelConversationData(),
    availability: normalizeChannelAvailability(row.availability),
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

interface ConnectionRow {
  id: string;
  organization_id: string;
  type: ProviderConnectionType;
  provider: ProviderConnectionProvider;
  display_name: string;
  encrypted_key: string | null;
  key_hint: string | null;
  config: ProviderConnectionConfig | null;
  created_by: string | null;
  created_at: string;
}

interface SsoConnectionRow {
  id: string;
  organization_id: string;
  provider: SsoProviderKind;
  // `not null default '{}'` in the schema; setSsoConnection always writes a
  // full config, so this is never null in practice.
  config: SsoConnectionConfig;
  encrypted_secret: string | null;
  validation_status: SsoValidationStatus;
  validated_at: string | null;
  connected_at: string;
  updated_at: string;
}

interface ConversationRow {
  id: string;
  assistant_id: string | null;
  teammate_id: string | null;
  subject_type: "member" | "visitor";
  subject_id: string;
  collection_id: string | null;
  title: string;
  metadata: ConversationMetadata | null;
  session_state: Record<string, unknown> | null;
  session_version?: number | null;
  pinned: boolean | null;
  legal_hold?: boolean | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: unknown[];
  flow_id: string | null;
  flow_name: string | null;
  feedback: -1 | 0 | 1;
  trace: StoredTurnTrace | null;
  created_at: string;
}

/**
 * Turns raw chunk hits into citable results: the Concept behind each chunk, its
 * Collection and Source, and (for an Assistant search) whether that Assistant
 * was granted Direct access to the Source's original file.
 *
 * Shared by both searches, `searchChunks` (an Assistant's linked Sources) and
 * `searchCollectionChunks` (a Teammate's Knowledge Scope), because a citation
 * must look identical whichever one produced it (ADR-0002). Passing a null
 * `assistantId` means there is no Direct access grant to read.
 */
type ChunkRow = { concept_id: string; content: string; similarity: number };
/** The query shape the three `Db.search*Chunks` methods accept. */
type ChunkSearchQuery = Parameters<Db["searchChunks"]>[2];

/**
 * The one hybrid chunk search the three scoped searches share (#801 review):
 * over-fetch for the per-Source cap, vector RPC with the embedding space,
 * lexical top-up over the same scope, hydrate, cap back to the caller's
 * limit. Three copies of this body had already grown three identical comment
 * blocks; the differences are the RPC and the scope filter, so those are the
 * parameters.
 *
 * Two schema-lag fallbacks live here, so every scope gets them:
 *  - the vector RPC is retried without `p_embedding_space` when the database
 *    still has the four-argument signature (PGRST202 / 42883), which is the
 *    pre-20260830234500 behaviour, every space treated as one;
 *  - the lexical query is retried without `is_active` when that column is
 *    missing, the older fallback the copies already carried.
 */
async function searchChunkRows(
  client: SupabaseClient,
  query: ChunkSearchQuery,
  scope: {
    rpc: "match_chunks_linked" | "match_chunks_collections" | "match_chunks_sources";
    rpcArgs: Record<string, unknown>;
    /**
     * Narrows the lexical `concept_chunks` query to the scope. Null when the
     * scope is known to be empty, so the lexical half returns nothing.
     */
    lexicalScope:
      | ((builder: ChunkLexicalBuilder) => ChunkLexicalBuilder)
      | null;
    /** The assistant whose Direct access grants hydration may honour. */
    hydrateFor: string | null;
  }
): Promise<KnowledgeSearchResult[]> {
  const limit = query.limit ?? 6;
  // The per-Source cap below can only remove, so the index is asked for more
  // than the caller wants (#801, CYB-14). Without this a query whose top hits
  // all come from one Source comes back short instead of diverse.
  const fetchLimit = limit * RETRIEVAL_OVERFETCH;

  const lexicalSearch = async (): Promise<ChunkRow[]> => {
    if (!scope.lexicalScope) return [];
    const tokens = lexicalTokens(query.text, 5);
    if (tokens.length === 0) return [];
    const pattern = tokens.map((t) => `content.ilike.%${t}%`).join(",");
    const build = (withActive: boolean) => {
      const base = withActive
        ? client
            .from("concept_chunks")
            .select("concept_id, content, concepts!inner(excluded,is_active)")
            .eq("concepts.excluded", false)
            .eq("concepts.is_active", true)
        : client
            .from("concept_chunks")
            .select("concept_id, content, concepts!inner(excluded)")
            .eq("concepts.excluded", false);
      return scope
        .lexicalScope!(base as unknown as ChunkLexicalBuilder)
        .or(pattern)
        .limit(fetchLimit);
    };
    let result = await build(true);
    if (result.error && isSchemaLagError(result.error)) result = await build(false);
    if (result.error) throw result.error;
    return (result.data as Array<{ concept_id: string; content: string }>).map((r) => ({
      concept_id: r.concept_id,
      content: r.content,
      similarity: LEXICAL_SIMILARITY,
    }));
  };

  const rows = await hybridRetrieve<ChunkRow>({
    embedding: query.embedding,
    // The interim window, not the caller's: the per-Source cap runs after
    // hydration below, and it can only remove, so truncating to `limit` here
    // would leave it nothing to backfill from and defeat the over-fetch
    // (#801, CYB-14). `capPerSource` cuts back to `limit`.
    limit: fetchLimit,
    vector: async () => {
      const args = {
        ...scope.rpcArgs,
        p_query_embedding: query.embedding,
        p_match_count: fetchLimit,
      };
      let result = await client.rpc(scope.rpc, {
        ...args,
        p_embedding_space: query.embeddingSpace ?? null,
      });
      if (result.error && isSchemaLagError(result.error)) {
        result = await client.rpc(scope.rpc, args);
      }
      if (result.error) throw result.error;
      return result.data as ChunkRow[];
    },
    lexical: lexicalSearch,
    keyOf: (r) => `${r.concept_id}\n${r.content}`,
    // The noise floor belongs here, where the cosine is (#801, CYB-14). The
    // per-document cap does not: a Concept is not a document, one Source
    // produces many, so it is applied after hydration below, where the Source
    // is known.
    similarityOf: (r) => r.similarity,
  });

  return capPerSource(await hydrateChunkHits(client, rows, scope.hydrateFor), limit);
}

/**
 * The lexical builder's shape after the base select, before the scope filter.
 * Structural on purpose: the real PostgREST builder type is deep enough that
 * naming it here trips the compiler's instantiation limit.
 */
interface ChunkLexicalBuilder {
  in(column: string, values: string[]): ChunkLexicalBuilder;
  eq(column: string, value: unknown): ChunkLexicalBuilder;
  or(filters: string): ChunkLexicalBuilder;
  limit(count: number): PromiseLike<{ data: unknown; error: unknown }>;
}

async function hydrateChunkHits(
  client: SupabaseClient,
  rows: Array<{ concept_id: string; content: string; similarity: number }>,
  assistantId: string | null
): Promise<KnowledgeSearchResult[]> {
  if (rows.length === 0) return [];

  const conceptIds = [...new Set(rows.map((r) => r.concept_id))];
  const { data: conceptRows, error: conceptError } = await client
    .from("concepts")
    .select(
      "id, path, frontmatter, collection_id, source_id, knowledge_collections (name), sources (id, name, kind, original_object_path)"
    )
    .in("id", conceptIds);
  if (conceptError) throw conceptError;

  const conceptById = new Map(
    (conceptRows as Array<Record<string, unknown>>).map((c) => [c.id, c])
  );

  // Direct access is per (assistant, source) link (PRD #726): one read for
  // the querying assistant's flags across the hit sources.
  const hitSourceIds = [
    ...new Set(
      (conceptRows as Array<{ source_id: string | null }>)
        .map((c) => c.source_id)
        .filter((id): id is string => id !== null)
    ),
  ];
  const directBySource = new Map<string, boolean>();
  if (assistantId && hitSourceIds.length > 0) {
    const { data: linkRows, error: linkErr } = await client
      .from("assistant_sources")
      .select("source_id, direct_access")
      .eq("assistant_id", assistantId)
      .in("source_id", hitSourceIds);
    if (linkErr) throw linkErr;
    for (const link of linkRows as Array<{
      source_id: string;
      direct_access: boolean;
    }>) {
      directBySource.set(link.source_id, link.direct_access);
    }
  }

  return rows.map((row): KnowledgeSearchResult => {
    const concept = conceptById.get(row.concept_id) as
      | Record<string, unknown>
      | undefined;
    const frontmatter = (concept?.frontmatter ?? {}) as ConceptFrontmatter;
    const collection = concept?.knowledge_collections as { name?: string } | null;
    const source = concept?.sources as {
      id?: string;
      name?: string;
      kind?: string;
      original_object_path?: string | null;
    } | null;
    return {
      conceptId: row.concept_id,
      conceptTitle: frontmatter.title ?? (concept?.path as string) ?? "Concept",
      conceptPath: (concept?.path as string) ?? "",
      collectionId: (concept?.collection_id as string) ?? "",
      collectionName: collection?.name ?? "",
      sourceName: source?.name ?? null,
      sourceId: source?.id ?? null,
      directAccess:
        source?.kind === "file" &&
        (source?.original_object_path ?? null) !== null &&
        directBySource.get(source?.id ?? "") === true,
      resourceUrl: frontmatter.resource ?? null,
      content: row.content,
      similarity: row.similarity,
    };
  });
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    assistantId: row.assistant_id,
    teammateId: row.teammate_id ?? null,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    collectionId: row.collection_id,
    title: row.title,
    metadata: row.metadata ?? {},
    sessionState: row.session_state ?? {},
    sessionVersion: row.session_version ?? 0,
    pinned: row.pinned ?? false,
    legalHold: row.legal_hold ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface SkillRow {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  prompt: string;
  created_at: string;
  updated_at: string;
}

function toSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description ?? "",
    prompt: row.prompt ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

interface MemoryRow {
  id: string;
  organization_id: string;
  subject_id: string;
  text: string;
  conversation_id: string | null;
  created_at: string;
}

// Purely mechanical snake→camel; the generic key rewriter is the mapper.
function toMemory(row: MemoryRow): Memory {
  return rowToDomain(row as unknown as Record<string, unknown>) as unknown as Memory;
}

interface EntityRecordRow {
  id: string;
  entity_id: string;
  record_key: string;
  values: Record<string, EntityRecordValue>;
  created_at: string;
  updated_at: string;
}

function toEntityRecord(row: EntityRecordRow): EntityRecord {
  return {
    id: row.id,
    entityId: row.entity_id,
    key: row.record_key,
    values: row.values ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

interface EntitySyncConfigRow {
  entity_id: string;
  url: string;
  sealed_headers: string | null;
  cadence_hours: number;
  prune: boolean;
  mapping: Record<string, string> | null;
  last_synced_at: string | null;
}

function toEntitySyncConfig(row: EntitySyncConfigRow): EntitySyncConfig {
  return {
    entityId: row.entity_id,
    url: row.url,
    sealedHeaders: row.sealed_headers,
    cadenceHours: row.cadence_hours,
    prune: row.prune,
    mapping: row.mapping ?? {},
    lastSyncedAt: row.last_synced_at,
  };
}

interface EntitySyncRunRow {
  id: string;
  entity_id: string;
  status: "succeeded" | "failed";
  upserted: number;
  pruned: number;
  rejected: string[] | null;
  error: string | null;
  finished_at: string;
}

function toEntitySyncRun(row: EntitySyncRunRow): EntitySyncRun {
  return {
    id: row.id,
    entityId: row.entity_id,
    status: row.status,
    upserted: row.upserted,
    pruned: row.pruned,
    rejected: row.rejected ?? [],
    error: row.error,
    finishedAt: row.finished_at,
  };
}

function toStoredMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content ?? [],
    flowId: row.flow_id,
    flowName: row.flow_name,
    feedback: row.feedback,
    // Null on every message written before traces were persisted, so the
    // transcript degrades to "no panel" rather than to an error.
    trace: row.trace ?? null,
    createdAt: row.created_at,
  };
}

interface ChannelMessageRow {
  id: string;
  seq: number;
  organization_id: string;
  channel_id: string;
  author_type: ChannelAuthorType;
  author_user_id: string | null;
  author_teammate_id: string | null;
  content: unknown[];
  mentions: string[] | null;
  chain_id: string | null;
  trace: StoredTurnTrace | null;
  created_at: string;
}

function toChannelMessage(row: ChannelMessageRow): ChannelMessage {
  return {
    id: row.id,
    organizationId: row.organization_id,
    channelId: row.channel_id,
    authorType: row.author_type,
    authorUserId: row.author_user_id,
    authorTeammateId: row.author_teammate_id,
    content: row.content ?? [],
    mentions: row.mentions ?? [],
    chainId: row.chain_id,
    trace: row.trace ?? null,
    createdAt: row.created_at,
  };
}

interface ImprovementRow {
  id: string;
  organization_id: string;
  seq: number;
  title: string;
  description: string;
  status: ImprovementStatus;
  priority: ImprovementPriority;
  tags: string[] | null;
  assignee_id: string | null;
  due_date: string | null;
  project_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toImprovement(row: ImprovementRow): Improvement {
  return {
    id: row.id,
    organizationId: row.organization_id,
    seq: row.seq,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    tags: row.tags ?? [],
    assigneeId: row.assignee_id,
    dueDate: row.due_date,
    projectId: row.project_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ImprovementProposalRow {
  id: string;
  organization_id: string;
  improvement_id: string;
  status: ImprovementProposalStatus;
  payload: ImprovementProposalPayload | null;
  dismiss_reason: string | null;
  accepted_concept_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MemoryDocumentRow {
  id: string;
  organization_id: string;
  member_id: string | null;
  teammate_id: string | null;
  project_id: string | null;
  body: string | null;
  created_at: string;
  updated_at: string;
}

function toMemoryDocument(row: MemoryDocumentRow): MemoryDocument {
  return {
    id: row.id,
    organizationId: row.organization_id,
    memberId: row.member_id,
    teammateId: row.teammate_id,
    projectId: row.project_id,
    // Derived, never stored: a `scope` column beside the ids could disagree
    // with them, and the exclusive-or check already fixes the answer (#771).
    scope: memoryDocumentScope({
      memberId: row.member_id,
      teammateId: row.teammate_id,
      projectId: row.project_id,
    }),
    body: row.body ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface MemoryDocumentEntryRow {
  id: string;
  organization_id: string;
  document_id: string;
  teammate_id: string | null;
  author_id: string | null;
  note: string | null;
  body_before: string | null;
  created_at: string;
}

function toMemoryDocumentEntry(
  row: MemoryDocumentEntryRow
): MemoryDocumentEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    documentId: row.document_id,
    teammateId: row.teammate_id,
    authorId: row.author_id,
    note: row.note ?? "",
    bodyBefore: row.body_before ?? "",
    createdAt: row.created_at,
  };
}

/** The owner as a PostgREST filter column + value pair. */
function memoryOwnerColumn(owner: MemoryDocumentOwner): {
  column: "member_id" | "teammate_id" | "project_id";
  value: string;
} {
  if (owner.scope === "user") return { column: "member_id", value: owner.memberId };
  if (owner.scope === "agent")
    return { column: "teammate_id", value: owner.teammateId };
  return { column: "project_id", value: owner.projectId };
}

function toImprovementProposal(row: ImprovementProposalRow): ImprovementProposal {
  return {
    id: row.id,
    organizationId: row.organization_id,
    improvementId: row.improvement_id,
    status: row.status,
    payload: row.payload ?? {
      draftQuestion: "",
      draftAnswer: "",
      rationale: "",
      sources: [],
      model: "",
      targetAssistantId: "",
      targetCollectionId: null,
    },
    dismissReason: row.dismiss_reason ?? "",
    acceptedConceptId: row.accepted_concept_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface AlertRow {
  id: string;
  organization_id: string;
  type: AlertType;
  title: string;
  detail: string;
  status: AlertStatus;
  source_key: string | null;
  detected_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

interface GoalRow {
  id: string;
  organization_id: string;
  assistant_id: string;
  question: string;
  status: "active" | "quarantined";
  expectations: AssistantGoal["expectations"] | null;
  last_run_at: string | null;
  last_result: "pass" | "fail" | null;
  last_detail: string | null;
  created_at: string;
}

function toGoal(row: GoalRow): AssistantGoal {
  return {
    id: row.id,
    organizationId: row.organization_id,
    assistantId: row.assistant_id,
    question: row.question,
    status: row.status,
    expectations: row.expectations ?? {},
    lastRunAt: row.last_run_at,
    lastResult: row.last_result,
    lastDetail: row.last_detail,
    createdAt: row.created_at,
  };
}

interface FlowTrustRow {
  assistant_id: string;
  flow_id: string;
  organization_id: string;
  runs: number;
  passes: number;
  tier: "auto" | "queue" | "watch";
  previous_tier: "auto" | "queue" | "watch" | null;
  computed_at: string;
}

function toFlowTrust(row: FlowTrustRow): FlowTrust {
  return rowToDomain(row as unknown as Record<string, unknown>) as unknown as FlowTrust;
}

interface FlowTrustEventRow {
  organization_id: string;
  assistant_id: string;
  flow_id: string;
  from_tier: "auto" | "queue" | "watch" | null;
  to_tier: "auto" | "queue" | "watch";
  runs: number;
  passes: number;
  created_at: string;
}

function toFlowTrustEvent(row: FlowTrustEventRow): FlowTrustEvent {
  return rowToDomain(row as unknown as Record<string, unknown>) as unknown as FlowTrustEvent;
}

function toAlert(row: AlertRow): Alert {
  return rowToDomain(row as unknown as Record<string, unknown>) as unknown as Alert;
}

function toConnection(
  row: ConnectionRow,
  embeddingConnectionId: string | null = null
): ProviderConnection {
  return {
    id: row.id,
    organizationId: row.organization_id,
    type: row.type,
    provider: row.provider,
    displayName: row.display_name,
    encryptedKey: row.encrypted_key,
    keyHint: row.key_hint ?? "",
    config: row.config ?? {},
    createdBy: row.created_by,
    createdAt: row.created_at,
    preferredForEmbedding: row.id === embeddingConnectionId,
  };
}

function toSsoConnection(row: SsoConnectionRow): SsoConnection {
  return rowToDomain(row as unknown as Record<string, unknown>) as unknown as SsoConnection;
}

interface ApiIntegrationRow {
  assistant_id: string;
  organization_id: string;
  name: string;
  base_url: string;
  auth_type: ApiIntegrationAuthType;
  auth_header_name: string | null;
  auth_username: string | null;
  encrypted_credential: string | null;
  /** `not null default '[]'` in the schema; a legacy null reads as empty. */
  endpoints: ApiEndpointSpec[] | null;
  created_at: string;
  updated_at: string;
}

function toApiIntegration(row: ApiIntegrationRow): ApiIntegration {
  return {
    assistantId: row.assistant_id,
    organizationId: row.organization_id,
    name: row.name,
    baseUrl: row.base_url,
    authType: row.auth_type,
    authHeaderName: row.auth_header_name ?? "",
    authUsername: row.auth_username ?? "",
    encryptedCredential: row.encrypted_credential,
    endpoints: row.endpoints ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface FlowRow {
  id: string;
  assistant_id: string;
  name: string;
  description: string;
  built_in: boolean;
  enabled: boolean;
  position: number;
  trigger_kind: FlowTrigger | null;
  trigger_settings: FlowTriggerSettings | null;
  condition_logic: FlowConditionLogic | null;
  conditions: FlowCondition[] | null;
  actions: FlowAction[];
  action_settings: FlowActionSettings | null;
  custom_message: string;
  is_default: boolean;
}

interface InviteRow {
  id: string;
  organization_id: string;
  email: string;
  role: Role;
  token: string;
  created_at: string;
}

interface OrgApiKeyRow {
  id: string;
  organization_id: string;
  name: string;
  secret_hint: string;
  role: Role;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function toAssistant(row: AssistantRow): Assistant {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    nickname: row.nickname,
    description: row.description,
    avatarUrl: row.avatar_url ?? undefined,
    welcomeMessage: row.welcome_message,
    aiDisclaimer: row.ai_disclaimer ?? DEFAULT_AI_DISCLAIMER,
    suggestedQuestions: row.suggested_questions ?? [],
    quickReplies: row.quick_replies ?? [],
    answeringStyle: row.answering_style ?? "",
    simplifiedThinking: row.simplified_thinking ?? false,
    chatLauncherEnabled: row.chat_launcher_enabled,
    modelProvider: row.model_provider ?? "anthropic",
    modelId: row.model_id ?? "claude-opus-4-8",
    style: row.style ?? {},
    allowedDomains: row.allowed_domains ?? [],
    helpDeskSettings: row.help_desk_settings ?? {},
    tools: row.tools ?? {},
    requireSignIn: row.require_sign_in ?? false,
    knowledgeEngine: row.knowledge_engine ?? "graph",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFlow(row: FlowRow): Flow {
  return {
    id: row.id,
    assistantId: row.assistant_id,
    name: row.name,
    description: row.description,
    builtIn: row.built_in,
    enabled: row.enabled,
    position: row.position,
    trigger: row.trigger_kind ?? "message",
    triggerSettings: row.trigger_settings ?? {},
    conditionLogic: row.condition_logic ?? "any",
    conditions: row.conditions ?? [],
    actions: row.actions ?? [],
    actionSettings: row.action_settings ?? {},
    customMessage: row.custom_message ?? "",
    isDefault: row.is_default,
  };
}

function toSource(row: Record<string, unknown>): Source {
  return {
    id: row.id as string,
    collectionId: row.collection_id as string,
    name: row.name as string,
    kind: row.kind as Source["kind"],
    status: row.status as Source["status"],
    error: (row.error as string) ?? "",
    config: (row.config as Source["config"]) ?? {},
    recrawlSchedule:
      (row.recrawl_schedule as Source["recrawlSchedule"]) ?? "never",
    lastCrawledAt: (row.last_crawled_at as string | null) ?? null,
    originalObjectPath: (row.original_object_path as string | null) ?? null,
    activeGenerationId: row.active_generation_id as string,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string) ?? (row.created_at as string),
  };
}

function toConcept(row: Record<string, unknown>): Concept {
  return {
    id: row.id as string,
    collectionId: row.collection_id as string,
    sourceId: row.source_id as string | null,
    generationId: (row.generation_id as string | null) ?? null,
    path: row.path as string,
    frontmatter: row.frontmatter as ConceptFrontmatter,
    body: row.body as string,
    excluded: (row.excluded as boolean) ?? false,
    recrawlSchedule: (row.recrawl_schedule as RecrawlSchedule | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function toApplicationConnection(
  row: Record<string, unknown>
): ApplicationConnection {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    ownerType:
      (row.owner_type as ApplicationConnection["ownerType"] | undefined) ??
      "organization",
    ownerMemberId: (row.owner_member_id as string | null | undefined) ?? null,
    provider: row.provider as ApplicationConnection["provider"],
    name: row.name as string,
    status: row.status as ApplicationConnection["status"],
    sealedCredentials: (row.sealed_credentials as string) ?? "",
    scopes: (row.scopes as string[]) ?? [],
    providerAccountId: (row.provider_account_id as string | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    error: (row.error as string | null) ?? "",
    lastConnectedAt: (row.last_connected_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toApplicationImport(row: Record<string, unknown>): ApplicationImport {
  const links =
    (row.application_import_assistants as Array<{ assistant_id: string }> | null) ??
    [];
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    connectionId: row.connection_id as string,
    collectionId: row.collection_id as string,
    name: row.name as string,
    config: (row.config as Record<string, unknown>) ?? {},
    cadence: row.cadence as ApplicationImport["cadence"],
    enabled: row.enabled as boolean,
    status: row.status as ApplicationImport["status"],
    checkpoint: (row.checkpoint as Record<string, unknown>) ?? {},
    error: (row.error as string | null) ?? "",
    lastSyncedAt: (row.last_synced_at as string | null) ?? null,
    nextSyncAt: (row.next_sync_at as string | null) ?? null,
    reservedBytes: Number(row.reserved_bytes ?? 0),
    assistantIds: links.map((link) => link.assistant_id),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toApplicationSource(row: Record<string, unknown>): ApplicationSource {
  return {
    id: row.id as string,
    importId: row.import_id as string,
    sourceId: (row.source_id as string | null) ?? null,
    remoteId: row.remote_id as string,
    canonicalUrl: (row.canonical_url as string | null) ?? null,
    revision: (row.revision as string | null) ?? null,
    contentHash: row.content_hash as string,
    contentBytes: Number(row.content_bytes ?? 0),
    remoteMimeType: (row.remote_mime_type as string | null) ?? null,
    remoteUpdatedAt: (row.remote_updated_at as string | null) ?? null,
    lastSeenAt: row.last_seen_at as string,
    removedAt: (row.removed_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toApplicationSyncRun(row: Record<string, unknown>): ApplicationSyncRun {
  return {
    id: row.id as string,
    importId: row.import_id as string,
    status: row.status as ApplicationSyncRun["status"],
    discovered: row.discovered as number,
    upserted: row.upserted as number,
    unchanged: row.unchanged as number,
    deleted: Number(row.deleted ?? 0),
    skipped: Number(row.skipped ?? 0),
    failed: Number(row.failed ?? 0),
    enqueued: row.enqueued as number,
    providerCalls: Number(row.provider_calls ?? 0),
    bytes: Number(row.bytes ?? 0),
    durationMs: Number(row.duration_ms ?? 0),
    skippedReasons:
      (row.skipped_reasons as ApplicationSyncRun["skippedReasons"]) ?? [],
    error: (row.error as string | null) ?? "",
    startedAt: row.started_at as string,
    completedAt: row.completed_at as string,
  };
}

function toBackgroundJob(row: Record<string, unknown>): BackgroundJob {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    kind: row.kind as BackgroundJob["kind"],
    sourceId: (row.source_id as string | null) ?? null,
    status: row.status as BackgroundJob["status"],
    payload: (row.payload as Record<string, unknown>) ?? {},
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    nextRunAt: row.next_run_at as string,
    lockedAt: (row.locked_at as string | null) ?? null,
    lockedBy: (row.locked_by as string | null) ?? null,
    leaseToken: (row.lease_token as string | null) ?? null,
    error: (row.error as string | null) ?? "",
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string) ?? (row.created_at as string),
  };
}

function toExportJob(row: Record<string, unknown>): ExportJob {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    kind: row.kind as ExportJob["kind"],
    status: row.status as ExportJob["status"],
    format: row.format as ExportJob["format"],
    params: (row.params as Record<string, unknown>) ?? {},
    storagePath: (row.storage_path as string | null) ?? null,
    error: (row.error as string | null) ?? "",
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    lockedAt: (row.locked_at as string | null) ?? null,
    lockedBy: (row.locked_by as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string) ?? (row.created_at as string),
  };
}

function toInvite(row: InviteRow): Invite {
  return rowToDomain(row as unknown as Record<string, unknown>) as unknown as Invite;
}

function toOrgApiKey(row: OrgApiKeyRow): OrgApiKey {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    secretHint: row.secret_hint,
    role: row.role,
    createdBy: row.created_by ?? "",
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

function assistantPatchToRow(patch: AssistantPatch): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.nickname !== undefined) row.nickname = patch.nickname;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;
  if (patch.welcomeMessage !== undefined)
    row.welcome_message = patch.welcomeMessage;
  if (patch.aiDisclaimer !== undefined) row.ai_disclaimer = patch.aiDisclaimer;
  if (patch.suggestedQuestions !== undefined)
    row.suggested_questions = patch.suggestedQuestions;
  if (patch.quickReplies !== undefined) row.quick_replies = patch.quickReplies;
  if (patch.answeringStyle !== undefined)
    row.answering_style = patch.answeringStyle;
  if (patch.chatLauncherEnabled !== undefined)
    row.chat_launcher_enabled = patch.chatLauncherEnabled;
  if (patch.modelProvider !== undefined) row.model_provider = patch.modelProvider;
  if (patch.modelId !== undefined) row.model_id = patch.modelId;
  if (patch.style !== undefined) row.style = patch.style;
  if (patch.allowedDomains !== undefined) row.allowed_domains = patch.allowedDomains;
  if (patch.helpDeskSettings !== undefined)
    row.help_desk_settings = patch.helpDeskSettings;
  if (patch.tools !== undefined) row.tools = patch.tools;
  if (patch.requireSignIn !== undefined)
    row.require_sign_in = patch.requireSignIn;
  if (patch.knowledgeEngine !== undefined)
    row.knowledge_engine = patch.knowledgeEngine;
  if (patch.simplifiedThinking !== undefined)
    row.simplified_thinking = patch.simplifiedThinking;
  return row;
}

/**
 * Generic table accessor (ADR-0016): one implementation for every table in
 * DbTableMap. Filters/patches arrive in domain field names and are rewritten
 * mechanically to columns; RLS still scopes every query to the caller's org.
 */
function supabaseTable<K extends DbTableName>(
  client: SupabaseClient,
  name: K
): DbTableAccessor<K> {
  const spec = DB_TABLE_SPECS[name];
  return {
    async list(filter = {}, options) {
      let query = client.from(spec.table).select("*");
      for (const [key, value] of Object.entries(filter)) {
        if (value === undefined) continue;
        const column = camelToSnakeKey(key);
        query = value === null ? query.is(column, null) : query.eq(column, value);
      }
      query = query.order(camelToSnakeKey(options?.orderBy ?? spec.orderBy), {
        ascending: options?.ascending ?? spec.ascending,
      });
      if (options?.limit !== undefined) query = query.limit(options.limit);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) => rowToDomain(row) as unknown as DbTableRow<K>);
    },

    async get(id) {
      const { data, error } = await client
        .from(spec.table)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? (rowToDomain(data) as unknown as DbTableRow<K>) : null;
    },

    async insert(values) {
      const row = domainToRow({ ...spec.defaults, ...values });
      const { data, error } = await client
        .from(spec.table)
        .insert({ id: newTableRowId(spec), ...row })
        .select()
        .single();
      if (error) throw error;
      return rowToDomain(data) as unknown as DbTableRow<K>;
    },

    async update(id, patch) {
      const row = domainToRow({ ...patch });
      if (spec.touchesUpdatedAt) row.updated_at = new Date().toISOString();
      const { data, error } = await client
        .from(spec.table)
        .update(row)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return rowToDomain(data) as unknown as DbTableRow<K>;
    },

    async delete(id) {
      const { error } = await client.from(spec.table).delete().eq("id", id);
      if (error) throw error;
    },
  };
}

/**
 * The Source ids linked to an Assistant, its retrieval corpus. Every
 * assistant-scoped knowledge read narrows through this (#733/#741): the
 * Collection is org-owned, so collection membership says nothing about which
 * Assistant answers from a Source.
 */
async function linkedSourceIds(
  client: SupabaseClient,
  assistantId: string
): Promise<string[]> {
  const { data, error } = await client
    .from("assistant_sources")
    .select("source_id")
    .eq("assistant_id", assistantId);
  if (error) throw error;
  return (data as Array<{ source_id: string }>).map((r) => r.source_id);
}

type ImprovementLinkJoinedRow = {
  id: string;
  message_id: string;
  created_at: string;
  messages:
    | (MessageRow & {
        conversations:
          | (ConversationRow & { assistants: { title: string } | null })
          | null;
      })
    | null;
};

/** Hydrate only the already-paged Improvement links into transcript cards. */
async function hydrateImprovementAssociations(
  client: SupabaseClient,
  linkRows: ImprovementLinkJoinedRow[]
): Promise<ImprovementAssociation[]> {
  if (linkRows.length === 0) return [];
  type ConvJoined = ConversationRow & { assistants: { title: string } | null };
  const flagged = new Map<string, StoredMessage>();
  const conversations = new Map<string, ConvJoined>();
  for (const link of linkRows) {
    if (!link.messages) continue;
    flagged.set(link.messages.id, toStoredMessage(link.messages));
    const conversation = link.messages.conversations;
    if (conversation) conversations.set(conversation.id, conversation);
  }
  const conversationIds = [...conversations.keys()];
  if (conversationIds.length === 0) return [];
  const collectionIds = [
    ...new Set(
      [...conversations.values()]
        .map((conversation) => conversation.collection_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const [messagesResult, collectionsResult] = await Promise.all([
    client
      .from("messages")
      .select("*")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: true })
      .order("seq", { ascending: true }),
    client
      .from("knowledge_collections")
      .select("id, name")
      .in("id", collectionIds),
  ]);
  if (messagesResult.error) throw messagesResult.error;
  if (collectionsResult.error) throw collectionsResult.error;
  const transcripts = new Map<string, StoredMessage[]>();
  for (const row of messagesResult.data as MessageRow[]) {
    const transcript = transcripts.get(row.conversation_id) ?? [];
    transcript.push(toStoredMessage(row));
    transcripts.set(row.conversation_id, transcript);
  }
  const collectionNames = new Map(
    ((collectionsResult.data ?? []) as Array<{ id: string; name: string }>).map(
      (row) => [row.id, row.name]
    )
  );
  return linkRows.flatMap((link): ImprovementAssociation[] => {
    const message = flagged.get(link.message_id);
    if (!message) return [];
    const conversation = conversations.get(message.conversationId);
    if (!conversation) return [];
    const transcript = transcripts.get(conversation.id) ?? [];
    const summary: InboxConversation = {
      id: conversation.id,
      assistantId: conversation.assistant_id,
      teammateId: conversation.teammate_id,
      subjectType: conversation.subject_type,
      subjectId: conversation.subject_id,
      collectionId: conversation.collection_id,
      title: conversation.title,
      metadata: conversation.metadata ?? {},
      pinned: conversation.pinned ?? false,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
      assistantTitle: conversation.assistants?.title ?? "",
      collectionName: conversation.collection_id
        ? (collectionNames.get(conversation.collection_id) ?? null)
        : null,
      messageCount: transcript.length,
      flowNames: [
        ...new Set(
          transcript
            .map((row) => row.flowName)
            .filter((name): name is string => Boolean(name))
        ),
      ],
      notificationOnly:
        transcript.length > 0 &&
        transcript.every((row) => isProactiveMessage(row.content)),
      feedback: transcript.some((row) => row.feedback === 1)
        ? 1
        : transcript.some((row) => row.feedback === -1)
          ? -1
          : 0,
    };
    return [
      {
        linkId: link.id,
        messageId: link.message_id,
        conversationId: conversation.id,
        message,
        transcript,
        conversation: summary,
      },
    ];
  });
}

/**
 * The signed-in caller's user id, from a locally verified JWT (getClaims):
 * with asymmetric signing keys this is a WebCrypto check against a cached
 * JWKS, not a network round trip to the Auth API the way auth.getUser() is.
 * The trade (same one the admin middleware makes): a server-side session
 * revocation isn't seen until the access token expires. Projects still on a
 * symmetric secret fall back to a server-side check inside supabase-js.
 */
async function authenticatedUserId(
  client: SupabaseClient
): Promise<string | null> {
  const { data } = await client.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

/**
 * Supabase-backed Db. The client must carry the caller's auth context
 * (cookie-based session in the admin app); RLS does the tenant isolation.
 */
export function createSupabaseDb(client: SupabaseClient): Db {
  return {
    // --- Organizations & membership -----------------------------------

    async getCurrentOrg(preferredOrgId?: string) {
      const userId = await authenticatedUserId(client);
      if (!userId) return null;

      const membershipFor = async (columns: string) => {
        let membership = client
          .from("organization_members")
          .select(`role, organizations (${columns})`)
          .eq("user_id", userId);
        if (preferredOrgId) membership = membership.eq("organization_id", preferredOrgId);
        return (await membership.limit(1).maybeSingle()) as unknown as {
          data: { role: string; organizations: OrganizationRow | null } | null;
          error: { code?: string; message?: string } | null;
        };
      };
      // `getCurrentOrg` runs on every signed-in request, so a column the
      // deploy knows and the database does not yet must not 500 the console
      // for the window between the Vercel deploy and the migrate job.
      let result = await membershipFor(ORGANIZATION_COLUMNS);
      if (result.error && isSchemaLagError(result.error)) {
        result = await membershipFor(ORGANIZATION_COLUMNS_LEGACY);
      }
      const { data, error } = result;
      if (error) throw error;
      if (data?.organizations) {
        return {
          organization: toOrganization(data.organizations),
          role: data.role as Role,
        };
      }

      // No membership row for the requested org, a platform superuser
      // browsing an org they don't belong to. RLS still governs visibility:
      // this returns nothing for anyone who isn't actually a superuser.
      const orgFor = (columns: string) => {
        let orgQuery = client.from("organizations").select(columns);
        orgQuery = preferredOrgId ? orgQuery.eq("id", preferredOrgId) : orgQuery;
        return orgQuery.limit(1).maybeSingle();
      };
      let orgResult = await orgFor(ORGANIZATION_COLUMNS);
      if (orgResult.error && isSchemaLagError(orgResult.error)) {
        orgResult = await orgFor(ORGANIZATION_COLUMNS_LEGACY);
      }
      const { data: orgRow, error: orgError } = orgResult;
      if (orgError) throw orgError;
      if (!orgRow) return null;
      return {
        organization: toOrganization(orgRow as unknown as OrganizationRow),
        role: "owner",
      };
    },

    async listOrganizations() {
      const listWith = (columns: string) =>
        client.from("organizations").select(columns).order("name", { ascending: true });
      let result = await listWith(ORGANIZATION_COLUMNS);
      if (result.error && isSchemaLagError(result.error)) {
        result = await listWith(ORGANIZATION_COLUMNS_LEGACY);
      }
      if (result.error) throw result.error;
      return (result.data as unknown as OrganizationRow[]).map(toOrganization);
    },

    async updateOrganization(organizationId, patch: OrganizationPatch) {
      const row: Record<string, unknown> = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.logoUrl !== undefined) row.logo_url = patch.logoUrl;
      if (patch.traceRetentionDays !== undefined)
        row.trace_retention_days = patch.traceRetentionDays;
      if (patch.transcriptRetentionDays !== undefined)
        row.transcript_retention_days = patch.transcriptRetentionDays;
      const updateWith = (columns: string) =>
        client
          .from("organizations")
          .update(row)
          .eq("id", organizationId)
          .select(columns)
          .single();
      let result = await updateWith(ORGANIZATION_COLUMNS);
      if (result.error && isSchemaLagError(result.error)) {
        // The column the patch names does not exist yet: refuse readably
        // rather than report a saved window that nothing will enforce. A patch
        // that does not touch it is served against the old shape.
        if (patch.transcriptRetentionDays !== undefined) {
          throw new Error(
            "Conversation retention is temporarily unavailable while the database updates"
          );
        }
        result = await updateWith(ORGANIZATION_COLUMNS_LEGACY);
      }
      if (result.error) throw result.error;
      return toOrganization(result.data as unknown as OrganizationRow);
    },

    async getProfile() {
      const userId = await authenticatedUserId(client);
      if (!userId) return null;
      const { data, error } = await client
        .from("profiles")
        .select("id, email, username, first_name, last_name, avatar_url")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        userId: data.id,
        email: data.email,
        username: data.username ?? "",
        firstName: data.first_name ?? "",
        lastName: data.last_name ?? "",
        avatarUrl: data.avatar_url,
      } satisfies Profile;
    },

    async updateProfile(patch: ProfilePatch) {
      const userId = await authenticatedUserId(client);
      if (!userId) throw new Error("Not authenticated");
      const row: Record<string, unknown> = {};
      if (patch.username !== undefined) row.username = patch.username;
      if (patch.firstName !== undefined) row.first_name = patch.firstName;
      if (patch.lastName !== undefined) row.last_name = patch.lastName;
      if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;
      const { data, error } = await client
        .from("profiles")
        .update(row)
        .eq("id", userId)
        .select("id, email, username, first_name, last_name, avatar_url")
        .single();
      if (error) throw error;
      return {
        userId: data.id,
        email: data.email,
        username: data.username ?? "",
        firstName: data.first_name ?? "",
        lastName: data.last_name ?? "",
        avatarUrl: data.avatar_url,
      } satisfies Profile;
    },

    async createOrganization(name) {
      const { data, error } = await client.rpc("create_organization", {
        org_name: name,
      });
      if (error) throw error;
      return data as string;
    },

    async acceptInvite(token) {
      const { data, error } = await client.rpc("accept_invite", {
        invite_token: token,
      });
      if (error) throw error;
      return data as string;
    },

    async getMemberRole(organizationId, userId) {
      const { data, error } = await client
        .from("organization_members")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return (data?.role as Role | undefined) ?? null;
    },

    async listMembers(organizationId) {
      // One query: emails come through the organization_members -> profiles
      // embed (FK added in 0020 -- the profile mirror exists for this join).
      const { data, error } = await client
        .from("organization_members")
        .select(
          "user_id, role, created_at, profiles(email, username, first_name, last_name, avatar_url)"
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = data as unknown as Array<{
        user_id: string;
        role: Role;
        created_at: string;
        profiles: {
          email: string;
          username: string | null;
          first_name: string | null;
          last_name: string | null;
          avatar_url: string | null;
        } | null;
      }>;
      return rows.map((r) => ({
        userId: r.user_id,
        email: r.profiles?.email ?? "",
        role: r.role,
        username: r.profiles?.username ?? null,
        firstName: r.profiles?.first_name ?? null,
        lastName: r.profiles?.last_name ?? null,
        avatarUrl: r.profiles?.avatar_url ?? null,
        createdAt: r.created_at,
      })) satisfies Member[];
    },

    async updateMemberRole(organizationId, userId, role) {
      const { error } = await client
        .from("organization_members")
        .update({ role })
        .eq("organization_id", organizationId)
        .eq("user_id", userId);
      if (error) throw error;
    },

    async removeMember(organizationId, userId) {
      const { error } = await client
        .from("organization_members")
        .delete()
        .eq("organization_id", organizationId)
        .eq("user_id", userId);
      if (error) throw error;
    },

    async listInvites(organizationId) {
      const { data, error } = await client
        .from("organization_invites")
        .select("*")
        .eq("organization_id", organizationId)
        .is("accepted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as InviteRow[]).map(toInvite);
    },

    async createInvite(organizationId, role, email) {
      const row = {
        organization_id: organizationId,
        role,
        email: email ?? "",
        token: shortId() + shortId(),
      };
      const { data, error } = await client
        .from("organization_invites")
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      return toInvite(data as InviteRow);
    },

    async revokeInvite(inviteId) {
      const { error } = await client
        .from("organization_invites")
        .delete()
        .eq("id", inviteId);
      if (error) throw error;
    },

    // --- Organization API keys (#618) -----------------------------------

    async listApiKeys(organizationId) {
      const { data, error } = await client
        .from("organization_api_keys")
        .select(
          "id, organization_id, name, secret_hint, role, created_by, created_at, last_used_at, revoked_at"
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as OrgApiKeyRow[]).map(toOrgApiKey);
    },

    async createApiKey(organizationId, input: OrgApiKeyInput) {
      const row = {
        organization_id: organizationId,
        name: input.name,
        secret_hash: input.secretHash,
        secret_hint: input.secretHint,
        role: input.role,
        created_by: input.createdBy,
      };
      const { data, error } = await client
        .from("organization_api_keys")
        .insert(row)
        .select(
          "id, organization_id, name, secret_hint, role, created_by, created_at, last_used_at, revoked_at"
        )
        .single();
      if (error) throw error;
      return toOrgApiKey(data as OrgApiKeyRow);
    },

    async revokeApiKey(keyId) {
      const { error } = await client
        .from("organization_api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", keyId)
        .is("revoked_at", null);
      if (error) throw error;
    },

    async getApiKeyByHash(secretHash) {
      const { data, error } = await client
        .from("organization_api_keys")
        .select(
          "id, organization_id, name, secret_hint, role, created_by, created_at, last_used_at, revoked_at"
        )
        .eq("secret_hash", secretHash)
        .maybeSingle();
      if (error) throw error;
      return data ? toOrgApiKey(data as OrgApiKeyRow) : null;
    },

    async touchApiKeyLastUsed(keyId) {
      const { error } = await client
        .from("organization_api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", keyId);
      if (error) throw error;
    },

    // --- Assistants -----------------------------------------------------

    async listAssistants(organizationId) {
      const { data, error } = await client
        .from("assistants")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as AssistantRow[]).map(toAssistant);
    },

    async listAssistantsPage(organizationId, input) {
      const limit = Math.max(1, Math.min(Math.trunc(input.limit), 100));
      let query = client
        .from("assistants")
        .select("*")
        .eq("organization_id", organizationId)
        .order("id", { ascending: true })
        .limit(limit + 1);
      if (input.cursor) query = query.gt("id", input.cursor);
      const { data, error } = await query;
      if (error) throw error;
      const rows = data as AssistantRow[];
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(toAssistant);
      return {
        items,
        nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
      };
    },

    async listAssistantShellSummaries(organizationId) {
      const { data, error } = await client
        .from("assistants")
        .select("id, title, nickname, avatar_url, style")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (
        data as Array<{
          id: string;
          title: string;
          nickname: string;
          avatar_url: string | null;
          style: WidgetStyle | null;
        }>
      ).map((assistant) => ({
        id: assistant.id,
        title: assistant.title,
        nickname: assistant.nickname,
        brandColor: assistant.style?.brandColor ?? null,
        avatarUrl: assistant.avatar_url,
      }));
    },

    async getAssistant(id) {
      const { data, error } = await client
        .from("assistants")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toAssistant(data as AssistantRow) : null;
    },

    async createAssistant(organizationId, input) {
      const row = {
        id: shortId(),
        organization_id: organizationId,
        title: input.title,
        nickname: input.nickname ?? input.title,
        description: input.description ?? "",
        welcome_message: DEFAULT_WELCOME_MESSAGE,
        ai_disclaimer: DEFAULT_AI_DISCLAIMER,
        suggested_questions: [],
        chat_launcher_enabled: true,
      };
      const { data, error } = await client
        .from("assistants")
        .insert(row)
        .select()
        .single();
      if (error) throw error;

      const flowRows = DEFAULT_FLOWS.map((f, i) => ({
        id: shortId(),
        assistant_id: row.id,
        name: f.name,
        description: f.description,
        built_in: f.builtIn,
        enabled: f.enabled,
        position: i,
        actions: f.actions,
        custom_message: f.customMessage,
        is_default: f.isDefault,
      }));
      const { error: flowError } = await client.from("flows").insert(flowRows);
      if (flowError) throw flowError;

      return toAssistant(data as AssistantRow);
    },

    async updateAssistant(id, patch) {
      const { data, error } = await client
        .from("assistants")
        .update({
          ...assistantPatchToRow(patch),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return toAssistant(data as AssistantRow);
    },

    async deleteAssistant(id) {
      const { error } = await client.from("assistants").delete().eq("id", id);
      if (error) throw error;
    },

    // --- Flows -----------------------------------------------------------

    async listFlows(assistantId) {
      const { data, error } = await client
        .from("flows")
        .select("*")
        .eq("assistant_id", assistantId);
      if (error) throw error;
      return sortFlows((data as FlowRow[]).map(toFlow));
    },

    async getFlow(id) {
      const { data, error } = await client
        .from("flows")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toFlow(data as FlowRow) : null;
    },

    async createFlow(assistantId, input) {
      const { count, error: countError } = await client
        .from("flows")
        .select("*", { count: "exact", head: true })
        .eq("assistant_id", assistantId)
        .eq("is_default", false);
      if (countError) throw countError;

      const row = {
        id: shortId(),
        assistant_id: assistantId,
        name: input.name,
        description: input.description ?? "",
        built_in: false,
        enabled: true,
        position: count ?? 0,
        trigger_kind: input.trigger ?? "message",
        trigger_settings: input.triggerSettings ?? {},
        condition_logic: input.conditionLogic ?? "any",
        conditions: input.conditions ?? [],
        actions: input.actions ?? ["search_knowledge"],
        action_settings: input.actionSettings ?? {},
        custom_message: input.customMessage ?? "",
        is_default: false,
      };
      const { data, error } = await client
        .from("flows")
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      return toFlow(data as FlowRow);
    },

    async updateFlow(id, patch: FlowPatch) {
      const row: Record<string, unknown> = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.description !== undefined) row.description = patch.description;
      if (patch.enabled !== undefined) row.enabled = patch.enabled;
      if (patch.trigger !== undefined) row.trigger_kind = patch.trigger;
      if (patch.triggerSettings !== undefined)
        row.trigger_settings = patch.triggerSettings;
      if (patch.conditionLogic !== undefined)
        row.condition_logic = patch.conditionLogic;
      if (patch.conditions !== undefined) row.conditions = patch.conditions;
      if (patch.actions !== undefined) row.actions = patch.actions;
      if (patch.actionSettings !== undefined)
        row.action_settings = patch.actionSettings;
      if (patch.customMessage !== undefined)
        row.custom_message = patch.customMessage;
      const { data, error } = await client
        .from("flows")
        .update(row)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return toFlow(data as FlowRow);
    },

    async deleteFlow(id) {
      const { error } = await client.from("flows").delete().eq("id", id);
      if (error) throw error;
    },

    async reorderFlows(assistantId, orderedIds) {
      const { error } = await client.rpc("reorder_assistant_flows", {
        p_assistant_id: assistantId,
        p_ordered_ids: orderedIds,
      });
      if (error) throw error;
    },

    // --- Help desks --------------------------------------------------------

    async listHelpDesks(organizationId) {
      const { data, error } = await client
        .from("help_desks")
        .select("*")
        .eq("organization_id", organizationId)
        .order("name");
      if (error) throw error;
      return (data as HelpDeskRow[]).map(toHelpDesk);
    },

    async getHelpDesk(id) {
      const { data, error } = await client
        .from("help_desks")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toHelpDesk(data as HelpDeskRow) : null;
    },

    async createHelpDesk(organizationId, input) {
      const { data, error } = await client
        .from("help_desks")
        .insert({
          id: shortId(),
          organization_id: organizationId,
          name: input.name,
          description: input.description ?? "",
        })
        .select()
        .single();
      if (error) throw error;
      return toHelpDesk(data as HelpDeskRow);
    },

    async updateHelpDesk(id, patch) {
      const row: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.description !== undefined) row.description = patch.description;
      if (patch.autoGenerateImprovements !== undefined)
        row.auto_generate_improvements = patch.autoGenerateImprovements;
      const { data, error } = await client
        .from("help_desks")
        .update(row)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return toHelpDesk(data as HelpDeskRow);
    },

    async deleteHelpDesk(id) {
      const { error } = await client.from("help_desks").delete().eq("id", id);
      if (error) throw error;
    },

    async listSupportChannels(helpDeskId) {
      const { data, error } = await client
        .from("support_channels")
        .select("*")
        .eq("help_desk_id", helpDeskId)
        .order("position");
      if (error) throw error;
      return (data as SupportChannelRow[]).map(toSupportChannel);
    },

    async createSupportChannel(helpDeskId, input) {
      const { count, error: countError } = await client
        .from("support_channels")
        .select("*", { count: "exact", head: true })
        .eq("help_desk_id", helpDeskId);
      if (countError) throw countError;
      const { data, error } = await client
        .from("support_channels")
        .insert({
          id: shortId(),
          help_desk_id: helpDeskId,
          kind: input.kind,
          name: input.name,
          position: count ?? 0,
          enabled: true,
          config: input.config ?? {},
          form_title: input.formTitle ?? "Send us a message",
          form: input.form ?? [],
          confirmation_message: input.confirmationMessage ?? "",
          conversation_data: input.conversationData ?? defaultChannelConversationData(),
          availability: normalizeChannelAvailability(input.availability),
        })
        .select()
        .single();
      if (error) throw error;
      return toSupportChannel(data as SupportChannelRow);
    },

    async updateSupportChannel(id, patch) {
      const row: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.enabled !== undefined) row.enabled = patch.enabled;
      if (patch.config !== undefined) row.config = patch.config;
      if (patch.formTitle !== undefined) row.form_title = patch.formTitle;
      if (patch.form !== undefined) row.form = patch.form;
      if (patch.confirmationMessage !== undefined)
        row.confirmation_message = patch.confirmationMessage;
      if (patch.conversationData !== undefined)
        row.conversation_data = patch.conversationData;
      if (patch.availability !== undefined) row.availability = patch.availability;
      const { data, error } = await client
        .from("support_channels")
        .update(row)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return toSupportChannel(data as SupportChannelRow);
    },

    async deleteSupportChannel(id) {
      const { error } = await client
        .from("support_channels")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },

    async reorderSupportChannels(helpDeskId, orderedIds) {
      for (let i = 0; i < orderedIds.length; i++) {
        const { error } = await client
          .from("support_channels")
          .update({ position: i })
          .eq("id", orderedIds[i])
          .eq("help_desk_id", helpDeskId);
        if (error) throw error;
      }
    },

    async setTicketingIntegration(helpDeskId, input) {
      const integration: TicketingIntegration = {
        id: shortId(),
        platform: input.platform,
        name: input.name,
        connectedAt: new Date().toISOString(),
        config: input.config,
      };
      const { data, error } = await client
        .from("help_desks")
        .update({
          ticketing_integration: integration,
          updated_at: new Date().toISOString(),
        })
        .eq("id", helpDeskId)
        .select()
        .single();
      if (error) throw error;
      return toHelpDesk(data as HelpDeskRow);
    },

    async clearTicketingIntegration(helpDeskId) {
      const { data, error } = await client
        .from("help_desks")
        .update({ ticketing_integration: null, updated_at: new Date().toISOString() })
        .eq("id", helpDeskId)
        .select()
        .single();
      if (error) throw error;
      return toHelpDesk(data as HelpDeskRow);
    },

    // --- Widget SSO connections -----------------------------------------

    async getSsoConnection(organizationId) {
      const { data, error } = await client
        .from("sso_connections")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return data ? toSsoConnection(data as SsoConnectionRow) : null;
    },

    async getSsoConnectionPublic(organizationId) {
      const { data, error } = await client
        .from("sso_connections")
        .select("provider")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return data
        ? { provider: (data as { provider: SsoProviderKind }).provider }
        : null;
    },

    async setSsoConnection(organizationId, input) {
      // One connection per org: upsert on organization_id. Setting a new
      // connection resets validation until the caller re-validates.
      const { data, error } = await client
        .from("sso_connections")
        .upsert(
          {
            organization_id: organizationId,
            provider: input.provider,
            config: input.config,
            encrypted_secret: input.encryptedSecret ?? null,
            validation_status: "unvalidated",
            validated_at: null,
            // connected_at omitted: the column default stamps it on first
            // insert and the existing value is preserved on rotation (update).
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id" }
        )
        .select()
        .single();
      if (error) throw error;
      return toSsoConnection(data as SsoConnectionRow);
    },

    async setSsoConnectionValidation(organizationId, status) {
      const { data, error } = await client
        .from("sso_connections")
        .update({
          validation_status: status,
          validated_at:
            status === "unvalidated" ? null : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", organizationId)
        .select()
        .single();
      if (error) throw error;
      return toSsoConnection(data as SsoConnectionRow);
    },

    async clearSsoConnection(organizationId) {
      const { error } = await client
        .from("sso_connections")
        .delete()
        .eq("organization_id", organizationId);
      if (error) throw error;
    },

    // --- API integrations (spec #559) ------------------------------------

    async getApiIntegration(assistantId) {
      const { data, error } = await client
        .from("assistant_api_integrations")
        .select("*")
        .eq("assistant_id", assistantId)
        .maybeSingle();
      if (error) throw error;
      return data ? toApiIntegration(data as ApiIntegrationRow) : null;
    },

    async setApiIntegration(input) {
      // One integration per assistant: upsert on assistant_id. An omitted
      // `encryptedCredential` keeps whatever is stored, so editing the
      // catalogue never has to round-trip the secret through the browser;
      // an explicit null clears it.
      const row: Record<string, unknown> = {
        assistant_id: input.assistantId,
        organization_id: input.organizationId,
        name: input.name,
        base_url: input.baseUrl,
        auth_type: input.authType,
        auth_header_name: input.authHeaderName ?? "",
        auth_username: input.authUsername ?? "",
        endpoints: input.endpoints,
        updated_at: new Date().toISOString(),
      };
      if (input.encryptedCredential !== undefined) {
        row.encrypted_credential = input.encryptedCredential;
      }
      const { data, error } = await client
        .from("assistant_api_integrations")
        .upsert(row, { onConflict: "assistant_id" })
        .select()
        .single();
      if (error) throw error;
      return toApiIntegration(data as ApiIntegrationRow);
    },

    async deleteApiIntegration(assistantId) {
      const { error } = await client
        .from("assistant_api_integrations")
        .delete()
        .eq("assistant_id", assistantId);
      if (error) throw error;
    },

    // --- Provider connections -------------------------------------------

    async listProviderConnections(organizationId) {
      // The org's embedding choice (#437) rides along on every connection
      // list, so the runtime resolves it without a second round trip at each
      // call site that loads connections.
      const [connections, org] = await Promise.all([
        client
          .from("provider_connections")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: true }),
        client
          .from("organizations")
          .select("embedding_connection_id")
          .eq("id", organizationId)
          .maybeSingle(),
      ]);
      if (connections.error) throw connections.error;
      if (org.error) throw org.error;
      const embeddingConnectionId =
        (org.data as { embedding_connection_id?: string | null } | null)
          ?.embedding_connection_id ?? null;
      return (connections.data as ConnectionRow[]).map((row) =>
        toConnection(row, embeddingConnectionId)
      );
    },

    async getEmbeddingConnectionId(organizationId) {
      const { data, error } = await client
        .from("organizations")
        .select("embedding_connection_id")
        .eq("id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return (
        (data as { embedding_connection_id?: string | null } | null)
          ?.embedding_connection_id ?? null
      );
    },

    async setEmbeddingConnectionId(organizationId, connectionId) {
      if (connectionId) {
        // Cross-org references would silently embed with someone else's key.
        const { data, error } = await client
          .from("provider_connections")
          .select("id")
          .eq("id", connectionId)
          .eq("organization_id", organizationId)
          .maybeSingle();
        if (error) throw error;
        if (!data) {
          throw new Error("connection does not belong to this organization");
        }
      }
      const { error } = await client
        .from("organizations")
        .update({ embedding_connection_id: connectionId })
        .eq("id", organizationId);
      if (error) throw error;
    },

    async createProviderConnection(organizationId, input) {
      const { data, error } = await client
        .from("provider_connections")
        .insert({
          organization_id: organizationId,
          type: input.type,
          provider: input.provider,
          display_name: input.displayName ?? "",
          encrypted_key: input.encryptedKey ?? null,
          key_hint: input.keyHint ?? "",
          config: input.config ?? {},
          created_by: input.createdBy ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return toConnection(data as ConnectionRow);
    },

    async deleteProviderConnection(id) {
      const { error } = await client
        .from("provider_connections")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },

    // --- Knowledge (OKF collections) ----------------------------------------

    async listOrgCollections(organizationId) {
      const { data, error } = await client
        .from("knowledge_collections")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as Array<Record<string, string>>).map((r) => ({
        id: r.id,
        organizationId: r.organization_id ?? "",
        name: r.name,
        description: r.description,
        createdAt: r.created_at,
      })) satisfies KnowledgeCollection[];
    },

    async listCollections(assistantId) {
      // Derived membership (PRD #726 contract): the Collections holding
      // Sources linked to this Assistant.
      const { data: linkRows, error: linkError } = await client
        .from("assistant_sources")
        .select("sources!inner(collection_id)")
        .eq("assistant_id", assistantId);
      if (linkError) throw linkError;
      const collectionIds = [
        ...new Set(
          (
            linkRows as unknown as Array<{
              sources: { collection_id: string } | null;
            }>
          )
            .map((r) => r.sources?.collection_id)
            .filter((id): id is string => Boolean(id))
        ),
      ];
      if (collectionIds.length === 0) return [];
      const { data, error } = await client
        .from("knowledge_collections")
        .select("*")
        .in("id", collectionIds)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as Array<Record<string, string>>).map((r) => ({
        id: r.id,
        organizationId: r.organization_id ?? "",
        name: r.name,
        description: r.description,
        createdAt: r.created_at,
      })) satisfies KnowledgeCollection[];
    },

    async getCollection(id) {
      const { data, error } = await client
        .from("knowledge_collections")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        organizationId: data.organization_id ?? "",
        name: data.name,
        description: data.description,
        createdAt: data.created_at,
      };
    },

    async getOrCreateOrgLibraryCollection(organizationId) {
      const id = `org-library-${organizationId}`;
      const map = (row: Record<string, unknown>): KnowledgeCollection => ({
        id: row.id as string,
        organizationId: (row.organization_id as string | null) ?? "",
        name: row.name as string,
        description: row.description as string,
        createdAt: row.created_at as string,
      });
      const { data: existing, error: readError } = await client
        .from("knowledge_collections")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (readError) throw readError;
      if (existing) return map(existing as Record<string, unknown>);
      const { data, error } = await client
        .from("knowledge_collections")
        .insert({
          id,
          organization_id: organizationId,
          name: "Knowledge Library",
          description:
            "Organization-wide knowledge added from the Knowledge hub",
        })
        .select()
        .single();
      if (error) {
        // Lost a create race: the deterministic id means the winner's row is
        // the one we wanted anyway.
        const { data: again, error: retryError } = await client
          .from("knowledge_collections")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (retryError || !again) throw error;
        return map(again as Record<string, unknown>);
      }
      return map(data as Record<string, unknown>);
    },

    async createCollection(assistantId, input) {
      // Stamp the owning Organization (PRD #726): new Collections are
      // org-owned from day one; the backfill migration covers history.
      const { data: assistant, error: assistantError } = await client
        .from("assistants")
        .select("organization_id")
        .eq("id", assistantId)
        .single();
      if (assistantError) throw assistantError;
      const { data, error } = await client
        .from("knowledge_collections")
        .insert({
          id: shortId(),
          organization_id: assistant.organization_id,
          name: input.name,
          description: input.description ?? "",
        })
        .select()
        .single();
      if (error) throw error;
      return {
        id: data.id,
        organizationId: data.organization_id ?? "",
        name: data.name,
        description: data.description,
        createdAt: data.created_at,
      };
    },

    async deleteCollection(id) {
      const { error } = await client
        .from("knowledge_collections")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },

    async listSources(collectionId) {
      const { data, error } = await client
        .from("sources")
        .select("*")
        .eq("collection_id", collectionId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as Array<Record<string, unknown>>).map(toSource);
    },

    async createSource(input) {
      const { data, error } = await client
        .from("sources")
        .insert({
          id: input.id ?? shortId(),
          collection_id: input.collectionId,
          name: input.name,
          kind: input.kind,
          config: input.config ?? {},
          recrawl_schedule: input.recrawlSchedule ?? "never",
          original_object_path: input.originalObjectPath ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      // No implicit link (PRD #726 contract): Collections have no owning
      // assistant, so callers (the ops layer) link Assistants explicitly.
      return toSource(data as Record<string, unknown>);
    },

    async updateSource(id, patch) {
      const row: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.error !== undefined) row.error = patch.error;
      if (patch.config !== undefined) row.config = patch.config;
      if (patch.recrawlSchedule !== undefined)
        row.recrawl_schedule = patch.recrawlSchedule;
      if (patch.lastCrawledAt !== undefined)
        row.last_crawled_at = patch.lastCrawledAt;
      if (patch.originalObjectPath !== undefined)
        row.original_object_path = patch.originalObjectPath;
      const { error } = await client.from("sources").update(row).eq("id", id);
      if (error) throw error;
    },

    async getSource(id) {
      const { data, error } = await client
        .from("sources")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toSource(data as Record<string, unknown>) : null;
    },

    async createApplicationOAuthNonce(input) {
      const { error } = await client.from("application_oauth_nonces").insert({
        nonce: input.nonce,
        organization_id: input.organizationId,
        member_id: input.memberId,
        expires_at: input.expiresAt,
      });
      if (error) throw error;
    },

    async consumeApplicationOAuthNonce(input) {
      const { data, error } = await client.rpc("consume_application_oauth_nonce", {
        p_nonce: input.nonce,
        p_organization_id: input.organizationId,
        p_member_id: input.memberId,
        p_consumed_at: input.consumedAt,
      });
      if (error) throw error;
      return data === true;
    },

    async listApplicationConnections(organizationId) {
      const { data, error } = await client
        .from("application_connections_safe")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as Array<Record<string, unknown>>).map(
        toApplicationConnection
      );
    },

    async getSafeApplicationConnection(id) {
      const { data, error } = await client
        .from("application_connections_safe")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toApplicationConnection(data as Record<string, unknown>) : null;
    },

    async getApplicationConnection(id) {
      const { data, error } = await client
        .from("application_connections")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data
        ? toApplicationConnection(data as Record<string, unknown>)
        : null;
    },

    async createApplicationConnection(input) {
      const now = new Date().toISOString();
      const owner = resolveApplicationConnectionOwner(
        input.provider,
        input.ownerMemberId
      );
      const legacyRow = {
        id: shortId(),
        organization_id: input.organizationId,
        provider: input.provider,
        name: input.name,
        status: "connected",
        sealed_credentials: input.sealedCredentials,
        scopes: input.scopes ?? [],
        provider_account_id: input.providerAccountId ?? null,
        metadata: input.metadata ?? {},
        error: "",
        last_connected_at: now,
      };
      let result = await client
        .from("application_connections")
        .insert({
          ...legacyRow,
          owner_type: owner.ownerType,
          owner_member_id: owner.ownerMemberId,
        })
        .select()
        .single();
      if (result.error && isSchemaLagError(result.error)) {
        if (owner.ownerType === "member") {
          throw new Error(
            "Personal Application Connections are temporarily unavailable while the database updates"
          );
        }
        result = await client
          .from("application_connections")
          .insert(legacyRow)
          .select()
          .single();
      }
      if (result.error) throw result.error;
      return toApplicationConnection(result.data as Record<string, unknown>);
    },

    async updateApplicationConnection(id, patch) {
      const row: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (patch.ownerType !== undefined) row.owner_type = patch.ownerType;
      if (patch.ownerMemberId !== undefined)
        row.owner_member_id = patch.ownerMemberId;
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.sealedCredentials !== undefined)
        row.sealed_credentials = patch.sealedCredentials;
      if (patch.scopes !== undefined) row.scopes = patch.scopes;
      if (patch.providerAccountId !== undefined)
        row.provider_account_id = patch.providerAccountId;
      if (patch.metadata !== undefined) row.metadata = patch.metadata;
      if (patch.error !== undefined) row.error = patch.error;
      if (patch.lastConnectedAt !== undefined)
        row.last_connected_at = patch.lastConnectedAt;
      const { error } = await client
        .from("application_connections")
        .update(row)
        .eq("id", id);
      if (error) throw error;
    },

    async deleteApplicationConnection(id) {
      const { error } = await client
        .from("application_connections")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },

    async listApplicationImports(organizationId) {
      const { data, error } = await client
        .from("application_imports")
        .select("*, application_import_assistants(assistant_id)")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as Array<Record<string, unknown>>).map(toApplicationImport);
    },

    async getApplicationImport(id) {
      const { data, error } = await client
        .from("application_imports")
        .select("*, application_import_assistants(assistant_id)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toApplicationImport(data as Record<string, unknown>) : null;
    },

    async acquireApplicationImportSync(id, organizationId) {
      const { data, error } = await client.rpc("acquire_application_import_sync", {
        p_id: id,
        p_organization_id: organizationId,
      });
      if (error) throw error;
      const acquired = Array.isArray(data) ? data[0] : data;
      return acquired
        ? toApplicationImport(acquired as Record<string, unknown>)
        : null;
    },

    async createApplicationImport(input) {
      const assistantIds = [...new Set(input.assistantIds ?? [])];
      const { data, error } = await client.rpc(
        "create_application_import_with_assistants",
        {
          p_id: shortId(),
          p_organization_id: input.organizationId,
          p_connection_id: input.connectionId,
          p_collection_id: input.collectionId,
          p_name: input.name,
          p_config: input.config ?? {},
          p_cadence: input.cadence ?? "manual",
          p_enabled: input.enabled ?? true,
          p_assistant_ids: assistantIds,
        }
      );
      if (error) throw error;
      const created = Array.isArray(data) ? data[0] : data;
      return toApplicationImport({
        ...(created as Record<string, unknown>),
        application_import_assistants: assistantIds.map((assistant_id) => ({
          assistant_id,
        })),
      });
    },

    async updateApplicationImport(id, patch) {
      const body: Record<string, unknown> = {};
      for (const key of [
        "name", "config", "cadence", "enabled", "status", "checkpoint",
        "error", "lastSyncedAt", "nextSyncAt", "resetSources",
      ] as const) {
        if (patch[key] !== undefined) body[key] = patch[key] ?? "";
      }
      const { error } = await client.rpc(
        "update_application_import_with_assistants",
        {
          p_id: id,
          p_patch: body,
          p_assistant_ids:
            patch.assistantIds === undefined
              ? null
              : [...new Set(patch.assistantIds)],
        }
      );
      if (error) throw error;
    },

    async deleteApplicationImport(id) {
      const { error } = await client
        .from("application_imports")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },

    async listDueApplicationImports(now, limit) {
      // Keep the PostgREST predicates flat. Nested `or(and(...), ...)` is not
      // portable across the hosted API and the local contract shim. A manual
      // continuation is due while it is `syncing`; scheduled Imports use the
      // ordinary cadence/time predicate. Merge and bound both result sets.
      const syncingQuery = client
        .from("application_imports")
        .select("*, application_import_assistants(assistant_id)")
        .eq("enabled", true)
        .eq("status", "syncing")
        .order("next_sync_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      const scheduledQuery = client
        .from("application_imports")
        .select("*, application_import_assistants(assistant_id)")
        .eq("enabled", true)
        .eq("cadence", "daily")
        .or(`next_sync_at.is.null,next_sync_at.lte.${now}`)
        .order("next_sync_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      const [syncing, scheduled] = await Promise.all([
        syncingQuery,
        scheduledQuery,
      ]);
      if (syncing.error) throw syncing.error;
      if (scheduled.error) throw scheduled.error;
      const rows = new Map<string, Record<string, unknown>>();
      for (const row of [
        ...((syncing.data ?? []) as Array<Record<string, unknown>>),
        ...((scheduled.data ?? []) as Array<Record<string, unknown>>),
      ]) {
        rows.set(String(row.id), row);
      }
      return [...rows.values()]
        .sort((left, right) =>
          String(left.next_sync_at ?? "").localeCompare(
            String(right.next_sync_at ?? "")
          )
        )
        .slice(0, limit)
        .map(toApplicationImport);
    },

    async listApplicationSources(importId) {
      const { data, error } = await client
        .from("application_sources")
        .select("*")
        .eq("import_id", importId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as Array<Record<string, unknown>>).map(toApplicationSource);
    },

    async upsertApplicationSource(input) {
      // Keep the mapping's own identity stable across incremental refreshes.
      // Supabase includes every supplied column in ON CONFLICT's UPDATE set,
      // so generating an id unconditionally would silently replace it.
      const { data: existing, error: lookupError } = await client
        .from("application_sources")
        .select("id")
        .eq("import_id", input.importId)
        .eq("remote_id", input.remoteId)
        .maybeSingle();
      if (lookupError) throw lookupError;
      const { data, error } = await client
        .from("application_sources")
        .upsert(
          {
            id:
              (existing as { id?: string } | null)?.id ?? shortId(),
            import_id: input.importId,
            source_id: input.sourceId,
            remote_id: input.remoteId,
            canonical_url: input.canonicalUrl ?? null,
            revision: input.revision ?? null,
            content_hash: input.contentHash,
            content_bytes: input.contentBytes ?? 0,
            remote_mime_type: input.remoteMimeType ?? null,
            remote_updated_at: input.remoteUpdatedAt ?? null,
            last_seen_at: input.lastSeenAt,
            removed_at: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "import_id,remote_id", ignoreDuplicates: false }
        )
        .select()
        .single();
      if (error) throw error;
      return toApplicationSource(data as Record<string, unknown>);
    },

    async reserveApplicationKnowledgeBytes(input) {
      const { data, error } = await client.rpc(
        "reserve_application_knowledge_bytes",
        {
          p_import_id: input.importId,
          p_organization_id: input.organizationId,
          p_projected_bytes: input.projectedBytes,
          p_limit_bytes: input.limitBytes,
        }
      );
      if (error) throw error;
      return data === true;
    },

    async syncApplicationSourceAssistantScope(importId, sourceId) {
      const { error } = await client.rpc("sync_application_source_assistant_scope", {
        p_import_id: importId,
        p_source_id: sourceId,
      });
      if (error) throw error;
    },

    async markApplicationSourceRemoved(importId, remoteId, removedAt) {
      const { error } = await client
        .from("application_sources")
        .update({ removed_at: removedAt, updated_at: new Date().toISOString() })
        .eq("import_id", importId)
        .eq("remote_id", remoteId);
      if (error) throw error;
    },

    async recordApplicationSyncRun(importId, input) {
      const { data, error } = await client
        .from("application_sync_runs")
        .insert({
          id: shortId(),
          import_id: importId,
          status: input.status,
          discovered: input.discovered,
          upserted: input.upserted,
          unchanged: input.unchanged,
          deleted: input.deleted,
          skipped: input.skipped,
          failed: input.failed,
          enqueued: input.enqueued,
          provider_calls: input.providerCalls,
          bytes: input.bytes,
          duration_ms: input.durationMs,
          skipped_reasons: input.skippedReasons,
          error: input.error,
          started_at: input.startedAt,
          completed_at: input.completedAt,
        })
        .select()
        .single();
      if (error) throw error;
      return toApplicationSyncRun(data as Record<string, unknown>);
    },

    async listApplicationSyncRuns(importId) {
      const { data, error } = await client
        .from("application_sync_runs")
        .select("*")
        .eq("import_id", importId)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return (data as Array<Record<string, unknown>>).map(toApplicationSyncRun);
    },

    async listApplicationOperationalState(organizationId) {
      const { data, error } = await client.rpc("list_application_operational_state", {
        p_organization_id: organizationId,
      });
      if (error) throw error;
      return (data as Array<Record<string, unknown>>).map((row) => ({
        importId: row.import_id as string,
        sourceCount: Number(row.source_count ?? 0),
        lastRun: row.last_run
          ? toApplicationSyncRun(row.last_run as Record<string, unknown>)
          : null,
      }));
    },

    async getApplicationHealthSummary(organizationId) {
      const { data, error } = await client.rpc("get_application_health_summary", {
        p_organization_id: organizationId,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      return {
        connected: Number(row?.connected ?? 0),
        pending: Number(row?.pending ?? 0),
        attention: Number(row?.attention ?? 0),
        syncing: Number(row?.syncing ?? 0),
        ready: Number(row?.ready ?? 0),
      };
    },

    async createBackgroundJob(input) {
      const now = new Date().toISOString();
      let organizationId = input.organizationId;
      if (!organizationId && input.sourceId) {
        const source = await this.getSource(input.sourceId);
        const collection = source
          ? await this.getCollection(source.collectionId)
          : null;
        organizationId = collection?.organizationId;
      }
      if (!organizationId && typeof input.payload.organizationId === "string") {
        organizationId = input.payload.organizationId;
      }
      const baseRow = {
          id: input.id ?? shortId(),
          kind: input.kind,
          source_id: input.sourceId ?? null,
          status: "queued",
          payload: input.payload,
          max_attempts: input.maxAttempts ?? 3,
          next_run_at: input.nextRunAt ?? now,
        };
      let { data, error } = await client
        .from("background_jobs")
        .insert({ ...baseRow, organization_id: organizationId ?? null })
        .select()
        .single();
      if (error && isSchemaLagError(error)) {
        ({ data, error } = await client
          .from("background_jobs")
          .insert(baseRow)
          .select()
          .single());
      }
      if (error && input.id && error.code === "23505") {
        const { data: existing, error: readError } = await client
          .from("background_jobs")
          .select("*")
          .eq("id", input.id)
          .single();
        if (readError) throw readError;
        return toBackgroundJob(existing as Record<string, unknown>);
      }
      if (error) throw error;
      return toBackgroundJob(data as Record<string, unknown>);
    },

    async createApplicationSyncJobIfAbsent(input) {
      const { data, error } = await client.rpc("create_application_sync_job_if_absent", {
        p_id: shortId(),
        p_import_id: input.importId,
        p_organization_id: input.organizationId,
        p_next_run_at: input.nextRunAt,
        p_max_concurrent: input.maxConcurrent ?? 3,
      });
      if (error) throw error;
      return data === true;
    },

    async cancelApplicationSyncJobs(importId, reason) {
      const { error } = await client.rpc("cancel_application_sync_jobs", {
        p_import_id: importId,
        p_reason: reason,
      });
      if (error) throw error;
    },

    async stageSourceIngestJob(input) {
      const { data, error } = await client.rpc("stage_source_ingest_job", {
        p_job_id: shortId(),
        p_source_id: input.sourceId,
        p_assistant_id: input.assistantId,
        p_collection_id: input.collectionId,
        p_raw_text: input.rawText,
        p_now: new Date().toISOString(),
      });
      if (error) {
        if (!isSchemaLagError(error)) throw error;
        await this.createBackgroundJob({
          kind: "ingest_source",
          sourceId: input.sourceId,
          payload: { kind: "ingest_source", ...input, schemaLagFallback: true },
        });
        return 0;
      }
      return Number(data);
    },

    async upgradeLegacySourceIngestJob(input) {
      const { data, error } = await client.rpc("upgrade_legacy_source_ingest_job", {
        p_job_id: input.jobId,
        p_lease_token: input.leaseToken,
        p_assistant_id: input.assistantId,
        p_collection_id: input.collectionId,
        p_source_id: input.sourceId,
        p_raw_text: input.rawText,
        p_now: input.now,
      });
      if (error) {
        if (isSchemaLagError(error)) return "schema_lag";
        throw error;
      }
      return data === null ? null : Number(data);
    },

    async getSourceIngestPayload(sourceId, version) {
      let query = client
        .from("source_ingest_payloads")
        .select("version, raw_text, draft_manifest")
        .eq("source_id", sourceId);
      if (version !== undefined) query = query.eq("version", version);
      const { data, error } = await query
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data
        ? {
            version: Number(data.version),
            rawText: data.raw_text as string,
            drafts: (data.draft_manifest as Array<{
              path: string;
              frontmatter: ConceptFrontmatter;
              body: string;
            }> | null) ?? null,
          }
        : null;
    },

    async initializeSourceIngestAttempt(input) {
      const { data, error } = await client.rpc("initialize_source_ingest_attempt", {
        p_job_id: input.jobId,
        p_lease_token: input.leaseToken,
        p_source_id: input.sourceId,
        p_version: input.version,
        p_draft_manifest: input.drafts,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as
        | Record<string, unknown>
        | undefined;
      if (!row) return null;
      return {
        drafts: row.draft_manifest as Array<{
          path: string;
          frontmatter: ConceptFrontmatter;
          body: string;
        }>,
        generationId: row.generation_id as string,
        expectedActiveGenerationId: row.expected_active_generation_id as string,
        cursor: Number(row.ingest_cursor),
      };
    },

    async checkpointSourceIngestCursor(input) {
      const { data, error } = await client.rpc("checkpoint_source_ingest_cursor", {
        p_job_id: input.jobId,
        p_lease_token: input.leaseToken,
        p_source_id: input.sourceId,
        p_version: input.version,
        p_generation_id: input.generationId,
        p_cursor: input.cursor,
      });
      if (error) throw error;
      return data === true;
    },

    async commitSourceIngestGeneration(input) {
      const { data, error } = await client.rpc("commit_source_ingest_generation", {
        p_job_id: input.jobId,
        p_lease_token: input.leaseToken,
        p_source_id: input.sourceId,
        p_version: input.version,
        p_expected_active_generation_id: input.expectedActiveGenerationId,
        p_generation_id: input.generationId,
      });
      if (error) throw error;
      return data === true;
    },

    async listBackgroundJobsForSource(sourceId, kind) {
      let query = client
        .from("background_jobs")
        .select("*")
        .eq("source_id", sourceId)
        .order("created_at", { ascending: false });
      if (kind) query = query.eq("kind", kind);
      const { data, error } = await query;
      if (error) throw error;
      return (data as Array<Record<string, unknown>>).map(toBackgroundJob);
    },

    async claimBackgroundJobs(input) {
      const { data, error } = await client.rpc("claim_background_jobs", {
        p_kind: input.kind,
        p_worker_id: input.workerId,
        p_now: input.now,
        p_stale_before: input.staleBefore,
        p_limit: input.limit,
      });
      if (error) {
        if (isSchemaLagError(error)) return [];
        throw error;
      }
      return ((data ?? []) as Array<Record<string, unknown>>).map(toBackgroundJob);
    },

    async claimTerminalBackgroundJobs(input) {
      const { data, error } = await client.rpc("claim_terminal_background_jobs", {
        p_kind: input.kind,
        p_worker_id: input.workerId,
        p_now: input.now,
        p_stale_before: input.staleBefore,
        p_limit: input.limit,
      });
      // During a worker-before-database rollout the legacy claim path safely
      // reclaims these jobs and runs them again, so absence is a safe fallback.
      if (error) {
        if (isSchemaLagError(error)) return [];
        throw error;
      }
      return ((data ?? []) as Array<Record<string, unknown>>).map(toBackgroundJob);
    },

    async settleBackgroundJob(input) {
      const { data, error } = await client.rpc("settle_background_job", {
        p_id: input.id,
        p_lease_token: input.leaseToken,
        p_now: input.now,
        p_status: input.outcome.status,
        p_error: "error" in input.outcome ? input.outcome.error : "",
        p_next_run_at:
          input.outcome.status === "queued" ? input.outcome.nextRunAt : null,
      });
      if (error) throw error;
      return data === true;
    },

    async settleApplicationSyncJobSuccess(input) {
      const { data, error } = await client.rpc(
        "settle_application_sync_job_success",
        {
          p_id: input.id,
          p_lease_token: input.leaseToken,
          p_import_id: input.importId,
          p_organization_id: input.organizationId,
          p_successor_id: shortId(),
          p_now: input.now,
          p_max_concurrent: input.maxConcurrent,
        }
      );
      if (error) throw error;
      return data === true;
    },

    async renewBackgroundJobLease(input) {
      const { data, error } = await client.rpc("renew_background_job_lease", {
        p_id: input.id,
        p_lease_token: input.leaseToken,
        p_now: input.now,
      });
      if (error) throw error;
      return data === true;
    },

    async claimApiIdempotency(input) {
      let { data, error } = await client.rpc("claim_api_idempotency", {
        p_scope: input.scope,
        p_key: input.key,
        p_request_hash: input.requestHash,
        p_now: input.now,
        p_stale_before: input.staleBefore,
        p_expires_at: input.expiresAt,
      });
      if (error && isSchemaLagError(error)) {
        ({ data, error } = await client.rpc("claim_api_idempotency", {
          p_scope: input.scope,
          p_key: input.key,
          p_request_hash: input.requestHash,
          p_now: input.now,
          p_expires_at: input.expiresAt,
        }));
      }
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
      const status = row.claim_status as "claimed" | "running" | "conflict" | "completed";
      if (status === "claimed") {
        return { status, leaseToken: row.claim_lease_token as string };
      }
      if (status === "completed") {
        return {
          status,
          responseStatus: Number(row.claim_response_status),
          responseBody: row.claim_response_body as string,
          contentType: (row.claim_content_type as string) || "application/json",
        };
      }
      return { status };
    },

    async completeApiIdempotency(input) {
      const { data, error } = await client.rpc("complete_api_idempotency", {
        p_scope: input.scope,
        p_key: input.key,
        p_lease_token: input.leaseToken,
        p_response_status: input.responseStatus,
        p_response_body: input.responseBody,
        p_content_type: input.contentType,
        p_now: input.now,
      });
      if (error) throw error;
      return data === true;
    },

    async releaseApiIdempotency(input) {
      const { data, error } = await client.rpc("release_api_idempotency", {
        p_scope: input.scope,
        p_key: input.key,
        p_lease_token: input.leaseToken,
      });
      if (error) throw error;
      return data === true;
    },

    async getWorkQueueHealth(now) {
      const { data, error } = await client.rpc("get_work_queue_health", {
        p_now: now,
      });
      if (error) {
        if (isSchemaLagError(error)) {
          return {
            backgroundJobs: {},
            turnEffects: { due: 0, oldestDueAt: null },
            organizations: {},
          };
        }
        throw error;
      }
      const health = (data ?? {}) as {
        backgroundJobs?: Record<string, { due: number; oldestDueAt: string | null }>;
        turnEffects?: { due: number; oldestDueAt: string | null };
        organizations?: Record<string, unknown>;
      };
      return {
        backgroundJobs: health.backgroundJobs ?? {},
        turnEffects: health.turnEffects ?? { due: 0, oldestDueAt: null },
        organizations: health.organizations ?? {},
      };
    },

    async sweepRuntimeLedgers(now, limit) {
      const { data, error } = await client.rpc("sweep_runtime_ledgers", {
        p_now: now,
        p_limit: limit,
      });
      if (error) {
        if (isSchemaLagError(error)) {
          return {
            backgroundJobs: 0,
            conversationTurns: 0,
            turnEffects: 0,
            apiIdempotencyKeys: 0,
            sourceGenerations: 0,
          };
        }
        throw error;
      }
      const report = (data ?? {}) as Record<string, unknown>;
      return {
        backgroundJobs: Number(report.backgroundJobs ?? 0),
        conversationTurns: Number(report.conversationTurns ?? 0),
        turnEffects: Number(report.turnEffects ?? 0),
        apiIdempotencyKeys: Number(report.apiIdempotencyKeys ?? 0),
        sourceGenerations: Number(report.sourceGenerations ?? 0),
      };
    },

    async createExportJob(organizationId, input) {
      const { data, error } = await client
        .from("export_jobs")
        .insert({
          id: shortId(),
          organization_id: organizationId,
          kind: input.kind,
          status: "queued",
          format: input.format,
          params: input.params,
        })
        .select()
        .single();
      if (error) throw error;
      return toExportJob(data as Record<string, unknown>);
    },

    async listExportJobs(organizationId) {
      const { data, error } = await client
        .from("export_jobs")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as Array<Record<string, unknown>>).map(toExportJob);
    },

    async getExportJob(id) {
      const { data, error } = await client
        .from("export_jobs")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toExportJob(data as Record<string, unknown>) : null;
    },

    async claimDueExportJobs(input) {
      const { data, error } = await client.rpc("claim_due_export_jobs", {
        p_worker_id: input.workerId,
        p_now: input.now,
        p_stale_before: input.staleBefore,
        p_limit: input.limit,
      });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map(toExportJob);
    },

    async updateExportJob(id, patch) {
      const row: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.error !== undefined) row.error = patch.error;
      if (patch.storagePath !== undefined) row.storage_path = patch.storagePath;
      if (patch.lockedAt !== undefined) row.locked_at = patch.lockedAt;
      if (patch.lockedBy !== undefined) row.locked_by = patch.lockedBy;
      const { error } = await client
        .from("export_jobs")
        .update(row)
        .eq("id", id);
      if (error) throw error;
    },

    async requeueExportJob(id) {
      const { error } = await client
        .from("export_jobs")
        .update({
          status: "queued",
          attempts: 0,
          error: "",
          storage_path: null,
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },

    async claimProcessingCrawlSources(input) {
      const { data, error } = await client.rpc("claim_processing_crawl_sources", {
        p_worker_id: input.workerId,
        p_now: input.now,
        p_stale_before: input.staleBefore,
        p_limit: input.limit,
      });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        sourceId: row.source_id as string,
        collectionId: row.collection_id as string,
        assistantId: row.assistant_id as string,
      }));
    },

    async claimDueRecrawlSources(input) {
      const { data, error } = await client.rpc("claim_due_recrawl_sources", {
        p_now: input.now,
        p_limit: input.limit,
      });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        sourceId: row.source_id as string,
        collectionId: row.collection_id as string,
        assistantId: row.assistant_id as string,
      }));
    },

    async claimProcessingCrawlSource(input) {
      const { data, error } = await client
        .from("sources")
        .update({
          crawl_finalize_locked_at: input.now,
          crawl_finalize_locked_by: input.workerId,
          crawl_finalize_attempted_at: input.now,
        })
        .eq("id", input.sourceId)
        .eq("status", "processing")
        .or(
          `crawl_finalize_locked_at.is.null,crawl_finalize_locked_at.lte.${input.staleBefore}`
        )
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },

    async renewProcessingCrawlSourceClaim({ sourceId, workerId, now }) {
      const { data, error } = await client
        .from("sources")
        .update({ crawl_finalize_locked_at: now })
        .eq("id", sourceId)
        .eq("status", "processing")
        .eq("crawl_finalize_locked_by", workerId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },

    async releaseProcessingCrawlSourceClaim({ sourceId, workerId }) {
      const { error } = await client
        .from("sources")
        .update({
          crawl_finalize_locked_at: null,
          crawl_finalize_locked_by: null,
        })
        .eq("id", sourceId)
        .eq("crawl_finalize_locked_by", workerId);
      if (error) throw error;
    },

    async deleteSource(id) {
      const { error } = await client.from("sources").delete().eq("id", id);
      if (error) throw error;
    },

    async deleteConceptsByIds(ids) {
      if (ids.length === 0) return;
      // Chunks cascade on the concept FK (0005_knowledge); ids that no longer
      // exist are silently ignored by the `in` filter, so this is idempotent.
      const { error } = await client.from("concepts").delete().in("id", ids);
      if (error) throw error;
    },

    async deleteSourceKnowledgeGeneration(sourceId, generationId) {
      const { data, error } = await client
        .from("concepts")
        .delete()
        .eq("source_id", sourceId)
        .eq("generation_id", generationId)
        .eq("is_active", false)
        .select("id");
      if (error) {
        if (isSchemaLagError(error)) return [];
        throw error;
      }
      return (data ?? []).map((row) => row.id as string);
    },

    async commitSourceKnowledgeGeneration(input) {
      const { data, error } = await client.rpc(
        "commit_source_knowledge_generation",
        {
          p_source_id: input.sourceId,
          p_expected_active_generation_id: input.expectedActiveGenerationId,
          p_generation_id: input.generationId,
        }
      );
      if (error) {
        if (isSchemaLagError(error)) return true;
        throw error;
      }
      return data === true;
    },

    async listConcepts(collectionId) {
      let result = await client
        .from("concepts")
        .select("*")
        .eq("collection_id", collectionId)
        .eq("is_active", true)
        .order("path", { ascending: true });
      if (result.error && isSchemaLagError(result.error)) {
        result = await client
          .from("concepts")
          .select("*")
          .eq("collection_id", collectionId)
          .order("path", { ascending: true });
      }
      const { data, error } = result;
      if (error) throw error;
      return (data as Array<Record<string, unknown>>).map(toConcept);
    },

    async listConceptPage(collectionId, input) {
      const limit = Math.max(1, Math.min(input.limit, 500));
      const build = (activeOnly: boolean) => {
        let query = client
          .from("concepts")
          .select("*")
          .eq("collection_id", collectionId)
          .order("id", { ascending: true })
          .limit(limit);
        if (activeOnly) query = query.eq("is_active", true);
        if (input.afterId) query = query.gt("id", input.afterId);
        return query;
      };
      let result = await build(true);
      if (result.error && isSchemaLagError(result.error)) result = await build(false);
      if (result.error) throw result.error;
      return ((result.data ?? []) as Array<Record<string, unknown>>).map(toConcept);
    },

    async getConcept(id) {
      let result = await client
        .from("concepts")
        .select("*")
        .eq("id", id)
        .eq("is_active", true)
        .maybeSingle();
      if (result.error && isSchemaLagError(result.error)) {
        result = await client.from("concepts").select("*").eq("id", id).maybeSingle();
      }
      const { data, error } = result;
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        collectionId: data.collection_id,
        sourceId: data.source_id,
        generationId: data.generation_id ?? null,
        path: data.path,
        frontmatter: data.frontmatter,
        body: data.body,
        excluded: data.excluded ?? false,
        recrawlSchedule: data.recrawl_schedule ?? null,
        createdAt: data.created_at,
      };
    },

    async listNullEmbeddingConceptIds(assistantId) {
      // Post-contract (#733): the assistant's corpus is its linked Sources.
      const sourceIds = await linkedSourceIds(client, assistantId);
      if (sourceIds.length === 0) return [];
      const activeResult = await client
        .from("concept_chunks")
        .select("concept_id, concepts!inner(is_active)")
        .eq("concepts.is_active", true)
        .in("source_id", sourceIds)
        .is("embedding", null);
      let data: unknown = activeResult.data;
      let error = activeResult.error;
      if (error && isSchemaLagError(error)) {
        const legacyResult = await client
          .from("concept_chunks")
          .select("concept_id")
          .in("source_id", sourceIds)
          .is("embedding", null);
        data = legacyResult.data;
        error = legacyResult.error;
      }
      if (error) throw error;
      return [
        ...new Set(
          (data as Array<{ concept_id: string }>).map((r) => r.concept_id)
        ),
      ];
    },

    async findFaqConcept(assistantId, question) {
      const normalized = question.trim().toLowerCase();
      if (!normalized) return null;
      // Post-contract reach: a FAQ answers for the Assistants its Source is
      // linked to. Exact-match filtering happens in JS to keep ilike wildcard
      // characters in the question from widening the match.
      const sourceIds = await linkedSourceIds(client, assistantId);
      if (sourceIds.length === 0) return null;
      let result = await client
        .from("concepts")
        .select("*, knowledge_collections!inner(name)")
        .in("source_id", sourceIds)
        .eq("excluded", false)
        .eq("is_active", true)
        .eq("frontmatter->>type", "FAQ");
      if (result.error && isSchemaLagError(result.error)) {
        result = await client
          .from("concepts")
          .select("*, knowledge_collections!inner(name)")
          .in("source_id", sourceIds)
          .eq("excluded", false)
          .eq("frontmatter->>type", "FAQ");
      }
      const { data, error } = result;
      if (error) throw error;
      const row = (data as Array<Record<string, unknown>>).find(
        (r) =>
          String(
            ((r.frontmatter ?? {}) as ConceptFrontmatter).title ?? ""
          )
            .trim()
            .toLowerCase() === normalized
      );
      if (!row) return null;
      const collection = row.knowledge_collections as { name?: string };
      return {
        concept: {
          id: row.id as string,
          collectionId: row.collection_id as string,
          sourceId: (row.source_id as string) ?? null,
          generationId: (row.generation_id as string | null) ?? null,
          path: row.path as string,
          frontmatter: row.frontmatter as ConceptFrontmatter,
          body: row.body as string,
          excluded: (row.excluded as boolean) ?? false,
          recrawlSchedule:
            (row.recrawl_schedule as Concept["recrawlSchedule"]) ?? null,
          createdAt: row.created_at as string,
        },
        collectionName: collection?.name ?? "",
      };
    },

    async createConcept(input) {
      if (input.generationId && input.sourceId) {
        const { data, error } = await client.rpc("stage_source_concept", {
          p_id: shortId(),
          p_collection_id: input.collectionId,
          p_source_id: input.sourceId,
          p_generation_id: input.generationId,
          p_path: input.path,
          p_frontmatter: input.frontmatter,
          p_body: input.body,
        });
        if (error) {
          if (!isSchemaLagError(error)) throw error;
          const legacy = {
            id: shortId(),
            collection_id: input.collectionId,
            source_id: input.sourceId,
            path: input.path,
            frontmatter: input.frontmatter,
            body: input.body,
          };
          const inserted = await client.from("concepts").insert(legacy).select().single();
          if (inserted.error) throw inserted.error;
          return {
            id: inserted.data.id,
            collectionId: inserted.data.collection_id,
            sourceId: inserted.data.source_id,
            generationId: null,
            path: inserted.data.path,
            frontmatter: inserted.data.frontmatter,
            body: inserted.data.body,
            excluded: inserted.data.excluded ?? false,
            recrawlSchedule: inserted.data.recrawl_schedule ?? null,
            createdAt: inserted.data.created_at,
          };
        }
        const staged = (Array.isArray(data) ? data[0] : data) as {
          id: string;
          collection_id: string;
          source_id: string;
          generation_id?: string | null;
          path: string;
          frontmatter: ConceptFrontmatter;
          body: string;
          excluded?: boolean;
          recrawl_schedule?: Concept["recrawlSchedule"];
          created_at: string;
        };
        return {
          id: staged.id,
          collectionId: staged.collection_id,
          sourceId: staged.source_id,
          generationId: staged.generation_id ?? null,
          path: staged.path,
          frontmatter: staged.frontmatter,
          body: staged.body,
          excluded: staged.excluded ?? false,
          recrawlSchedule: staged.recrawl_schedule ?? null,
          createdAt: staged.created_at,
        };
      }
      const row = {
        id: shortId(),
        collection_id: input.collectionId,
        source_id: input.sourceId,
        generation_id: null,
        is_active: true,
        path: input.path,
        frontmatter: input.frontmatter,
        body: input.body,
      };
      let result = await client
        .from("concepts")
        .insert(row)
        .select()
        .single();
      if (result.error && isSchemaLagError(result.error)) {
        const { generation_id: _generationId, is_active: _isActive, ...legacyRow } = row;
        result = await client.from("concepts").insert(legacyRow).select().single();
      }
      const { data, error } = result;
      if (error) throw error;
      return {
        id: data.id,
        collectionId: data.collection_id,
        sourceId: data.source_id,
        generationId: data.generation_id ?? null,
        path: data.path,
        frontmatter: data.frontmatter,
        body: data.body,
        excluded: data.excluded ?? false,
        recrawlSchedule: data.recrawl_schedule ?? null,
        createdAt: data.created_at,
      };
    },

    async updateConcept(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.frontmatter !== undefined) row.frontmatter = patch.frontmatter;
      if (patch.body !== undefined) row.body = patch.body;
      const { data, error } = await client
        .from("concepts")
        .update(row)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return {
        id: data.id,
        collectionId: data.collection_id,
        sourceId: data.source_id,
        generationId: data.generation_id ?? null,
        path: data.path,
        frontmatter: data.frontmatter,
        body: data.body,
        excluded: data.excluded ?? false,
        recrawlSchedule: data.recrawl_schedule ?? null,
        createdAt: data.created_at,
      };
    },

    async deleteConcept(id) {
      const { error } = await client.from("concepts").delete().eq("id", id);
      if (error) throw error;
    },

    async deleteChunksByConcept(conceptId) {
      const { error } = await client
        .from("concept_chunks")
        .delete()
        .eq("concept_id", conceptId);
      if (error) throw error;
    },

    async setConceptExcluded(id, excluded) {
      const { error } = await client
        .from("concepts")
        .update({ excluded })
        .eq("id", id);
      if (error) throw error;
    },

    async setConceptRecrawlSchedule(id, schedule) {
      const { error } = await client
        .from("concepts")
        .update({ recrawl_schedule: schedule })
        .eq("id", id);
      if (error) throw error;
    },

    async saveChunks(chunks) {
      if (chunks.length === 0) return;
      const rows = chunks.map((chunk) => ({
        id: shortId(),
        concept_id: chunk.conceptId,
        collection_id: chunk.collectionId,
        source_id: chunk.sourceId ?? null,
        content: chunk.content,
        embedding: chunk.embedding,
        embedding_space: chunk.embeddingSpace ?? null,
      }));
      // Against a schema without `embedding_space` (20260830234500 not yet
      // applied) the insert is retried without the column: the row is then a
      // legacy null-space row, which the matchers treat as the current space,
      // exactly what every chunk was before the column existed.
      let withSpace = true;
      for (let offset = 0; offset < rows.length; offset += 100) {
        const batch = rows.slice(offset, offset + 100);
        let result = withSpace
          ? await client.from("concept_chunks").insert(batch)
          : { error: null };
        if (!withSpace || (result.error && isSchemaLagError(result.error))) {
          withSpace = false;
          result = await client
            .from("concept_chunks")
            .insert(batch.map(({ embedding_space: _space, ...rest }) => rest));
        }
        if (result.error) throw result.error;
      }
    },

    async searchChunks(assistantId, collectionId, query) {
      // Lexical search: also the safety net for vector search, since chunks
      // ingested while no embedding key was configured have NULL embeddings
      // and are invisible to match_chunks_linked. Post-contract (#733) the
      // scope is exactly the assistant's linked Sources.
      const linked = await linkedSourceIds(client, assistantId);
      if (linked.length === 0 && !query.embedding) return [];
      return searchChunkRows(client, query, {
        rpc: "match_chunks_linked",
        rpcArgs: { p_assistant_id: assistantId, p_collection_id: collectionId },
        lexicalScope: linked.length === 0
          ? null
          : (builder) => {
              const scoped = builder.in("source_id", linked);
              return collectionId ? scoped.eq("collection_id", collectionId) : scoped;
            },
        hydrateFor: assistantId,
      });
    },

    async searchCollectionChunks(organizationId, collectionIds, query) {
      // Saying "no Collections" is not the same as saying "everything": a
      // pure-persona Teammate must not fall through to an org-wide search.
      if (collectionIds.length === 0) return [];

      // Tenancy first: the caller names Collections, the database decides which
      // of them are this Organization's. A stale scope (a Collection deleted or
      // moved) narrows the search instead of widening it.
      const { data: ownRows, error: ownError } = await client
        .from("knowledge_collections")
        .select("id")
        .eq("organization_id", organizationId)
        .in("id", collectionIds);
      if (ownError) throw ownError;
      const scoped = (ownRows as Array<{ id: string }>).map((row) => row.id);
      if (scoped.length === 0) return [];

      // No assistant, so no per-(assistant, source) Direct access grant: a
      // Teammate cites the file, it never hands out a signed original.
      return searchChunkRows(client, query, {
        rpc: "match_chunks_collections",
        rpcArgs: { p_collection_ids: scoped },
        lexicalScope: (builder) => builder.in("collection_id", scoped),
        hydrateFor: null,
      });
    },

    async searchSourceChunks(organizationId, sourceIds, query) {
      // Same rule as the Collection half: "no Sources" is not "everything".
      if (sourceIds.length === 0) return [];

      // Tenancy first, and through the Collection: `sources` carries no
      // organization id of its own, so the join is what decides which of the
      // named Sources are this Organization's. A stale scope narrows the
      // search instead of widening it.
      const { data: ownRows, error: ownError } = await client
        .from("sources")
        .select("id, knowledge_collections!inner(organization_id)")
        .in("id", sourceIds)
        .eq("knowledge_collections.organization_id", organizationId);
      if (ownError) throw ownError;
      const scoped = (ownRows as Array<{ id: string }>).map((row) => row.id);
      if (scoped.length === 0) return [];

      return searchChunkRows(client, query, {
        rpc: "match_chunks_sources",
        rpcArgs: { p_source_ids: scoped },
        lexicalScope: (builder) => builder.in("source_id", scoped),
        hydrateFor: null,
      });
    },

    // --- Publications --------------------------------------------------------

    async createPublication(assistantId, config: PublicationConfig) {
      const { data: latest, error: latestError } = await client
        .from("publications")
        .select("version")
        .eq("assistant_id", assistantId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) throw latestError;
      const version = (latest?.version ?? 0) + 1;
      const { data, error } = await client
        .from("publications")
        .insert({ id: shortId(), assistant_id: assistantId, version, config })
        .select()
        .single();
      if (error) throw error;
      return {
        id: data.id,
        assistantId: data.assistant_id,
        version: data.version,
        config: data.config,
        createdAt: data.created_at,
      } satisfies Publication;
    },

    async deletePublications(assistantId) {
      const { error } = await client
        .from("publications")
        .delete()
        .eq("assistant_id", assistantId);
      if (error) throw error;
    },

    async listPublications(assistantId) {
      const { data, error } = await client
        .from("publications")
        .select("*")
        .eq("assistant_id", assistantId)
        .order("version", { ascending: false });
      if (error) throw error;
      return (data as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as string,
        assistantId: r.assistant_id as string,
        version: r.version as number,
        config: r.config as PublicationConfig,
        createdAt: r.created_at as string,
      }));
    },

    async getLatestPublication(assistantId) {
      const { data, error } = await client
        .from("publications")
        .select("*")
        .eq("assistant_id", assistantId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        assistantId: data.assistant_id,
        version: data.version,
        config: data.config,
        createdAt: data.created_at,
      };
    },

    async getPublication(id) {
      const { data, error } = await client
        .from("publications")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        assistantId: data.assistant_id,
        version: data.version,
        config: data.config,
        createdAt: data.created_at,
      };
    },

    // --- Conversations & messages ------------------------------------------

    async createConversation(input) {
      const id = input.id ?? shortId();
      const row = {
          id,
          assistant_id: input.assistantId ?? null,
          teammate_id: input.teammateId ?? null,
          subject_type: input.subjectType,
          subject_id: input.subjectId,
          collection_id: input.collectionId ?? null,
          title: input.title ?? "",
          metadata: input.metadata ?? {},
        };
      if (input.id) {
        const { error: insertError } = await client
          .from("conversations")
          .upsert(row, { onConflict: "id", ignoreDuplicates: true });
        if (insertError) throw insertError;
        const { data, error } = await client
          .from("conversations")
          .select("*")
          .eq("id", id)
          .single();
        if (error) throw error;
        return toConversation(data as ConversationRow);
      }
      const { data, error } = await client
        .from("conversations")
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      return toConversation(data as ConversationRow);
    },

    async listConversations(assistantId, subjectType, subjectId) {
      // Unbounded before: a visitor's or member's full lifetime history was
      // fetched on every call. Callers only ever show a short recent list
      // (+ pinned, capped in the UI), so cap the round trip at the source.
      const { data, error } = await client
        .from("conversations")
        .select("*")
        .eq("assistant_id", assistantId)
        .eq("subject_type", subjectType)
        .eq("subject_id", subjectId)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data as ConversationRow[]).map(toConversation);
    },

    async listTeammateConversations(teammateId, subjectId) {
      const { data, error } = await client
        .from("conversations")
        .select("*")
        .eq("teammate_id", teammateId)
        .eq("subject_id", subjectId)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data as ConversationRow[]).map(toConversation);
    },

    async getInboxPage(organizationId, query): Promise<InboxPage> {
      const limit = inboxPageSize(query.limit);
      const cursor = decodeInboxCursor(query.cursor);
      const optionalText = (value: string | undefined) =>
        value?.trim() ? value.trim() : null;
      const { data, error } = await client.rpc("get_inbox_page", {
        p_organization_id: organizationId,
        p_limit: limit,
        p_cursor_updated_at: cursor?.updatedAt ?? null,
        p_cursor_id: cursor?.id ?? null,
        p_search: optionalText(query.search),
        p_user_info: optionalText(query.userInfo),
        p_location: optionalText(query.location),
        p_city: optionalText(query.city),
        p_role: optionalText(query.role),
        p_from: optionalText(query.from),
        p_to: optionalText(query.to),
        p_assistant_id: optionalText(query.assistantId),
        p_language: optionalText(query.language),
        p_workflow: optionalText(query.workflow),
        p_conversation_ids: query.conversationIds?.length
          ? query.conversationIds
          : null,
        p_feedback: optionalText(query.feedback),
        p_escalation: optionalText(query.escalation),
        p_staff: optionalText(query.staff),
      });
      if (error) throw error;

      type InboxPageRow = {
        id: string;
        assistant_id: string;
        subject_type: Conversation["subjectType"];
        subject_id: string;
        collection_id: string | null;
        title: string;
        metadata: ConversationMetadata | null;
        pinned: boolean;
        created_at: string;
        updated_at: string;
        assistant_title: string;
        collection_name: string | null;
        message_count: number | string;
        flow_names: string[] | null;
        notification_only: boolean;
        feedback: -1 | 0 | 1;
      };
      const rows = (data ?? []) as InboxPageRow[];
      const hasMore = rows.length > limit;
      const conversations = rows.slice(0, limit).map(
        (row): InboxConversation => ({
          id: row.id,
          assistantId: row.assistant_id,
          teammateId: null,
          subjectType: row.subject_type,
          subjectId: row.subject_id,
          collectionId: row.collection_id,
          title: row.title,
          metadata: row.metadata ?? {},
          pinned: row.pinned,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          assistantTitle: row.assistant_title,
          collectionName: row.collection_name,
          messageCount: Number(row.message_count),
          flowNames: row.flow_names ?? [],
          notificationOnly: row.notification_only,
          feedback: row.feedback,
        })
      );
      const last = conversations.at(-1);
      return {
        conversations,
        nextCursor:
          hasMore && last
            ? encodeInboxCursor({ updatedAt: last.updatedAt, id: last.id })
            : null,
      };
    },

    async getInboxFacets(organizationId): Promise<InboxFacets> {
      const { data, error } = await client.rpc("get_inbox_facets", {
        p_organization_id: organizationId,
      });
      if (error) throw error;
      const facets = (data ?? {}) as Partial<InboxFacets>;
      return {
        locations: facets.locations ?? [],
        cities: facets.cities ?? [],
        roles: facets.roles ?? [],
        languages: facets.languages ?? [],
        workflows: facets.workflows ?? [],
      };
    },

    async getInboxConversationReview(
      conversationId
    ): Promise<InboxConversationReview> {
      const { data, error } = await client
        .from("messages")
        .select(
          "*, improvement_messages(message_id, improvements(id, seq, title)), answer_verdicts(message_id, verdict, reason, created_at)"
        )
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .order("seq", { ascending: true });
      if (error) throw error;

      type ReviewMessageRow = MessageRow & {
        improvement_messages:
          | Array<{
              message_id: string;
              improvements: { id: string; seq: number; title: string } | null;
            }>
          | null;
        answer_verdicts:
          | Array<{
              message_id: string;
              verdict: "pass" | "fail";
              reason: string;
              created_at: string;
            }>
          | {
              message_id: string;
              verdict: "pass" | "fail";
              reason: string;
              created_at: string;
            }
          | null;
      };
      const rows = (data ?? []) as unknown as ReviewMessageRow[];
      const improvementLinks = new Map<string, ImprovementMessageLink>();
      const answerVerdicts = new Map<
        string,
        InboxConversationReview["answerVerdicts"][number]
      >();
      for (const row of rows) {
        for (const link of row.improvement_messages ?? []) {
          if (!link.improvements) continue;
          improvementLinks.set(`${row.id}:${link.improvements.id}`, {
            messageId: row.id,
            improvementId: link.improvements.id,
            seq: link.improvements.seq,
            title: link.improvements.title,
          });
        }
        const verdicts = Array.isArray(row.answer_verdicts)
          ? row.answer_verdicts
          : row.answer_verdicts
            ? [row.answer_verdicts]
            : [];
        for (const verdict of verdicts) {
          answerVerdicts.set(verdict.message_id, {
            messageId: verdict.message_id,
            verdict: verdict.verdict,
            reason: verdict.reason,
            createdAt: verdict.created_at,
          });
        }
      }
      return {
        messages: rows.map(toStoredMessage),
        improvementLinks: [...improvementLinks.values()],
        answerVerdicts: [...answerVerdicts.values()],
      };
    },

    async getConversation(id) {
      const { data, error } = await client
        .from("conversations")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toConversation(data as ConversationRow) : null;
    },

    async getConversationForMessage(messageId) {
      const { data: msg, error: msgError } = await client
        .from("messages")
        .select("conversation_id")
        .eq("id", messageId)
        .maybeSingle();
      if (msgError) throw msgError;
      const conversationId = (msg as { conversation_id?: string } | null)
        ?.conversation_id;
      if (!conversationId) return null;
      const { data, error } = await client
        .from("conversations")
        .select("*")
        .eq("id", conversationId)
        .maybeSingle();
      if (error) throw error;
      return data ? toConversation(data as ConversationRow) : null;
    },

    async listActiveGraphDatasets() {
      // Post-contract, Collections reach Assistants only through the link
      // table: a Collection is an active graph dataset when any Assistant
      // linked to one of its Sources runs the graph engine.
      const { data, error } = await client
        .from("assistant_sources")
        .select(
          "sources!inner(collection_id), assistants!inner(knowledge_engine, organization_id)"
        )
        .eq("assistants.knowledge_engine", "graph");
      if (error) throw error;
      type Row = {
        sources: { collection_id: string } | null;
        assistants: { organization_id: string } | null;
      };
      const byCollection = new Map<string, string>();
      for (const row of data as unknown as Row[]) {
        const collectionId = row.sources?.collection_id;
        const organizationId = row.assistants?.organization_id;
        if (collectionId && organizationId)
          byCollection.set(collectionId, organizationId);
      }
      return [...byCollection].map(([collectionId, organizationId]) => ({
        organizationId,
        collectionId,
      }));
    },

    async claimActiveGraphDatasets(limit) {
      const { data, error } = await client.rpc("claim_active_graph_datasets", {
        p_limit: limit,
      });
      if (error) {
        if (isSchemaLagError(error)) {
          return this.listActiveGraphDatasets();
        }
        throw error;
      }
      return ((data ?? []) as Array<{
        organization_id: string;
        collection_id: string;
      }>).map((row) => ({
        organizationId: row.organization_id,
        collectionId: row.collection_id,
      }));
    },

    async setConversationPinned(id, pinned) {
      const { error } = await client
        .from("conversations")
        .update({ pinned })
        .eq("id", id);
      if (error) throw error;
    },

    async setConversationLegalHold(id, legalHold) {
      const { error } = await client
        .from("conversations")
        .update({ legal_hold: legalHold })
        .eq("id", id);
      if (error && isSchemaLagError(error)) {
        // No silent success here: a hold the database cannot record is a hold
        // the sweep would not honour, so the caller hears that it did not take.
        throw new Error(
          "Legal hold is temporarily unavailable while the database updates"
        );
      }
      if (error) throw error;
    },

    async updateConversationMetadata(id, patch) {
      const { error } = await client.rpc("merge_conversation_metadata", {
        p_id: id,
        p_patch: patch,
      });
      if (!error) return;
      if (!isSchemaLagError(error)) throw error;
      const { data, error: readError } = await client
        .from("conversations")
        .select("metadata")
        .eq("id", id)
        .maybeSingle();
      if (readError) throw readError;
      const metadata = {
        ...((data?.metadata as ConversationMetadata) ?? {}),
        ...patch,
      };
      const { error: updateError } = await client
        .from("conversations")
        .update({ metadata })
        .eq("id", id);
      if (updateError) throw updateError;
    },

    async appendConversationReferral(id, referral) {
      const { error } = await client.rpc("append_conversation_referral", {
        p_id: id,
        p_referral: referral,
      });
      if (!error) return;
      if (!isSchemaLagError(error)) throw error;
      const { data, error: readError } = await client
        .from("conversations")
        .select("metadata")
        .eq("id", id)
        .maybeSingle();
      if (readError) throw readError;
      const current = (data?.metadata as ConversationMetadata | null) ?? {};
      const { error: updateError } = await client
        .from("conversations")
        .update({
          metadata: {
            ...current,
            referredTo: [...(current.referredTo ?? []), referral],
          },
        })
        .eq("id", id);
      if (updateError) throw updateError;
    },

    async updateConversationSessionState(id, state) {
      const { error } = await client
        .from("conversations")
        .update({ session_state: state })
        .eq("id", id);
      if (error) throw error;
    },

    async mergeConversationSessionState(input) {
      const { data, error } = await client.rpc(
        "merge_conversation_session_state",
        {
          p_id: input.id,
          p_expected_version: input.expectedVersion,
          p_patch: input.patch,
        }
      );
      if (error) throw error;
      return data === true;
    },

    async claimConversationTurn(input) {
      const { data, error } = await client.rpc("claim_conversation_turn", {
        p_conversation_id: input.conversationId,
        p_request_id: input.requestId,
        p_worker_id: input.workerId,
        p_now: input.now,
        p_stale_before: input.staleBefore,
      });
      if (error) {
        if (isSchemaLagError(error)) {
          return {
            status: "claimed" as const,
            leaseToken: null,
            assistantMessageId: null,
          };
        }
        throw error;
      }
      const row = (Array.isArray(data) ? data[0] : data) as {
        claim_status: "claimed" | "running" | "completed";
        claim_lease_token: string | null;
        claim_assistant_message_id: string | null;
      };
      return {
        status: row.claim_status,
        leaseToken: row.claim_lease_token ?? null,
        assistantMessageId: row.claim_assistant_message_id ?? null,
      };
    },

    async completeConversationTurn(input) {
      const { data, error } = await client.rpc("complete_conversation_turn", {
        p_conversation_id: input.conversationId,
        p_request_id: input.requestId,
        p_lease_token: input.leaseToken,
        p_assistant_message_id: input.assistantMessageId,
        p_now: input.now,
      });
      if (error) throw error;
      return data === true;
    },

    async commitConversationTurn(input) {
      const { data, error } = await client.rpc("commit_conversation_turn", {
        p_message_id: shortId(),
        p_conversation_id: input.conversationId,
        p_request_id: input.requestId,
        p_lease_token: input.leaseToken,
        p_content: input.content,
        p_flow_id: input.flowId ?? null,
        p_flow_name: input.flowName ?? null,
        p_trace: input.trace ?? null,
        p_deferred_effects: input.deferredEffects ?? [],
        p_now: input.now,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row ? toStoredMessage(row as MessageRow) : null;
    },

    async failConversationTurn(input) {
      const { data, error } = await client.rpc("fail_conversation_turn", {
        p_conversation_id: input.conversationId,
        p_request_id: input.requestId,
        p_lease_token: input.leaseToken,
        p_error: input.error,
        p_now: input.now,
      });
      if (error) throw error;
      return data === true;
    },

    async deleteConversation(id) {
      const { error } = await client.from("conversations").delete().eq("id", id);
      if (error) throw error;
    },

    async listMessages(conversationId) {
      const { data, error } = await client
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        // seq breaks created_at ties (same-tick appends) in insertion order.
        .order("created_at", { ascending: true })
        .order("seq", { ascending: true });
      if (error) throw error;
      return (data as MessageRow[]).map(toStoredMessage);
    },

    async getMessage(id) {
      const { data, error } = await client
        .from("messages")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toStoredMessage(data as MessageRow) : null;
    },

    async listRecentMessages(conversationId, limit) {
      const cappedLimit = Math.max(1, Math.min(Math.floor(limit), 50));
      const { data, error } = await client
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .order("seq", { ascending: false })
        .limit(cappedLimit);
      if (error) throw error;
      return (data as MessageRow[])
        .map(toStoredMessage)
        .reverse();
    },

    async appendMessage(input) {
      if (input.requestId) {
        const { data, error } = await client.rpc("append_turn_message", {
          p_id: shortId(),
          p_conversation_id: input.conversationId,
          p_request_id: input.requestId,
          p_role: input.role,
          p_content: input.content,
          p_flow_id: input.flowId ?? null,
          p_flow_name: input.flowName ?? null,
          p_trace: input.trace ?? null,
          p_deferred_effects: input.deferredEffects ?? [],
        });
        if (!error) {
          const row = (Array.isArray(data) ? data[0] : data) as MessageRow;
          await client
            .from("conversations")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", input.conversationId);
          return toStoredMessage(row);
        }
        if (!isSchemaLagError(error)) throw error;
      }
      const legacyRow: Record<string, unknown> = {
        id: shortId(),
        conversation_id: input.conversationId,
        role: input.role,
        content: input.content,
        flow_id: input.flowId ?? null,
        flow_name: input.flowName ?? null,
        trace: input.trace ?? null,
      };
      const { data, error } = await client
        .from("messages")
        .insert(legacyRow)
        .select()
        .single();
      if (error) throw error;
      await client
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", input.conversationId);
      return toStoredMessage(data as MessageRow);
    },

    async claimTurnEffects(input) {
      const { data, error } = await client.rpc("claim_turn_effects", {
        p_message_id: input.messageId ?? null,
        p_worker_id: input.workerId,
        p_now: input.now,
        p_stale_before: input.staleBefore,
        p_limit: input.limit,
      });
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: row.id as string,
        organizationId: row.organization_id as string,
        conversationId: row.conversation_id as string,
        messageId: row.message_id as string,
        payload: row.payload,
        attempts: Number(row.attempts ?? 0),
        leaseToken: row.lease_token as string,
      }));
    },

    async settleTurnEffect(input) {
      const { data, error } = await client.rpc("settle_turn_effect", {
        p_id: input.id,
        p_lease_token: input.leaseToken,
        p_now: input.now,
        p_succeeded: input.succeeded,
        p_error: input.error ?? "",
      });
      if (error) throw error;
      return data === true;
    },

    async appendChannelMessage(input) {
      const { data, error } = await client
        .from("teammate_channel_messages")
        .insert({
          id: shortId(),
          organization_id: input.organizationId,
          channel_id: input.channelId,
          author_type: input.authorType,
          author_user_id: input.authorUserId ?? null,
          author_teammate_id: input.authorTeammateId ?? null,
          content: input.content,
          mentions: input.mentions ?? [],
          chain_id: input.chainId ?? null,
          trace: input.trace ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      // The roster sorts channels by last activity, so the row moves with its
      // transcript the way a Conversation does.
      await client
        .from("teammate_channels")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", input.channelId);
      return toChannelMessage(data as ChannelMessageRow);
    },

    async listChannelMessages(channelId, limit = 100) {
      // Newest-first with a limit, then reversed: "the last 100 messages" is a
      // tail read, and ordering ascending with a limit would return the oldest
      // hundred of a long channel.
      const { data, error } = await client
        .from("teammate_channel_messages")
        .select("*")
        .eq("channel_id", channelId)
        .order("seq", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data as ChannelMessageRow[]).map(toChannelMessage).reverse();
    },

    async listChannelMessageWindows(channelIds, limitPerChannel = 30) {
      if (channelIds.length === 0) return [];
      const { data, error } = await client.rpc("list_channel_message_windows", {
        p_channel_ids: channelIds,
        p_limit_per_channel: limitPerChannel,
      });
      if (error) throw error;
      return (data as ChannelMessageRow[]).map(toChannelMessage);
    },

    async listChannelChainMessages(channelId, chainId) {
      const { data, error } = await client
        .from("teammate_channel_messages")
        .select("*")
        .eq("channel_id", channelId)
        .eq("chain_id", chainId)
        .order("seq", { ascending: true });
      if (error) throw error;
      return (data as ChannelMessageRow[]).map(toChannelMessage);
    },

    async setMessageFeedback(messageId, feedback) {
      const { error } = await client
        .from("messages")
        .update({ feedback })
        .eq("id", messageId);
      if (error) throw error;
    },

    async listTraceRetentionPolicies() {
      // Filtered in code rather than with `.not(... is null)`: the row set is
      // one per organization, and this keeps the query inside the PostgREST
      // subset the pglite contract shim implements.
      const { data, error } = await client
        .from("organizations")
        .select("id, trace_retention_days");
      if (error) throw error;
      return (
        data as Array<{ id: string; trace_retention_days: number | null }>
      )
        .filter((org) => org.trace_retention_days !== null)
        .map((org) => ({
          organizationId: org.id,
          retentionDays: org.trace_retention_days as number,
        }));
    },

    async clearExpiredTraces(organizationId, cutoffIso) {
      const { data, error } = await client.rpc("clear_expired_traces", {
        p_organization_id: organizationId,
        p_cutoff: cutoffIso,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },

    async listTranscriptRetentionPolicies() {
      // Filtered in code for the same reason the trace policies are: one row
      // per organization, and it keeps the query inside the PostgREST subset
      // the pglite contract shim implements.
      const { data, error } = await client
        .from("organizations")
        .select("id, transcript_retention_days");
      // No column yet means no policy anywhere: nothing to sweep.
      if (error && isSchemaLagError(error)) return [];
      if (error) throw error;
      return (
        data as Array<{ id: string; transcript_retention_days: number | null }>
      )
        .filter((org) => org.transcript_retention_days !== null)
        .map((org) => ({
          organizationId: org.id,
          retentionDays: org.transcript_retention_days as number,
        }));
    },

    async deleteExpiredConversations(organizationId, cutoffIso) {
      const { data, error } = await client.rpc("delete_expired_conversations", {
        p_organization_id: organizationId,
        p_cutoff: cutoffIso,
      });
      // The sweep primitive is not there yet: nothing expired, nothing deleted.
      if (error && isSchemaLagError(error)) return 0;
      if (error) throw error;
      return (data as number) ?? 0;
    },

    // --- Improvements -------------------------------------------------

    async listImprovements(organizationId) {
      const { data, error } = await client
        .from("improvements")
        .select("*, improvement_messages(id.count())")
        .eq("organization_id", organizationId)
        .order("seq", { ascending: false });
      if (error) throw error;
      type Row = ImprovementRow & {
        improvement_messages: Array<{ count: number }>;
      };
      return (data as Row[]).map(
        (row): ImprovementListItem => ({
          ...toImprovement(row),
          messageCount: row.improvement_messages?.[0]?.count ?? 0,
        })
      );
    },

    async listImprovementsPage(organizationId, input) {
      const { limit, beforeSeq, status } = normalizeImprovementPageInput(input);
      let query = client
        .from("improvements")
        .select("*, improvement_messages(id.count())")
        .eq("organization_id", organizationId)
        .order("seq", { ascending: false })
        .limit(limit + 1);
      if (beforeSeq !== null) {
        query = query.lt("seq", beforeSeq);
      }
      if (status) {
        query = query.eq("status", status);
      }
      const { data, error } = await query;
      if (error) throw error;
      type Row = ImprovementRow & {
        improvement_messages: Array<{ count: number }>;
      };
      const mapped = (data as Row[]).map(
        (row): ImprovementListItem => ({
          ...toImprovement(row),
          messageCount: row.improvement_messages?.[0]?.count ?? 0,
        })
      );
      return finalizeImprovementPage(mapped, limit);
    },

    async countImprovementsByStatus(organizationId) {
      // Five indexed head counts in parallel rather than one grouped
      // aggregate: `count: "exact", head: true` is plain PostgREST, so this
      // read needs none of the aggregate configuration the embedded
      // `id.count()` above depends on.
      const counts = await Promise.all(
        IMPROVEMENT_STATUS_VALUES.map(async (status) => {
          const { count, error } = await client
            .from("improvements")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("status", status);
          if (error) throw error;
          return [status, count ?? 0] as const;
        })
      );
      return Object.fromEntries(counts) as Record<ImprovementStatus, number>;
    },

    async getImprovement(id) {
      const { data, error } = await client
        .from("improvements")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toImprovement(data as ImprovementRow) : null;
    },

    async createImprovement(organizationId, input) {
      const { data: seq, error: seqError } = await client.rpc(
        "next_improvement_seq",
        { org: organizationId }
      );
      if (seqError) throw seqError;
      const id = shortId();
      const { data, error } = await client
        .from("improvements")
        .insert({
          id,
          organization_id: organizationId,
          seq: seq as number,
          title: input.title,
          created_by: input.createdBy ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      if (input.messageId) {
        const { error: linkError } = await client
          .from("improvement_messages")
          .insert({
            id: shortId(),
            improvement_id: id,
            message_id: input.messageId,
          });
        if (linkError) throw linkError;
      }
      return toImprovement(data as ImprovementRow);
    },

    async updateImprovement(id, patch) {
      const row: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (patch.title !== undefined) row.title = patch.title;
      if (patch.description !== undefined) row.description = patch.description;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.priority !== undefined) row.priority = patch.priority;
      if (patch.tags !== undefined) row.tags = patch.tags;
      if (patch.assigneeId !== undefined) row.assignee_id = patch.assigneeId;
      if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
      if (patch.projectId !== undefined) row.project_id = patch.projectId;
      const { data, error } = await client
        .from("improvements")
        .update(row)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return toImprovement(data as ImprovementRow);
    },

    async deleteImprovement(id) {
      const { error } = await client.from("improvements").delete().eq("id", id);
      if (error) throw error;
    },

    async getImprovementProposal(improvementId) {
      const { data, error } = await client
        .from("improvement_proposals")
        .select("*")
        .eq("improvement_id", improvementId)
        .maybeSingle();
      if (error) throw error;
      return data ? toImprovementProposal(data as ImprovementProposalRow) : null;
    },

    async listDueRoutineCandidates({ before, limit }) {
      const { data, error } = await client
        .from("teammate_routines")
        .select("*")
        .eq("enabled", true)
        .or(`last_run_at.is.null,last_run_at.lt.${before}`)
        .order("last_run_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map(
        (row) => rowToDomain(row) as unknown as TeammateRoutine
      );
    },

    async claimTeammateRoutine(id, expectedLastRunAt, now) {
      // Compare-and-set in one statement: the `eq`/`is` on the value the
      // caller read is the lock. A concurrent tick that already stamped it
      // matches zero rows and gets null, so one routine runs once.
      let query = client
        .from("teammate_routines")
        .update({ last_run_at: now, updated_at: now })
        .eq("id", id);
      query = expectedLastRunAt
        ? query.eq("last_run_at", expectedLastRunAt)
        : query.is("last_run_at", null);
      const { data, error } = await query.select("*").maybeSingle();
      if (error) throw error;
      return data ? (rowToDomain(data) as unknown as TeammateRoutine) : null;
    },

    async recordTeammateRoutineRun(id, input) {
      const { error } = await client
        .from("teammate_routines")
        .update({
          last_status: input.status,
          last_detail: input.detail.slice(0, 1000),
        })
        .eq("id", id);
      if (error) throw error;
    },

    async getMemoryDocument(organizationId, owner) {
      const { column, value } = memoryOwnerColumn(owner);
      const { data, error } = await client
        .from("memory_documents")
        .select("*")
        .eq("organization_id", organizationId)
        .eq(column, value)
        .maybeSingle();
      if (error) throw error;
      return data ? toMemoryDocument(data as MemoryDocumentRow) : null;
    },

    async writeMemoryDocument(input) {
      const { column, value } = memoryOwnerColumn(input.owner);
      const existing = await this.getMemoryDocument(
        input.organizationId,
        input.owner
      );
      const body = capMemoryDocument(input.body);
      // Monotonic, not `Date.now()` and not the column default: two writes in
      // one millisecond would tie, and `order("created_at")` would then decide
      // "newest first" arbitrarily (the coin flip 98c5df54 fixed elsewhere).
      const now = new Date(monotonicNow()).toISOString();

      let row: MemoryDocumentRow;
      if (existing) {
        const { data, error } = await client
          .from("memory_documents")
          .update({ body, updated_at: now })
          .eq("id", existing.id)
          .select("*")
          .single();
        if (error) throw error;
        row = data as MemoryDocumentRow;
      } else {
        const { data, error } = await client
          .from("memory_documents")
          .insert({
            id: shortId(),
            organization_id: input.organizationId,
            [column]: value,
            body,
          })
          .select("*")
          .single();
        if (error) throw error;
        row = data as MemoryDocumentRow;
      }

      // Append the history entry after the body lands. Ordered this way on
      // purpose: a missing entry is a gap in an audit trail, a phantom entry
      // for a write that failed is a lie in one.
      const { error: entryError } = await client
        .from("memory_document_entries")
        .insert({
          id: shortId(),
          organization_id: input.organizationId,
          document_id: row.id,
          teammate_id: input.teammateId ?? null,
          author_id: input.authorId ?? null,
          note: input.note ?? "",
          body_before: existing?.body ?? "",
          created_at: now,
        });
      if (entryError) throw entryError;
      return toMemoryDocument(row);
    },

    async listMemoryDocumentEntries(documentId, limit = 50) {
      const { data, error } = await client
        .from("memory_document_entries")
        .select("*")
        .eq("document_id", documentId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((row) =>
        toMemoryDocumentEntry(row as MemoryDocumentEntryRow)
      );
    },

    async revertMemoryDocument(input) {
      const { data: entryData, error: entryError } = await client
        .from("memory_document_entries")
        .select("*")
        .eq("id", input.entryId)
        .maybeSingle();
      if (entryError) throw entryError;
      if (!entryData) throw new Error("No such memory history entry");
      const entry = toMemoryDocumentEntry(entryData as MemoryDocumentEntryRow);

      const { data: docData, error: docError } = await client
        .from("memory_documents")
        .select("*")
        .eq("id", entry.documentId)
        .maybeSingle();
      if (docError) throw docError;
      if (!docData) throw new Error("No such memory document");
      const before = toMemoryDocument(docData as MemoryDocumentRow);

      const revertedAt = new Date(monotonicNow()).toISOString();
      const { data, error } = await client
        .from("memory_documents")
        .update({ body: entry.bodyBefore, updated_at: revertedAt })
        .eq("id", entry.documentId)
        .select("*")
        .single();
      if (error) throw error;

      // Undoing a write is another write: the history keeps both, so a revert
      // is visible rather than a hole where a write used to be.
      const { error: appendError } = await client
        .from("memory_document_entries")
        .insert({
          id: shortId(),
          organization_id: before.organizationId,
          document_id: before.id,
          teammate_id: null,
          author_id: input.authorId ?? null,
          note: "Reverted an earlier write",
          body_before: before.body,
          created_at: revertedAt,
        });
      if (appendError) throw appendError;
      return toMemoryDocument(data as MemoryDocumentRow);
    },

    async getImprovementProposalById(id) {
      const { data, error } = await client
        .from("improvement_proposals")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toImprovementProposal(data as ImprovementProposalRow) : null;
    },

    async createImprovementProposal(input) {
      // Delete-then-insert (matching the mock) so a re-draft is a clean fresh
      // proposal, never a stale dismiss_reason/accepted_concept_id or a
      // mutated primary key from an upsert.
      await client
        .from("improvement_proposals")
        .delete()
        .eq("improvement_id", input.improvementId);
      const { data, error } = await client
        .from("improvement_proposals")
        .insert({
          id: shortId(),
          organization_id: input.organizationId,
          improvement_id: input.improvementId,
          status: "draft",
          payload: input.payload,
        })
        .select()
        .single();
      if (error) throw error;
      return toImprovementProposal(data as ImprovementProposalRow);
    },

    async updateImprovementProposal(id, patch) {
      const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.dismissReason !== undefined) row.dismiss_reason = patch.dismissReason;
      if (patch.acceptedConceptId !== undefined)
        row.accepted_concept_id = patch.acceptedConceptId;
      const { data, error } = await client
        .from("improvement_proposals")
        .update(row)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return toImprovementProposal(data as ImprovementProposalRow);
    },

    async listImprovementMessages(improvementId) {
      const { data: links, error } = await client
        .from("improvement_messages")
        .select(
          "id, message_id, created_at, messages(*, conversations(*, assistants(title)))"
        )
        .eq("improvement_id", improvementId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return hydrateImprovementAssociations(
        client,
        links as unknown as ImprovementLinkJoinedRow[]
      );
    },

    async getImprovementAssociationPage(improvementId, page = {}) {
      const offset = Math.max(0, Math.floor(page.offset ?? 0));
      const limit = Math.max(1, Math.min(Math.floor(page.limit ?? 1), 10));
      const [pageResult, countResult] = await Promise.all([
        client
          .from("improvement_messages")
          .select(
            "id, message_id, created_at, messages(id, conversation_id, role, content, flow_id, flow_name, feedback, trace, created_at, conversations(id, assistant_id, teammate_id, subject_type, subject_id, collection_id, title, metadata, pinned, created_at, updated_at, assistants(title)))"
          )
          .eq("improvement_id", improvementId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + limit - 1),
        client
          .from("improvement_messages")
          .select("id", { count: "exact", head: true })
          .eq("improvement_id", improvementId),
      ]);
      if (pageResult.error) throw pageResult.error;
      if (countResult.error) throw countResult.error;
      const associations = await hydrateImprovementAssociations(
        client,
        pageResult.data as unknown as ImprovementLinkJoinedRow[]
      );
      const total = countResult.count ?? associations.length;
      return {
        associations,
        total,
        offset,
        nextOffset: offset + associations.length < total ? offset + limit : null,
      };
    },

    async linkImprovementMessage(improvementId, messageId) {
      const { data: existing } = await client
        .from("improvement_messages")
        .select("id")
        .eq("improvement_id", improvementId)
        .eq("message_id", messageId)
        .maybeSingle();
      if (existing) return;
      const { error } = await client.from("improvement_messages").insert({
        id: shortId(),
        improvement_id: improvementId,
        message_id: messageId,
      });
      if (error) throw error;
    },

    async unlinkImprovementMessage(improvementId, messageId) {
      const { error } = await client
        .from("improvement_messages")
        .delete()
        .eq("improvement_id", improvementId)
        .eq("message_id", messageId);
      if (error) throw error;
    },

    async listConversationImprovementLinks(conversationId) {
      const { data: msgs, error } = await client
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId);
      if (error) throw error;
      const ids = (msgs as Array<{ id: string }>).map((m) => m.id);
      if (ids.length === 0) return [];
      const { data, error: lErr } = await client
        .from("improvement_messages")
        .select("message_id, improvements!inner(id, seq, title)")
        .in("message_id", ids);
      if (lErr) throw lErr;
      type Row = {
        message_id: string;
        improvements: { id: string; seq: number; title: string };
      };
      return (data as unknown as Row[]).map(
        (r): ImprovementMessageLink => ({
          messageId: r.message_id,
          improvementId: r.improvements.id,
          seq: r.improvements.seq,
          title: r.improvements.title,
        })
      );
    },

    // --- Org-level knowledge hub (PRD #726) -------------------------------

    async listOrgKnowledgeSources(organizationId, filter) {
      // Fine-filtering and paging happen adapter-side, hub tables are
      // org-sized (dozens to hundreds of Sources), and this keeps the query
      // shapes inside what the PostgREST test shim implements. Every
      // Collection carries its org id (stamped at creation, backfilled for
      // history), so one read scopes the whole hub.
      const stampedRes = await client
        .from("sources")
        .select("*, knowledge_collections!inner(organization_id)")
        .in("kind", filter.kinds)
        .eq("knowledge_collections.organization_id", organizationId);
      if (stampedRes.error) throw stampedRes.error;

      let matches = (
        stampedRes.data as Array<Record<string, unknown>>
      ).map(toSource);
      if (filter.status)
        matches = matches.filter((s) => s.status === filter.status);
      const query = (filter.query ?? "").trim().toLowerCase();
      if (query)
        matches = matches.filter((s) => s.name.toLowerCase().includes(query));
      if (filter.assistantId) {
        const { data: linkRows, error: linkError } = await client
          .from("assistant_sources")
          .select("source_id")
          .eq("assistant_id", filter.assistantId);
        if (linkError) throw linkError;
        const linkedIds = new Set(
          (linkRows as Array<{ source_id: string }>).map((r) => r.source_id)
        );
        matches = matches.filter((s) => linkedIds.has(s.id));
      }
      matches.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

      const statusCounts = { processing: 0, ready: 0, error: 0 };
      for (const source of matches) statusCounts[source.status] += 1;

      const total = matches.length;
      const pageSize = filter.pageSize ?? 25;
      const page = filter.page ?? 1;
      const slice = matches.slice((page - 1) * pageSize, page * pageSize);
      if (slice.length === 0) return { items: [], total, statusCounts };
      const pageIds = slice.map((s) => s.id);

      type LinkRow = {
        assistant_id: string;
        source_id: string;
        direct_access: boolean;
        created_at: string;
        assistants: { title: string } | null;
      };
      const faqIds = slice
        .filter((s) => s.kind === "faq")
        .map((s) => s.id);
      const loadFaqAnswers = async () => {
        if (faqIds.length === 0) return { data: [], error: null };
        let result = await client
          .from("concepts")
          .select("source_id, body")
          .in("source_id", faqIds)
          .eq("is_active", true);
        if (result.error && isSchemaLagError(result.error)) {
          result = await client
            .from("concepts")
            .select("source_id, body")
            .in("source_id", faqIds);
        }
        return result;
      };
      const countSourceConcepts = async (id: string) => {
        let result = await client
          .from("concepts")
          .select("id", { count: "exact", head: true })
          .eq("source_id", id)
          .eq("is_active", true);
        if (result.error && isSchemaLagError(result.error)) {
          result = await client
            .from("concepts")
            .select("id", { count: "exact", head: true })
            .eq("source_id", id);
        }
        if (result.error) throw result.error;
        return [id, result.count ?? 0] as const;
      };
      const [linksRes, answersRes, counts] = await Promise.all([
        client
          .from("assistant_sources")
          .select(
            "assistant_id, source_id, direct_access, created_at, assistants!inner(title)"
          )
          .in("source_id", pageIds),
        loadFaqAnswers(),
        Promise.all(pageIds.map(countSourceConcepts)),
      ]);
      if (linksRes.error) throw linksRes.error;
      if (answersRes.error) throw answersRes.error;

      const linksBySource = new Map<string, LinkRow[]>();
      for (const row of linksRes.data as unknown as LinkRow[]) {
        const list = linksBySource.get(row.source_id) ?? [];
        list.push(row);
        linksBySource.set(row.source_id, list);
      }
      const answerBySource = new Map<string, string>();
      for (const row of answersRes.data as Array<{
        source_id: string;
        body: string;
      }>) {
        if (!answerBySource.has(row.source_id))
          answerBySource.set(row.source_id, row.body.slice(0, 200));
      }
      const countBySource = new Map(counts);

      const items = slice.map((source) => ({
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
        conceptCount: countBySource.get(source.id) ?? 0,
        answerPreview: answerBySource.get(source.id) ?? "",
        linkedAssistants: (linksBySource.get(source.id) ?? [])
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((row) => ({
            assistantId: row.assistant_id,
            assistantName: row.assistants?.title ?? "",
            directAccess: row.direct_access,
          })),
      }));

      return { items, total, statusCounts };
    },

    async listOrgFaqs(organizationId) {
      const page = await this.listOrgKnowledgeSources(organizationId, {
        kinds: ["faq"],
        pageSize: Number.MAX_SAFE_INTEGER,
      });
      if (page.items.length === 0) return [];
      let result = await client
        .from("concepts")
        .select("source_id, body")
        .in(
          "source_id",
          page.items.map((item) => item.id)
        )
        .eq("is_active", true);
      if (result.error && isSchemaLagError(result.error)) {
        result = await client
          .from("concepts")
          .select("source_id, body")
          .in(
            "source_id",
            page.items.map((item) => item.id)
          );
      }
      const { data, error } = result;
      if (error) throw error;
      const answerBySource = new Map<string, string>();
      for (const row of data as Array<{ source_id: string; body: string }>) {
        if (!answerBySource.has(row.source_id))
          answerBySource.set(row.source_id, row.body);
      }
      return page.items.map((item) => ({
        sourceId: item.id,
        question: item.name,
        answer: answerBySource.get(item.id) ?? "",
      }));
    },

    async listConceptsBySource(sourceId, limit) {
      let result = await client
        .from("concepts")
        .select("*")
        .eq("source_id", sourceId)
        .eq("is_active", true)
        .order("path", { ascending: true })
        .limit(limit ?? 500);
      if (result.error && isSchemaLagError(result.error)) {
        result = await client
          .from("concepts")
          .select("*")
          .eq("source_id", sourceId)
          .order("path", { ascending: true })
          .limit(limit ?? 500);
      }
      const { data, error } = result;
      if (error) throw error;
      return (data as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as string,
        collectionId: r.collection_id as string,
        sourceId: r.source_id as string | null,
        generationId: (r.generation_id as string | null) ?? null,
        path: r.path as string,
        frontmatter: r.frontmatter as ConceptFrontmatter,
        body: r.body as string,
        excluded: (r.excluded as boolean) ?? false,
        recrawlSchedule: (r.recrawl_schedule as RecrawlSchedule | null) ?? null,
        createdAt: r.created_at as string,
      }));
    },

    async listAssistantSourceIds(assistantId) {
      return linkedSourceIds(client, assistantId);
    },

    async listSourceAssistantLinks(sourceId) {
      const { data, error } = await client
        .from("assistant_sources")
        .select("assistant_id, direct_access, created_at, assistants!inner(title)")
        .eq("source_id", sourceId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      type Row = {
        assistant_id: string;
        direct_access: boolean;
        assistants: { title: string } | null;
      };
      return (data as unknown as Row[]).map((row) => ({
        assistantId: row.assistant_id,
        assistantName: row.assistants?.title ?? "",
        directAccess: row.direct_access,
      }));
    },

    async setSourceAssistantLinks(sourceId, assistantIds) {
      const { error } = await client.rpc("set_source_assistant_links", {
        p_source_id: sourceId,
        p_assistant_ids: assistantIds,
      });
      if (!error) return;
      if (!isSchemaLagError(error)) throw error;
      const { data, error: readError } = await client
        .from("assistant_sources")
        .select("assistant_id")
        .eq("source_id", sourceId);
      if (readError) throw readError;
      const existing = new Set(
        (data as Array<{ assistant_id: string }>).map((row) => row.assistant_id),
      );
      const wanted = new Set(assistantIds);
      const toRemove = [...existing].filter((id) => !wanted.has(id));
      const toAdd = [...wanted].filter((id) => !existing.has(id));
      if (toRemove.length > 0) {
        const { error: removeError } = await client
          .from("assistant_sources")
          .delete()
          .eq("source_id", sourceId)
          .in("assistant_id", toRemove);
        if (removeError) throw removeError;
      }
      if (toAdd.length > 0) {
        const { error: addError } = await client.from("assistant_sources").insert(
          toAdd.map((assistantId) => ({
            assistant_id: assistantId,
            source_id: sourceId,
          })),
        );
        if (addError) throw addError;
      }
    },

    async setSourceDirectAccess(sourceId, assistantId, directAccess) {
      const { error } = await client
        .from("assistant_sources")
        .update({ direct_access: directAccess })
        .eq("source_id", sourceId)
        .eq("assistant_id", assistantId);
      if (error) throw error;
    },

    async getInsightsOverview(organizationId, filters) {
      const { data, error } = await client.rpc("get_insights_overview", {
        p_organization_id: organizationId,
        p_from: filters.from,
        p_to: filters.to,
        p_aggregate: filters.aggregate,
        p_assistant_id: filters.assistantId || null,
        p_channel: filters.channel || null,
        p_role: filters.role || null,
        p_feedback: filters.feedback || null,
        p_escalation: filters.escalation || null,
      });
      if (error) throw error;
      const overview = data as InsightsOverview | null;
      if (!overview || !overview.stats || !overview.chart || !overview.options) {
        throw new Error("Invalid Insights reporting result");
      }
      return colorizeOverview(overview);
    },

    // --- Alerts ---------------------------------------------------------

    async listAlerts(organizationId) {
      const { data, error } = await client
        .from("alerts")
        .select("*")
        .eq("organization_id", organizationId)
        .order("detected_at", { ascending: false });
      if (error) throw error;
      return (data as AlertRow[]).map(toAlert);
    },

    async listActiveAlerts(organizationId, limit = 5) {
      const { data, error } = await client
        .from("alerts")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .order("detected_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data as AlertRow[]).map(toAlert);
    },

    async countActiveAlerts(organizationId) {
      const { count, error } = await client
        .from("alerts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("status", "active");
      if (error) throw error;
      return count ?? 0;
    },

    async raiseAlert(organizationId, input) {
      if (input.sourceKey) {
        const { data: existing, error: findError } = await client
          .from("alerts")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("source_key", input.sourceKey)
          .eq("status", "active")
          .maybeSingle();
        if (findError) throw findError;
        if (existing) {
          const { data, error } = await client
            .from("alerts")
            .update({
              type: input.type,
              title: input.title,
              detail: input.detail,
              detected_at: new Date().toISOString(),
            })
            .eq("id", existing.id)
            .select()
            .single();
          if (error) throw error;
          return toAlert(data as AlertRow);
        }
      }
      const { data, error } = await client
        .from("alerts")
        .insert({
          id: shortId(),
          organization_id: organizationId,
          type: input.type,
          title: input.title,
          detail: input.detail,
          source_key: input.sourceKey ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return toAlert(data as AlertRow);
    },

    async resolveAlert(id, resolvedBy) {
      const { data, error } = await client
        .from("alerts")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by: resolvedBy ?? null,
        })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return toAlert(data as AlertRow);
    },

    async resolveAlertsByKey(organizationId, sourceKey) {
      const { error } = await client
        .from("alerts")
        .update({
          status: "resolved",
          resolved_at: new Date().toISOString(),
          resolved_by: null,
        })
        .eq("organization_id", organizationId)
        .eq("source_key", sourceKey)
        .eq("status", "active");
      if (error) throw error;
    },

    // --- AI usage ledger -----------------------------------------------------

    async recordAiUsage(rows) {
      if (rows.length === 0) return;
      const { error } = await client.from("ai_usage").insert(
        rows.map((r) => ({
          organization_id: r.organizationId,
          assistant_id: r.assistantId,
          conversation_id: r.conversationId ?? null,
          message_id: r.messageId ?? null,
          stage: r.stage,
          provider: r.provider,
          model_id: r.modelId,
          credential_kind: r.credentialKind ?? null,
          input_tokens: r.inputTokens,
          output_tokens: r.outputTokens,
        }))
      );
      if (error) throw error;
    },

    async getOrgTokensUsedToday(organizationId) {
      const { data, error } = await client.rpc("org_ai_tokens_today", {
        p_organization_id: organizationId,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },

    async getOrgCostUsedToday(organizationId) {
      const { data, error } = await client.rpc("org_ai_usage_by_model_today", {
        p_organization_id: organizationId,
      });
      if (error) throw error;
      const rows = (data ?? []) as {
        provider: Provider;
        model_id: string;
        input_tokens: number | string;
        output_tokens: number | string;
      }[];
      return rows.reduce(
        (sum, r) =>
          sum +
          estimateCostEur(
            r.provider,
            r.model_id,
            Number(r.input_tokens),
            Number(r.output_tokens)
          ),
        0
      );
    },

    async rollupUsageDaily(days = 2) {
      const { data, error } = await client.rpc("rollup_usage_daily", {
        p_days: days,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },

    async getOrgUsageDaily(organizationId, days = 30) {
      const { data, error } = await client.rpc("org_usage_daily", {
        p_organization_id: organizationId,
        p_days: days,
      });
      if (error) throw error;
      const rows = (data ?? []) as {
        day: string;
        kind: UsageKind;
        credential_kind: UsageDailyRow["credentialKind"];
        provider: string | null;
        model_id: string | null;
        calls: number | string;
        input_tokens: number | string;
        output_tokens: number | string;
        units: number | string | null;
      }[];
      return rows.map((r) => ({
        // PostgREST serializes `date` as YYYY-MM-DD; some drivers hand back a
        // full ISO timestamp instead, keep only the day either way.
        day: String(r.day).slice(0, 10),
        kind: r.kind,
        credentialKind: r.credential_kind,
        provider: r.provider ?? "",
        modelId: r.model_id ?? "",
        calls: Number(r.calls),
        inputTokens: Number(r.input_tokens),
        outputTokens: Number(r.output_tokens),
        units: Number(r.units ?? 0),
      }));
    },

    async getOrgUsageMeters(organizationId, from, to) {
      const { data, error } = await client.rpc("org_usage_meters", {
        p_organization_id: organizationId,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      const rows = (data ?? []) as {
        resource: UsageMeterRow["resource"];
        credential_kind: UsageMeterRow["credentialKind"];
        provider: string | null;
        model_id: string | null;
        calls: number | string;
        input_tokens: number | string;
        output_tokens: number | string;
        units: number | string | null;
      }[];
      // bigint sums arrive as strings over PostgREST; a string here would make
      // every cap comparison downstream lexicographic.
      return rows.map((r) => ({
        resource: r.resource,
        credentialKind: r.credential_kind,
        provider: r.provider ?? "",
        modelId: r.model_id ?? "",
        calls: Number(r.calls),
        inputTokens: Number(r.input_tokens),
        outputTokens: Number(r.output_tokens),
        units: Number(r.units ?? 0),
      }));
    },

    async recordRuntimeEvent(event) {
      const { error } = await client.from("runtime_events").insert({
        organization_id: event.organizationId,
        assistant_id: event.assistantId ?? null,
        conversation_id: event.conversationId ?? null,
        message_id: event.messageId ?? null,
        kind: event.kind,
        status: event.status,
        surface: event.surface ?? null,
        provider: event.provider ?? null,
        model_id: event.modelId ?? null,
        credential_kind: event.credentialKind ?? null,
        flow_id: event.flowId ?? null,
        flow_name: event.flowName ?? null,
        input_tokens: event.inputTokens ?? 0,
        output_tokens: event.outputTokens ?? 0,
        duration_ms: event.durationMs ?? null,
        tool_calls: event.toolCalls ?? 0,
        retrieval_count: event.retrievalCount ?? 0,
        crawler_provider: event.crawlerProvider ?? null,
        page_count: event.pageCount ?? null,
        error_class: event.errorClass ?? null,
        error_message: event.errorMessage ?? null,
        trace_id: event.traceId ?? null,
        span_id: event.spanId ?? null,
      });
      if (error) throw error;
    },

    async recordObjectAccess(event) {
      const { error } = await client.from("object_access_events").insert({
        organization_id: event.organizationId,
        actor_kind: event.actorKind,
        actor_id: event.actorId ?? null,
        object_kind: event.objectKind,
        object_path: event.objectPath,
        source_id: event.sourceId ?? null,
        result: event.result,
        bytes: event.bytes ?? null,
        ip: event.ip ?? null,
        user_agent: event.userAgent ?? null,
        request_id: event.requestId ?? null,
      });
      if (error) throw error;
    },

    async listObjectAccessEvents(organizationId, options) {
      const limit = options?.limit ?? 100;
      const offset = options?.offset ?? 0;
      let query = client
        .from("object_access_events")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        // `now()` is transaction time, so two rows can share `created_at`;
        // the id tie-break is what makes a paged read stable across pages.
        .order("id", { ascending: false })
        .range(offset, offset + limit - 1);
      if (options?.objectPath) query = query.eq("object_path", options.objectPath);
      if (options?.sinceIso) query = query.gte("created_at", options.sinceIso);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: String(row.id),
        organizationId: String(row.organization_id),
        actorKind: row.actor_kind,
        actorId: row.actor_id ?? null,
        objectKind: row.object_kind,
        objectPath: String(row.object_path),
        sourceId: row.source_id ?? null,
        result: row.result,
        bytes: row.bytes === null || row.bytes === undefined ? null : Number(row.bytes),
        ip: row.ip ?? null,
        userAgent: row.user_agent ?? null,
        requestId: row.request_id ?? null,
        createdAt: String(row.created_at),
      }));
    },

    async purgeExpiredObjectAccessEvents(cutoffIso) {
      const { data, error } = await client.rpc("purge_expired_object_access_events", {
        p_cutoff: cutoffIso,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },

    async recordRetentionSweep(event) {
      const { error } = await client.from("retention_sweep_events").insert({
        organization_id: event.organizationId,
        policy: event.policy,
        retention_days: event.retentionDays,
        cutoff: event.cutoff,
        deleted: event.deleted ?? null,
        error: event.error ?? null,
      });
      if (error) throw error;
    },

    async listRetentionSweepEvents(organizationId, options) {
      const { data, error } = await client
        .from("retention_sweep_events")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(options?.limit ?? 100);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: String(row.id),
        organizationId: String(row.organization_id),
        policy: row.policy,
        retentionDays: Number(row.retention_days),
        cutoff: String(row.cutoff),
        deleted: row.deleted === null || row.deleted === undefined ? null : Number(row.deleted),
        error: row.error ?? null,
        createdAt: String(row.created_at),
      }));
    },

    async getOrgBudget(organizationId) {
      const { data, error } = await client
        .from("org_budgets")
        .select("*")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as {
        organization_id: string;
        daily_token_limit: number | string | null;
        daily_euro_limit_cents: number | string | null;
        enforcement: "notify" | "block";
      };
      return {
        organizationId: row.organization_id,
        dailyTokenLimit:
          row.daily_token_limit == null ? null : Number(row.daily_token_limit),
        dailyEuroLimit:
          row.daily_euro_limit_cents == null
            ? null
            : Number(row.daily_euro_limit_cents) / 100,
        enforcement: row.enforcement,
      };
    },

    async setOrgBudget(organizationId, input) {
      const { data, error } = await client
        .from("org_budgets")
        .upsert(
          {
            organization_id: organizationId,
            daily_token_limit: input.dailyTokenLimit,
            daily_euro_limit_cents:
              input.dailyEuroLimit == null
                ? null
                : Math.round(input.dailyEuroLimit * 100),
            enforcement: input.enforcement,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id" }
        )
        .select()
        .single();
      if (error) throw error;
      const row = data as {
        organization_id: string;
        daily_token_limit: number | string | null;
        daily_euro_limit_cents: number | string | null;
        enforcement: "notify" | "block";
      };
      return {
        organizationId: row.organization_id,
        dailyEuroLimit:
          row.daily_euro_limit_cents == null
            ? null
            : Number(row.daily_euro_limit_cents) / 100,
        dailyTokenLimit:
          row.daily_token_limit == null ? null : Number(row.daily_token_limit),
        enforcement: row.enforcement,
      };
    },

    async reserveOrgBudget(input) {
      const { data, error } = await client.rpc("reserve_org_budget", {
        p_organization_id: input.organizationId,
        p_max_tokens: input.maxTokens,
        p_max_eur: input.maxEur,
        p_observed_cost_eur: input.observedCostEur,
        p_now: input.now,
        p_expires_at: input.expiresAt,
      });
      if (error) throw error;
      return typeof data === "string" ? data : null;
    },

    async settleOrgBudgetReservation(id, rows) {
      const { data, error } = await client.rpc(
        "settle_org_budget_reservation",
        { p_id: id, p_rows: rows }
      );
      if (error) {
        if (!isSchemaLagError(error)) throw error;
        // One-migration-behind fallback: persist usage first, then release the
        // old four-argument reservation. The old schema has no atomic settle.
        await this.recordAiUsage(rows);
        const actualTokens = rows.reduce(
          (sum, row) => sum + row.inputTokens + row.outputTokens,
          0,
        );
        const actualEur = rows.reduce(
          (sum, row) =>
            sum +
            estimateCostEur(
              row.provider,
              row.modelId,
              row.inputTokens,
              row.outputTokens,
            ),
          0,
        );
        const { data: released, error: releaseError } = await client.rpc(
          "release_org_budget_reservation",
          {
            p_id: id,
            p_actual_tokens: actualTokens,
            p_actual_eur: actualEur,
            p_now: new Date().toISOString(),
          },
        );
        if (releaseError) throw releaseError;
        return released === true;
      }
      return data === true;
    },

    async releaseOrgBudgetReservation(id) {
      let { data, error } = await client.rpc(
        "release_org_budget_reservation",
        { p_id: id }
      );
      if (error && isSchemaLagError(error)) {
        ({ data, error } = await client.rpc("release_org_budget_reservation", {
          p_id: id,
          p_actual_tokens: 0,
          p_actual_eur: 0,
          p_now: new Date().toISOString(),
        }));
      }
      if (error) throw error;
      return data === true;
    },

    // --- Standing goals -------------------------------------------------------

    async createAssistantGoal(assistantId, input) {
      const { data: assistant, error: assistantError } = await client
        .from("assistants")
        .select("organization_id")
        .eq("id", assistantId)
        .single();
      if (assistantError) throw assistantError;
      const { count, error: countError } = await client
        .from("assistant_goals")
        .select("id", { count: "exact", head: true })
        .eq("assistant_id", assistantId);
      if (countError) throw countError;
      if ((count ?? 0) >= ASSISTANT_GOAL_CAP) {
        throw new Error(
          `This assistant already has ${ASSISTANT_GOAL_CAP} goals, remove one first.`
        );
      }
      return supabaseTable(client, "assistantGoals").insert({
        organizationId: (assistant as { organization_id: string })
          .organization_id,
        assistantId,
        question: input.question,
        expectations: input.expectations,
      });
    },

    async claimDueAssistantGoals({ dueBefore, limit }) {
      const { data, error } = await client.rpc("claim_due_assistant_goals", {
        p_due_before: dueBefore,
        p_limit: limit,
      });
      if (error) throw error;
      return ((data ?? []) as GoalRow[]).map(toGoal);
    },

    // --- Answer verification --------------------------------------------------

    async listUnverifiedAnswers({ limit }) {
      const { data, error } = await client.rpc("list_unverified_answers", {
        p_limit: limit,
      });
      if (error) throw error;
      return ((data ?? []) as {
        message_id: string;
        conversation_id: string;
        assistant_id: string;
        organization_id: string;
        flow_id: string | null;
        flow_name: string | null;
        content: unknown[];
        question: string | null;
        created_at: string;
      }[]).map((row) => ({
        messageId: row.message_id,
        conversationId: row.conversation_id,
        assistantId: row.assistant_id,
        organizationId: row.organization_id,
        flowId: row.flow_id,
        flowName: row.flow_name,
        content: row.content ?? [],
        question: row.question,
        createdAt: row.created_at,
      }));
    },

    async claimUnverifiedAnswers({ limit, staleBefore }) {
      const { data, error } = await client.rpc("claim_unverified_answers", {
        p_limit: limit,
        p_stale_before: staleBefore,
      });
      if (error) throw error;
      return ((data ?? []) as {
        message_id: string;
        conversation_id: string;
        assistant_id: string;
        organization_id: string;
        flow_id: string | null;
        flow_name: string | null;
        content: unknown[];
        question: string | null;
        created_at: string;
      }[]).map((row) => ({
        messageId: row.message_id,
        conversationId: row.conversation_id,
        assistantId: row.assistant_id,
        organizationId: row.organization_id,
        flowId: row.flow_id,
        flowName: row.flow_name,
        content: row.content ?? [],
        question: row.question,
        createdAt: row.created_at,
      }));
    },

    async releaseAnswerVerifierClaim(messageId) {
      const { error } = await client
        .from("answer_verifier_claims")
        .delete()
        .eq("message_id", messageId);
      if (error) throw error;
    },

    async listConversationAnswerVerdicts(conversationId) {
      const { data: messageRows, error: messagesError } = await client
        .from("messages")
        .select("id")
        .eq("conversation_id", conversationId);
      if (messagesError) throw messagesError;
      const ids = ((messageRows ?? []) as { id: string }[]).map((r) => r.id);
      if (ids.length === 0) return [];
      const { data, error } = await client
        .from("answer_verdicts")
        .select("message_id, verdict, reason, created_at")
        .in("message_id", ids);
      if (error) throw error;
      return ((data ?? []) as {
        message_id: string;
        verdict: "pass" | "fail";
        reason: string;
        created_at: string;
      }[]).map((row) => ({
        messageId: row.message_id,
        verdict: row.verdict,
        reason: row.reason,
        createdAt: row.created_at,
      }));
    },

    async recordAnswerVerdict(input) {
      const { error } = await client.from("answer_verdicts").insert({
        message_id: input.messageId,
        organization_id: input.organizationId,
        assistant_id: input.assistantId,
        flow_id: input.flowId,
        verdict: input.verdict,
        reason: input.reason,
        model_id: input.modelId,
      });
      if (error) {
        // 23505 = unique violation: already verified, idempotent skip.
        if ((error as { code?: string }).code === "23505") return false;
        throw error;
      }
      return true;
    },

    // --- Flow trust ledger -----------------------------------------------------

    async listTrustSignals({ limit }) {
      const { data, error } = await client.rpc("list_trust_signals", {
        p_limit: limit,
      });
      if (error) throw error;
      return ((data ?? []) as {
        organization_id: string;
        assistant_id: string;
        flow_id: string;
        message_id: string;
        pass: boolean;
        reason: string;
        created_at: string;
      }[]).map((row) => ({
        organizationId: row.organization_id,
        assistantId: row.assistant_id,
        flowId: row.flow_id,
        messageId: row.message_id,
        pass: row.pass,
        reason: row.reason,
        createdAt: row.created_at,
      }));
    },

    async upsertFlowTrust(input) {
      const { data: existing, error: readError } = await client
        .from("flow_trust")
        .select("tier")
        .eq("assistant_id", input.assistantId)
        .eq("flow_id", input.flowId)
        .maybeSingle();
      if (readError) throw readError;
      const previousTier =
        ((existing as { tier?: "auto" | "queue" | "watch" } | null)?.tier ??
          null);
      const { error } = await client.from("flow_trust").upsert(
        {
          assistant_id: input.assistantId,
          flow_id: input.flowId,
          organization_id: input.organizationId,
          runs: input.runs,
          passes: input.passes,
          tier: input.tier,
          previous_tier: previousTier,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "assistant_id,flow_id" }
      );
      if (error) throw error;
      return { previousTier };
    },

    async listFlowTrust(assistantId) {
      const { data, error } = await client
        .from("flow_trust")
        .select("*")
        .eq("assistant_id", assistantId);
      if (error) throw error;
      return ((data ?? []) as FlowTrustRow[]).map(toFlowTrust);
    },

    async getFlowTrust(assistantId, flowId) {
      const { data, error } = await client
        .from("flow_trust")
        .select("*")
        .eq("assistant_id", assistantId)
        .eq("flow_id", flowId)
        .maybeSingle();
      if (error) throw error;
      return data ? toFlowTrust(data as FlowTrustRow) : null;
    },

    async recordFlowTrustEvent(input) {
      const { error } = await client.from("flow_trust_events").insert({
        organization_id: input.organizationId,
        assistant_id: input.assistantId,
        flow_id: input.flowId,
        from_tier: input.fromTier,
        to_tier: input.toTier,
        runs: input.runs,
        passes: input.passes,
      });
      if (error) throw error;

      // Capped retention: drop everything older than the newest N per flow.
      const { data: stale, error: staleError } = await client
        .from("flow_trust_events")
        .select("id")
        .eq("assistant_id", input.assistantId)
        .eq("flow_id", input.flowId)
        .order("created_at", { ascending: false })
        .range(FLOW_TRUST_EVENT_RETENTION, FLOW_TRUST_EVENT_RETENTION + 199);
      if (staleError) throw staleError;
      const staleIds = ((stale ?? []) as { id: string }[]).map((r) => r.id);
      if (staleIds.length > 0) {
        const { error: deleteError } = await client
          .from("flow_trust_events")
          .delete()
          .in("id", staleIds);
        if (deleteError) throw deleteError;
      }
    },

    async listFlowTrustEvents(assistantId, flowId) {
      const { data, error } = await client
        .from("flow_trust_events")
        .select("*")
        .eq("assistant_id", assistantId)
        .eq("flow_id", flowId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as FlowTrustEventRow[]).map(toFlowTrustEvent);
    },

    // --- Compost loop ----------------------------------------------------------

    async claimDueCompostAssistants({ dueBefore, staleBefore, limit }) {
      const { data, error } = await client.rpc("claim_due_compost_assistants", {
        p_due_before: dueBefore,
        p_stale_before: staleBefore,
        p_limit: limit,
      });
      if (error) throw error;
      return ((data ?? []) as {
        assistant_id: string;
        organization_id: string;
        last_run_at: string | null;
      }[]).map((row) => ({
        assistantId: row.assistant_id,
        organizationId: row.organization_id,
        lastRunAt: row.last_run_at,
      }));
    },

    async getCompostDigest(assistantId, since) {
      const [verdicts, messages, escalated, goals, trust] = await Promise.all([
        client
          .from("answer_verdicts")
          .select("message_id, reason")
          .eq("assistant_id", assistantId)
          .eq("verdict", "fail")
          .gte("created_at", since),
        client
          .from("messages")
          .select("id, conversation_id, content, feedback, conversations!inner(assistant_id)")
          .eq("conversations.assistant_id", assistantId)
          .eq("role", "assistant")
          .gte("created_at", since),
        client
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("assistant_id", assistantId)
          .eq("metadata->>escalated", "true")
          .gte("updated_at", since),
        client
          .from("assistant_goals")
          .select("question, last_detail")
          .eq("assistant_id", assistantId)
          .eq("last_result", "fail")
          .gte("last_run_at", since),
        // Demotions come from the append-only event ledger, not the nightly
        // snapshot, so a demotion mid-window still counts even if a later
        // materialization overwrote the snapshot back to a higher tier.
        client
          .from("flow_trust_events")
          .select("flow_id, runs, passes")
          .eq("assistant_id", assistantId)
          .eq("to_tier", "watch")
          .in("from_tier", ["auto", "queue"])
          .gte("created_at", since),
      ]);
      for (const r of [verdicts, messages, escalated, goals, trust]) {
        if (r.error) throw r.error;
      }

      const messageRows = (messages.data ?? []) as {
        id: string;
        conversation_id: string;
        content: { type?: string; action?: string; text?: string }[];
        feedback: number;
      }[];
      const conversationByMessage = new Map(
        messageRows.map((m) => [m.id, m.conversation_id])
      );

      return {
        failedVerdicts: ((verdicts.data ?? []) as {
          message_id: string;
          reason: string;
        }[]).map((v) => ({
          messageId: v.message_id,
          conversationId: conversationByMessage.get(v.message_id) ?? "",
          reason: v.reason,
        })),
        thumbsDown: messageRows
          .filter((m) => m.feedback === -1)
          .map((m) => ({
            messageId: m.id,
            conversationId: m.conversation_id,
            text: m.content.find((p) => p.type === "text")?.text ?? "",
          })),
        escalatedConversations: escalated.count ?? 0,
        refusals: messageRows.filter((m) =>
          m.content.some((p) => p.type === "text" && p.action === "refusal")
        ).length,
        goalViolations: ((goals.data ?? []) as {
          question: string;
          last_detail: string | null;
        }[]).map((g) => ({ question: g.question, detail: g.last_detail ?? "" })),
        demotedFlows: ((trust.data ?? []) as {
          flow_id: string;
          runs: number;
          passes: number;
        }[]).map((t) => ({ flowId: t.flow_id, runs: t.runs, passes: t.passes })),
      };
    },

    async recordCompostRun(input) {
      const { error } = await client.from("compost_runs").insert({
        assistant_id: input.assistantId,
        organization_id: input.organizationId,
        window_start: input.windowStart,
        window_end: input.windowEnd,
        proposals: input.proposals,
        clean: input.clean,
      });
      if (error) throw error;
    },

    async setCompostOptOut(organizationId, optOut) {
      const { error } = await client
        .from("organizations")
        .update({ compost_opt_out: optOut })
        .eq("id", organizationId);
      if (error) throw error;
    },

    async getCompostOptOut(organizationId) {
      const { data, error } = await client
        .from("organizations")
        .select("compost_opt_out")
        .eq("id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return (data as { compost_opt_out?: boolean } | null)?.compost_opt_out ?? false;
    },

    async setPersonalAiSubscriptionsAllowed(organizationId, allowed) {
      const { error } = await client
        .from("organizations")
        .update({ allow_personal_ai_subscriptions: allowed })
        .eq("id", organizationId);
      if (error) throw error;
    },

    async getPersonalAiSubscriptionsAllowed(organizationId) {
      const { data, error } = await client
        .from("organizations")
        .select("allow_personal_ai_subscriptions")
        .eq("id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return (
        (data as { allow_personal_ai_subscriptions?: boolean } | null)
          ?.allow_personal_ai_subscriptions ?? false
      );
    },

    async recordAssistantGoalRun(goalId, input) {
      const { data: goal, error: goalError } = await client
        .from("assistant_goals")
        .select("organization_id")
        .eq("id", goalId)
        .single();
      if (goalError) throw goalError;
      const organizationId = (goal as { organization_id: string })
        .organization_id;

      const { error: runError } = await client.from("assistant_goal_runs").insert({
        goal_id: goalId,
        organization_id: organizationId,
        pass: input.pass,
        detail: input.detail,
        duration_ms: input.durationMs,
      });
      if (runError) throw runError;

      const { error: updateError } = await client
        .from("assistant_goals")
        .update({
          last_run_at: new Date().toISOString(),
          last_result: input.pass ? "pass" : "fail",
          last_detail: input.detail || null,
        })
        .eq("id", goalId);
      if (updateError) throw updateError;

      // Capped retention: drop everything older than the newest N runs.
      const { data: stale, error: staleError } = await client
        .from("assistant_goal_runs")
        .select("id")
        .eq("goal_id", goalId)
        .order("ran_at", { ascending: false })
        .range(GOAL_RUN_RETENTION, GOAL_RUN_RETENTION + 199);
      if (staleError) throw staleError;
      const staleIds = ((stale ?? []) as { id: string }[]).map((r) => r.id);
      if (staleIds.length > 0) {
        const { error: deleteError } = await client
          .from("assistant_goal_runs")
          .delete()
          .in("id", staleIds);
        if (deleteError) throw deleteError;
      }
    },

    // --- Local-connector relay (service-role only) ----------------------------

    async consumeLocalConnectorPairing({ codeHash, origin, now }) {
      // One-time consumption as a single compare-and-set: only an unused,
      // unexpired pairing matching the code + origin can flip to used.
      const { data, error } = await client
        .from("local_connector_pairings")
        .update({ used_at: now })
        .eq("code_hash", codeHash)
        .eq("origin", origin)
        .is("used_at", null)
        .gt("expires_at", now)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data
        ? (rowToDomain(data as Record<string, unknown>) as unknown as LocalConnectorPairing)
        : null;
    },

    async listFreshLocalConnectorDevices(input) {
      let query = client
        .from("local_connector_devices")
        .select("*")
        .eq("organization_id", input.organizationId)
        .eq("user_id", input.userId)
        .eq("origin", input.origin)
        .is("revoked_at", null)
        .gte("last_seen_at", input.seenAfter)
        .order("last_seen_at", { ascending: false });
      if (input.limit !== undefined) query = query.limit(input.limit);
      const { data, error } = await query;
      if (error) throw error;
      return ((data ?? []) as Array<Record<string, unknown>>).map(
        (row) => rowToDomain(row) as unknown as LocalConnectorDevice
      );
    },

    async claimNextLocalInferenceJob({ deviceId, now, sweep = true }) {
      // A server request may disappear after the connector has claimed its
      // job. Expired work is swept on claim so prompts cannot linger, but
      // not on every claim: at the 1s hot poll rate this DELETE was the
      // single most executed statement in the database and deleted nothing
      // almost every time. The relay gates it to the heartbeat cadence.
      if (sweep) {
        const { error: sweepError } = await client
          .from("local_inference_jobs")
          .delete()
          .eq("device_id", deviceId)
          .lt("expires_at", now);
        if (sweepError) throw sweepError;
      }
      const { data: pending, error } = await client
        .from("local_inference_jobs")
        .select("id")
        .eq("device_id", deviceId)
        .eq("status", "pending")
        .gt("expires_at", now)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!pending) return null;
      // CAS pending → claimed: a concurrent claimer loses and gets null.
      const { data: claimed, error: claimError } = await client
        .from("local_inference_jobs")
        .update({ status: "claimed", claimed_at: now })
        .eq("id", pending.id)
        .eq("status", "pending")
        .select()
        .maybeSingle();
      if (claimError) throw claimError;
      return claimed
        ? (rowToDomain(claimed as Record<string, unknown>) as unknown as LocalInferenceJob)
        : null;
    },

    async completeLocalInferenceJob(input) {
      const failed = Boolean(input.error);
      const { data, error } = await client
        .from("local_inference_jobs")
        .update({
          status: failed ? "failed" : "completed",
          result: input.result ?? null,
          error: input.error ?? null,
          completed_at: input.now,
        })
        .eq("id", input.jobId)
        .eq("device_id", input.deviceId)
        .eq("status", "claimed")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },

    // --- Platform settings (single row, service-role only) --------------------

    async getPlatformSystemPromptOverride() {
      const { data, error } = await client
        .from("platform_settings")
        .select("system_prompt")
        .eq("id", "default")
        .maybeSingle();
      if (error) throw error;
      return ((data as { system_prompt?: string } | null)?.system_prompt ?? "");
    },

    async setPlatformSystemPrompt(prompt, updatedBy) {
      const { error } = await client.from("platform_settings").upsert(
        {
          id: "default",
          system_prompt: prompt,
          updated_by: updatedBy,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );
      if (error) throw error;
    },

    // --- Skills (reusable prompt templates) ----------------------------------
    // Plain CRUD moved to `table("skills")` (ADR-0016 stage 3); the delete
    // stays named because it carries cascade semantics (assistant_skills).

    async deleteSkill(id) {
      const { error } = await client.from("skills").delete().eq("id", id);
      if (error) throw error;
    },

    async listAssistantSkills(assistantId) {
      const { data, error } = await client
        .from("assistant_skills")
        .select("position, skills(*)")
        .eq("assistant_id", assistantId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data as unknown as Array<{ position: number; skills: SkillRow }>)
        .filter((row) => row.skills)
        .map((row) => toSkill(row.skills));
    },

    async setAssistantSkills(assistantId, skillIds) {
      const { error } = await client.rpc("set_assistant_skills", {
        p_assistant_id: assistantId,
        p_skill_ids: skillIds,
      });
      if (!error) return;
      if (!isSchemaLagError(error)) throw error;
      const { error: deleteError } = await client
        .from("assistant_skills")
        .delete()
        .eq("assistant_id", assistantId);
      if (deleteError) throw deleteError;
      if (skillIds.length === 0) return;
      const { error: insertError } = await client.from("assistant_skills").insert(
        skillIds.map((skillId, position) => ({
          assistant_id: assistantId,
          skill_id: skillId,
          position,
        })),
      );
      if (insertError) throw insertError;
    },

    // --- Entities + Records (#663) ---------------------------------------

    async upsertEntityRecords(entityId, rows) {
      if (rows.length === 0) return 0;
      // Manual upsert (select → update/insert) instead of ON CONFLICT: the
      // update path must never rewrite the row id, and chunked IN-filters
      // keep statements bounded for large imports.
      const CHUNK = 200;
      const now = new Date().toISOString();
      let written = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const keys = chunk.map((r) => r.key);
        const { data: existing, error: readError } = await client
          .from("entity_records")
          .select("id, record_key, values")
          .eq("entity_id", entityId)
          .in("record_key", keys);
        if (readError) throw readError;
        const byKey = new Map(
          (existing as Array<{
            id: string;
            record_key: string;
            values: Record<string, EntityRecordValue>;
          }>).map((r) => [
            r.record_key,
            r,
          ])
        );
        for (const row of chunk) {
          const existingRow = byKey.get(row.key);
          if (existingRow) {
            if (entityRecordValuesEqual(existingRow.values, row.values)) continue;
            const { error } = await client
              .from("entity_records")
              .update({ values: row.values, updated_at: now })
              .eq("id", existingRow.id);
            if (error) throw error;
          } else {
            const { error } = await client.from("entity_records").insert({
              id: shortId(),
              entity_id: entityId,
              record_key: row.key,
              values: row.values,
            });
            if (error) throw error;
          }
          written += 1;
        }
      }
      return written;
    },

    async listEntityRecords(entityId, opts) {
      const limit = opts?.limit ?? 50;
      const offset = opts?.offset ?? 0;
      const { data, error } = await client
        .from("entity_records")
        .select()
        .eq("entity_id", entityId)
        .order("record_key", { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return (data as EntityRecordRow[]).map(toEntityRecord);
    },

    async countEntityRecords(entityId) {
      const { count, error } = await client
        .from("entity_records")
        .select("id", { count: "exact", head: true })
        .eq("entity_id", entityId);
      if (error) throw error;
      return count ?? 0;
    },

    async queryEntityRecords(entityId, query) {
      const { data, error } = await client.rpc("query_entity_records", {
        p_entity_id: entityId,
        p_filters: query.filters ?? {},
        p_search: query.search?.trim() || null,
        p_limit: query.limit ?? 20,
      });
      if (error) throw error;
      return (data as EntityRecordRow[]).map(toEntityRecord);
    },

    // --- Long-term memories (#664) ---------------------------------------

    async getMemoryEnabled(organizationId) {
      const { data, error } = await client
        .from("organizations")
        .select("memory_enabled")
        .eq("id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return Boolean((data as { memory_enabled?: boolean } | null)?.memory_enabled);
    },

    async setMemoryEnabled(organizationId, enabled) {
      const { error } = await client
        .from("organizations")
        .update({ memory_enabled: enabled })
        .eq("id", organizationId);
      if (error) throw error;
    },

    async upsertMemories(subject, items) {
      const { organizationId, subjectId } = subject;
      const { data: existingRows, error: existingError } = await client
        .from("memories")
        .select("text")
        .eq("organization_id", organizationId)
        .eq("subject_id", subjectId);
      if (existingError) throw existingError;
      const existing = new Set(
        (existingRows as Array<{ text: string }>).map((r) => r.text)
      );

      // Explicit monotonic created_at stamps keep intra-batch order
      // deterministic for newest-first listing and drop-oldest capping.
      const rows: Array<Record<string, unknown>> = [];
      for (const item of items) {
        const text = item.text.trim();
        if (!text || existing.has(text)) continue;
        existing.add(text);
        rows.push({
          id: shortId(),
          organization_id: organizationId,
          subject_id: subjectId,
          text,
          embedding: item.embedding,
          conversation_id: item.conversationId ?? null,
          created_at: new Date(monotonicNow()).toISOString(),
        });
      }
      let inserted = 0;
      if (rows.length > 0) {
        const { data, error } = await client
          .from("memories")
          .insert(rows)
          .select("id");
        if (error) throw error;
        inserted = data?.length ?? 0;
      }

      // Cap enforcement: drop the oldest rows beyond the per-subject cap.
      const { data: overflow, error: overflowError } = await client
        .from("memories")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("subject_id", subjectId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(MEMORIES_PER_SUBJECT_CAP, MEMORIES_PER_SUBJECT_CAP + 999);
      if (overflowError) throw overflowError;
      const staleIds = (overflow as Array<{ id: string }>).map((r) => r.id);
      if (staleIds.length > 0) {
        const { error } = await client.from("memories").delete().in("id", staleIds);
        if (error) throw error;
      }
      return inserted;
    },

    async listMemories({ organizationId, subjectId }) {
      const { data, error } = await client
        .from("memories")
        .select("id, organization_id, subject_id, text, conversation_id, created_at")
        .eq("organization_id", organizationId)
        .eq("subject_id", subjectId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (error) throw error;
      return (data as MemoryRow[]).map(toMemory);
    },

    async deleteMemory(id) {
      const { error } = await client.from("memories").delete().eq("id", id);
      if (error) throw error;
    },

    async getMemory(id) {
      const { data, error } = await client
        .from("memories")
        .select("id, organization_id, subject_id, text, conversation_id, created_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? toMemory(data as MemoryRow) : null;
    },

    // --- Synced Record ingestion (#670) ---------------------------------

    async getEntitySyncConfig(entityId) {
      const { data, error } = await client
        .from("entity_sync_configs")
        .select("*")
        .eq("entity_id", entityId)
        .maybeSingle();
      if (error) throw error;
      return data ? toEntitySyncConfig(data as EntitySyncConfigRow) : null;
    },

    async upsertEntitySyncConfig(entityId, input) {
      const { data, error } = await client
        .from("entity_sync_configs")
        .upsert(
          {
            entity_id: entityId,
            url: input.url,
            sealed_headers: input.sealedHeaders ?? null,
            cadence_hours: input.cadenceHours,
            prune: input.prune,
            mapping: input.mapping,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "entity_id" }
        )
        .select()
        .single();
      if (error) throw error;
      return toEntitySyncConfig(data as EntitySyncConfigRow);
    },

    async deleteEntitySyncConfig(entityId) {
      const { error } = await client
        .from("entity_sync_configs")
        .delete()
        .eq("entity_id", entityId);
      if (error) throw error;
    },

    async markEntitySynced(entityId, at) {
      const { error } = await client
        .from("entity_sync_configs")
        .update({ last_synced_at: at })
        .eq("entity_id", entityId);
      if (error) throw error;
    },

    async listDueEntitySyncConfigs(now) {
      const { data, error } = await client
        .from("entity_sync_configs")
        .select("entity_id, cadence_hours, last_synced_at, entities!inner(organization_id)");
      if (error) throw error;
      const due: Array<{ entityId: string; organizationId: string }> = [];
      for (const row of data as unknown as Array<{
        entity_id: string;
        cadence_hours: number;
        last_synced_at: string | null;
        entities: { organization_id: string };
      }>) {
        if (row.last_synced_at) {
          const nextAt =
            new Date(row.last_synced_at).getTime() + row.cadence_hours * 3_600_000;
          if (nextAt > new Date(now).getTime()) continue;
        }
        due.push({
          entityId: row.entity_id,
          organizationId: row.entities.organization_id,
        });
      }
      return due;
    },

    async recordEntitySyncRun(entityId, run) {
      const { data, error } = await client
        .from("entity_sync_runs")
        .insert({
          id: shortId(),
          // Same reason as `memories` below: `now()` resolves to the same
          // instant for runs recorded back to back, and `id` is random, so the
          // newest-first listing needs an explicitly monotonic stamp to order
          // by. Postgres' clock would otherwise decide the contract by coin flip.
          finished_at: new Date(monotonicNow()).toISOString(),
          entity_id: entityId,
          status: run.status,
          upserted: run.upserted,
          pruned: run.pruned,
          rejected: run.rejected,
          error: run.error ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return toEntitySyncRun(data as EntitySyncRunRow);
    },

    async commitEntitySync(input) {
      const { data, error } = await client.rpc("commit_entity_sync", {
        p_entity_id: input.entityId,
        p_expected_last_synced_at: input.expectedLastSyncedAt,
        p_rows: input.rows,
        p_prune: input.prune,
        p_rejected: input.rejected,
        p_at: input.at,
      });
      if (error) {
        if (!isSchemaLagError(error)) throw error;
        const config = await this.getEntitySyncConfig(input.entityId);
        if (!config || config.lastSyncedAt !== input.expectedLastSyncedAt) {
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
                input.rows.map((row) => row.key),
              )
            : 0;
        const run = await this.recordEntitySyncRun(input.entityId, {
          status: "succeeded",
          upserted,
          pruned,
          rejected: input.rejected,
          error: null,
        });
        await this.markEntitySynced(input.entityId, input.at);
        return run;
      }
      const row = (data as EntitySyncRunRow[] | null)?.[0];
      if (!row) throw new Error("Entity sync commit returned no run");
      return toEntitySyncRun(row);
    },

    async listEntitySyncRuns(entityId, limit = 20) {
      const { data, error } = await client
        .from("entity_sync_runs")
        .select("*")
        .eq("entity_id", entityId)
        .order("finished_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data as EntitySyncRunRow[]).map(toEntitySyncRun);
    },

    async pruneEntityRecords(entityId, seenKeys) {
      const { data: rows, error: listError } = await client
        .from("entity_records")
        .select("id, record_key")
        .eq("entity_id", entityId);
      if (listError) throw listError;
      const seen = new Set(seenKeys);
      const stale = (rows as Array<{ id: string; record_key: string }>)
        .filter((r) => !seen.has(r.record_key))
        .map((r) => r.id);
      if (stale.length > 0) {
        const { error } = await client
          .from("entity_records")
          .delete()
          .in("id", stale);
        if (error) throw error;
      }
      return stale.length;
    },

    async listMemorySubjects(organizationId) {
      const { data, error } = await client
        .from("memories")
        .select("subject_id, created_at")
        .eq("organization_id", organizationId);
      if (error) throw error;
      const bySubject = new Map<string, { count: number; last: string }>();
      for (const row of data as Array<{ subject_id: string; created_at: string }>) {
        const entry = bySubject.get(row.subject_id);
        if (!entry) {
          bySubject.set(row.subject_id, { count: 1, last: row.created_at });
        } else {
          entry.count += 1;
          if (row.created_at > entry.last) entry.last = row.created_at;
        }
      }
      if (bySubject.size === 0) return [];

      // Latest SSO conversation per subject carries the identity-claim value.
      const { data: convRows, error: convError } = await client
        .from("conversations")
        .select("subject_id, metadata, created_at, assistants!inner(organization_id)")
        .eq("assistants.organization_id", organizationId)
        .eq("subject_type", "sso")
        .in("subject_id", [...bySubject.keys()])
        .order("created_at", { ascending: false });
      if (convError) throw convError;
      const claims = new Map<string, string>();
      for (const row of convRows as Array<{
        subject_id: string;
        metadata: ConversationMetadata | null;
      }>) {
        if (claims.has(row.subject_id)) continue;
        const value = row.metadata?.ssoClaimValue;
        if (value) claims.set(row.subject_id, value);
      }

      return [...bySubject.entries()]
        .map(([subjectId, entry]) => ({
          subjectId,
          claimValue: claims.get(subjectId) ?? null,
          memoryCount: entry.count,
          lastMemoryAt: entry.last,
        }))
        .sort((a, b) => (a.lastMemoryAt > b.lastMemoryAt ? -1 : 1));
    },

    async listMemorySubjectsPage(organizationId, input) {
      const limit = Math.max(1, Math.min(Math.trunc(input.limit), 100));
      let afterLastMemoryAt: string | null = null;
      let afterSubjectId: string | null = null;
      if (input.cursor) {
        try {
          const decoded = JSON.parse(input.cursor) as [string, string];
          if (typeof decoded[0] === "string" && typeof decoded[1] === "string") {
            [afterLastMemoryAt, afterSubjectId] = decoded;
          } else {
            throw new Error("Invalid memory subject cursor");
          }
        } catch {
          throw new Error("Invalid memory subject cursor");
        }
      }
      const { data, error } = await client.rpc("list_memory_subjects_page", {
        p_organization_id: organizationId,
        p_after_last_memory_at: afterLastMemoryAt,
        p_after_subject_id: afterSubjectId,
        p_limit: limit + 1,
      });
      if (error) throw error;
      const mapped = ((data ?? []) as Array<Record<string, unknown>>).map(
        (row): MemorySubjectSummary => ({
          subjectId: row.subject_id as string,
          claimValue: (row.claim_value as string | null) ?? null,
          memoryCount: Number(row.memory_count ?? 0),
          lastMemoryAt: row.last_memory_at as string,
        })
      );
      const hasMore = mapped.length > limit;
      const items = mapped.slice(0, limit);
      return {
        items,
        nextCursor: hasMore
          ? JSON.stringify([
              items.at(-1)!.lastMemoryAt,
              items.at(-1)!.subjectId,
            ])
          : null,
      };
    },

    async listEntitiesPage(organizationId, input) {
      const limit = Math.max(1, Math.min(Math.trunc(input.limit), 100));
      let query = client
        .from("entities")
        .select("*")
        .eq("organization_id", organizationId)
        .order("id", { ascending: true })
        .limit(limit + 1);
      if (input.cursor) query = query.gt("id", input.cursor);
      const { data, error } = await query;
      if (error) throw error;
      const mapped = (data ?? []).map(
        (row) => rowToDomain(row) as unknown as Entity
      );
      const hasMore = mapped.length > limit;
      const items = mapped.slice(0, limit);
      return {
        items,
        nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
      };
    },

    async deleteSubjectMemories({ organizationId, subjectId }) {
      const { error } = await client.rpc("erase_subject_memories", {
        p_organization_id: organizationId,
        p_subject_id: subjectId,
      });
      if (error) throw error;
    },

    async searchMemories({ organizationId, subjectId }, query) {
      const limit = query.limit ?? 5;
      type MemoryRow = { id: string; text: string; similarity: number };

      // Lexical search: also the safety net for vector search, since memories
      // written while no embedding key was configured have NULL embeddings
      // and are invisible to match_memories.
      const lexicalSearch = async (): Promise<MemoryRow[]> => {
        const tokens = lexicalTokens(query.text, 5);
        if (tokens.length === 0) return [];
        const { data, error } = await client
          .from("memories")
          .select("id, text")
          .eq("organization_id", organizationId)
          .eq("subject_id", subjectId)
          .or(tokens.map((t) => `text.ilike.%${t}%`).join(","))
          .limit(limit);
        if (error) throw error;
        return (data as Array<{ id: string; text: string }>).map((r) => ({
          id: r.id,
          text: r.text,
          similarity: LEXICAL_SIMILARITY,
        }));
      };

      return hybridRetrieve<MemoryRow>({
        embedding: query.embedding,
        limit,
        vector: async () => {
          const { data, error } = await client.rpc("match_memories", {
            p_organization_id: organizationId,
            p_subject_id: subjectId,
            p_query_embedding: query.embedding,
            p_match_count: limit,
          });
          if (error) throw error;
          return data as MemoryRow[];
        },
        lexical: lexicalSearch,
        keyOf: (r) => r.id,
      });
    },

    // --- Generic table access (ADR-0016) --------------------------------

    table(name) {
      return supabaseTable(client, name);
    },
  };
}
