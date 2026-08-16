import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hybridRetrieve,
  lexicalTokens,
  LEXICAL_SIMILARITY,
} from "./hybrid-search";
import type {
  Alert,
  AlertStatus,
  AlertType,
  ApiEndpointSpec,
  ApiIntegration,
  ApiIntegrationAuthType,
  Assistant,
  AssistantAccessEntry,
  AssistantAccessRole,
  AssistantGoal,
  AssistantPatch,
  AssistantTools,
  BackgroundJob,
  ChannelAvailability,
  ChannelConversationData,
  ChannelFormField,
  ChannelKind,
  Concept,
  ConceptFrontmatter,
  Conversation,
  ConversationMetadata,
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
  colorizeOverview,
  DEFAULT_AI_DISCLAIMER,
  DEFAULT_FLOWS,
  DEFAULT_WELCOME_MESSAGE,
  defaultChannelConversationData,
  estimateCostEur,
  FLOW_TRUST_EVENT_RETENTION,
  GOAL_RUN_RETENTION,
  isProactiveMessage,
  MEMORIES_PER_SUBJECT_CAP,
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
import type { Db } from "./types";

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
  assistant_id: string;
  subject_type: "member" | "visitor";
  subject_id: string;
  collection_id: string | null;
  title: string;
  metadata: ConversationMetadata | null;
  session_state: Record<string, unknown> | null;
  pinned: boolean | null;
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

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    assistantId: row.assistant_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    collectionId: row.collection_id,
    title: row.title,
    metadata: row.metadata ?? {},
    sessionState: row.session_state ?? {},
    pinned: row.pinned ?? false,
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

function toMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    organizationId: row.organization_id,
    subjectId: row.subject_id,
    text: row.text,
    conversationId: row.conversation_id ?? null,
    createdAt: row.created_at,
  };
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
  return {
    assistantId: row.assistant_id,
    flowId: row.flow_id,
    organizationId: row.organization_id,
    runs: row.runs,
    passes: row.passes,
    tier: row.tier,
    previousTier: row.previous_tier,
    computedAt: row.computed_at,
  };
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
  return {
    organizationId: row.organization_id,
    assistantId: row.assistant_id,
    flowId: row.flow_id,
    fromTier: row.from_tier,
    toTier: row.to_tier,
    runs: row.runs,
    passes: row.passes,
    createdAt: row.created_at,
  };
}

function toAlert(row: AlertRow): Alert {
  return {
    id: row.id,
    organizationId: row.organization_id,
    type: row.type,
    title: row.title,
    detail: row.detail,
    status: row.status,
    sourceKey: row.source_key,
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
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
  return {
    id: row.id,
    organizationId: row.organization_id,
    provider: row.provider,
    config: row.config,
    encryptedSecret: row.encrypted_secret,
    validationStatus: row.validation_status,
    validatedAt: row.validated_at,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  };
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
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string) ?? (row.created_at as string),
  };
}

