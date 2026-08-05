/**
 * The domain vocabulary — every noun in `CONTEXT.md`, as a type.
 *
 * Pure type declarations with **no data-access concept in them**: no `Db`, no
 * Supabase, no I/O. That separation is the point of this package (ADR-0019).
 * `@agent-hub/db` declares the `Db` interface over these types and depends on
 * this package; nothing here may depend on it, or on any adapter.
 *
 * Keep the names the ones `CONTEXT.md` fixes — Organization, Assistant, Member,
 * Role, Knowledge Collection, Source, Concept, Publication, Widget, Visitor,
 * Conversation, Flow, Flow Action, Provider Connection — and add a term there
 * before adding a type here.
 */

import type { ConceptFrontmatter } from "./okf";

export type FlowAction =
  | "search_knowledge"
  | "custom_message"
  | "suggest_help_desk"
  | "follow_up_questions"
  | "show_button"
  | "iframe"
  | "api_request"
  | "send_email"
  | "improvement"
  | "handover"
  /**
   * The courtesy primitive (Basic Interaction, #565): one conversational reply
   * with no retrieval, no tools and no second write phase. What answers a
   * greeting, a thanks or a farewell — a message that carries no information
   * need, so searching the knowledge base for it can only cost latency.
   */
  | "basic_reply"
  /**
   * The proactive-engagement primitive: an unprompted in-widget message. The
   * only action a proactively-triggered Flow may run, and never available to a
   * message-triggered one (see `actionAllowedForTrigger` in `engine.ts`).
   */
  | "notification";

export type FlowButtonType =
  | "external_link"
  | "help_desk"
  | "send_text"
  | "faq";

export type FlowButtonIcon =
  | "message"
  | "phone"
  | "headset"
  | "bell"
  | "mail"
  /** Legacy icon values from early Flow Button configurations. */
  | "external_link"
  | "headphones";

/**
 * The event that starts a flow. Legacy flows (no trigger stored) = "message".
 *
 * "message" drives Intent Classification; the other three are **proactive** —
 * fired by a client event, with no Visitor message to classify. See
 * `isProactiveTrigger` in `engine.ts`.
 */
export type FlowTrigger = "message" | "page_load" | "time_on_page" | "chat_open";

/**
 * Configuration owned by the *trigger* rather than by an action. Separate from
 * `FlowActionSettings` because a dwell duration is a property of the event that
 * starts the flow, not of what the flow then does.
 */
export interface FlowTriggerSettings {
  /** "Time on page": how long the Visitor must linger before the flow fires. */
  timeOnPage?: {
    minutes?: number;
    seconds?: number;
  };
}

export type FlowConditionLogic = "any" | "all";

/** Example message that should (or should not) satisfy a condition. */
export interface FlowConditionExample {
  message: string;
  /** Short explanation shown to the classifier, max 1000 chars in the UI. */
  note: string;
  shouldTrigger: boolean;
}

/** "Conversation context" condition: an LLM-evaluated description + examples. */
export interface ConversationContextCondition {
  id: string;
  kind: "conversation_context";
  description: string;
  examples: FlowConditionExample[];
}

/** How a URL condition compares the page URL to its configured value. */
export type FlowUrlOperator = "matches" | "contains" | "regex";

/** "URL" condition: the page the Visitor is on, matched three ways. */
export interface UrlCondition {
  id: string;
  kind: "url";
  operator: FlowUrlOperator;
  /** Exact URL, substring or regular expression, per `operator`. */
  value: string;
}

/**
 * "Schedule" condition: a wall-clock window read in one IANA timezone.
 *
 * The bounds are local wall-clock date-times, never instants, for the same
 * reason `ChannelAvailability` stores local opening hours plus a zone — "09:00
 * in Europe/Rome" has to stay 09:00 across a daylight-saving change.
 */
export interface ScheduleCondition {
  id: string;
  kind: "schedule";
  /** Wall-clock local date-time, `YYYY-MM-DDTHH:mm`. Required. */
  startAt: string;
  /** Same shape; absent or blank leaves the window open-ended. */
  endAt?: string;
  /** IANA zone id, e.g. "Europe/Rome". Both bounds are read in this zone. */
  timezone: string;
}

/**
 * One criterion a Flow must meet to stay a routing candidate.
 *
 * `conversation_context` is **semantic** — evaluated by the classifier (or, with
 * no model, keyword-scored). `url` and `schedule` are **objective**: checkable
 * facts, gated deterministically before Intent Classification by
 * `flowConditionsAllowRouting` and never shown to the model (spec #550).
 */
export type FlowCondition =
  | ConversationContextCondition
  | UrlCondition
  | ScheduleCondition;

/** One response-extraction rule: a JSON path bound to a template variable name. */
export interface ApiRequestJsonPath {
  id: string;
  /** e.g. `$.data.user.name`; blank binds the whole response body. */
  path: string;
  /** The `{{variable}}` name the extracted value is exposed as. */
  variable: string;
}

/** How the API request action authenticates against the configured endpoint. */
export type ApiRequestAuthType = "none" | "bearer" | "api_key" | "basic";

export type ApiRequestAuth =
  | { type: "none" }
  | { type: "bearer"; token?: string }
  | { type: "api_key"; header?: string; key?: string }
  | { type: "basic"; username?: string; password?: string };

/**
 * How often a Notification may reach the same Visitor.
 * - `session` (default) — once per Conversation.
 * - `visitor` — once ever, across all of that Visitor's Conversations.
 * - `always` — every time the trigger fires.
 */
export type NotificationDeliveryRule = "session" | "visitor" | "always";

/**
 * One button attached to a Notification. A deliberate subset of
 * `FlowButtonType`: a proactive nudge can send the Visitor somewhere or start a
 * conversation, but help-desk and FAQ buttons answer a question nobody asked.
 */
export interface NotificationButton {
  id: string;
  label?: string;
  type?: "external_link" | "send_text";
  /** Destination for an `external_link` button. */
  url?: string;
  /** First message put into the chat by a `send_text` button. */
  text?: string;
}

/** Per-action settings, keyed by action type (each type appears at most once). */
export interface FlowActionSettings {
  search_knowledge?: {
    /** Offer the help-desk escalation button when no answer is found. */
    escalatePrompt?: boolean;
    /** Record unresolved queries as knowledge improvement items. */
    improvementItems?: boolean;
    /**
     * Extra instructions steering how the knowledge base is searched for this
     * flow (e.g. "when asked about X, also search about Y"). Supports template
     * variables. Max 10000 chars.
     */
    searchGuidelines?: string;
    /**
     * Tone/format guidance for the generated answer in this flow. Supports
     * template variables. Max 10000 chars.
     */
    answeringStyle?: string;
    /**
     * When true, `answeringStyle` replaces the assistant's global answering
     * style for this flow; when false (default) it is appended to it.
     */
    overrideAnsweringStyle?: boolean;
  };
  basic_reply?: {
    /**
     * Pins the courtesy reply's exact wording. Set = emitted verbatim with no
     * model call (the Message action's invariant, for the same reason: an
     * admin's own words are never model-rewritten). Unset = generated in the
     * Visitor's language from the assistant's identity and answering style.
     * Doubles as the reply when no chat model resolves at all. Supports
     * template variables.
     */
    message?: string;
  };
  show_button?: {
    label?: string;
    type?: FlowButtonType;
    url?: string;
    helpDeskId?: string;
    /** Text posted as a user message when the response button is clicked. */
    text?: string;
    /** FAQ identity and question chosen from the assistant's Knowledge. */
    faqId?: string;
    faqQuestion?: string;
    showIcon?: boolean;
    icon?: FlowButtonIcon;
  };
  iframe?: {
    url?: string;
    /** Accessible title / heading shown above the embed. */
    title?: string;
    /** Offer a fullscreen (lightbox) view of the embed when the site allows it. */
    lightbox?: boolean;
    /** Iframe height value; unit in `heightUnit`. Defaults to 30. */
    height?: number;
    /** Unit for `height`. Defaults to "vh". */
    heightUnit?: "vh" | "px";
  };
  api_request?: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url?: string;
    /**
     * How the request authenticates. Secrets live here in the flow's jsonb
     * settings (org-scoped by RLS) and are never returned to the browser once
     * saved — the editor shows a masked placeholder and replaces on edit.
     */
    auth?: ApiRequestAuth;
    /** Admin-set request headers (name/value); denylisted names rejected on save. */
    headers?: KeyValuePair[];
    /** Appended to the URL query string. */
    queryParams?: KeyValuePair[];
    /**
     * Raw JSON request body template for non-GET methods; template variables
     * inside it are resolved with JSON-string escaping so the result stays
     * valid JSON. Empty/unset sends the triggering message as `{ "message": … }`.
     */
    bodyTemplate?: string;
    /**
     * Extracts values from the JSON response into `{{variable}}` template
     * variables available to later actions in the same turn. A blank `path`
     * binds the whole response body.
     */
    jsonPaths?: ApiRequestJsonPath[];
  };
  send_email?: { to?: string };
  handover?: { assistantId?: string };
  follow_up_questions?: {
    /**
     * How follow-up chips are produced. "ai_generated" (default) lets the
     * model suggest questions from the conversation; "manual" shows the
     * `questions` list verbatim.
     */
    mode?: "ai_generated" | "manual";
    /** Fixed follow-up questions shown verbatim when `mode` is "manual". */
    questions?: string[];
  };
  /**
   * The proactive nudge a proactively-triggered Flow delivers. Emitted
   * **verbatim**, like `custom_message` — a Notification never passes through a
   * model.
   */
  notification?: {
    /** Optional heading shown above the content, max 100 chars in the UI. */
    title?: string;
    /** Rich-text body, max 5000 chars in the UI. Required for a valid Flow. */
    content?: string;
    /**
     * How often the same Visitor may receive it. Absent reads as `session` —
     * the safe default, so an announcement cannot re-fire on every page view of
     * a long browsing session.
     */
    deliveryRule?: NotificationDeliveryRule;
    /**
     * Whether the Visitor may answer the nudge. Absent reads as `true` — an
     * existing Notification is never silently muted.
     */
    allowReplies?: boolean;
    /** Optional next steps offered under the nudge. */
    buttons?: NotificationButton[];
  };
}

