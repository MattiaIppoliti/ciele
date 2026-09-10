import type { TriageEvidence } from "./document-triage";
/**
 * The domain vocabulary: every noun in `CONTEXT.md`, as a type.
 *
 * Pure type declarations with **no data-access concept in them**: no `Db`, no
 * Supabase, no I/O. That separation is the point of this package (ADR-0019).
 * `@agent-hub/db` declares the `Db` interface over these types and depends on
 * this package; nothing here may depend on it, or on any adapter.
 *
 * Keep the names the ones `CONTEXT.md` fixes, Organization, Assistant, Member,
 * Role, Knowledge Collection, Source, Concept, Publication, Widget, Visitor,
 * Conversation, Flow, Flow Action, Provider Connection, and add a term there
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
   * greeting, a thanks or a farewell, a message that carries no information
   * need, so searching the knowledge base for it can only cost latency.
   */
  | "basic_reply"
  /**
   * The proactive-engagement primitive: an unprompted in-widget message. The
   * only action a proactively-triggered Flow may run, and never available to a
   * message-triggered one (see `actionAllowedForTrigger` in `engine.ts`).
   */
  | "notification"
  /**
   * One catalogued operation against a connected external system (spec #836,
   * #839): a ServiceNow record, a Salesforce query, a Slack message. Runs
   * through an Application Connection the Organization already holds; the
   * action settings name the connection and the catalogue key, never a
   * credential, so a Publication snapshot carries none.
   */
  | "connector"
  /**
   * The approval gate (spec #836, #841): the turn stops, named Members are
   * asked by email or Slack, and the Flow's remaining actions run only after
   * the first of them approves. Linear, not a branch: rejected or expired
   * halts with a configured message.
   */
  | "human_review"
  /**
   * The callback gate (#842): subscribe to an external system, stop the turn,
   * and continue when that system calls back. The same shape as
   * `human_review` with a machine in the middle instead of a person, which is
   * why it reuses the gate's cursor-and-resume machinery rather than a second
   * copy of it.
   */
  | "http_webhook"
  /**
   * The reply to an inbound HTTP request (#843): status code, headers, body.
   * Only meaningful on the `http_request` trigger, because it answers the
   * caller that trigger has waiting, and it ends the Flow, since nothing after
   * it can change what that caller was told.
   */
  | "respond";

/** How a Human review reaches its assignees. */
export type ReviewChannel = "email" | "slack";

/**
 * The Inputs an assignee fills on the decision page. A subset of the Help Desk
 * form builder's field types: the four an approval actually needs, and every
 * one of them renders as a plain control with no upload or lookup behind it.
 */
export type ReviewInputType = "short_text" | "long_text" | "dropdown" | "yes_no";

export interface ReviewInputField {
  id: string;
  label: string;
  type: ReviewInputType;
  required?: boolean;
  placeholder?: string;
  /** Dropdown choices. */
  options?: string[];
}

export interface HumanReviewSettings {
  title?: string;
  /** What the assignee reads under the title; supports template variables. */
  message?: string;
  /** Member email addresses; resolved against the roster at Publish. */
  assignees?: string[];
  channel?: ReviewChannel;
  /** The Editor's own Microsoft 365 mail Connection the request is sent from. */
  senderConnectionId?: string;
  /** Slack channel id or user id the request is posted to. */
  slackTarget?: string;
  inputs?: ReviewInputField[];
  /** Hours until an undecided request expires. Default 24. */
  timeoutHours?: number;
  /** What the Visitor reads when the request is rejected or expires. */
  haltMessage?: string;
  /** What the Visitor reads while the request waits. */
  waitingMessage?: string;
}

export type ReviewStatus = "pending" | "approved" | "rejected" | "expired";
export type ReviewDecision = "approved" | "rejected";

/**
 * One approval request a Human review action raised. The row is the gate's
 * state: the runtime creates it `pending`, a Member's decision or the expiry
 * sweep closes it exactly once, and the resumption job reads the cursor
 * (`actionIndex`) to continue the Flow after the gate.
 */