function toBackgroundJob(row: Record<string, unknown>): BackgroundJob {
  return {
    id: row.id as string,
    kind: row.kind as BackgroundJob["kind"],
    sourceId: (row.source_id as string | null) ?? null,
    status: row.status as BackgroundJob["status"],
    payload: (row.payload as Record<string, unknown>) ?? {},
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    nextRunAt: row.next_run_at as string,
    lockedAt: (row.locked_at as string | null) ?? null,
    lockedBy: (row.locked_by as string | null) ?? null,
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
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role,
    token: row.token,
    createdAt: row.created_at,
  };
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
 * Supabase-backed Db. The client must carry the caller's auth context
 * (cookie-based session in the admin app) — RLS does the tenant isolation.
 */
export function createSupabaseDb(client: SupabaseClient): Db {
  return {
    // --- Organizations & membership -----------------------------------

    async getCurrentOrg(preferredOrgId?: string) {
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user) return null;

      let membership = client
        .from("organization_members")
        .select(
          "role, organizations (id, name, logo_url, trace_retention_days, created_at)"
        )
        .eq("user_id", user.id);
      if (preferredOrgId) membership = membership.eq("organization_id", preferredOrgId);
      const { data, error } = await membership.limit(1).maybeSingle();
      if (error) throw error;
      if (data?.organizations) {
        const org = data.organizations as unknown as {
          id: string;
          name: string;
          logo_url: string | null;
          trace_retention_days: number | null;
          created_at: string;
        };
        return {
          organization: {
            id: org.id,
            name: org.name,
            logoUrl: org.logo_url,
            traceRetentionDays: org.trace_retention_days,
            createdAt: org.created_at,
          },
          role: data.role as Role,
        };
      }

      // No membership row for the requested org — a platform superuser
      // browsing an org they don't belong to. RLS still governs visibility:
      // this returns nothing for anyone who isn't actually a superuser.
      let orgQuery = client
        .from("organizations")
        .select("id, name, logo_url, trace_retention_days, created_at");
      orgQuery = preferredOrgId ? orgQuery.eq("id", preferredOrgId) : orgQuery;
      const { data: orgRow, error: orgError } = await orgQuery.limit(1).maybeSingle();
      if (orgError) throw orgError;
      if (!orgRow) return null;
      return {
        organization: {
          id: orgRow.id as string,
          name: orgRow.name as string,
          logoUrl: orgRow.logo_url as string | null,
          traceRetentionDays: orgRow.trace_retention_days as number | null,
          createdAt: orgRow.created_at as string,
        },
        role: "owner",
      };
    },

    async listOrganizations() {
      const { data, error } = await client
        .from("organizations")
        .select("id, name, logo_url, trace_retention_days, created_at")
        .order("name", { ascending: true });
      if (error) throw error;
      return (
        data as Array<{
          id: string;
          name: string;
          logo_url: string | null;
          trace_retention_days: number | null;
          created_at: string;
        }>
      ).map((org) => ({
        id: org.id,
        name: org.name,
        logoUrl: org.logo_url,
        traceRetentionDays: org.trace_retention_days,
        createdAt: org.created_at,
      }));
    },

    async updateOrganization(organizationId, patch: OrganizationPatch) {
      const row: Record<string, unknown> = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.logoUrl !== undefined) row.logo_url = patch.logoUrl;
      if (patch.traceRetentionDays !== undefined)
        row.trace_retention_days = patch.traceRetentionDays;
      const { data, error } = await client
        .from("organizations")
        .update(row)
        .eq("id", organizationId)
        .select("id, name, logo_url, trace_retention_days, created_at")
        .single();
      if (error) throw error;
      return {
        id: data.id,
        name: data.name,
        logoUrl: data.logo_url,
        traceRetentionDays: data.trace_retention_days,
        createdAt: data.created_at,
      };
    },

    async getProfile() {
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user) return null;
      const { data, error } = await client
        .from("profiles")
        .select("id, email, username, first_name, last_name, avatar_url")
        .eq("id", user.id)
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
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const row: Record<string, unknown> = {};
      if (patch.username !== undefined) row.username = patch.username;
      if (patch.firstName !== undefined) row.first_name = patch.firstName;
      if (patch.lastName !== undefined) row.last_name = patch.lastName;
      if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;
      const { data, error } = await client
        .from("profiles")
        .update(row)
        .eq("id", user.id)
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

    // --- Assistant access overrides (PRD #296) ---------------------------

    async listAssistantAccess(assistantId) {
      // Same one-query profiles embed as listMembers (dual FK, see the
      // assistant_access migration).
      const { data, error } = await client
        .from("assistant_access")
        .select(
          "user_id, role, granted_at, granted_by, profiles(email, username, first_name, last_name, avatar_url)"
        )
        .eq("assistant_id", assistantId)
        .order("granted_at", { ascending: true });
      if (error) throw error;
      const rows = data as unknown as Array<{
        user_id: string;
        role: AssistantAccessRole;
        granted_at: string;
        granted_by: string | null;
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
        username: r.profiles?.username ?? null,
        firstName: r.profiles?.first_name ?? null,
        lastName: r.profiles?.last_name ?? null,
        avatarUrl: r.profiles?.avatar_url ?? null,
        role: r.role,
        grantedAt: r.granted_at,
        grantedBy: r.granted_by,
      })) satisfies AssistantAccessEntry[];
    },

    async setAssistantAccess(assistantId, userId, role) {
      // granted_at/granted_by are stamped by a DB trigger on every write.
      const { error } = await client.from("assistant_access").upsert(
        { assistant_id: assistantId, user_id: userId, role },
        { onConflict: "assistant_id,user_id" }
      );
      if (error) throw error;
    },

    async clearAssistantAccess(assistantId, userId) {
      const { error } = await client
        .from("assistant_access")
        .delete()
        .eq("assistant_id", assistantId)
        .eq("user_id", userId);
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
      for (let i = 0; i < orderedIds.length; i++) {
        const { error } = await client
          .from("flows")
          .update({ position: i })
          .eq("id", orderedIds[i])
          .eq("assistant_id", assistantId)
          .eq("is_default", false);
        if (error) throw error;
      }
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

    async listCollections(assistantId) {
      const { data, error } = await client
        .from("knowledge_collections")
        .select("*")
        .eq("assistant_id", assistantId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as Array<Record<string, string>>).map((r) => ({
        id: r.id,
        assistantId: r.assistant_id ?? "",
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
        assistantId: data.assistant_id ?? "",
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
        assistantId: (row.assistant_id as string | null) ?? "",
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
          assistant_id: null,
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
          assistant_id: assistantId,
          organization_id: assistant.organization_id,
          name: input.name,
          description: input.description ?? "",
        })
        .select()
        .single();
      if (error) throw error;
      return {
        id: data.id,
        assistantId: data.assistant_id ?? "",
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
          id: shortId(),
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
      const source = toSource(data as Record<string, unknown>);
      // Auto-link to the collection's legacy owning assistant (PRD #726) so
      // assistant-editor add flows keep answering with link-scoped retrieval.
      const { data: collection, error: collectionError } = await client
        .from("knowledge_collections")
        .select("assistant_id")
        .eq("id", input.collectionId)
        .maybeSingle();
      if (collectionError) throw collectionError;
      if (collection?.assistant_id) {
        // Plain insert: the Source was created in this call, so the pair
        // cannot exist yet.
        const { error: linkError } = await client
          .from("assistant_sources")
          .insert({
            assistant_id: collection.assistant_id,
            source_id: source.id,
          });
        if (linkError) throw linkError;
      }
      return source;
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

    async createBackgroundJob(input) {
      const now = new Date().toISOString();
      const { data, error } = await client
        .from("background_jobs")
        .insert({
          id: shortId(),
          kind: input.kind,
          source_id: input.sourceId ?? null,
          status: "queued",
          payload: input.payload,
          max_attempts: input.maxAttempts ?? 3,
          next_run_at: input.nextRunAt ?? now,
        })
        .select()
        .single();
      if (error) throw error;
      return toBackgroundJob(data as Record<string, unknown>);
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
      const { data: queued, error: queuedError } = await client
        .from("background_jobs")
        .select("*")
        .eq("kind", input.kind)
        .eq("status", "queued")
        .lte("next_run_at", input.now)
        .order("next_run_at", { ascending: true })
        .limit(input.limit);
      if (queuedError) throw queuedError;

      const remaining = Math.max(0, input.limit - queued.length);
      const { data: stale, error: staleError } = remaining
        ? await client
            .from("background_jobs")
            .select("*")
            .eq("kind", input.kind)
            .eq("status", "running")
            .lte("locked_at", input.staleBefore)
            .order("locked_at", { ascending: true })
            .limit(remaining)
        : { data: [], error: null };
      if (staleError) throw staleError;

      const claimed: BackgroundJob[] = [];
      for (const row of [...queued, ...stale] as Array<Record<string, unknown>>) {
        const job = toBackgroundJob(row);
        const runningAndStale =
          job.status === "running" &&
          Boolean(job.lockedAt) &&
          job.lockedAt! <= input.staleBefore;
        if (!runningAndStale && job.attempts >= job.maxAttempts) continue;
        const { data: updated, error: updateError } = await client
          .from("background_jobs")
          .update({
            status: "running",
            attempts:
              runningAndStale && job.attempts >= job.maxAttempts
                ? job.attempts
                : job.attempts + 1,
            locked_at: input.now,
            locked_by: input.workerId,
            error: "",
            updated_at: input.now,
          })
          .eq("id", job.id)
          .in("status", ["queued", "running"])
          .select()
          .maybeSingle();
        if (updateError) throw updateError;
        if (updated) claimed.push(toBackgroundJob(updated as Record<string, unknown>));
      }
      return claimed;
    },

    async updateBackgroundJob(id, patch) {
      const row: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.error !== undefined) row.error = patch.error;
      if (patch.nextRunAt !== undefined) row.next_run_at = patch.nextRunAt;
      if (patch.lockedAt !== undefined) row.locked_at = patch.lockedAt;
      if (patch.lockedBy !== undefined) row.locked_by = patch.lockedBy;
      const { error } = await client
        .from("background_jobs")
        .update(row)
        .eq("id", id);
      if (error) throw error;
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

    async listConcepts(collectionId) {
      const { data, error } = await client
        .from("concepts")
        .select("*")
        .eq("collection_id", collectionId)
        .order("path", { ascending: true });
      if (error) throw error;
      return (data as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as string,
        collectionId: r.collection_id as string,
        sourceId: r.source_id as string | null,
        path: r.path as string,
        frontmatter: r.frontmatter as ConceptFrontmatter,
        body: r.body as string,
        excluded: (r.excluded as boolean) ?? false,
        recrawlSchedule: (r.recrawl_schedule as RecrawlSchedule | null) ?? null,
        createdAt: r.created_at as string,
      })) satisfies Concept[];
    },

    async getConcept(id) {
      const { data, error } = await client
        .from("concepts")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        collectionId: data.collection_id,
        sourceId: data.source_id,
        path: data.path,
        frontmatter: data.frontmatter,
        body: data.body,
        excluded: data.excluded ?? false,
        recrawlSchedule: data.recrawl_schedule ?? null,
        createdAt: data.created_at,
      };
    },

    async listNullEmbeddingConceptIds(assistantId) {
      const { data, error } = await client
        .from("concept_chunks")
        .select("concept_id")
        .eq("assistant_id", assistantId)
        .is("embedding", null);
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
      // Exact-match filtering happens in JS to keep ilike wildcard characters
      // in the question from widening the match.
      const { data, error } = await client
        .from("concepts")
        .select("*, knowledge_collections!inner(name, assistant_id)")
        .eq("knowledge_collections.assistant_id", assistantId)
        .eq("excluded", false)
        .eq("frontmatter->>type", "FAQ");
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
      const { data, error } = await client
        .from("concepts")
        .insert({
          id: shortId(),
          collection_id: input.collectionId,
          source_id: input.sourceId,
          path: input.path,
          frontmatter: input.frontmatter,
          body: input.body,
        })
        .select()
        .single();
      if (error) throw error;
      return {
        id: data.id,
        collectionId: data.collection_id,
        sourceId: data.source_id,
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
        assistant_id: chunk.assistantId,
        source_id: chunk.sourceId ?? null,
        content: chunk.content,
        embedding: chunk.embedding,
      }));
      const { error } = await client.from("concept_chunks").insert(rows);
      if (error) throw error;
    },

    async searchChunks(assistantId, collectionId, query) {
      const limit = query.limit ?? 6;
      type ChunkRow = { concept_id: string; content: string; similarity: number };

      // Lexical search: also the safety net for vector search, since chunks
      // ingested while no embedding key was configured have NULL embeddings
      // and are invisible to match_chunks_linked. Two reach paths (PRD #726):
      // legacy chunks (source_id null) scope by assistant_id; source-aware
      // chunks scope by the assistant↔source link table.
      const lexicalSearch = async (): Promise<ChunkRow[]> => {
        const tokens = lexicalTokens(query.text, 5);
        if (tokens.length === 0) return [];
        const tokenClause = tokens.map((t) => `content.ilike.%${t}%`).join(",");
        const baseQuery = () => {
          let builder = client
            .from("concept_chunks")
            .select("concept_id, content, concepts!inner(excluded)")
            .eq("concepts.excluded", false)
            .or(tokenClause)
            .limit(limit);
          if (collectionId) builder = builder.eq("collection_id", collectionId);
          return builder;
        };
        const toChunkRows = (data: unknown): ChunkRow[] =>
          (data as Array<{ concept_id: string; content: string }>).map((r) => ({
            concept_id: r.concept_id,
            content: r.content,
            similarity: LEXICAL_SIMILARITY,
          }));

        const { data: linkRows, error: linkError } = await client
          .from("assistant_sources")
          .select("source_id")
          .eq("assistant_id", assistantId);
        if (linkError) throw linkError;
        const linkedSourceIds = (
          linkRows as Array<{ source_id: string }>
        ).map((r) => r.source_id);

        const legacyQuery = baseQuery()
          .is("source_id", null)
          .eq("assistant_id", assistantId);
        const [legacyRes, linkedRes] = await Promise.all([
          legacyQuery,
          linkedSourceIds.length > 0
            ? baseQuery().in("source_id", linkedSourceIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (legacyRes.error) throw legacyRes.error;
        if (linkedRes.error) throw linkedRes.error;
        const legacy = toChunkRows(legacyRes.data);
        const linked = toChunkRows(linkedRes.data);
        const seen = new Set<string>();
        return [...legacy, ...linked].filter((r) => {
          const key = `${r.concept_id}\n${r.content}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      };

      const rows = await hybridRetrieve<ChunkRow>({
        embedding: query.embedding,
        limit,
        vector: async () => {
          const { data, error } = await client.rpc("match_chunks_linked", {
            p_assistant_id: assistantId,
            p_collection_id: collectionId,
            p_query_embedding: query.embedding,
            p_match_count: limit,
          });
          if (error) throw error;
          return data as ChunkRow[];
        },
        lexical: lexicalSearch,
        keyOf: (r) => `${r.concept_id}\n${r.content}`,
      });

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
      if (hitSourceIds.length > 0) {
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
      const { data, error } = await client
        .from("conversations")
        .insert({
          id: shortId(),
          assistant_id: input.assistantId,
          subject_type: input.subjectType,
          subject_id: input.subjectId,
          collection_id: input.collectionId ?? null,
          title: input.title ?? "",
          metadata: input.metadata ?? {},
        })
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

    async listInboxConversations(organizationId) {
      // collection_id has no FK (anchoring survives collection deletion), so
      // names can't be embedded — but they don't depend on the conversation
      // rows either: fetch the org's collection names in parallel instead of
      // as a dependent second round-trip.
      const [convRes, collRes] = await Promise.all([
        client
          .from("conversations")
          .select(
            "*, assistants!inner(title, organization_id), messages(flow_name, feedback, proactive)"
          )
          .eq("assistants.organization_id", organizationId)
          .order("updated_at", { ascending: false }),
        client
          .from("knowledge_collections")
          .select("id, name, assistants!inner(organization_id)")
          .eq("assistants.organization_id", organizationId),
      ]);
      if (convRes.error) throw convRes.error;
      type JoinedRow = ConversationRow & {
        assistants: { title: string };
        messages: Array<{
          flow_name: string | null;
          feedback: -1 | 0 | 1;
          proactive: boolean | null;
        }>;
      };
      const rows = convRes.data as unknown as JoinedRow[];

      const collectionNames = new Map<string, string>();
      for (const c of (collRes.data ?? []) as unknown as Array<{
        id: string;
        name: string;
      }>) {
        collectionNames.set(c.id, c.name);
      }

      return rows.map((row): InboxConversation => {
        const messages = row.messages ?? [];
        return {
          ...toConversation(row),
          assistantTitle: row.assistants.title,
          collectionName: row.collection_id
            ? (collectionNames.get(row.collection_id) ?? null)
            : null,
          messageCount: messages.length,
          flowNames: [
            ...new Set(
              messages.map((m) => m.flow_name).filter((n): n is string => !!n)
            ),
          ],
          notificationOnly:
            messages.length > 0 && messages.every((m) => m.proactive === true),
          feedback: messages.some((m) => m.feedback === 1)
            ? 1
            : messages.some((m) => m.feedback === -1)
              ? -1
              : 0,
        };
      });
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
      const { data, error } = await client
        .from("knowledge_collections")
        .select("id, assistants!inner(organization_id, knowledge_engine)")
        .eq("assistants.knowledge_engine", "graph");
      if (error) throw error;
      // PostgREST types an embedded to-one relation as an array, though it
      // returns a single object at runtime — normalize either shape.
      const rows = data as unknown as Array<{
        id: string;
        assistants: { organization_id: string } | { organization_id: string }[];
      }>;
      return rows.map((r) => {
        const assistant = Array.isArray(r.assistants) ? r.assistants[0] : r.assistants;
        return { organizationId: assistant.organization_id, collectionId: r.id };
      });
    },

    async setConversationPinned(id, pinned) {
      const { error } = await client
        .from("conversations")
        .update({ pinned })
        .eq("id", id);
      if (error) throw error;
    },

    async updateConversationMetadata(id, patch) {
      const { data, error } = await client
        .from("conversations")
        .select("metadata")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      const metadata = { ...((data?.metadata as ConversationMetadata) ?? {}), ...patch };
      const { error: updateError } = await client
        .from("conversations")
        .update({ metadata })
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
      const { data, error } = await client
        .from("messages")
        .insert({
          id: shortId(),
          conversation_id: input.conversationId,
          role: input.role,
          content: input.content,
          flow_id: input.flowId ?? null,
          flow_name: input.flowName ?? null,
          trace: input.trace ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      await client
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", input.conversationId);
      return toStoredMessage(data as MessageRow);
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

    async listInsightsMessages(organizationId) {
      const { data, error } = await client
        .from("messages")
        .select(
          "conversation_id, role, feedback, created_at, proactive, conversations!inner(assistants!inner(organization_id))"
        )
        .eq("conversations.assistants.organization_id", organizationId);
      if (error) throw error;
      type Row = Pick<
        MessageRow,
        "conversation_id" | "role" | "feedback" | "created_at"
      > & { proactive: boolean | null };
      return (data as unknown as Row[]).map((row) => ({
        conversationId: row.conversation_id,
        role: row.role,
        feedback: row.feedback,
        createdAt: row.created_at,
        // Derived by the database (a stored generated column), so it cannot drift
        // from the content it describes.
        proactive: row.proactive === true,
      }));
    },

    // --- Improvements -------------------------------------------------

    async listImprovements(organizationId) {
      const { data, error } = await client
        .from("improvements")
        .select("*, improvement_messages(id)")
        .eq("organization_id", organizationId)
        .order("seq", { ascending: false });
      if (error) throw error;
      type Row = ImprovementRow & { improvement_messages: Array<{ id: string }> };
      return (data as Row[]).map(
        (row): ImprovementListItem => ({
          ...toImprovement(row),
          messageCount: (row.improvement_messages ?? []).length,
        })
      );
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

    async createImprovementProposal(input) {
      // Delete-then-insert (matching the mock) so a re-draft is a clean fresh
      // proposal — never a stale dismiss_reason/accepted_concept_id or a
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
      // One nested embed (links -> messages -> conversations -> assistants)
      // replaces three sequential queries; transcripts and collection names
      // then load in parallel. Five sequential round-trips become an
      // effective two.
      type ConvJoined = ConversationRow & { assistants: { title: string } | null };
      const { data: links, error } = await client
        .from("improvement_messages")
        .select(
          "id, message_id, created_at, messages(*, conversations(*, assistants(title)))"
        )
        .eq("improvement_id", improvementId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const linkRows = links as unknown as Array<{
        id: string;
        message_id: string;
        created_at: string;
        messages: (MessageRow & { conversations: ConvJoined | null }) | null;
      }>;
      if (linkRows.length === 0) return [];

      const flagged = new Map<string, StoredMessage>();
      const convMap = new Map<string, ConvJoined>();
      for (const link of linkRows) {
        if (!link.messages) continue;
        flagged.set(link.messages.id, toStoredMessage(link.messages));
        const conv = link.messages.conversations;
        if (conv) convMap.set(conv.id, conv);
      }
      const conversationIds = [...convMap.keys()];
      if (conversationIds.length === 0) return [];

      const collectionIds = [
        ...new Set(
          [...convMap.values()]
            .map((c) => c.collection_id)
            .filter((x): x is string => !!x)
        ),
      ];
      const [allMsgsRes, collectionsRes] = await Promise.all([
        client
          .from("messages")
          .select("*")
          .in("conversation_id", conversationIds)
          .order("created_at", { ascending: true }),
        client
          .from("knowledge_collections")
          .select("id, name")
          .in("id", collectionIds),
      ]);
      if (allMsgsRes.error) throw allMsgsRes.error;
      const transcripts = new Map<string, StoredMessage[]>();
      for (const m of allMsgsRes.data as MessageRow[]) {
        const arr = transcripts.get(m.conversation_id) ?? [];
        arr.push(toStoredMessage(m));
        transcripts.set(m.conversation_id, arr);
      }

      const collectionNames = new Map<string, string>();
      for (const c of (collectionsRes.data ?? []) as Array<{
        id: string;
        name: string;
      }>) {
        collectionNames.set(c.id, c.name);
      }

      return linkRows.flatMap((link): ImprovementAssociation[] => {
        const message = flagged.get(link.message_id);
        if (!message) return [];
        const conv = convMap.get(message.conversationId);
        if (!conv) return [];
        const transcript = transcripts.get(conv.id) ?? [];
        const enriched: InboxConversation = {
          ...toConversation(conv),
          assistantTitle: conv.assistants?.title ?? "",
          collectionName: conv.collection_id
            ? (collectionNames.get(conv.collection_id) ?? null)
            : null,
          messageCount: transcript.length,
          flowNames: [
            ...new Set(
              transcript.map((m) => m.flowName).filter((n): n is string => !!n)
            ),
          ],
          notificationOnly:
            transcript.length > 0 &&
            transcript.every((m) => isProactiveMessage(m.content)),
          feedback: transcript.some((m) => m.feedback === 1)
            ? 1
            : transcript.some((m) => m.feedback === -1)
              ? -1
              : 0,
        };
        return [
          {
            linkId: link.id,
            messageId: link.message_id,
            conversationId: conv.id,
            message,
            transcript,
            conversation: enriched,
          },
        ];
      });
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
      // Two reads cover the expand window: Collections already stamped with
      // the org id, plus legacy Collections reached through the owning
      // assistant. Fine-filtering and paging happen adapter-side — hub tables
      // are org-sized (dozens to hundreds of Sources), and this keeps the
      // query shapes inside what the PostgREST test shim implements.
      const { data: orgAssistants, error: orgAssistantsError } = await client
        .from("assistants")
        .select("id")
        .eq("organization_id", organizationId);
      if (orgAssistantsError) throw orgAssistantsError;
      const orgAssistantIds = (
        orgAssistants as Array<{ id: string }>
      ).map((r) => r.id);

      const [stampedRes, legacyRes] = await Promise.all([
        client
          .from("sources")
          .select("*, knowledge_collections!inner(organization_id)")
          .in("kind", filter.kinds)
          .eq("knowledge_collections.organization_id", organizationId),
        orgAssistantIds.length > 0
          ? client
              .from("sources")
              .select(
                "*, knowledge_collections!inner(organization_id, assistant_id)"
              )
              .in("kind", filter.kinds)
              .is("knowledge_collections.organization_id", null)
              .in("knowledge_collections.assistant_id", orgAssistantIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (stampedRes.error) throw stampedRes.error;
      if (legacyRes.error) throw legacyRes.error;
      const byId = new Map<string, Source>();
      for (const row of [
        ...(stampedRes.data as Array<Record<string, unknown>>),
        ...(legacyRes.data as Array<Record<string, unknown>>),
      ]) {
        const source = toSource(row);
        byId.set(source.id, source);
      }

      let matches = [...byId.values()];
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
      const [linksRes, answersRes, counts] = await Promise.all([
        client
          .from("assistant_sources")
          .select(
            "assistant_id, source_id, direct_access, created_at, assistants!inner(title)"
          )
          .in("source_id", pageIds),
        faqIds.length > 0
          ? client
              .from("concepts")
              .select("source_id, body")
              .in("source_id", faqIds)
          : Promise.resolve({ data: [], error: null }),
        Promise.all(
          pageIds.map(async (id) => {
            const { count, error } = await client
              .from("concepts")
              .select("id", { count: "exact", head: true })
              .eq("source_id", id);
            if (error) throw error;
            return [id, count ?? 0] as const;
          })
        ),
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
      const { data, error } = await client
        .from("concepts")
        .select("source_id, body")
        .in(
          "source_id",
          page.items.map((item) => item.id)
        );
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
      const { data, error } = await client
        .from("concepts")
        .select("*")
        .eq("source_id", sourceId)
        .order("path", { ascending: true })
        .limit(limit ?? 500);
      if (error) throw error;
      return (data as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as string,
        collectionId: r.collection_id as string,
        sourceId: r.source_id as string | null,
        path: r.path as string,
        frontmatter: r.frontmatter as ConceptFrontmatter,
        body: r.body as string,
        excluded: (r.excluded as boolean) ?? false,
        recrawlSchedule: (r.recrawl_schedule as RecrawlSchedule | null) ?? null,
        createdAt: r.created_at as string,
      }));
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
      const { data, error } = await client
        .from("assistant_sources")
        .select("assistant_id")
        .eq("source_id", sourceId);
      if (error) throw error;
      const existing = new Set(
        (data as Array<{ assistant_id: string }>).map((r) => r.assistant_id)
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
        const { error: addError } = await client
          .from("assistant_sources")
          .insert(
            toAdd.map((assistantId) => ({
              assistant_id: assistantId,
              source_id: sourceId,
            }))
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

    async listWebsiteSources(organizationId) {
      const { data, error } = await client
        .from("sources")
        .select(
          "id, name, config, knowledge_collections!inner(assistant_id, assistants!inner(organization_id))"
        )
        .eq("kind", "website")
        .eq("knowledge_collections.assistants.organization_id", organizationId);
      if (error) throw error;
      type Row = {
        id: string;
        name: string;
        config: { url?: string } | null;
        knowledge_collections: { assistant_id: string };
      };
      return (data as unknown as Row[]).map((row) => ({
        id: row.id,
        assistantId: row.knowledge_collections.assistant_id,
        name: row.name,
        url: row.config?.url ?? "",
      }));
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
        // full ISO timestamp instead — keep only the day either way.
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

    // --- Standing goals -------------------------------------------------------

    async listAssistantGoals(assistantId) {
      const { data, error } = await client
        .from("assistant_goals")
        .select("*")
        .eq("assistant_id", assistantId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as GoalRow[]).map(toGoal);
    },

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
          `This assistant already has ${ASSISTANT_GOAL_CAP} goals — remove one first.`
        );
      }
      const { data, error } = await client
        .from("assistant_goals")
        .insert({
          id: shortId(),
          organization_id: (assistant as { organization_id: string })
            .organization_id,
          assistant_id: assistantId,
          question: input.question,
          expectations: input.expectations,
        })
        .select()
        .single();
      if (error) throw error;
      return toGoal(data as GoalRow);
    },

    async updateAssistantGoal(id, patch) {
      const update: Record<string, unknown> = {};
      if (patch.question !== undefined) update.question = patch.question;
      if (patch.expectations !== undefined)
        update.expectations = patch.expectations;
      if (patch.status !== undefined) update.status = patch.status;
      const { data, error } = await client
        .from("assistant_goals")
        .update(update)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return toGoal(data as GoalRow);
    },

    async deleteAssistantGoal(id) {
      const { error } = await client
        .from("assistant_goals")
        .delete()
        .eq("id", id);
      if (error) throw error;
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
        // 23505 = unique violation: already verified — idempotent skip.
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

    async listDueCompostAssistants({ dueBefore, limit }) {
      const { data, error } = await client.rpc("list_due_compost_assistants", {
        p_due_before: dueBefore,
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
        // snapshot — so a demotion mid-window still counts even if a later
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

    async claimNextLocalInferenceJob({ deviceId, now }) {
      // A server request may disappear after the connector has claimed its
      // job. Remove expired work on every claim so prompts cannot linger.
      const { error: sweepError } = await client
        .from("local_inference_jobs")
        .delete()
        .eq("device_id", deviceId)
        .lt("expires_at", now);
      if (sweepError) throw sweepError;
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

    async listSkills(organizationId) {
      const { data, error } = await client
        .from("skills")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as SkillRow[]).map(toSkill);
    },

    async createSkill(organizationId, input) {
      const { data, error } = await client
        .from("skills")
        .insert({
          id: shortId(),
          organization_id: organizationId,
          name: input.name,
          description: input.description ?? "",
          prompt: input.prompt,
        })
        .select()
        .single();
      if (error) throw error;
      return toSkill(data as SkillRow);
    },

    async updateSkill(id, patch) {
      const row: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.description !== undefined) row.description = patch.description;
      if (patch.prompt !== undefined) row.prompt = patch.prompt;
      const { data, error } = await client
        .from("skills")
        .update(row)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return toSkill(data as SkillRow);
    },

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
      const { error: deleteError } = await client
        .from("assistant_skills")
        .delete()
        .eq("assistant_id", assistantId);
      if (deleteError) throw deleteError;
      if (skillIds.length === 0) return;
      const { error } = await client.from("assistant_skills").insert(
        skillIds.map((skillId, position) => ({
          assistant_id: assistantId,
          skill_id: skillId,
          position,
        }))
      );
      if (error) throw error;
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

    async getDataAssistantEntityIds(organizationId) {
      const { data, error } = await client
        .from("organizations")
        .select("data_assistant_entities")
        .eq("id", organizationId)
        .maybeSingle();
      if (error) throw error;
      const ids = (data as { data_assistant_entities?: unknown } | null)
        ?.data_assistant_entities;
      return Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string") : [];
    },

    async setDataAssistantEntityIds(organizationId, entityIds) {
      const { error } = await client
        .from("organizations")
        .update({ data_assistant_entities: entityIds })
        .eq("id", organizationId);
      if (error) throw error;
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