/**
 * Built-in runtime tools an assistant can enable for its agent loop. Names
 * match the tool-call names the model sees. `searchKnowledge` is the core
 * RAG tool and is always on; the others are opt-in per assistant.
 */
export type BuiltInToolName =
  | "searchKnowledge"
  | "fetchUrl"
  | "remember";

/**
 * Per-assistant tool configuration (assistants.tools jsonb).
 *
 * Held one shape smaller than the column: `custom` — one registered HTTP tool
 * per endpoint — was superseded by {@link ApiIntegration} and removed in the
 * contract step of spec #559. A pre-existing row may still carry the key; it is
 * read by nothing and deliberately left in place rather than migrated away,
 * because deleting a self-hoster's stored configuration is not this schema's
 * call to make.
 */
export interface AssistantTools {
  /** Built-in enablement overrides; unset = runtime default. */
  builtIns?: Partial<Record<BuiltInToolName, boolean>>;
}

/** Declared type of a catalogued endpoint parameter, shown to the model. */
export type ApiParamType = "string" | "number" | "boolean";

/**
 * One parameter of a catalogued endpoint. `in` says where it goes: a `path`
 * parameter is the `{name}` placeholder the model substitutes from what it
 * learned in the conversation; a `query` parameter is appended.
 */
export interface ApiEndpointParam {
  name: string;
  description?: string;
  type?: ApiParamType;
  in?: "path" | "query";
  required?: boolean;
}

/**
 * One endpoint of an {@link ApiIntegration}'s catalogue: what it is for, the
 * parameters it takes, and the keys a successful response carries. This
 * description is the whole contract the model discovers and reads — it is also
 * the allow-list every outbound path is validated against before egress.
 */
export interface ApiEndpointSpec {
  id: string;
  /** Short human label; also the synthetic Source name an answer cites. */
  name: string;
  /** Path relative to the integration's base URL, e.g. `/tickets/{ticketId}/comments`. */
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** What the endpoint answers, in the admin's own words. */
  purpose: string;
  params?: ApiEndpointParam[];
  /** Keys present in a successful response body. */
  responseKeys?: string[];
}

export type ApiIntegrationAuthType = "none" | "bearer" | "api_key" | "basic";

/**
 * The API integration registered on an Assistant (spec #559): a base URL,
 * one sealed credential, and a catalogue of described endpoints. The model
 * reaches it through three generic tools — catalogue summary, per-endpoint
 * detail, query — rather than one registered tool per endpoint.
 *
 * `encryptedCredential` is sealed app-side (see `sealSecret`) and lives in its
 * own table precisely so it is never part of `AssistantTools`, and therefore
 * never travels into a Publication snapshot or down to a widget client.
 */
export interface ApiIntegration {
  assistantId: string;
  organizationId: string;
  /** Display name; the citation reads as `<endpoint.name>` under this collection. */
  name: string;
  /** Absolute https origin (+ optional base path) every relative path resolves against. */
  baseUrl: string;
  authType: ApiIntegrationAuthType;
  /** Header the API key goes in (`api_key` auth only). */
  authHeaderName: string;
  /** Username (`basic` auth only); the password is the sealed credential. */
  authUsername: string;
  /** Sealed bearer token / API key / basic password; null when unset. */
  encryptedCredential: string | null;
  endpoints: ApiEndpointSpec[];
  createdAt: string;
  updatedAt: string;
}

/**
 * What an admin submits when saving an integration. `encryptedCredential`
 * omitted keeps the stored credential (so an edit never has to round-trip a
 * secret through the browser); null clears it.
 */
export interface ApiIntegrationInput {
  assistantId: string;
  organizationId: string;
  name: string;
  baseUrl: string;
  authType: ApiIntegrationAuthType;
  authHeaderName?: string;
  authUsername?: string;
  encryptedCredential?: string | null;
  endpoints: ApiEndpointSpec[];
}

/**
 * A reusable org-level prompt template ("Skill"). Attached skills are layered
 * into the assistant's system prompt between the answering style and the
 * flow routing context.
 */