export interface ReviewRequest {
  id: string;
  organizationId: string;
  assistantId: string;
  conversationId: string;
  flowId: string;
  /** Index of the `human_review` action in the Flow; resumption starts after it. */
  actionIndex: number;
  status: ReviewStatus;
  title: string;
  message: string;
  /** What the assignee reads about the conversation so far. */
  summary: string;
  channel: ReviewChannel;
  /** Lower-cased Member emails. */
  assignees: string[];
  inputs: ReviewInputField[];
  /** The assignee's Inputs, keyed by field id. Null until decided. */
  decision: Record<string, string> | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  expiresAt: string;
  /** What the Visitor reads on rejection or expiry. */
  haltMessage: string;
  /** Preview / Teammate turns: nothing was sent, the transcript decides inline. */
  simulated: boolean;
  /** Set once the approval turn (or the halt message) has been persisted. */
  resumedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ReviewRequestInput = Omit<
  ReviewRequest,
  "id" | "status" | "decision" | "decidedBy" | "decidedByName" | "decidedAt" | "resumedAt" | "createdAt" | "updatedAt"
> & { id?: string };

export type ReviewRequestPatch = Partial<
  Pick<ReviewRequest, "status" | "decision" | "decidedBy" | "decidedByName" | "decidedAt" | "resumedAt">
>;

/** One half of an `http_webhook` action's pair of calls. */
export interface WebhookCall {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url?: string;
  /** Template-resolved request body. Not sent for GET. */
  bodyTemplate?: string;
  /**
   * How the call authenticates, the same shape `api_request` uses. Here
   * rather than in the URL or body, because `redactFlowSecrets` knows this
   * slot and blanks it on every read, and a secret typed into the URL would
   * travel into the Publication snapshot and the transcript card in clear.
   */
  auth?: ApiRequestAuth;
  /** Admin-set request headers; values are redacted on read like `api_request`'s. */
  headers?: KeyValuePair[];
  /**
   * Values read from this call's own reply. On the subscribe call they are
   * what the unsubscribe call may interpolate (`{{subscriptionId}}`), because
   * the id the other system hands back is the one thing the unsubscribe needs
   * and the one thing not known before the subscribe has answered.
   */
  jsonPaths?: ApiRequestJsonPath[];
}

/**
 * The `http_webhook` action's settings (#842).
 *
 * Two calls and a wait between them. The subscribe call tells the other system
 * where to call back, which is why `{{webhook.callbackUrl}}` is available to
 * its body and to its query; the unsubscribe call is what stops that system
 * calling an endpoint whose turn ended, and is resolved and stored when the
 * subscription is made so it still fires if the Flow is edited meanwhile.
 */
export interface HttpWebhookSettings {
  subscribe?: WebhookCall;
  unsubscribe?: WebhookCall;
  /** Minutes until an unanswered subscription expires. Default 15, max 1440. */
  timeoutMinutes?: number;
  /** What the Visitor reads while the callback is awaited. */
  waitingMessage?: string;
  /** What the Visitor reads when it expires or the subscribe call fails. */
  haltMessage?: string;
  /**
   * Extracts values from the callback body into `{{variable}}` template
   * variables for the actions after the gate. A blank `path` binds the whole
   * body, the same rule `api_request` uses.
   */
  jsonPaths?: ApiRequestJsonPath[];
}

/** The `respond` action's settings (#843). */
export interface RespondSettings {
  /**
   * HTTP status the caller receives. Required: a Response without one is not
   * configured (`respondSettingsIssue`), and the runtime answers 500 rather
   * than inventing a 200 for a Flow that never said what it meant.
   */
  status?: number;
  /** Response headers; values may carry template variables. */
  headers?: KeyValuePair[];
  /** Response body, template-resolved. Sent as JSON unless a header says otherwise. */
  bodyTemplate?: string;
}

export type WebhookSubscriptionStatus = "pending" | "received" | "expired" | "failed";

/**
 * One awaited callback (#842). The row is the gate's state: created `pending`
 * by the runtime before the subscribe call goes out (the callback URL names
 * it, so it has to exist first), closed exactly once by the first callback or
 * by the expiry sweep, and read back by the resumption job for where to
 * continue (`actionIndex`) and what the caller sent (`payload`).
 */
export interface WebhookSubscription {
  id: string;
  organizationId: string;
  assistantId: string;
  conversationId: string;
  flowId: string;
  /** Index of the `http_webhook` action in the Flow; resumption starts after it. */
  actionIndex: number;
  status: WebhookSubscriptionStatus;
  /** The resolved subscribe call, for the transcript and for diagnosis. */
  subscribeMethod: string;
  subscribeUrl: string;
  /**
   * The resolved unsubscribe call, stored rather than re-read from the Flow:
   * it must still fire when the Flow was edited during the wait, and an
   * unsubscribe pointed at the wrong URL is a subscription nobody stops.
   */
  unsubscribeMethod: string | null;
  unsubscribeUrl: string | null;
  unsubscribeBody: string | null;
  unsubscribedAt: string | null;
  /** The callback body, capped. Null until one arrives. */
  payload: string | null;
  receivedAt: string | null;
  expiresAt: string;
  haltMessage: string;
  /** Preview / Teammate turns: the subscribe call is still made, nothing else differs. */
  simulated: boolean;
  /** Set once the continuation (or the halt message) has been persisted. */
  resumedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WebhookSubscriptionInput = Omit<
  WebhookSubscription,
  | "id"
  | "status"
  | "payload"
  | "receivedAt"
  | "unsubscribedAt"
  | "resumedAt"
  | "createdAt"
  | "updatedAt"
> & { id?: string };

/**
 * One inbound run of an HTTP-triggered Flow (#843). Not a Conversation, by
 * decision: a machine-to-machine call has no Visitor, and a Conversation for
 * it would enter the Inbox and the Insights population ADR-0010 keeps for
 * people. So the record is its own row, read from the trigger's own panel.
 * It keeps what an operator needs to diagnose a silent or failing endpoint,
 * never the request body: that may carry a caller's data and is not ours to
 * archive.
 */
export interface HttpFlowRun {
  id: string;
  organizationId: string;
  assistantId: string;
  flowId: string;
  /** The Publication the Flow was read from. */
  publicationId: string | null;
  method: string;
  /** What the caller was answered. */
  status: number;
  /** Actions that ran, in order. */
  ran: FlowAction[];
  /** The action that threw and its message, when one did. */
  failedAction: string | null;
  failedMessage: string | null;
  durationMs: number;
  createdAt: string;
}

export type HttpFlowRunInput = Omit<HttpFlowRun, "id" | "createdAt"> & { id?: string };

export type WebhookSubscriptionPatch = Partial<
  Pick<
    WebhookSubscription,
    | "status"
    | "payload"
    | "receivedAt"
    | "resumedAt"
    | "unsubscribedAt"
    | "unsubscribeMethod"
    | "unsubscribeUrl"
    | "unsubscribeBody"
  >
>;

/**
 * The Application providers a Connector action can target. The two Drives are
 * Member-owned Connections (ADR-0021) and therefore run only on the operator
 * surfaces (#840); Publish refuses them until an Organization-owned mode exists.
 */
export type ConnectorProvider =
  | "salesforce"
  | "servicenow"
  | "slack"
  | "onedrive"
  | "google_drive";

/**
 * A Connector action's settings. `params` are the catalogued action's fields,
 * template variables allowed; `failureMessage` is what the Visitor reads when
 * the call fails, so a provider error never reaches the chat verbatim.
 */
export interface ConnectorActionSettings {
  provider?: ConnectorProvider;
  connectionId?: string;
  /** A key from the Connector catalogue, e.g. `servicenow.record.create`. */
  action?: string;
  params?: Record<string, string>;
  /** What the Visitor reads after a write succeeds; read actions stay silent. */
  successMessage?: string;
  failureMessage?: string;
}

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
 * "message" drives Intent Classification; the other three are **proactive**,
 * fired by a client event, with no Visitor message to classify. See
 * `isProactiveTrigger` in `engine.ts`.
 */
export type FlowTrigger =
  | "message"
  | "page_load"
  | "time_on_page"
  | "chat_open"
  /**
   * An inbound HTTP request to the Flow's own endpoint (#843). Not a Visitor
   * and not a widget event: another system calls, the Flow runs, and the
   * `respond` action is what the caller reads. The only trigger with a caller
   * waiting on a status code, which is why it is its own kind rather than a
   * fifth proactive one.
   */
  | "http_request";

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
  /**
   * "On HTTP request" (#843). No credential lives here: the endpoint is
   * authorized by an Organization API key, so nothing about this trigger is a
   * secret and a Publication snapshot may carry it whole.
   */
  httpRequest?: {
    /** Methods the endpoint accepts. Empty or unset means POST only. */
    methods?: ("GET" | "POST" | "PUT" | "PATCH" | "DELETE")[];
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
 * reason `ChannelAvailability` stores local opening hours plus a zone, "09:00
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
 * `conversation_context` is **semantic**, evaluated by the classifier (or, with
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

/**
 * The `has*` flags carry "a secret is stored" to a surface that must not receive
 * the secret itself; `redactFlowSecrets` sets them and drops the value. They are
 * derived on read, never persisted.
 */
export type ApiRequestAuth =
  | { type: "none" }
  | { type: "bearer"; token?: string; hasToken?: boolean }
  | { type: "api_key"; header?: string; key?: string; hasKey?: boolean }
  | {
      type: "basic";
      username?: string;
      password?: string;
      hasPassword?: boolean;
    };

/**
 * How often a Notification may reach the same Visitor.
 * - `session` (default): once per Conversation.
 * - `visitor`: once ever, across all of that Visitor's Conversations.
 * - `always`: every time the trigger fires.
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
    /**
     * Where the endpoint comes from (#837). `"url"` is the one typed into the
     * builder. `"swagger"` names an `operationId` in the OpenAPI / Swagger
     * document at `swaggerUrl`, and the method and URL come from there, so an
     * organization that already publishes a spec does not hand-copy a path
     * that the spec states, and does not silently keep calling it once the
     * API moves. Unset means `"url"`, which is what every Flow written before
     * this meant.
     */
    endpoint?: "url" | "swagger";
    /** The OpenAPI / Swagger document, when `endpoint` is `"swagger"`. */
    swaggerUrl?: string;
    /** The operation to invoke, by its `operationId` in that document. */
    operationId?: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url?: string;
    /**
     * How the request authenticates. Secrets live here in the flow's jsonb
     * settings (org-scoped by RLS) and are never returned to the browser once
     * saved, the editor shows a masked placeholder and replaces on edit.
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
  connector?: ConnectorActionSettings;
  human_review?: HumanReviewSettings;
  http_webhook?: HttpWebhookSettings;
  respond?: RespondSettings;
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
   * **verbatim**, like `custom_message`, a Notification never passes through a
   * model.
   */
  notification?: {
    /** Optional heading shown above the content, max 100 chars in the UI. */
    title?: string;
    /** Rich-text body, max 5000 chars in the UI. Required for a valid Flow. */
    content?: string;
    /**
     * How often the same Visitor may receive it. Absent reads as `session`,
     * the safe default, so an announcement cannot re-fire on every page view of
     * a long browsing session.
     */
    deliveryRule?: NotificationDeliveryRule;
    /**
     * Whether the Visitor may answer the nudge. Absent reads as `true`, an
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
  | "remember"
  /**
   * The render catalogue's table (generative UI). Gated here like any other
   * built-in, so it travels in the Publication snapshot and a published widget
   * only renders components the assistant was published with.
   */
  | "renderTable";

/**
 * Per-assistant tool configuration (assistants.tools jsonb).
 *
 * Held one shape smaller than the column: `custom`, one registered HTTP tool
 * per endpoint, was superseded by {@link ApiIntegration} and removed in the
 * contract step of spec #559. A pre-existing row may still carry the key; it is
 * read by nothing and deliberately left in place rather than migrated away,
 * because deleting a self-hoster's stored configuration is not this schema's
 * call to make.
 */
export interface AssistantTools {
  /** Built-in enablement overrides; unset = runtime default. */
  builtIns?: Partial<Record<BuiltInToolName, boolean>>;
  /** Entity schemas selected for generated Record-retrieval tools. */
  entities?: string[];
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
  in?: "path" | "query" | "header";
  required?: boolean;
  /**
   * Server-pinned value. It is hidden from the model and may interpolate
   * `{{identity.subject}}` or `{{identity.claim}}` from a verified SSO turn.
   */
  value?: string;
}

/**
 * One endpoint of an {@link ApiIntegration}'s catalogue: what it is for, the
 * parameters it takes, and the keys a successful response carries. This
 * description is the whole contract the model discovers and reads; it is also
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
 * reaches it through three generic tools, catalogue summary, per-endpoint
 * detail, query, rather than one registered tool per endpoint.
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
 * One recorded cookie-consent decision, our own evidence that a visitor
 * consented (GDPR Art. 7(1)), independent of the `cc_cookie` they hold.
 *
 * Append-only: a withdrawal is a new row with `action: "changed"`, never an
 * edit of the row that granted consent. The history is the evidence.
 *
 * Not org-scoped, anonymous visitors have no organization, and deliberately
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
  /** "all" | "custom" | "necessary", the shape of the choice. */
  acceptType: string;
  /** "granted" on a first decision, "changed" on a later edit or withdrawal. */
  action: string;
  /** Visitor's clock when they chose; untrusted, kept alongside `createdAt`. */
  consentedAt: string | null;
  pageUrl: string;
  userAgent: string;
  /** Our clock when the record was stored, the trusted timestamp. */
  createdAt: string;
}

export type SkillPatch = Partial<Pick<Skill, "name" | "description" | "prompt">>;

/** What the runtime needs of an attached skill (frozen into Publications). */
export type SkillSnapshot = Pick<Skill, "id" | "name" | "description" | "prompt">;

// ---------------------------------------------------------------------------
// Entities + Records: org-level structured business data (#663).

export type EntityAttributeType = "text" | "number" | "date" | "boolean";

export interface EntityAttribute {
  key: string;
  label: string;
  type: EntityAttributeType;
}

export type EntityScope = "shared" | "user";

export interface Entity {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  attributes: EntityAttribute[];
  keyAttribute: string;
  scope: EntityScope;
  identityAttribute: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EntityRecordValue = string | number | boolean | null;

export interface EntityRecord {
  id: string;
  entityId: string;
  key: string;
  values: Record<string, EntityRecordValue>;
  createdAt: string;
  updatedAt: string;
}

export interface EntityInput {
  name: string;
  description?: string;
  attributes: EntityAttribute[];
  keyAttribute: string;
  scope: EntityScope;
  identityAttribute?: string | null;
}

export type EntitySnapshot = Pick<
  Entity,
  "id" | "name" | "description" | "attributes" | "scope" | "identityAttribute"
>;

export interface EntityRecordQuery {
  filters?: Record<string, EntityRecordValue>;
  search?: string;
  limit?: number;
}

export interface EntitySyncConfig {
  entityId: string;
  url: string;
  sealedHeaders: string | null;
  cadenceHours: number;
  prune: boolean;
  mapping: Record<string, string>;
  lastSyncedAt: string | null;
}

export type EntitySyncConfigInput = Omit<
  EntitySyncConfig,
  "entityId" | "lastSyncedAt"
>;

export interface EntitySyncRun {
  id: string;
  entityId: string;
  status: "succeeded" | "failed";
  upserted: number;
  pruned: number;
  rejected: string[];
  error: string | null;
  finishedAt: string;
}

export interface Memory {
  id: string;
  organizationId: string;
  subjectId: string;
  text: string;
  conversationId: string | null;
  createdAt: string;
}

export interface MemorySubjectRef {
  organizationId: string;
  subjectId: string;
}

export const MEMORIES_PER_SUBJECT_CAP = 200;

export interface MemorySearchResult {
  id: string;
  text: string;
  similarity: number;
}

export interface MemorySubjectSummary {
  subjectId: string;
  claimValue: string | null;
  memoryCount: number;
  lastMemoryAt: string;
}

/**
 * Local-connector relay (personal AI subscriptions that stay on a Member's
 * Mac). Server-only tables, no RLS policies; reachable only through a
 * service-role Db. See migration 20260714001000_local_connector_relay.
 */

/** One-time pairing code handed from Preview to the local connector. */
export interface LocalConnectorPairing {
  id: string;
  organizationId: string;
  userId: string;
  /** sha256 of the signed pairing code, the plaintext never touches the DB. */
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
  /** Circular logo shown in the org switcher, same treatment as an
   * Assistant's avatarUrl (data URL, falls back to an initial letter). */
  logoUrl?: string | null;
  /**
   * How many days a message keeps its persisted Turn Trace before the cron
   * sweep strips it (#573). Null (the default) keeps traces forever, an
   * existing tenant's transcripts never start disappearing without an admin
   * opting in. The sweep removes only the trace payload; the message, its
   * content, feedback and timestamps stay.
   */
  traceRetentionDays?: number | null;
  /**
   * How many days a Conversation is kept before the nightly sweep deletes it,
   * transcript and all (#801, CYB-12). Null (the default) keeps them forever.
   * Distinct from {@link traceRetentionDays}, which only strips the Thinking
   * trace and leaves the transcript: this one is the lifecycle the privacy
   * page promises.
   */
  transcriptRetentionDays?: number | null;
  createdAt: string;
}

export interface Member {
  userId: string;
  email: string;
  role: Role;
  /** Profile fields, joined from `profiles`, null until the member (or the
   * signup trigger) has set them. */
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

/** The signed-in caller's own profile, Settings > Profile. */
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
  /** Transcript retention window in days; null = keep forever (#801, CYB-12). */
  transcriptRetentionDays?: number | null;
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
 * A revoked key keeps its row: `revokedAt` set, for audit.
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
 * chat/embeddings API, Ollama, vLLM, LM Studio, a gateway. Used with the
 * `api_key` connection type; the key itself is optional (many local servers
 * ignore it). Embeddings are padded or truncated to the shared 1536.
 */
export interface OpenAiCompatibleConfig {
  kind: "openai_compatible";
  baseUrl: string;
  chatModel: string;
  embeddingModel?: string;
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
  /** AES-256-GCM ciphertext, decrypted only inside the runtime. */
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
 * Widget SSO: the identity provider an organization connects so its
 * assistants can require visitors to sign in before chatting. One connection
 * per organization; assistants opt in via {@link Assistant.requireSignIn}.
 * Entra ID ships first; `clerk`/`workos` are contract-ready but not built.
 */
export type SsoProviderKind = "entra" | "clerk" | "workos";

/** Non-secret Entra config; the client secret is sealed separately. */
export interface EntraSsoConfig {
  clientId: string;
  tenantId: string;
  /** Optional verified token claim used by identity-scoped tools. */
  identityClaim?: string;
}

/** Non-secret, provider-specific connection settings (grows with clerk/workos). */
export type SsoConnectionConfig = EntraSsoConfig;

export type SsoValidationStatus = "unvalidated" | "valid" | "invalid";

/**
 * Organization-level SSO connection. `encryptedSecret` is AES-sealed app-side
 * (see `sealSecret`) and returned only to server-side callers, NEVER to the
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

/** Widget/browser-safe projection, provider kind only, never config or secrets. */
export interface SsoConnectionPublic {
  provider: SsoProviderKind;
}

/** Which viewport corner the launcher (and the opened window) anchors to. */
export type WidgetCorner =
  | "bottom-right"
  | "bottom-left"
  | "top-right"
  | "top-left";

/**
 * Widget appearance, the SETUP Style section (§4.7 of the reference map).
 * Every field is optional: absent means "the shipped default", so an
 * Assistant styled before a field existed renders unchanged. `brandColor` and
 * `position` predate the full section and remain the fallback the specific
 * fields refine (`position` is the legacy bottom-corner pick that `corner`
 * supersedes when set). Icons are small data: URLs (≤200×200 uploads), frozen
 * into the Publication snapshot like every other style fact.
 */
export interface WidgetStyle {
  brandColor?: string;
  position?: "right" | "left";
  /** Background of the chat window's top bar. */
  headerColor?: string;
  /** Bubble color for messages sent by the Visitor. */
  bubbleColor?: string;
  /** FAQ / action buttons throughout the chat. */
  buttonColor?: string;
  /** Launcher icon (data: URL); absent = the chat glyph. */
  launcherIcon?: string;
  /** Keyboard focus outline around the launcher. */
  focusRingColor?: string;
  /** Close icon shown while the window is open (data: URL). */
  closeIcon?: string;
  /** Show the launcher on small screens (default true). */
  showOnMobile?: boolean;
  /** Launcher diameter in px (default 56). */
  buttonSize?: number;
  /** Launcher corner radius in px (default 100 ≈ circle). */
  buttonRadius?: number;
  /** Launcher offset from the anchored vertical edge, px (default 24). */
  paddingBottom?: number;
  /** Launcher offset from the anchored horizontal edge, px (default 24). */
  paddingRight?: number;
  /** Anchoring corner; wins over the legacy `position` when set. */
  corner?: WidgetCorner;
  /** Google font family name (default the embedding page's own font). */
  fontFamily?: string;
  /** Base font size in px (default 14). */
  fontSize?: number;
  /** Opened window size in px (defaults 380×640, viewport-capped). */
  windowWidth?: number;
  windowHeight?: number;
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

export type TicketingPlatform = "servicenow";

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
   * at runtime, it customizes persona/tone/format but can never override
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

/** The narrow Assistant projection needed by global navigation. */
export interface AssistantShellSummary {
  id: string;
  title: string;
  nickname: string;
  brandColor: string | null;
  avatarUrl: string | null;
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
  /** Entity schemas frozen at publish time; Record values remain live. */
  entities?: EntitySnapshot[];
}

export interface Publication {
  id: string;
  assistantId: string;
  version: number;
  config: PublicationConfig;
  createdAt: string;
}

/** Who may see a Teammate on the roster: everyone, or its owner and admins. */
export type TeammateVisibility = "org" | "private";

/**
 * An **AI Teammate** (spec #767): the Assistant's internal sibling. Same chat
 * runtime, same knowledge, same citations, but it answers Members inside the
 * console instead of Visitors on a website, so it has no Publication, no
 * Flows, no widget and no escalation.
 *
 * Everything that makes one distinct is configuration over the runtime: the
 * persona (name + title + Standing Role) becomes a prompt layer, and the
 * Knowledge Scope becomes the set of Collections its search may reach.
 */
export interface Teammate {
  id: string;
  organizationId: string;
  /** What Members call it: the roster card, the chat title, the persona's name. */
  name: string;
  /** Job title under the name ("Support Copywriter"). Empty is allowed. */
  title: string;
  /** The Standing Role, in the organization's own words. */
  roleDescription: string;
  /** Seed for the generated avatar; empty falls back to the id. */
  avatarSeed: string;
  /** The Member who created it. Keeps edit rights even on a private Teammate. */
  ownerId: string;
  /** Members who may edit it besides the owner and the organization's admins. */
  editorIds: string[];
  visibility: TeammateVisibility;
  /**
   * Knowledge Scope, part one: whole Library Collections this Teammate may
   * search. Empty is a real configuration (pure persona), not a missing one, see
   * `teammateSearchesKnowledge` in `teammate.ts`.
   */
  collectionIds: string[];
  /**
   * Knowledge Scope, part two: individual Library **Sources** (a website, an
   * uploaded file, an FAQ, PRD #726) this Teammate may search, whatever
   * Collection they happen to sit in.
   *
   * A second list rather than a polymorphic one, because a Collection and a
   * Source are different nouns and retrieval filters on a different column for
   * each. The two are a **union**: a Teammate scoped to one Collection and two
   * loose files searches all three, and a Source that is already inside a
   * scoped Collection adds nothing.
   */
  sourceIds: string[];
  modelProvider: Provider;
  modelId: string;
  /**
   * Null for a Member-created Teammate. A system Teammate (#838) belongs to
   * the surface that created it, is hidden from the roster and from referral
   * candidates, and is never a channel participant.
   */
  systemKind: TeammateSystemKind | null;
  /** The Assistant a system Teammate belongs to; null otherwise. */
  assistantId: string | null;
  /**
   * The ceiling on what any granted operation may do (#770). Grants say *which*
   * domains a Teammate acts in; this says how far inside them, and it is a
   * separate knob because the two are set by different people for different
   * reasons: an owner adds the improvements domain because the Teammate's job
   * needs it, an admin lowers the ceiling to `member` because they want to
   * watch it read before they let it write.
   *
   * Deliberately not the full `Role` ladder: no Teammate manages members, mints
   * API keys or changes roles, so those rungs do not exist here at all rather
   * than existing and being refused.
   */
  capabilityCeiling: TeammateCapabilityCeiling;
  /**
   * Whether this Teammate may accept its own Suggested Fixes (#770), the one
   * explicit relaxation of ADR-0017's "a Member must accept" invariant. False
   * by default and never implied by any domain grant: writing knowledge without
   * a human in the loop is a decision an admin makes on purpose, per Teammate.
   */
  approvalBypass: boolean;
  /**
   * The Project this Teammate is attached to, or null (#771). At most one:
   * a Teammate that read three projects' decisions every turn would be
   * answering from a blend of contexts nobody asked it to combine.
   */
  projectId: string | null;
  /** Soft-delete tombstone (#767): past Conversations stay readable. */
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A domain a Teammate may act in (#770). The vocabulary is closed: a grant row
 * naming something not here is not a weaker grant, it is a typo, and the check
 * constraint says so.
 *
 * Three to start, the ones the spec's stories need. A fourth costs one entry
 * here, one row in the action catalogue, and the check constraint, which is the
 * point of keeping the mapping data rather than code.
 */
export type TeammateGrantDomain = "improvements" | "knowledge" | "inbox" | "flows";

export const TEAMMATE_GRANT_DOMAINS: readonly TeammateGrantDomain[] = [
  "improvements",
  "knowledge",
  "inbox",
  /**
   * The Flows Agent's domain (#838): read an Assistant's Flows, draft changes
   * to the open one, propose another. Never delete or reorder.
   */
  "flows",
];

/**
 * A Teammate the product creates for its own purposes (#838), as opposed to
 * one a Member created. Kept off the roster and out of referral candidates;
 * chatted with from the surface that owns it.
 */
export type TeammateSystemKind = "flows_agent";

/** How far inside a granted domain a Teammate may go. */
export type TeammateCapabilityCeiling = "member" | "edit";

export const TEAMMATE_CAPABILITY_CEILINGS: readonly TeammateCapabilityCeiling[] = [
  "member",
  "edit",
];

/**
 * One granted domain (#770). **The row is the grant**: there is no `enabled`
 * column, because a disabled grant and an absent one mean the same thing to the
 * runtime and only one of them can be misread. Revoking deletes the row.
 */
export interface TeammateGrant {
  id: string;
  organizationId: string;
  teammateId: string;
  domain: TeammateGrantDomain;
  /** The admin who granted it; null once their account is gone. */
  grantedBy: string | null;
  createdAt: string;
}

/**
 * One Member keeping one Teammate off their own roster (#767, story 10).
 *
 * A row means hidden. Like a grant row it holds no mutable state, so unhiding
 * is a delete rather than a flag: "hidden = false" and "no row" would be two
 * ways to say the same thing, and only one of them can be misread.
 *
 * Not a state of the Teammate. It answers everybody else unchanged, it is still
 * a referral target, and this Member can still open it by URL; what changes is
 * one list.
 */
export interface TeammateRosterHidden {
  id: string;
  organizationId: string;
  teammateId: string;
  /** Whose roster it is off. */
  userId: string;
  createdAt: string;
}

/**
 * The tag every automatically filed Improvement carries (#767, story 16), so a
 * Member can filter the board down to what a Teammate raised. Exactly one
 * string, in the domain rather than at the call site: a board filter and a
 * writer that disagree by a character produce a filter that matches nothing.
 */
export const AUTO_IMPROVEMENT_LABEL = "auto-filed";

/** How often a Routine runs (#772). Presets, deliberately not a cron string. */
export type RoutineCadence = "daily" | "weekly" | "monthly";

/** Whether the last unattended run worked. */
export type RoutineRunStatus = "ok" | "failed";

/**
 * A **Routine** (#772): a standing instruction plus a cadence, run unattended.
 *
 * `lastRunAt` is both the claim lease and the cadence anchor, which is what
 * makes "once per window even with a drifting cron tick" one field rather than
 * two that can disagree.
 */
export interface TeammateRoutine {
  id: string;
  organizationId: string;
  teammateId: string;
  /** What to do, read as the user message of the unattended turn. */
  instruction: string;
  cadence: RoutineCadence;
  /** Preferred hour, UTC. Cadence says how often, this says when in the day. */
  hour: number;
  enabled: boolean;
  /** Whose standing instruction it is; the runs land in their thread. */
  createdBy: string | null;
  lastRunAt: string | null;
  lastStatus: RoutineRunStatus | null;
  lastDetail: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeammateRoutineInput {
  organizationId: string;
  teammateId: string;
  instruction: string;
  cadence: RoutineCadence;
  hour?: number;
  createdBy?: string | null;
}

export type TeammateRoutinePatch = Partial<
  Pick<TeammateRoutine, "instruction" | "cadence" | "hour" | "enabled">
>;

/**
 * A **Project** (#771): the durable home for decisions that belong to the work
 * rather than to one conversation. Lightweight on purpose, a name, a
 * description, an archived flag, and one document; everything richer (per-
 * project Improvements, per-project conversations) is out of scope in #767.
 */
export interface Project {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  /** Archived keeps the decisions readable and stops them reaching a prompt. */
  archived: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectInput {
  organizationId: string;
  name: string;
  description?: string;
  createdBy?: string | null;
}

export type ProjectPatch = Partial<
  Pick<Project, "name" | "description" | "archived">
>;

/**
 * Which of the three memory layers a document is (#771). Derived from which
 * owner the row carries, never stored beside them: a column that can disagree
 * with the ids is a column that eventually will.
 */
export type MemoryDocumentScope = "user" | "agent" | "project";

/**
 * One memory document: markdown, injected whole into the prompt, size-capped.
 *
 * Deliberately not the embedding-recall `Memory` the widget keeps for Visitors.
 * That answers "what do I half-remember about this person"; this is a document
 * you read in full or not at all, because retrieving the top-k sentences of
 * your team's own conventions would be worse than reading none of them.
 */
export interface MemoryDocument {
  id: string;
  organizationId: string;
  /** Exactly one of the three is set; `scope` says which. */
  memberId: string | null;
  teammateId: string | null;
  projectId: string | null;
  scope: MemoryDocumentScope;
  body: string;
  createdAt: string;
  updatedAt: string;
}

/** Who a document belongs to, as the one argument every read and write takes. */
export type MemoryDocumentOwner =
  | { scope: "user"; memberId: string }
  | { scope: "agent"; teammateId: string }
  | { scope: "project"; projectId: string };

/**
 * One write, kept forever. `bodyBefore` is the document as it stood *before*
 * this write, which is what makes reverting a restore rather than a
 * reconstruction (#767, story 19).
 */
export interface MemoryDocumentEntry {
  id: string;
  organizationId: string;
  documentId: string;
  /** The Teammate that wrote it; null when a Member edited it themselves. */
  teammateId: string | null;
  /** The Member it is attributed to: the editor, or whoever the Teammate answered. */
  authorId: string | null;
  /** What the writer said it was doing, in its own words. */
  note: string;
  bodyBefore: string;
  createdAt: string;
}

/**
 * A **Teammate channel** (#778): a named thread holding N Members and N
 * Teammates, where anyone present can @mention a Teammate and get its reply in
 * the same transcript.
 *
 * Its own entity, owning its own messages, rather than a `Conversation` that
 * grew participants. A Conversation is single-subject by construction (#768's
 * exclusive-or check), and the widget, the Inbox, Insights and the message-level
 * export all read it that way; teaching it a roster would have made every one of
 * those reads ask "and is this one a group?".
 */
export interface TeammateChannel {
  id: string;
  organizationId: string;
  name: string;
  /**
   * The bound Project (0..1), whose decisions document is shared context for
   * every Teammate turn in here, and where a Teammate writes what the channel
   * settles (#776).
   */
  projectId: string | null;
  /** Who opened it. Keeps the roster and the name theirs to change. */
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeammateChannelInput {
  organizationId: string;
  name: string;
  projectId?: string | null;
  createdBy?: string | null;
}

export type TeammateChannelPatch = Partial<
  Pick<TeammateChannel, "name" | "projectId">
>;

/**
 * One seat in a channel: a Member or a Teammate, never both.
 *
 * Two nullable owners under an exclusive-or check, the shape `conversations`
 * (#768) and `memory_documents` (#771) already take, rather than two tables
 * that would answer "who is in this channel" twice. `lastReadAt` is a Member's
 * own read marker and stays null on a Teammate row: an agent has no unreads.
 */
export interface TeammateChannelParticipant {
  id: string;
  organizationId: string;
  channelId: string;
  userId: string | null;
  teammateId: string | null;
  addedBy: string | null;
  lastReadAt: string | null;
  createdAt: string;
}

export interface TeammateChannelParticipantInput {
  organizationId: string;
  channelId: string;
  userId?: string | null;
  teammateId?: string | null;
  addedBy?: string | null;
}

/**
 * Who wrote a channel message. `system` is the runtime speaking as itself: the
 * chain-cap marker, which has to be in the transcript rather than in a toast,
 * because "the fan-out stopped here" is part of the record of what happened.
 */
export type ChannelAuthorType = "member" | "teammate" | "system";

/**
 * One message in a channel transcript.
 *
 * `content` is the same `ChatReplyPart[]` vocabulary a Conversation message
 * carries, so the console renders a channel with the transcript component the
 * 1:1 chat already uses, citations and tool cards included (#778, story 17).
 */
export interface ChannelMessage {
  id: string;
  organizationId: string;
  channelId: string;
  authorType: ChannelAuthorType;
  authorUserId: string | null;
  authorTeammateId: string | null;
  content: unknown[];
  /** The Teammates this message addressed, resolved against the roster. */
  mentions: string[];
  /**
   * The chain this message belongs to: the id of the human message that started
   * it. Null on that human message itself, which is what makes "everything one
   * message triggered" a single `where chain_id = ?` rather than a walk.
   */
  chainId: string | null;
  /** How the answer was reached, as in a Conversation message; null otherwise. */
  trace: StoredTurnTrace | null;
  createdAt: string;
}

/** What creating a Teammate requires; everything else takes a column default. */
export interface TeammateInput {
  organizationId: string;
  ownerId: string;
  name: string;
  title?: string;
  roleDescription?: string;
  avatarSeed?: string;
  visibility?: TeammateVisibility;
  collectionIds?: string[];
  sourceIds?: string[];
  /** Set only by the product, for a system Teammate (#838). */
  systemKind?: TeammateSystemKind | null;
  assistantId?: string | null;
}

export type TeammatePatch = Partial<
  Pick<
    Teammate,
    | "name"
    | "title"
    | "roleDescription"
    | "avatarSeed"
    | "visibility"
    | "collectionIds"
    | "sourceIds"
    | "editorIds"
    | "modelProvider"
    | "modelId"
    | "projectId"
    | "deletedAt"
  >
>;

/**
 * The two fields an Editor may not touch (#770). Kept out of `TeammatePatch`
 * rather than merely out of its zod schema: the grants surface is admin-only,
 * and a colleague who may rename a Teammate must not be able to raise its
 * ceiling or hand it approval-bypass in the same write.
 */
export type TeammateGovernancePatch = Partial<
  Pick<Teammate, "capabilityCeiling" | "approvalBypass">
>;

/**
 * An org-owned grouping of Sources (PRD #726). Collections stopped belonging
 * to an Assistant at the contract migration: "an Assistant's collections" is
 * now derived, the Collections holding Sources linked to it.
 */
export interface KnowledgeCollection {
  id: string;
  /** Owning Organization. Stamped at creation and backfilled for history. */
  organizationId: string;
  name: string;
  description: string;
  createdAt: string;
}

/**
 * "faq" (PRD #726): a curated Q&A as a first-class Source, the question is
 * the Source name, the answer stays on its Concept (frontmatter.type = "FAQ"),
 * so FAQ lookup and the widget quick-reply resolve exactly as before.
 */
export type SourceKind =
  | "file"
  | "url"
  | "text"
  | "website"
  | "application"
  | "faq";
export type SourceStatus = "processing" | "ready" | "error";
export type BackgroundJobKind =
  | "ingest_source"
  | "graph_sync_concept"
  | "draft_improvement_proposal"
  | "promote_memories"
  | "distill_agent_memory"
  | "sync_entity_records"
  | "sync_application_import"
  /** Human review (#841): deliver the request, then resume or halt the Flow. */
  | "deliver_review_request"
  | "resume_reviewed_conversation"
  /**
   * The callback gate (#842): resume or halt the Flow once the subscription
   * settles. There is no delivery job to pair with it, the subscribe call runs
   * inline in the action so a failure can halt the turn that made it.
   */
  | "resume_webhook_conversation";
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
  /** Dataset cursor for bounded, restartable post-crawl ingestion. */
  crawlIngestCursor?: string;
  /** Staged generation that survives serverless finalizer restarts. */
  crawlIngestGenerationId?: string;
  /** CAS fence captured before staging began. */
  crawlIngestExpectedGenerationId?: string;
  /** Successfully staged usable pages, for progress and empty-result checks. */
  crawlIngestedPages?: number;
  /** Restartable non-website ingestion generation and next draft index. */
  sourceIngestGenerationId?: string;
  sourceIngestExpectedGenerationId?: string;
  sourceIngestCursor?: number;
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
   * failed, today only a spent scraping allowance (#510). Cleared the moment a
   * run starts. Deliberately separate from `error`: a refusal leaves the Source
   * on its previous status, because knowledge that already works must not be
   * downgraded by a budget.
   */
  crawlBlockedReason?: string;
}

/** Provenance retained on a Source materialized from an Application Import. */
export interface ApplicationSourceConfig {
  applicationProvider?: ApplicationProvider;
  applicationImportId?: string;
  remoteId?: string;
  remoteUrl?: string | null;
  remoteRevision?: string | null;
  remoteUpdatedAt?: string | null;
  remoteMetadata?: Record<string, unknown>;
}

/**
 * Source config is one sparse JSON object. Website and Application fields are
 * disjoint and optional so legacy rows remain valid while consumers can read
 * common fields without narrowing a union first.
 */
export type SourceConfig = WebsiteSourceConfig &
  ApplicationSourceConfig & {
    /**
     * The persisted triage verdict for an uploaded file (#801, CYB-09):
     * scanner, rule-set version, sha256 of the bytes, and when. Absent on
     * non-file Sources and on files uploaded before the verdict was recorded.
     */
    triage?: TriageEvidence;
  };

export interface Source {
  id: string;
  collectionId: string;
  name: string;
  kind: SourceKind;
  status: SourceStatus;
  error: string;
  config: SourceConfig;
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
  /** Retrieval exposes Concepts from this committed generation only. */
  activeGenerationId: string;
  createdAt: string;
  updatedAt: string;
}

// --- Application knowledge connectors --------------------------------------

export type ApplicationProvider =
  | "salesforce"
  | "servicenow"
  | "slack"
  | "onedrive"
  | "google_drive"
  /**
   * A Member's own Microsoft 365 mailbox with the delegated mail-send scope
   * (#841): the sender of a Human review's email. Same Entra app registration
   * as OneDrive, a different consent, and never a knowledge source.
   */
  | "microsoft_mail";

export type ApplicationConnectionStatus =
  | "pending"
  | "connected"
  | "reauthorization_required"
  | "error";

export type ApplicationConnectionOwnerType = "organization" | "member";

export interface ApplicationConnection {
  id: string;
  organizationId: string;
  ownerType: ApplicationConnectionOwnerType;
  /** Present only when ownerType is member; always belongs to organizationId. */
  ownerMemberId: string | null;
  provider: ApplicationProvider;
  name: string;
  status: ApplicationConnectionStatus;
  /** Encrypted OAuth token set or provider credential bundle. */
  sealedCredentials: string;
  scopes: string[];
  providerAccountId: string | null;
  metadata: Record<string, unknown>;
  error: string;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ApplicationImportCadence = "manual" | "daily";
export type ApplicationImportStatus = "idle" | "syncing" | "ready" | "error";

export interface ApplicationImport {
  id: string;
  organizationId: string;
  connectionId: string;
  collectionId: string;
  name: string;
  config: Record<string, unknown>;
  cadence: ApplicationImportCadence;
  enabled: boolean;
  status: ApplicationImportStatus;
  checkpoint: Record<string, unknown>;
  error: string;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  /** Bytes reserved against the Organization allowance for this Import. */
  reservedBytes: number;
  assistantIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** Stable remote-item → Source identity for idempotent incremental sync. */
export interface ApplicationSource {
  id: string;
  importId: string;
  /** Null after the remote item is tombstoned and its Source is removed. */
  sourceId: string | null;
  remoteId: string;
  canonicalUrl: string | null;
  revision: string | null;
  contentHash: string;
  /** UTF-8 bytes of the normalized artifact stored for this mapping. */
  contentBytes: number;
  remoteMimeType: string | null;
  remoteUpdatedAt: string | null;
  lastSeenAt: string;
  removedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ApplicationSyncRunStatus = "succeeded" | "failed";

export interface ApplicationSyncRun {
  id: string;
  importId: string;
  status: ApplicationSyncRunStatus;
  discovered: number;
  upserted: number;
  unchanged: number;
  deleted: number;
  skipped: number;
  failed: number;
  enqueued: number;
  providerCalls: number;
  bytes: number;
  durationMs: number;
  skippedReasons: Array<{ remoteId: string | null; reason: string }>;
  error: string;
  startedAt: string;
  completedAt: string;
}

// --- Org-level knowledge hub (PRD #726) -------------------------------------

/** One Assistant a Source is linked to, with its per-assistant Direct access. */
export interface AssistantSourceLink {
  assistantId: string;
  /** The Assistant's title, for the hub's "Linked assistants" chips. */
  assistantName: string;
  /** May chat users open the cited file itself (files only; default off). */
  directAccess: boolean;
}

/** One row of the hub's Websites / Files / FAQs tables. */
export interface OrgKnowledgeSourceListItem {
  id: string;
  collectionId: string;
  name: string;
  kind: SourceKind;
  status: SourceStatus;
  error: string;
  config: SourceConfig;
  lastCrawledAt: string | null;
  originalObjectPath: string | null;
  createdAt: string;
  updatedAt: string;
  /** Indexed Concepts under this Source, the "N Pages" column. */
  conceptCount: number;
  /** FAQ answer excerpt (kind "faq" only; "" otherwise). */
  answerPreview: string;
  linkedAssistants: AssistantSourceLink[];
}

/** Hub table filters; kinds picks the tab (websites/files/faqs buckets). */
export interface OrgKnowledgeSourceFilter {
  kinds: SourceKind[];
  /** Narrow to one ingest status; "" means all. */
  status?: SourceStatus | "";
  /** Only Sources linked to this Assistant; "" means all. */
  assistantId?: string;
  /** Case-insensitive match on the Source name; "" means all. */
  query?: string;
  /** 1-based page. */
  page?: number;
  /** Zero requests only totals/status tallies, without hydrating Source rows. */
  pageSize?: number;
}

/** Source identity for Knowledge Scope pickers, without content or link details. */
export type OrgKnowledgeSourceOption = Pick<
  OrgKnowledgeSourceListItem,
  "id" | "name" | "kind" | "collectionId"
>;

export interface OrgKnowledgeSourceOptions {
  items: OrgKnowledgeSourceOption[];
  total: number;
}

/** Ingest-status tallies across every row matching the filter (not the page). */
export interface OrgKnowledgeStatusCounts {
  processing: number;
  ready: number;
  error: number;
}

export interface OrgKnowledgeSourcePage {
  items: OrgKnowledgeSourceListItem[];
  /** Total rows matching the filter, across all pages. */
  total: number;
  statusCounts: OrgKnowledgeStatusCounts;
}

/** One FAQ with its full answer, the hub's org-wide CSV export. */
export interface OrgFaqEntry {
  sourceId: string;
  question: string;
  answer: string;
}

export interface BackgroundJob {
  id: string;
  organizationId: string;
  kind: BackgroundJobKind;
  sourceId: string | null;
  status: BackgroundJobStatus;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  /** Unique claim generation; settlement must present this exact fence. */
  leaseToken: string | null;
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
 * OKF v0.2 frontmatter: `type` is the only required field. The vocabulary and
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
  /** Source replacement generation; null only for legacy source-less Concepts. */
  generationId: string | null;
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
  /** The concept's Source id, when it has one (PRD #726). */
  sourceId?: string | null;
  /**
   * Whether the QUERYING assistant may hand the visitor the original file:
   * its link row has Direct access on, the Source is a file, and the original
   * is retained. Computed per search; false/absent otherwise.
   */
  directAccess?: boolean;
  /** The concept's original page/document URL (OKF `resource`), when known. */
  resourceUrl: string | null;
  content: string;
  /**
   * Cosine similarity in [0,1]: but ONLY when `engine` is `vector`. The graph
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

export type ConversationSubject = "member" | "visitor" | "sso";

/** Best-effort session context captured when a conversation starts. */
export interface ConversationMetadata {
  /**
   * Set when this Conversation is an unattended Routine run (#772). A run is
   * an ordinary Teammate Conversation in every way the runtime cares about, so
   * what makes it a run is a fact about where it came from, not a column.
   */
  routineId?: string;
  /** The routine's one-line name, so the thread can label the run. */
  routineName?: string;
  /**
   * Set when this Conversation began as a referral from another Teammate
   * (#773): where it came from, who sent it, and what they said. The summary
   * is read as standing context on the first turn, never as a message, because
   * it is neither the Member's words nor this Teammate's.
   */
  referredFromConversationId?: string;
  referredFromTeammateName?: string;
  referralSummary?: string;
  /**
   * The continuations opened from referral cards in this Conversation, so the
   * origin points forward and the handoff is a link rather than a coincidence
   * of timing.
   */
  referredTo?: { conversationId: string; teammateId: string; teammateName: string }[];
  /**
   * Set on a Flows Agent conversation (#838): which Assistant's Flow the chat
   * was building. `flowId` is null while the Flow is still unsaved, so the
   * new-Flow canvas lists those threads and a saved Flow lists its own.
   */
  flowsAgent?: { assistantId: string; flowId: string | null };
  /**
   * The Human review this Conversation is waiting on (#841), set when the gate
   * raises it and cleared when the gate closes. A marker rather than a join so
   * the Inbox's "Pending reviews" filter is the same metadata read as
   * "Escalated".
   */
  pendingReviewId?: string | null;
  /**
   * The open callback gate (#842), while one is waiting. Same role as
   * `pendingReviewId`: the surfaces read it to know the turn is not over.
   */
  pendingWebhookId?: string | null;
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
   * against the reference's own file must read unchanged, a field the producing
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
  /** Verified SSO claim persisted for Inbox display and identity-aware tools. */
  ssoClaimName?: string;
  ssoClaimValue?: string;
}

export interface Conversation {
  id: string;
  /**
   * The Assistant this Conversation belongs to, or null on a Teammate one.
   * Exactly one of `assistantId` / `teammateId` is set (#768); the database
   * check constraint is what makes that an invariant rather than a habit.
   */
  assistantId: string | null;
  /** The AI Teammate this Conversation belongs to, or null on an Assistant one. */
  teammateId: string | null;
  subjectType: ConversationSubject;
  subjectId: string;
  collectionId: string | null;
  title: string;
  metadata: ConversationMetadata;
  /**
   * Persistent cross-turn session state (tau-style sessions): a JSON bag the
   * runtime's tools read at the start of a turn and write back after it,
   * e.g. the `remember` tool's session memory. Never rendered directly.
   */
  sessionState: Record<string, unknown>;
  /** Optimistic concurrency fence for session-state patches. */
  sessionVersion: number;
  /** Pinned conversations stay in the History panel beyond the recency cap. */
  pinned: boolean;
  /**
   * Exempt from the transcript-retention sweep (#801, CYB-12). Set while the
   * conversation is under a preservation obligation, so an organization can
   * hold one without turning retention off for every other conversation.
   * Optional for the same reason the retention windows are: a row written
   * before the column existed simply is not held.
   */
  legalHold?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Conversation summary for the org-wide Inbox. Runtime session state is
 * deliberately absent: it can be large, is never rendered, and must not ride
 * every list response merely because the runtime Conversation owns it.
 */
export interface InboxConversation
  extends Omit<Conversation, "sessionState" | "sessionVersion"> {
  assistantTitle: string;
  collectionName: string | null;
  messageCount: number;
  /** Distinct flow names that handled assistant replies. */
  flowNames: string[];
  /**
   * True when the Assistant spoke proactively and the Visitor never replied, a
   * nudge, not a conversation. The Inbox marks it so a queue is not padded with
   * non-conversations, and Insights leaves it out of its counts entirely (#546).
   */
  notificationOnly: boolean;
  /** 1 if any reply was voted up, -1 if any down, 0 otherwise (up wins). */
  feedback: -1 | 0 | 1;
}

/** Server-owned filters for one bounded Inbox window. */
export interface InboxQuery {
  cursor?: string | null;
  limit?: number;
  search?: string;
  userInfo?: string;
  location?: string;
  city?: string;
  role?: string;
  from?: string;
  to?: string;
  assistantId?: string;
  language?: string;
  workflow?: string;
  conversationIds?: string[];
  feedback?: "" | "up" | "down";
  escalation?: "" | "escalated" | "not_escalated";
  staff?: "" | "include" | "only";
}

/** One bounded Inbox window; the cursor is opaque to callers. */
export interface InboxPage {
  conversations: InboxConversation[];
  nextCursor: string | null;
}

/** Org-wide selectable values, loaded independently from the bounded list. */
export interface InboxFacets {
  locations: string[];
  cities: string[];
  roles: string[];
  languages: string[];
  workflows: string[];
}

/** Everything the transcript pane needs, loaded through one read interface. */
export interface InboxConversationReview {
  messages: StoredMessage[];
  improvementLinks: ImprovementMessageLink[];
  answerVerdicts: AnswerVerdict[];
}

/**
 * **Legacy.** Where a Thinking Step sat in the agent loop, back when the runtime
 * emitted a generic phase machine alongside the real tool lifecycle (#560). The
 * runtime no longer produces these, the tool-call rows, the reasoning thoughts
 * and the Simplified-thinking narration carry what the stages stood in for, but
 * traces persisted before the collapse still hold them, so the type survives for
 * read-back and the UI keeps a stage icon for those rows.
 */
export type StepStage = "classify" | "generate" | "search" | "found";

/**
 * One Thinking Step: a single row of the Thinking panel, folded from the
 * runtime's step/thought/tool-* wire events. Lives in the domain rather than
 * the runtime because it is **persisted** with the answer it explains, the
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
   * - `tool`: one instrumented tool call, with its input, outcome and duration.
   * - `thought`: the model's own reasoning before a tool call (Role-gated).
   * - `notice`: a runtime diagnostic worth telling an operator about (a provider
   *   fallback, an unparseable API response, the flow that matched).
   * - `step`, **legacy**: a row from the retired phase machine (see
   *   {@link StepStage}). Never produced any more; still read back.
   */
  kind: "notice" | "thought" | "tool" | "step";
  label: string;
  /** Registry tool name, for `kind: "tool"`. */
  tool?: string;
  /** Legacy engine stage, for `kind: "step"`, picks that row's icon. */
  stage?: StepStage;
  /** Tool calls run until their tool-end arrives; other kinds are done. */
  status: "running" | "done" | "error";
  /** Model-supplied call arguments (already safe to show, never secrets). */
  input?: Record<string, unknown>;
  /** Outcome summary from the tool-end event ("3 concepts found"). */
  detail?: string;
  /**
   * Structured outcome, for tools whose result is worth showing as labelled rows
   * rather than a one-line summary, an API call's endpoint, method, status and
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
   * that ran without a budget (the deterministic no-model path), the panel
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
 * Trace storage caps. Reasoning text is unbounded by nature, a single turn in
 * the reference export ran to 108k characters, and a Conversation holds many
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
 * trace, the reference platform's own API payloads contain student names and
 * quiz grades verbatim, so this is the field that makes per-Organization trace
 * retention matter rather than a nice-to-have.
 */
export const TRACE_MAX_RESULT_CHARS = 8_000;

/**
 * Longest Simplified-thinking narration line (#560), a sentence, not a
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
   * How this answer was reached: Thinking Steps captured as the turn streamed.
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
   * True for a proactive Notification: an Assistant message nobody asked for.
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
  /** Proactive Notifications delivered, never folded into `aiAnswers` (#546). */
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

/** Bounded data rendered by Insights, never raw Conversations or Messages. */
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

/** Every lane of the Improvements board, in board order. */
export const IMPROVEMENT_STATUS_VALUES: readonly ImprovementStatus[] = [
  "to_do",
  "in_progress",
  "in_review",
  "done",
  "archived",
];

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
  /**
   * The Project this work belongs to, or null (#771).
   *
   * Most Improvements are org-wide and stay null. Deleting the Project detaches
   * them rather than taking them with it: what was wrong with an answer is
   * still worth knowing after the project it was filed under is gone.
   */
  projectId: string | null;
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
  /** Draft FAQ question, becomes the Concept title on accept. */
  draftQuestion: string;
  /** Draft FAQ answer, becomes the Concept body on accept. */
  draftAnswer: string;
  /** Why this fix, shown to the reviewer (never persisted into the Concept). */
  rationale: string;
  /** Knowledge the draft drew on (provenance for the reviewer). */
  sources: ImprovementProposalSource[];
  /** The model that drafted it (audit). */
  model: string;
  /** Where accepting writes the FAQ Concept, the flagged answer's assistant
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
  /** improvement_messages row id, used to unlink. */
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

/** One progressively loaded slice of an Improvement's linked conversations. */
export interface ImprovementAssociationPage {
  associations: ImprovementAssociation[];
  total: number;
  offset: number;
  nextOffset: number | null;
}

/** Which improvement (if any) a message is linked to, powers the Inbox chip. */
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
    | "projectId"
  >
>;

export type AlertType =
  | "integration"
  | "crawl"
  | "provider"
  | "ingestion"
  /**
   * A knowledge-configuration problem that no retry fixes, today an AI
   * Teammate whose Knowledge Scope names a Collection somebody deleted (#769).
   * Distinct from `ingestion`, which is a pipeline failure: this one waits for
   * a person to decide what the scope should say instead.
   */
  | "knowledge"
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
  | "graph_cognify"
  | "memory_extract"
  /** Distilling one Teammate turn into its Agent memory layer (#771). */
  | "agent_memory";

/**
 * Which credential answered a metered model call, the platform env key
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

/** Max standing goals per assistant, bounds the scheduled runner's cost. */
export const ASSISTANT_GOAL_CAP = 20;

/** Runs kept per goal in the ledger, enough for flakiness triage, bounded growth. */
export const GOAL_RUN_RETENTION = 50;

/** Tier transitions kept per Flow in the demotion-history ledger, bounded like goal runs. */
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
 * input is optional by construction, absent features contribute empty
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
 * euro limits are independent caps, either one crossing today's usage trips
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
 * `scraping` (pages fetched by a website crawler). Disjoint by construction,
 * every metered unit belongs to exactly one, so the three can be capped and
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
 * The plan-facing resource a stored usage kind belongs to, the one mapping
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
  /** Metered units that are not tokens, crawled pages. Zero for model calls. */
  units: number;
}

/**
 * One organization's usage over an arbitrary window, grouped finely enough to
 * price in credits: per metered resource, per funding credential, per
 * provider/model. The window need not align to UTC days, plan windows run from
 * a billing anchor, so the read takes whole closed days from the rollup and the
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
/**
 * Which traffic produced a runtime event. `teammate` is internal staff chat
 * (#768): it is neither a Visitor on the widget nor an admin testing in the
 * Preview, and folding it into either would misattribute internal usage.
 */
export type RuntimeEventSurface = "preview" | "widget" | "teammate";

/**
 * Who reached for a sensitive object (#801, CYB-05). A Member acts with their
 * auth user id, an API key with the key's id, an anonymous widget Visitor with
 * its subject id.
 */
export type ObjectAccessActorKind = "member" | "api_key" | "visitor" | "unknown";

/** Which private object was reached for. */
export type ObjectAccessObjectKind = "knowledge_original" | "analytics_export";

/**
 * `served` means bytes reached the caller and the transfer completed.
 * `aborted` means the caller went away mid-transfer: `bytes` says how much had
 * already moved, and the bulk-download detection counts it beside `served`,
 * because fetching most of every original and cancelling is still
 * exfiltration. `refused` is an authorization or policy no, the value the
 * probe detection counts. `failed` is our own side breaking, and is not a
 * security event.
 */
export type ObjectAccessResult = "served" | "aborted" | "refused" | "failed";

/**
 * One attempt to read a private object, recorded whether or not it succeeded.
 *
 * Unlike {@link RuntimeEventInput} this deliberately carries identifying data:
 * an access ledger that cannot say who, from where, and how much is not
 * evidence of anything. That is also why it lives in its own append-only
 * table that only the service role writes.
 */
export interface ObjectAccessEventInput {
  organizationId: string;
  actorKind: ObjectAccessActorKind;
  actorId?: string | null;
  objectKind: ObjectAccessObjectKind;
  objectPath: string;
  sourceId?: string | null;
  result: ObjectAccessResult;
  /** Bytes actually transferred (`served` and `aborted`). Null when nothing moved. */
  bytes?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface ObjectAccessEvent extends ObjectAccessEventInput {
  id: string;
  createdAt: string;
}

/**
 * One retention-sweep tick for one Organization (#801, CYB-12): the durable
 * record that a policy ran, what window it enforced, and how many rows it
 * removed. Carries no personal data, which is what lets the audit outlive the
 * transcripts it describes.
 */
export interface RetentionSweepEventInput {
  organizationId: string;
  /** Which lifecycle ran: transcript deletion, or the older trace strip. */
  policy: "transcripts" | "traces";
  retentionDays: number;
  /** The cutoff the sweep computed; rows older than this were the target. */
  cutoff: string;
  /** Conversations deleted / messages stripped; null when the tick failed. */
  deleted?: number | null;
  /** Present when the org's tick failed. */
  error?: string | null;
}

export interface RetentionSweepEvent extends RetentionSweepEventInput {
  id: string;
  createdAt: string;
}

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