export interface Skill {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillInput {
  name: string;
  description?: string;
  prompt: string;
}

/**
 * One recorded cookie-consent decision — our own evidence that a visitor
 * consented (GDPR Art. 7(1)), independent of the `cc_cookie` they hold.
 *
 * Append-only: a withdrawal is a new row with `action: "changed"`, never an
 * edit of the row that granted consent. The history is the evidence.
 *
 * Not org-scoped — anonymous visitors have no organization — and deliberately
 * holds no IP address; `consentId` (mirrored in the visitor's cookie) is the
 * link back to the device. See migration 20260726100000_cookie_consent_records.
 */
export interface CookieConsentRecord {
  id: string;
  /** The consent plugin's random id, also written to the visitor's cookie. */
  consentId: string;
  /** Which revision of the cookie declaration the visitor was shown. */
  revision: number;
  acceptedCategories: string[];
  rejectedCategories: string[];
  /** "all" | "custom" | "necessary" — the shape of the choice. */
  acceptType: string;
  /** "granted" on a first decision, "changed" on a later edit or withdrawal. */
  action: string;
  /** Visitor's clock when they chose; untrusted, kept alongside `createdAt`. */
  consentedAt: string | null;
  pageUrl: string;
  userAgent: string;
  /** Our clock when the record was stored — the trusted timestamp. */
  createdAt: string;
}

export type SkillPatch = Partial<Pick<Skill, "name" | "description" | "prompt">>;

/** What the runtime needs of an attached skill (frozen into Publications). */
export type SkillSnapshot = Pick<Skill, "id" | "name" | "description" | "prompt">;

/**
 * Local-connector relay (personal AI subscriptions that stay on a Member's
 * Mac). Server-only tables — no RLS policies; reachable only through a
 * service-role Db. See migration 20260714001000_local_connector_relay.
 */

/** One-time pairing code handed from Preview to the local connector. */
export interface LocalConnectorPairing {
  id: string;
  organizationId: string;
  userId: string;
  /** sha256 of the signed pairing code — the plaintext never touches the DB. */
  codeHash: string;
  origin: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

/** A paired local connector, identified by its hashed bearer token. */
export interface LocalConnectorDevice {
  id: string;
  organizationId: string;
  userId: string;
  /** sha256 of the device bearer token. */
  tokenHash: string;
  origin: string;
  /** Provider ids the connector advertises (e.g. "openai", "anthropic"). */
  providers: string[];
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export type LocalInferenceJobStatus =
  | "pending"
  | "claimed"
  | "completed"
  | "failed";

/** One opaque model invocation relayed between Preview and a paired Mac. */
export interface LocalInferenceJob {
  id: string;
  deviceId: string;
  organizationId: string;
  userId: string;
  provider: string;
  modelId: string;
  invocation: Record<string, unknown>;
  status: LocalInferenceJobStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  expiresAt: string;
  claimedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export type Role = "owner" | "admin" | "editor" | "viewer";

export interface Organization {
  id: string;
  name: string;
  /** Circular logo shown in the org switcher — same treatment as an
   * Assistant's avatarUrl (data URL, falls back to an initial letter). */
  logoUrl?: string | null;
  /**
   * How many days a message keeps its persisted Turn Trace before the cron
   * sweep strips it (#573). Null (the default) keeps traces forever — an
   * existing tenant's transcripts never start disappearing without an admin
   * opting in. The sweep removes only the trace payload; the message, its
   * content, feedback and timestamps stay.
   */
  traceRetentionDays?: number | null;
  createdAt: string;
}

export interface Member {
  userId: string;
  email: string;
  role: Role;
  /** Profile fields, joined from `profiles` — null until the member (or the
   * signup trigger) has set them. */
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

/** The signed-in caller's own profile — Settings > Profile. */
export interface Profile {
  userId: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

export interface ProfilePatch {
  username?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string | null;
}

export interface OrganizationPatch {
  name?: string;
  logoUrl?: string | null;
  /** Trace retention window in days; null = keep forever (#573). */
  traceRetentionDays?: number | null;
}

export interface Invite {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  token: string;
  createdAt: string;
}

/**
 * An Organization-scoped API key (#618): authenticates programmatic access
 * (the CLI, MCP server, /api/v1) as the Organization, acting with a Role
 * capped at its creator's. Only the SHA-256 hash of the secret is stored
 * (see `api-keys.ts`); `secretHint` is the displayable first characters.
 * A revoked key keeps its row — `revokedAt` set — for audit.
 */
export interface OrgApiKey {
  id: string;
  organizationId: string;
  name: string;
  secretHint: string;
  role: Role;
  /** Empty when the creating account was since deleted. */
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface OrgApiKeyInput {
  name: string;
  role: Role;
  secretHash: string;
  secretHint: string;
  createdBy: string;
}

/**
 * A Member's per-assistant role override ("Manage access" — PRD #296).
 * No row means "System Role": the Member's org Role applies. 'denied' hides
 * the Assistant and its data from that Member entirely. Org owners and
 * platform superusers are exempt — overrides never apply to them.
 */
export type AssistantAccessRole = "denied" | "viewer" | "editor" | "admin";

/** An override row joined with the member's profile (mirrors Member). */
export interface AssistantAccessEntry {
  userId: string;
  email: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  role: AssistantAccessRole;
  /** Last time this override was set (stamped server-side). */
  grantedAt: string;
  /** Who set it (stamped server-side; null for pre-audit rows). */
  grantedBy: string | null;
}

export type Provider = "anthropic" | "openai" | "google" | "openai_compatible";
export type ProviderConnectionProvider = Provider | "azure_openai";
export type ProviderConnectionType =
  | "platform"
  | "subscription"
  | "api_key"
  | "federated";

export interface GoogleVertexFederatedConfig {
  kind: "google_vertex";
  projectId: string;
  location: string;
  workloadIdentityAudience: string;
  serviceAccountEmail?: string;
}

export interface AnthropicWifFederatedConfig {
  kind: "anthropic_wif";
  workloadIdentityAudience: string;
  organizationId?: string;
  workspaceId?: string;
}

export interface AzureOpenAiFederatedConfig {
  kind: "azure_openai";
  tenantId: string;
  endpoint: string;
  deployment: string;
  clientId?: string;
  audience?: string;
}

/**
 * OpenAI-compatible endpoint config (#436): any server speaking the OpenAI
 * chat/embeddings API — Ollama, vLLM, LM Studio, a gateway. Used with the
 * `api_key` connection type; the key itself is optional (many local servers
 * ignore it). `embeddingDims` records the model's native dimension for a
 * future re-embed migration; v1 still pads/truncates to the shared 1536.
 */
export interface OpenAiCompatibleConfig {
  kind: "openai_compatible";
  baseUrl: string;
  chatModel: string;
  embeddingModel?: string;
  embeddingDims?: number;
}

export type ProviderConnectionConfig =
  | Record<string, never>
  | GoogleVertexFederatedConfig
  | AnthropicWifFederatedConfig
  | AzureOpenAiFederatedConfig
  | OpenAiCompatibleConfig;

export interface ProviderConnection {
  id: string;
  organizationId: string;
  type: ProviderConnectionType;
  provider: ProviderConnectionProvider;
  displayName: string;
  /** AES-256-GCM ciphertext — decrypted only inside the runtime. */
  encryptedKey: string | null;
  /** Non-secret display suffix, e.g. "…abcd". */
  keyHint: string;
  /** Non-secret provider-specific connection settings. */
  config: ProviderConnectionConfig;
  /** Member who connected it, when the connection was created by a signed-in user. */
  createdBy: string | null;
  createdAt: string;
  /**
   * This is the connection the Organization chose to embed its knowledge
   * (#437). At most one connection per org carries it; when none does, the
   * runtime falls back to its automatic provider order. Derived from
   * `organizations.embedding_connection_id`, so every reader of a connection
   * list sees the choice without a second query.
   */
  preferredForEmbedding: boolean;
}

/**
 * Widget SSO — the identity provider an organization connects so its
 * assistants can require visitors to sign in before chatting. One connection
 * per organization; assistants opt in via {@link Assistant.requireSignIn}.
 * Entra ID ships first; `clerk`/`workos` are contract-ready but not built.
 */
export type SsoProviderKind = "entra" | "clerk" | "workos";

/** Non-secret Entra config; the client secret is sealed separately. */
export interface EntraSsoConfig {
  clientId: string;
  tenantId: string;
}

/** Non-secret, provider-specific connection settings (grows with clerk/workos). */
export type SsoConnectionConfig = EntraSsoConfig;

export type SsoValidationStatus = "unvalidated" | "valid" | "invalid";

/**
 * Organization-level SSO connection. `encryptedSecret` is AES-sealed app-side
 * (see `sealSecret`) and returned only to server-side callers — NEVER to the
 * browser or the widget. Use {@link SsoConnectionPublic} on any browser-facing
 * read path.
 */
export interface SsoConnection {
  id: string;
  organizationId: string;
  provider: SsoProviderKind;
  /** Non-secret settings (Entra: client id + tenant id). */
  config: SsoConnectionConfig;
  /** Sealed client secret; server-side only. */
  encryptedSecret: string | null;
  validationStatus: SsoValidationStatus;
  validatedAt: string | null;
  connectedAt: string;
  updatedAt: string;
}

/** Widget/browser-safe projection — provider kind only, never config or secrets. */
export interface SsoConnectionPublic {
  provider: SsoProviderKind;
}

export interface WidgetStyle {
  brandColor?: string;
  position?: "right" | "left";
}

/** Escalation destination configured at the organization level. */
export interface HelpDesk {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  /** Auto-generate an Improvement from the last AI answer on escalation. */
  autoGenerateImprovements: boolean;
  ticketingIntegration: TicketingIntegration | null;
  createdAt: string;
  updatedAt: string;
}

export type TicketingPlatform =
  | "servicenow"
  | "jira"
  | "salesforce"
  | "topdesk"
  | "solarwinds"
  | "hubspot"
  | "halo"
  | "faqtory"
  | "teamdynamix"
  | "zendesk"
  | "ivanti";

/**
 * OAuth password-grant credentials for ServiceNow's Table API: an OAuth
 * application (client ID/secret) registered on the instance, plus a
 * dedicated integration user (username/password) to obtain access tokens.
 * clientSecret and password are stored encrypted (see sealSecret) and never
 * sent back to the browser.
 */
export interface ServiceNowConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

export interface TicketingIntegration {
  id: string;
  platform: TicketingPlatform;
  name: string;
  connectedAt: string;
  config: ServiceNowConfig;
}

export type ChannelKind =
  | "email"
  | "phone"
  | "live_chat"
  | "ticket"
  | "external_link"
  | "salesforce_chat"
  | "api_endpoint";

export type ChannelFieldType =
  | "user_email"
  | "student_number"
  | "user_role"
  | "short_text"
  | "long_text"
  | "phone"
  | "dropdown"
  | "date"
  | "url"
  | "checkbox"
  | "file"
  | "string_list";

/** One field of a channel's escalation form. */
export interface ChannelFormField {
  id: string;
  type: ChannelFieldType;
  label: string;
  placeholder?: string;
  usePlaceholderAsDefault?: boolean;
  /** Replies to the escalation go to this field's value (email fields). */
  useAsReplyTo?: boolean;
  required?: boolean;
  showInForm?: boolean;
  /** Choices for dropdown / list fields. */
  options?: string[];
}

export type ApiAuthType = "none" | "api_key" | "bearer" | "basic";

/** One name/value row, e.g. an API endpoint header or query parameter. */
export interface KeyValuePair {
  id: string;
  name: string;
  value: string;
}

/** Kind-specific destination settings. */
export interface SupportChannelConfig {
  destinationEmail?: string;
  phoneNumber?: string;
  /** ISO country code for phoneNumber's calling code, e.g. "IT". */
  phoneCountry?: string;
  url?: string;
  authType?: ApiAuthType;
  apiKeyHeaderName?: string;
  apiKeyValue?: string;
  bearerToken?: string;
  basicUsername?: string;
  basicPassword?: string;
  headers?: KeyValuePair[];
  queryParams?: KeyValuePair[];
}

/** Conversation detail toggles injected into the escalation payload. */
export interface ChannelConversationData {
  /** 1-2 paragraph AI generated summary of what was discussed. */
  chatSummary?: boolean;
  /** All user messages and AI responses with timestamps. */
  fullChatHistory?: boolean;
  /** All user data fields, included by default. */
  userData?: boolean;
  /** All conversation metadata fields, included by default. */
  metadata?: boolean;
}

export type WeekDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/** A single opening window, e.g. 10:30–19:00, in the channel's timezone. */
export interface TimeRange {
  id: string;
  opensHour: number;
  opensMinute: number;
  closesHour: number;
  closesMinute: number;
}

/** One weekday's opening windows in the channel's availability schedule. */
export interface DayAvailability {
  enabled: boolean;
  /** Zero or more windows; a day open past midnight is modelled as one range. */
  ranges: TimeRange[];
}

export type AvailabilityMode = "always" | "limited";

/** When this channel may be offered to users. */
export interface ChannelAvailability {
  mode: AvailabilityMode;
  /** IANA timezone id, e.g. "Europe/Rome". */
  timezone: string;
  hours: Record<WeekDay, DayAvailability>;
}

/** One escalation method offered by a help desk. */
export interface SupportChannel {
  id: string;
  helpDeskId: string;
  kind: ChannelKind;
  /** Button label users see in the escalation menu. */
  name: string;
  position: number;
  enabled: boolean;
  config: SupportChannelConfig;
  formTitle: string;
  form: ChannelFormField[];
  /** Message shown after the form is submitted. */
  confirmationMessage: string;
  conversationData: ChannelConversationData;
  availability: ChannelAvailability;
  createdAt: string;
  updatedAt: string;
}

export interface SupportChannelInput {
  kind: ChannelKind;
  name: string;
  config?: SupportChannelConfig;
  formTitle?: string;
  form?: ChannelFormField[];
  confirmationMessage?: string;
  conversationData?: ChannelConversationData;
  availability?: ChannelAvailability;
}

export type SupportChannelPatch = Partial<
  Pick<
    SupportChannel,
    | "name"
    | "enabled"
    | "config"
    | "formTitle"
    | "form"
    | "confirmationMessage"
    | "conversationData"
    | "availability"
  >
>;

/** Per-assistant escalation configuration (the Help Desks setup page). */
export interface HelpDeskSettings {
  /** Recommend a matching desk when the AI can't answer. */
  aiRecommended?: boolean;
  /** Hide the always-available floating "contact support" button. */
  hideEscalationButton?: boolean;
  /** Label of the floating escalation button. */
  contactButtonLabel?: string;
  /** Help desks this assistant may recommend. */
  selectedIds?: string[];
}

export type QuickReplyType =
  | "send_text"
  | "escalation"
  | "external_link"
  | "faq";

/**
 * A typed quick-reply starter button shown under the welcome message.
 * send_text/faq pre-fill a first message; escalation opens the help-desk
 * menu; external_link opens a URL in a new tab. Max 50 per assistant.
 */
export interface QuickReplyButton {
  id: string;
  label: string;
  type: QuickReplyType;
  /** Message sent into chat (send_text) or FAQ question asked (faq). */
  text?: string;
  /** Destination for external_link buttons. */
  url?: string;
}

/**
 * Which retrieval engine answers `search_knowledge` for an assistant. `graph`
 * (the default) retrieves from the derived Knowledge Graph (ADR-0017), falling
 * back to `vector` when the graph worker is unreachable; `vector` is the
 * pgvector RAG. OKF stays the record and citation anchor for both.
 */
export type KnowledgeEngine = "graph" | "vector";

export interface Assistant {
  id: string;
  organizationId: string;
  title: string;
  nickname: string;
  description: string;
  /** Circular logo shown in the sidebar Overview row and the widget header. */
  avatarUrl?: string;
  welcomeMessage: string;
  /**
   * Short disclaimer shown at the bottom of the chat window, under the AI's
   * responses (e.g. "AI answers are not perfect…"). Rendered in the editor
   * preview and the published widget. Empty string hides it.
   */
  aiDisclaimer: string;
  suggestedQuestions: string[];
  quickReplies: QuickReplyButton[];
  /**
   * The org-authored system prompt for this assistant (the reference
   * platform's "Answering style"). Layered UNDER the platform system prompt
   * at runtime — it customizes persona/tone/format but can never override
   * platform rules.
   */
  answeringStyle: string;
  /**
   * Simplified thinking: with it on, every tool phase of a turn narrates itself
   * to the Visitor in one short line, in their language ("Sto cercando i video
   * nella sezione Video Prova del corso…"). The lines stream as they happen and
   * are persisted as their own `progress` reply parts, so the Inbox transcript
   * shows the same narration the Visitor saw. Off (the default) is the runtime's
   * ordinary behaviour: the Thinking panel and nothing in the message.
   */
  simplifiedThinking: boolean;
  chatLauncherEnabled: boolean;
  modelProvider: Provider;
  modelId: string;
  style: WidgetStyle;
  allowedDomains: string[];
  helpDeskSettings: HelpDeskSettings;
  /** Agent-loop tool configuration (built-in enablement overrides). */
  tools: AssistantTools;
  /**
   * Require visitors to sign in (via the org's SSO Connection) before the
   * widget will chat. Enforcement is per-assistant; the credential lives once
   * per org (see {@link SsoConnection}).
   */
  requireSignIn: boolean;
  /** Which retrieval engine answers this assistant's knowledge searches. */
  knowledgeEngine: KnowledgeEngine;
  createdAt: string;
  updatedAt: string;
}

/** Immutable snapshot served by the published widget (CONTEXT.md: Publication). */
export interface PublicationConfig {
  assistant: Pick<
    Assistant,
    | "id"
    | "organizationId"
    | "title"
    | "nickname"
    | "description"
    | "avatarUrl"
    | "welcomeMessage"
    | "aiDisclaimer"
    | "suggestedQuestions"
    | "quickReplies"
    | "answeringStyle"
    | "simplifiedThinking"
    | "chatLauncherEnabled"
    | "modelProvider"
    | "modelId"
    | "style"
    | "allowedDomains"
    | "helpDeskSettings"
    | "tools"
    | "requireSignIn"
    | "knowledgeEngine"
  >;
  flows: Flow[];
  collections: Array<{ id: string; name: string }>;
  /** Attached Skills frozen at publish time (older snapshots lack it). */
  skills?: SkillSnapshot[];
}

export interface Publication {
  id: string;
  assistantId: string;
  version: number;
  config: PublicationConfig;
  createdAt: string;
}

export interface KnowledgeCollection {
  id: string;
  assistantId: string;
  name: string;
  description: string;
  createdAt: string;
}

export type SourceKind = "file" | "url" | "text" | "website";
export type SourceStatus = "processing" | "ready" | "error";
export type BackgroundJobKind =
  | "ingest_source"
  | "graph_sync_concept"
  | "draft_improvement_proposal";
export type BackgroundJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface CrawlFinalizeClaim {
  sourceId: string;
  workerId: string;
  now: string;
  staleBefore: string;
}

export interface CrawlFinalizeBatchClaim {
  workerId: string;
  now: string;
  staleBefore: string;
  limit: number;
}

export interface DueRecrawlClaim {
  now: string;
  limit: number;
}

/** How often a website source re-crawls itself. "never" = manual only. */
export type RecrawlSchedule = "daily" | "weekly" | "monthly" | "never";

/** Crawler choice configured by an org admin for a Website Source. */
export type WebsiteCrawlerProvider = "auto" | "local" | "apify" | "crawl4ai";

/** Concrete crawler selected for one in-flight or completed crawl. */
export type ResolvedWebsiteCrawlerProvider = Exclude<
  WebsiteCrawlerProvider,
  "auto"
>;

/** Crawl configuration stored on website sources (edit + re-crawl). */
export interface WebsiteSourceConfig {
  url?: string;
  maxPages?: number;
  includeGlobs?: string[];
  excludeGlobs?: string[];
  fetchFiles?: boolean;
  throttle?: boolean;
  pageTimeoutSecs?: number;
  waitSecs?: number;
  loginProtected?: boolean;
  /** Missing on legacy Sources; absence has the same meaning as "auto". */
  crawlerProvider?: WebsiteCrawlerProvider;
  /** Provider chosen when the current/most-recent crawl started. */
  resolvedCrawlerProvider?: ResolvedWebsiteCrawlerProvider;
  /**
   * Provider-specific run state. Poll/finalize reads it together with the
   * resolved provider and ingests the result once the crawl succeeds.
   */
  crawlRunId?: string;
  crawlDatasetId?: string;
  /**
   * When the current/most-recent crawl started, so finalization can record the
   * crawl's wall-clock duration as telemetry. Absent on legacy runs.
   */
  crawlStartedAt?: string;
  /**
   * Set once a thin Local crawl has been escalated to a browser provider, so
   * the escalation happens at most once per crawl (no re-escalation loop). A
   * fresh manual/scheduled crawl clears it.
   */
  crawlEscalated?: boolean;
  /**
   * Why the last crawl attempt did not start, when it was refused rather than
   * failed — today only a spent scraping allowance (#510). Cleared the moment a
   * run starts. Deliberately separate from `error`: a refusal leaves the Source
   * on its previous status, because knowledge that already works must not be
   * downgraded by a budget.
   */
  crawlBlockedReason?: string;
}

export interface Source {
  id: string;
  collectionId: string;
  name: string;
  kind: SourceKind;
  status: SourceStatus;
  error: string;
  config: WebsiteSourceConfig;
  /** Re-crawl cadence (website sources only); "never" for other kinds. */
  recrawlSchedule: RecrawlSchedule;
  /** Last successful crawl completion; null until a crawl finishes. */
  lastCrawledAt: string | null;
  /**
   * Object-storage key of the uploaded original file (file sources only);
   * null for pasted text, URLs, websites, and files uploaded before originals
   * were retained. Its presence is what enables re-processing from source.
   */
  originalObjectPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackgroundJob {
  id: string;
  kind: BackgroundJobKind;
  sourceId: string | null;
  status: BackgroundJobStatus;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  error: string;
  createdAt: string;
  updatedAt: string;
}

/** Report exports generated off the request path (ADR-0010). */
export type ExportJobKind = "insights_overview";
export type ExportJobStatus = "queued" | "running" | "done" | "error";
export type ExportJobFormat = "csv";

export interface ExportJob {
  id: string;
  organizationId: string;
  kind: ExportJobKind;
  status: ExportJobStatus;
  format: ExportJobFormat;
  /** Filter snapshot the worker replays against the reporting layer. */
  params: Record<string, unknown>;
  /** Object-storage path once generated; null until done. */
  storagePath: string | null;
  error: string;
  attempts: number;
  maxAttempts: number;
  lockedAt: string | null;
  lockedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * OKF v0.2 frontmatter — `type` is the only required field. The vocabulary and
 * its consumer derivations (trust tier, staleness, the `generated.at` →
 * legacy-`timestamp` fallback) live in `okf.ts`; re-exported here so the
 * Concept shape stays part of the one domain-type surface.
 */
export type { ConceptFrontmatter } from "./okf";

/** One OKF concept document inside a Knowledge Collection. */
export interface Concept {
  id: string;
  collectionId: string;
  sourceId: string | null;
  path: string;
  frontmatter: ConceptFrontmatter;
  body: string;
  /** Excluded pages keep the document but leave the search index. */
  excluded: boolean;
  /**
   * Per-page re-crawl override; null = inherit the website source's
   * site-level schedule. See `effectivePageSchedule`.
   */
  recrawlSchedule: RecrawlSchedule | null;
  createdAt: string;
}

export interface KnowledgeSearchResult {
  conceptId: string;
  conceptTitle: string;
  conceptPath: string;
  collectionId: string;
  collectionName: string;
  sourceName: string | null;
  /** The concept's original page/document URL (OKF `resource`), when known. */
  resourceUrl: string | null;
  content: string;
  /**
   * Cosine similarity in [0,1] — but ONLY when `engine` is `vector`. The graph
   * engine has no relevance score to report, so it fills this with a
   * rank-descending placeholder purely to keep ordering stable. Anything that
   * compares this against a threshold must check `engine` first.
   */
  similarity: number;
  /**
   * Which retrieval engine produced this result. Absent is read as `vector`
   * (the pgvector path never had to say so). Carried on the result rather than
   * threaded through call sites so that `similarity` is never interpreted
   * without the context that makes it meaningful.
   */
  engine?: KnowledgeEngine;
}

export type ConversationSubject = "member" | "visitor";

/** Best-effort session context captured when a conversation starts. */
export interface ConversationMetadata {
  userName?: string;
  userEmail?: string;
  userRole?: string;
  launchUrl?: string;
  ip?: string;
  os?: string;
  browser?: string;
  language?: string;
  /** ISO country code, e.g. "IT". */
  location?: string;
  city?: string;
  /** Viewport size captured at launch, e.g. "1470x923". */
  resolution?: string;
  escalated?: boolean;
  /** Free-text feedback sent from the chat's "Send feedback" action. */
  feedbackText?: string;
  feedbackAt?: string;

  /**
   * The reference platform's remaining Conversation fields (#561). Each is
   * carried here because the Inbox export is a 29-field shape a parser written
   * against the reference's own file must read unchanged — a field the producing
   * feature has not shipped yet exports as an empty string, which is exactly what
   * the reference does for a tenant that does not use it.
   *
   * `courseId` / `courseName` / `studentId` wait on the LMS integration (root
   * CLAUDE.md §11); `csat*` waits on the satisfaction survey. The escalation and
   * external-user-data fields are written by features that do exist.
   */
  /** LMS course the Conversation was launched inside. */
  courseId?: string;
  courseName?: string;
  /** Institution-issued learner id, from the LMS launch or the IdP profile. */
  studentId?: string;
  /** End-of-chat satisfaction survey: 1–5 and its optional comment. */
  csatScore?: number;
  csatComment?: string;
  /** Which help desk, and which of its channels, an escalation went to. */
  escalationHelpDesk?: string;
  escalationOption?: string;
  /** Imported per-user fields exposed as personalization variables. */
  externalUserData?: Record<string, string>;
  /** Where those fields came from (CSV upload name, LMS, integration). */
  externalUserDataSourceNames?: string[];
}

export interface Conversation {
  id: string;
  assistantId: string;
  subjectType: ConversationSubject;
  subjectId: string;
  collectionId: string | null;
  title: string;
  metadata: ConversationMetadata;
  /**
   * Persistent cross-turn session state (tau-style sessions): a JSON bag the
   * runtime's tools read at the start of a turn and write back after it —
   * e.g. the `remember` tool's session memory. Never rendered directly.
   */
  sessionState: Record<string, unknown>;
  /** Pinned conversations stay in the History panel beyond the recency cap. */
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Conversation enriched for the org-wide Inbox (joins done db-side). */
export interface InboxConversation extends Conversation {
  assistantTitle: string;
  collectionName: string | null;
  messageCount: number;
  /** Distinct flow names that handled assistant replies. */
  flowNames: string[];
  /**
   * True when the Assistant spoke proactively and the Visitor never replied — a
   * nudge, not a conversation. The Inbox marks it so a queue is not padded with
   * non-conversations, and Insights leaves it out of its counts entirely (#546).
   */
  notificationOnly: boolean;
  /** 1 if any reply was voted up, -1 if any down, 0 otherwise (up wins). */
  feedback: -1 | 0 | 1;
}

/**
 * **Legacy.** Where a Thinking Step sat in the agent loop, back when the runtime
 * emitted a generic phase machine alongside the real tool lifecycle (#560). The
 * runtime no longer produces these — the tool-call rows, the reasoning thoughts
 * and the Simplified-thinking narration carry what the stages stood in for — but
 * traces persisted before the collapse still hold them, so the type survives for
 * read-back and the UI keeps a stage icon for those rows.
 */
export type StepStage = "classify" | "generate" | "search" | "found";

/**
 * One Thinking Step: a single row of the Thinking panel, folded from the
 * runtime's step/thought/tool-* wire events. Lives in the domain rather than
 * the runtime because it is **persisted** with the answer it explains — the
 * Inbox reads it back to show how a reply was reached.
 *
 * Deliberately structured rather than the flat bracketed string the reference
 * platform stores: the chat clients already render this shape, so the Inbox
 * reuses their panel unchanged and the flat string stays an export-time
 * serialization (see docs/audits/reference-agent-trace-parity.md).
 */
export interface TurnStep {
  /** tool-* steps carry the AI-SDK toolCallId; other kinds get a local id. */
  id: string;
  /**
   * - `tool` — one instrumented tool call, with its input, outcome and duration.
   * - `thought` — the model's own reasoning before a tool call (Role-gated).
   * - `notice` — a runtime diagnostic worth telling an operator about (a provider
   *   fallback, an unparseable API response, the flow that matched).
   * - `step` — **legacy**: a row from the retired phase machine (see
   *   {@link StepStage}). Never produced any more; still read back.
   */
  kind: "notice" | "thought" | "tool" | "step";
  label: string;
  /** Registry tool name, for `kind: "tool"`. */
  tool?: string;
  /** Legacy engine stage, for `kind: "step"` — picks that row's icon. */
  stage?: StepStage;
  /** Tool calls run until their tool-end arrives; other kinds are done. */
  status: "running" | "done" | "error";
  /** Model-supplied call arguments (already safe to show — never secrets). */
  input?: Record<string, unknown>;
  /** Outcome summary from the tool-end event ("3 concepts found"). */
  detail?: string;
  /**
   * Structured outcome, for tools whose result is worth showing as labelled rows
   * rather than a one-line summary — an API call's endpoint, method, status and
   * response body, say. `detail` stays the one-liner; this is what the transcript
   * expands into.
   *
   * Only ever what the runtime deemed safe to show: capped and redacted on write
   * like every other stored string (see TRACE_MAX_RESULT_CHARS).
   */
  result?: Record<string, unknown>;
  durationMs?: number;
  /**
   * Which agent-loop iteration this tool call spent, out of the turn's budget.
   * The transcript shows it so an operator can see a turn that ran out of room
   * rather than one that chose to stop.
   */
  iteration?: number;
}

/**
 * How the agent loop declared it was done (#558): `answer` = write the answer,
 * `needs_clarification` = ask one focused question, `insufficient_information`
 * = admit the knowledge base does not answer it. Declared by the mandatory
 * terminal tool, never inferred.
 */
export type TurnTerminalStatus =
  | "answer"
  | "needs_clarification"
  | "insufficient_information";

/**
 * A persisted turn trace: the Thinking Steps plus the counters the panel header
 * needs, and a truncation flag so a clipped trace reads as clipped rather than
 * as a turn that did less work than it did.
 */
export interface StoredTurnTrace {
  steps: TurnStep[];
  /** Knowledge searches run this turn (the ×N pill). */
  searchCount: number;
  /** True when caps dropped steps or clipped text (see TRACE_* limits). */
  truncated?: boolean;
  /**
   * Agent-loop iterations the turn spent, out of {@link iterationLimit} (#574).
   * Both absent on traces persisted before they were recorded, and on turns
   * that ran without a budget (the deterministic no-model path) — the panel
   * shows `iteration N/M` only when it knows both.
   */
  iteration?: number;
  iterationLimit?: number;
  /**
   * The terminal status the loop declared. Absent on pre-#574 traces; the
   * Inbox shows it as a badge every Role that can read the Inbox sees.
   */
  terminal?: TurnTerminalStatus;
}

/**
 * Trace storage caps. Reasoning text is unbounded by nature — a single turn in
 * the reference export ran to 108k characters — and a Conversation holds many
 * turns, so the trace is clipped on write, never on read.
 */
export const TRACE_MAX_STEPS = 60;
/** Per-step text cap; a thought's whole body is its label. */
export const TRACE_MAX_LABEL_CHARS = 4_000;
/** Per-step cap for the tool outcome summary. */
export const TRACE_MAX_DETAIL_CHARS = 2_000;
/** Serialized cap for one step's model-supplied tool input. */
export const TRACE_MAX_INPUT_CHARS = 2_000;
/**
 * Serialized cap for one step's structured result. Deliberately larger than the
 * summary and input caps: a result worth showing as labelled rows is a response
 * body, and 2k would clip every one of them into uselessness. Deliberately still
 * a cap: response bodies carry more personal data than any other field on a
 * trace — the reference platform's own API payloads contain student names and
 * quiz grades verbatim — so this is the field that makes per-Organization trace
 * retention matter rather than a nice-to-have.
 */
export const TRACE_MAX_RESULT_CHARS = 8_000;

/**
 * Longest Simplified-thinking narration line (#560) — a sentence, not a
 * paragraph. Here rather than in the runtime because two places must agree on it:
 * the tool wrapper that clips the line, and the gather prompt that tells the model
 * the limit. A drift between those two shows up as narration the Visitor sees cut
 * mid-word, which is exactly the kind of mismatch a shared constant prevents.
 */
export const PROGRESS_MAX_CHARS = 200;

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  /** Reply parts for assistant messages, [{type:'text', text}] for user ones. */
  content: unknown[];
  flowId: string | null;
  flowName: string | null;
  feedback: -1 | 0 | 1;
  /**
   * How this answer was reached — Thinking Steps captured as the turn streamed.
   * Null for user messages, for verbatim turns that did no agentic work
   * (a `custom_message` Flow Action, a proactive Notification), and for every
   * message written before traces were persisted.
   */
  trace: StoredTurnTrace | null;
  createdAt: string;
}

/** Message trimmed to what org-wide analytics (Insights) needs. */
export interface InsightsMessage {
  conversationId: string;
  role: "user" | "assistant";
  feedback: -1 | 0 | 1;
  createdAt: string;
  /**
   * True for a proactive Notification — an Assistant message nobody asked for.
   * Counted separately from AI answers, and a Conversation made only of these is
   * not counted as a Conversation at all (#546).
   */
  proactive?: boolean;
}

/** Crawled website source resolved org-wide (the Insights "Channels" filter). */
export interface OrgWebsiteSource {
  id: string;
  assistantId: string;
  name: string;
  url: string;
}

/** Time-series bucket granularity for the Insights chart. */
export type ChartAggregate = "daily" | "weekly" | "monthly";
export type InsightsAggregate = ChartAggregate;

/** The conversation-level filter fields (a subset of the UI Filters). */
export interface ConversationFilter {
  /** Local yyyy-mm-dd, inclusive; empty string means unbounded. */
  from: string;
  to: string;
  assistantId: string;
  /** Hostname of the crawled website the widget launched from. */
  channel: string;
  role: string;
  feedback: "" | "up" | "down";
  escalation: "" | "escalated" | "not_escalated";
}

/** The only filter input the Insights read model accepts. */
export interface InsightsFilter {
  from: string;
  to: string;
  aggregate: InsightsAggregate;
  assistantId: string;
  channel: string;
  role: string;
  feedback: "" | "up" | "down";
  escalation: "" | "escalated" | "not_escalated";
}

/** Overview KPI cards. */
export interface InsightsStats {
  total: number;
  escalated: number;
  /** Null when there are no conversations to rate. */
  resolutionRate: number | null;
  positive: number;
  negative: number;
  answerRating: number;
  aiAnswers: number;
  /** Proactive Notifications delivered — never folded into `aiAnswers` (#546). */
  notifications: number;
  userMessages: number;
  uniqueUsers: number;
  conversationsPerUser: number;
  answersPerConversation: number;
  /** [language, count], descending by count. */
  languages: Array<[string, number]>;
}

/** One named time-series in the Insights chart. */
export interface ChartMetric {
  key: string;
  values: number[];
}

export interface InsightsChartData {
  labels: string[];
  series: ChartMetric[];
}

/** One stacked group in a usage breakdown chart (by assistant, channel, …). */
export interface BreakdownSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
  total: number;
  /** Share of the grand total across the whole range, 0–100. */
  percent: number;
}

export interface BreakdownChart {
  labels: string[];
  series: BreakdownSeries[];
}

/** Bounded data rendered by Insights — never raw Conversations or Messages. */
export interface InsightsOverview {
  stats: InsightsStats;
  chart: InsightsChartData;
  assistantBreakdown: BreakdownChart;
  channelBreakdown: BreakdownChart;
  options: {
    roles: string[];
    channels: Array<{ value: string; label: string }>;
  };
}

export type ImprovementStatus =
  | "to_do"
  | "in_progress"
  | "in_review"
  | "done"
  | "archived";

export type ImprovementPriority = "high" | "medium" | "low" | "none";

/**
 * An AI-answer-quality tracker item (the Improvements Kanban). Created from the
 * Inbox "Improve Answer" action and linked to the flagged assistant message(s).
 */
export interface Improvement {
  id: string;
  organizationId: string;
  /** Per-org sequential number; the human key is `IMP-${seq}`. */
  seq: number;
  title: string;
  description: string;
  status: ImprovementStatus;
  priority: ImprovementPriority;
  /** Up to 5 free-text labels. */
  tags: string[];
  /** Auth user id of the assigned member, or null. */
  assigneeId: string | null;
  /** Due date as yyyy-mm-dd, or null. */
  dueDate: string | null;
  /** Auth user id of whoever created the item, or null. */
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Improvement enriched for the Kanban board (associated-message count). */
export interface ImprovementListItem extends Improvement {
  messageCount: number;
}

export type ImprovementProposalStatus = "draft" | "accepted" | "dismissed";

/** A Concept the drafter drew on, kept for the Concept → Source provenance the
 * reviewer sees (and the accepted FAQ can cite). */
export interface ImprovementProposalSource {
  conceptId: string;
  conceptTitle: string;
  sourceName: string | null;
}

/** The drafted Suggested Fix content (one structured-output LLM call). */
export interface ImprovementProposalPayload {
  /** Draft FAQ question — becomes the Concept title on accept. */
  draftQuestion: string;
  /** Draft FAQ answer — becomes the Concept body on accept. */
  draftAnswer: string;
  /** Why this fix, shown to the reviewer (never persisted into the Concept). */
  rationale: string;
  /** Knowledge the draft drew on (provenance for the reviewer). */
  sources: ImprovementProposalSource[];
  /** The model that drafted it (audit). */
  model: string;
  /** Where accepting writes the FAQ Concept — the flagged answer's assistant
   * and Collection (Collection null when the conversation was unanchored). */
  targetAssistantId: string;
  targetCollectionId: string | null;
}

/**
 * A **Suggested Fix** (ADR-0017): a drafted, human-approved knowledge
 * improvement attached to one Improvement. Accepting it writes a real FAQ
 * Concept; the loop never auto-edits a tenant's knowledge.
 */
export interface ImprovementProposal {
  id: string;
  organizationId: string;
  improvementId: string;
  status: ImprovementProposalStatus;
  payload: ImprovementProposalPayload;
  /** Reason captured on dismiss. */
  dismissReason: string;
  /** The FAQ Concept created on accept, or null. */
  acceptedConceptId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A flagged answer associated with an improvement, with its conversation context. */
export interface ImprovementAssociation {
  /** improvement_messages row id — used to unlink. */
  linkId: string;
  messageId: string;
  conversationId: string;
  /** The flagged assistant message. */
  message: StoredMessage;
  /** The conversation transcript (short in practice) for the mini view. */
  transcript: StoredMessage[];
  /** Conversation enriched with session / escalation / assistant context. */
  conversation: InboxConversation;
}

/** Which improvement (if any) a message is linked to — powers the Inbox chip. */
export interface ImprovementMessageLink {
  messageId: string;
  improvementId: string;
  seq: number;
  title: string;
}

export type ImprovementPatch = Partial<
  Pick<
    Improvement,
    | "title"
    | "description"
    | "status"
    | "priority"
    | "tags"
    | "assigneeId"
    | "dueDate"
  >
>;

export type AlertType =
  | "integration"
  | "crawl"
  | "provider"
  | "ingestion"
  | "system";

export type AlertStatus = "active" | "resolved";

/**
 * An operational-health issue raised by the system (e.g. a failing website
 * crawl or integration credentials that stopped working). Persists until an
 * admin resolves it or the underlying issue clears (auto-resolve).
 */
export interface Alert {
  id: string;
  organizationId: string;
  type: AlertType;
  title: string;
  detail: string;
  status: AlertStatus;
  /** Dedup key for system-raised alerts (e.g. "website-source:<id>"). */
  sourceKey: string | null;
  detectedAt: string;
  resolvedAt: string | null;
  /** Auth user id for manual resolves; null when auto-resolved. */
  resolvedBy: string | null;
}

/**
 * Which runtime stage a metered model call belongs to: `classify` (intent
 * router), `generate` (agent loop), `embed` (query + ingestion embeddings),
 * `enrich` (OKF enrichment during ingestion), and the scheduled loops
 * (verify / goal_eval / compost / improvement_proposal). `graph_search` and
 * `graph_cognify` are the graph worker's internal LLM calls (search-time
 * completion/guidance vs. graph-building cognify/distillation), reported by
 * the worker and metered by the runtime (ADR-0017).
 */
export type AiUsageStage =
  | "classify"
  | "generate"
  | "embed"
  | "enrich"
  | "verify"
  | "goal_eval"
  | "compost"
  | "improvement_proposal"
  | "graph_search"
  | "graph_cognify";

/**
 * Which credential answered a metered model call — the platform env key
 * (platform-funded), the org's own API key (BYOK), a federated cloud
 * credential, or a member's local CLI subscription (Preview only). This is
 * the signal usage enforcement uses to treat funded and customer traffic
 * differently: funded traffic can be capped, BYOK is never blocked.
 */
export type AiCredentialKind =
  | "platform"
  | "api_key"
  | "google_vertex_federated"
  | "local_subscription";

/** Max standing goals per assistant — bounds the scheduled runner's cost. */
export const ASSISTANT_GOAL_CAP = 20;

/** Runs kept per goal in the ledger — enough for flakiness triage, bounded growth. */
export const GOAL_RUN_RETENTION = 50;

/** Tier transitions kept per Flow in the demotion-history ledger — bounded like goal runs. */
export const FLOW_TRUST_EVENT_RETENTION = 200;

export type GoalStatus = "active" | "quarantined";

/**
 * Machine-checkable expectations for a standing goal. "The answer is not the
 * fallback apology" is always checked and not stored. Deterministic by
 * design: if a pure function couldn't check it, it isn't a goal expectation.
 */
export interface GoalExpectations {
  /** The answer must cite at least one Source. */
  mustCiteSources?: boolean;
  /** A cited Source URL must contain this substring. */
  expectedSourceUrl?: string;
  /** The answer text must contain each fragment (case-insensitive). */
  mustContain?: string[];
}

/**
 * A standing goal: an admin-authored golden question re-verified on a
 * schedule. Nothing that passed once goes unwatched.
 */
export interface AssistantGoal {
  id: string;
  organizationId: string;
  assistantId: string;
  question: string;
  status: GoalStatus;
  expectations: GoalExpectations;
  lastRunAt: string | null;
  lastResult: "pass" | "fail" | null;
  lastDetail: string | null;
  createdAt: string;
}

/** An assistant answer awaiting independent verification. */
export interface VerifiableAnswer {
  messageId: string;
  conversationId: string;
  assistantId: string;
  organizationId: string;
  flowId: string | null;
  flowName: string | null;
  /** The persisted reply parts (the runtime's ChatReplyPart[]). */
  content: unknown[];
  /** The user question that prompted this answer, when recoverable. */
  question: string | null;
  createdAt: string;
}

/** A stored verifier judgment, as read for the Inbox transcript. */
export interface AnswerVerdict {
  messageId: string;
  verdict: "pass" | "fail";
  reason: string;
  createdAt: string;
}

/** The independent verifier's one-line judgment on a message. */
export interface AnswerVerdictInput {
  messageId: string;
  organizationId: string;
  assistantId: string | null;
  flowId: string | null;
  verdict: "pass" | "fail";
  reason: string;
  modelId: string;
}

/** Earned autonomy tier for a (Assistant, Flow) pair. */
export type TrustTier = "auto" | "queue" | "watch";

/** Materialized rolling pass rate for one Flow of one Assistant. */
export interface FlowTrust {
  assistantId: string;
  flowId: string;
  organizationId: string;
  runs: number;
  passes: number;
  tier: TrustTier;
  previousTier: TrustTier | null;
  computedAt: string;
}

/** One recorded tier transition for a (Assistant, Flow) pair (demotion history). */
export interface FlowTrustEvent {
  organizationId: string;
  assistantId: string;
  flowId: string;
  /** The tier being left; null when the pair first entered the ledger. */
  fromTier: TrustTier | null;
  toTier: TrustTier;
  runs: number;
  passes: number;
  createdAt: string;
}

/** One graded signal feeding the trust ledger (verdict or explicit feedback). */
export interface TrustSignal {
  organizationId: string;
  assistantId: string;
  flowId: string;
  messageId: string;
  pass: boolean;
  reason: string;
  createdAt: string;
}

/** An assistant due for a weekly compost pass. */
export interface DueCompostAssistant {
  assistantId: string;
  organizationId: string;
  lastRunAt: string | null;
}

/**
 * One assistant's week of exhaust, digested for the compost pass. Every
 * input is optional by construction — absent features contribute empty
 * lists and the loop still works.
 */
export interface CompostDigest {
  failedVerdicts: {
    messageId: string;
    conversationId: string;
    reason: string;
  }[];
  thumbsDown: { messageId: string; conversationId: string; text: string }[];
  escalatedConversations: number;
  refusals: number;
  goalViolations: { question: string; detail: string }[];
  demotedFlows: { flowId: string; runs: number; passes: number }[];
}

/** What happens when an Organization crosses its daily token budget. */
export type BudgetEnforcement = "notify" | "block";

/**
 * Per-Organization daily AI budget; null limit = unmetered. The token and
 * euro limits are independent caps — either one crossing today's usage trips
 * `enforcement`. The euro figure is an estimate from `pricing.ts`, not a
 * billed amount.
 */
export interface OrgBudget {
  organizationId: string;
  dailyTokenLimit: number | null;
  dailyEuroLimit: number | null;
  enforcement: BudgetEnforcement;
}

/** One AI usage ledger row: a single model call, fully attributed. */
export interface AiUsageInput {
  organizationId: string;
  assistantId: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  stage: AiUsageStage;
  /** The provider/model that actually ran (post cross-provider fallback). */
  provider: Provider;
  modelId: string;
  /** Which credential answered (platform-funded vs BYOK etc.); null when unknown. */
  credentialKind?: AiCredentialKind | null;
  inputTokens: number;
  outputTokens: number;
}

/**
 * How a metered unit of work is recorded in the usage rollup: an LLM chat call,
 * an embedding call, or a completed website crawl (whose unit is pages, not
 * tokens). This is the STORAGE vocabulary; `UsageResource` is the plan-facing
 * one, and `chat` maps to the `ai` resource.
 */
export type UsageKind = "chat" | "embedding" | "crawl";

/**
 * The three kinds of work the platform pays for, and therefore the three things
 * a plan allowance is expressed in: `ai` (routing, answers, verification and
 * scheduled AI work), `embedding` (knowledge indexing and query vectors), and
 * `scraping` (pages fetched by a website crawler). Disjoint by construction —
 * every metered unit belongs to exactly one — so the three can be capped and
 * displayed independently: a crawl budget must never stop answering.
 */
export type UsageResource = "ai" | "embedding" | "scraping";

/** Every metered resource, for iterating the three meters in a stable order. */
export const USAGE_RESOURCES: readonly UsageResource[] = [
  "ai",
  "embedding",
  "scraping",
];

/**
 * The plan-facing resource a stored usage kind belongs to — the one mapping
 * between the two vocabularies. `chat` is `ai` because routing, answering and
 * scheduled AI work are one allowance; the SQL rollup carries the same mapping.
 */
export function usageResourceOf(kind: UsageKind): UsageResource {
  if (kind === "embedding") return "embedding";
  if (kind === "crawl") return "scraping";
  return "ai";
}

/**
 * One org-facing usage aggregate: an org's calls and tokens for one UTC day,
 * split by call kind and by the credential that answered. Closed days come
 * from the usage_daily rollup (maintained by the rollup-usage cron); today is
 * aggregated live from the raw ledger.
 */
export interface UsageDailyRow {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  kind: UsageKind;
  /** 'unknown' buckets ledger rows recorded before credential metering landed. */
  credentialKind: AiCredentialKind | "unknown";
  /**
   * What actually ran: an LLM provider for chat/embedding rows, the resolved
   * crawler for crawl rows. Part of the grain because credits are estimated
   * cost, which cannot be recovered from a model-blind aggregate.
   */
  provider: string;
  /** The model that ran; empty on a crawl row, which has none. */
  modelId: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Metered units that are not tokens — crawled pages. Zero for model calls. */
  units: number;
}

/**
 * One organization's usage over an arbitrary window, grouped finely enough to
 * price in credits: per metered resource, per funding credential, per
 * provider/model. The window need not align to UTC days — plan windows run from
 * a billing anchor — so the read takes whole closed days from the rollup and the
 * partial ends live from the raw sources.
 */
export interface UsageMeterRow {
  resource: UsageResource;
  credentialKind: AiCredentialKind | "unknown";
  provider: string;
  modelId: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Crawled pages on a scraping row; zero for model calls. */
  units: number;
}

/**
 * Runtime telemetry (ADR-0011): the structured, privacy-safe event vocabulary
 * for the `runtime_events` sink. The Conversation Turn is the first writer
 * (`chat_turn`); the rest reserve the ADR's event set for scheduled work so
 * later writers meter into the same table without a schema change.
 */
export type RuntimeEventKind =
  | "chat_turn"
  | "llm_step"
  | "tool_call"
  | "retrieval"
  | "ingest_job"
  | "cron_sweep"
  | "crawl";

export type RuntimeEventStatus = "started" | "succeeded" | "failed";

/** Which traffic surface produced a chat-turn event. */
export type RuntimeEventSurface = "preview" | "widget";

/**
 * One runtime telemetry event: an attributed record of a runtime boundary
 * (latency, tokens, tool calls, error outcome). Never carries prompts, message
 * text, retrieved chunks, model outputs, keys or personal contact data.
 * Written post-commit; a telemetry failure never breaks a user-visible turn.
 */
export interface RuntimeEventInput {
  organizationId: string;
  assistantId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  kind: RuntimeEventKind;
  status: RuntimeEventStatus;
  surface?: RuntimeEventSurface | null;
  /** The provider/model that actually ran (post cross-provider fallback). */
  provider?: Provider | null;
  modelId?: string | null;
  credentialKind?: string | null;
  flowId?: string | null;
  flowName?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number | null;
  toolCalls?: number;
  retrievalCount?: number;
  /** The crawler that ran a `crawl` event (resolved provider); null otherwise. */
  crawlerProvider?: ResolvedWebsiteCrawlerProvider | null;
  /** Usable pages a `crawl` event ingested; null for non-crawl events. */
  pageCount?: number | null;
  errorClass?: string | null;
  errorMessage?: string | null;
  traceId?: string | null;
  spanId?: string | null;
}

export interface Flow {
  id: string;
  assistantId: string;
  name: string;
  description: string;
  builtIn: boolean;
  enabled: boolean;
  position: number;
  trigger: FlowTrigger;
  /** Trigger-scoped configuration (the Time-on-page dwell). */
  triggerSettings: FlowTriggerSettings;
  conditionLogic: FlowConditionLogic;
  conditions: FlowCondition[];
  actions: FlowAction[];
  actionSettings: FlowActionSettings;
  /** Message sent by the custom_message action. */
  customMessage: string;
  isDefault: boolean;
}

export interface AssistantInput {
  title: string;
  nickname?: string;
  description?: string;
}

export type AssistantPatch = Partial<
  Pick<
    Assistant,
    | "title"
    | "nickname"
    | "description"
    | "avatarUrl"
    | "welcomeMessage"
    | "aiDisclaimer"
    | "suggestedQuestions"
    | "quickReplies"
    | "answeringStyle"
    | "simplifiedThinking"
    | "chatLauncherEnabled"
    | "modelProvider"
    | "modelId"
    | "style"
    | "allowedDomains"
    | "helpDeskSettings"
    | "tools"
    | "requireSignIn"
    | "knowledgeEngine"
  >
>;

export interface FlowInput {
  name: string;
  description?: string;
  trigger?: FlowTrigger;
  triggerSettings?: FlowTriggerSettings;
  conditionLogic?: FlowConditionLogic;
  conditions?: FlowCondition[];
  actions?: FlowAction[];
  actionSettings?: FlowActionSettings;
  customMessage?: string;
}

export type FlowPatch = Partial<
  Pick<
    Flow,
    | "name"
    | "description"
    | "enabled"
    | "trigger"
    | "triggerSettings"
    | "conditionLogic"
    | "conditions"
    | "actions"
    | "actionSettings"
    | "customMessage"
  >
>;

export interface CurrentOrg {
  organization: Organization;
  role: Role;
}
