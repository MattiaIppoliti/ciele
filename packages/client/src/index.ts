import type {
  ApplicationConnection,
  ReviewRequest,
  AssistantPatch,
  Conversation,
  StoredMessage,
  ChannelMessage,
  ChannelRosterEntry,
  ChannelUnread,
  Teammate,
  TeammateChannel,
  TeammateChannelParticipant,
  TeammateInput,
  TeammatePatch,
  TeammateRuntimeConfig,
  TeammateRoutine,
  MemoryDocument,
  MemoryDocumentEntry,
  Project,
  ProjectPatch,
  Flow,
  FlowInput,
  FlowPatch,
  HttpFlowRun,
  ImprovementPatch,
  HelpDesk,
  KnowledgeCollection,
  Memory,
  MemorySubjectSummary,
  SupportChannel,
  SupportChannelConfig,
  SupportChannelInput,
  SupportChannelPatch,
  Skill,
  SkillInput,
  SkillPatch,
  AssistantGoal,
  GoalExpectations,
  GoalStatus,
  Alert,
  Organization,
  OrganizationPatch,
  Member,
  Invite,
  OrgApiKey,
  Role,
  ApiEndpointSpec,
  ApiIntegrationAuthType,
  AssistantAnswer,
  KnowledgeSearchResponse,
  ProviderConnection,
  TicketingPlatform,
} from "@agent-hub/core";

/**
 * The ask and search wire shapes, re-exported so a client user types a
 * response without a second dependency. Declared once, in `@agent-hub/core`.
 */
export type {
  AssistantAnswer,
  AssistantAnswerSource,
  KnowledgeSearchHit,
  KnowledgeSearchResponse,
} from "@agent-hub/core";

/**
 * `@ciele/client`: the typed /api/v1 client the CLI (#627) and the MCP
 * server (#629) share. Mirrors the endpoint registry in the web app's
 * `api-v1/openapi.ts` method-for-method. Two tests keep the triangle closed:
 * `openapi.test.ts` pins registry ↔ route files, and
 * `client-conformance.test.ts` pins registry ↔ this client (every method's
 * (verb, path) must resolve to exactly one registry entry, and every
 * registered endpoint must be reachable through some method here).
 *
 * Works identically against the SaaS and a self-hosted deployment, the
 * base URL is just a constructor option / CIELE_BASE_URL.
 */

export interface CieleClientOptions {
  /** An org API key (`ciele_sk_…`), minted in Settings → API Keys. */
  apiKey: string;
  /** Deployment origin; defaults to the SaaS. Self-host: your own URL. */
  baseUrl?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
}

export const DEFAULT_CIELE_BASE_URL = "https://ciele.app";

/** The uniform `{ error: { code, message } }` envelope, thrown as an Error. */
export class CieleApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CieleApiError";
    this.status = status;
    this.code = code;
  }
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export interface ListParams {
  limit?: number;
  cursor?: string;
}

/** The assistant projection /api/v1 serves (a subset of the row). */
export interface ApiAssistant {
  id: string;
  title: string;
  nickname: string;
  description: string;
  avatarUrl: string;
  welcomeMessage: string;
  aiDisclaimer: string;
  suggestedQuestions: string[];
  answeringStyle: string;
  chatLauncherEnabled: boolean;
  allowedDomains: string[];
  requireSignIn: boolean;
  createdAt: string;
}

export interface ApiSource {
  id: string;
  collectionId: string;
  name: string;
  kind: "file" | "url" | "text" | "website";
  status: "processing" | "ready" | "error";
  createdAt: string;
}

export type ApiHelpDesk = Omit<HelpDesk, "ticketingIntegration"> & {
  ticketingIntegration: null | {
    id: string;
    platform: TicketingPlatform;
    name: string;
    connectedAt: string;
    hasCredentials: boolean;
  };
};

export type ApiSupportChannel = Omit<SupportChannel, "config"> & {
  config: Omit<
    SupportChannelConfig,
    "apiKeyValue" | "bearerToken" | "basicPassword"
  > & {
    hasApiKey: boolean;
    hasBearerToken: boolean;
    hasBasicPassword: boolean;
  };
};

/** One channel row as the roster read returns it (#778). */
export interface ApiChannelSummary {
  channel: TeammateChannel;
  memberIds: string[];
  teammateIds: string[];
  unread: ChannelUnread;
  lastMessagePreview: string;
  lastMessageAt: string | null;
}

/** One channel: its roster, the names a mention can reach, its transcript. */
export interface ApiChannelView {
  channel: TeammateChannel;
  participants: TeammateChannelParticipant[];
  teammates: Teammate[];
  roster: ChannelRosterEntry[];
  messages: ChannelMessage[];
  canManage: boolean;
}

/** A memory document with its append-only history (#771). */
export interface ApiMemoryDocumentView {
  document: MemoryDocument | null;
  entries: MemoryDocumentEntry[];
}

/**
 * What a Teammate may do (#770). Restated rather than imported: `@ciele/ops`
 * owns the interface and this package deliberately depends only on `core`.
 */
export interface TeammateGovernance {
  teammateId: string;
  domains: string[];
  ceiling: string;
  approvalBypass: boolean;
}

/** A Teammate conversation with the turns it holds (#768). */
export interface ApiTeammateConversation {
  conversation: Conversation;
  messages: StoredMessage[];
}

export type PublicationStatus =
  | { published: false }
  | {
      published: true;
      publicationId: string;
      version: number;
      publishedAt: string;
    };

export interface ApiMeta {
  api: string;
  apiVersion: number;
  serverVersion: string;
  domains: string[];
}

/** An Application Connection over the API: never the sealed credential (#839). */
export type ApplicationConnectionView = Pick<
  ApplicationConnection,
  | "id" | "provider" | "name" | "status" | "ownerType" | "ownerMemberId"
  | "scopes" | "providerAccountId" | "error" | "lastConnectedAt" | "createdAt" | "updatedAt"
>;

/** A Human review request (#841): the row as the API returns it. */
export type ReviewRequestView = Omit<ReviewRequest, "haltMessage" | "resumedAt">;

/** One catalogued Connector action, as the API describes it. */
export interface ConnectorActionView {
  key: string;
  /** Mirrors `ConnectorProvider` in `@agent-hub/core`; the two Drives are Member-owned (#840). */
  provider: "salesforce" | "servicenow" | "slack" | "onedrive" | "google_drive";
  title: string;
  description: string;
  effect: "read" | "write";
  requiredScopes: string[];
  fields: Array<{ name: string; label: string; type: string; required: boolean; template: boolean }>;
  outputs: Array<{ name: string; label: string }>;
}

/** What a re-consent request returns: the union to grant and where to grant it. */
export interface ApplicationReconsentView {
  connectionId: string;
  provider: string;
  currentScopes: string[];
  scopes: string[];
  startPath: string;
  /** The start path on the deployment's origin; open it in a browser. */
  startUrl: string;
}

export interface ApiIntegrationView {
  name: string;
  baseUrl: string;
  authType: ApiIntegrationAuthType;
  authHeaderName: string;
  authUsername: string;
  hasCredential: boolean;
  endpoints: ApiEndpointSpec[];
}

export type ProviderConnectionView = Omit<ProviderConnection, "encryptedKey"> & {
  hasCredential: boolean;
};

/** `GET /whoami`, the key's own identity (#627). */
export interface ApiWhoami {
  organizationId: string;
  role: "owner" | "admin" | "editor" | "viewer";
  keyId: string;
}

interface RequestOptions {
  body?: unknown;
  form?: FormData;
  query?: Record<string, string | number | undefined>;
  idempotencyKey?: string;
  signal?: AbortSignal;
  accept?: string;
}

/** Tagged template for request paths: every interpolation is URL-encoded. */
const p = (strings: TemplateStringsArray, ...values: string[]) =>
  String.raw({ raw: strings }, ...values.map(encodeURIComponent));

/** A multipart upload the route links to Assistants. */
function linkedForm(file: File, assistantIds: string[]): FormData {
  const form = new FormData();
  form.set("file", file);
  // The route parses this field as JSON (multipart carries no arrays).
  form.set("assistantIds", JSON.stringify(assistantIds));
  return form;
}

export class CieleClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CieleClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_CIELE_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async requestResponse(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<Response> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
    };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
    if (options.accept) headers.accept = options.accept;

    const response = await this.fetchImpl(url.toString(), {
      method,
      headers,
      signal: options.signal,
      body:
        options.form ??
        (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });

    if (!response.ok) {
      const envelope = (await response
        .json()
        .catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      throw new CieleApiError(
        response.status,
        envelope?.error?.code ?? "unknown",
        envelope?.error?.message ?? `HTTP ${response.status}`
      );
    }
    return response;
  }

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions & { parseText?: boolean } = {}
  ): Promise<T> {
    const response = await this.requestResponse(method, path, options);
    if (options.parseText) return (await response.text()) as T;
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /**
   * Walks a paginated listing to exhaustion, `for await` over every item.
   */
  private async *paginate<T>(
    path: string,
    query: Record<string, string | number | undefined> = {}
  ): AsyncGenerator<T> {
    let cursor: string | undefined;
    do {
      const page = await this.request<Page<T>>("GET", path, {
        query: { ...query, cursor },
      });
      yield* page.data;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  /** `GET /meta`, what this deployment speaks. Useful before anything else. */
  meta(): Promise<ApiMeta> {
    return this.request("GET", "/meta");
  }

  /** `GET /whoami`, the Organization and Role this key acts with. */
  whoami(): Promise<ApiWhoami> {
    return this.request("GET", "/whoami");
  }

  readonly assistants = {
    list: (params: ListParams = {}): Promise<Page<ApiAssistant>> =>
      this.request("GET", "/assistants", { query: { ...params } }),
    listAll: (): AsyncGenerator<ApiAssistant> => this.paginate("/assistants"),
    get: (id: string): Promise<ApiAssistant> =>
      this.request("GET", p`/assistants/${id}`),
    create: (
      input: { title: string; nickname?: string; description?: string },
      opts: { idempotencyKey?: string } = {}
    ): Promise<ApiAssistant> =>
      this.request("POST", "/assistants", { body: input, ...opts }),
    update: (id: string, patch: AssistantPatch): Promise<ApiAssistant> =>
      this.request("PATCH", p`/assistants/${id}`, { body: patch }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", p`/assistants/${id}`),
    duplicate: (id: string): Promise<ApiAssistant> =>
      this.request("POST", p`/assistants/${id}/duplicate`),
    /**
     * The published Assistant's answer to `question`, with its Sources. A real
     * turn (it can take a while and creates a Conversation the Inbox shows);
     * pass `conversationId` from a previous answer to continue that thread.
     */
    ask: (
      id: string,
      input: { question: string; conversationId?: string }
    ): Promise<AssistantAnswer> =>
      this.request("POST", p`/assistants/${id}/ask`, { body: input }),
    skills: (id: string): Promise<{ data: Skill[] }> =>
      this.request("GET", p`/assistants/${id}/skills`),
    setSkills: (id: string, skillIds: string[]): Promise<{ data: Skill[] }> =>
      this.request("PATCH", p`/assistants/${id}/skills`, {
        body: { skillIds },
      }),
  };

  readonly flows = {
    /**
     * The deployment's Flow catalogue. Ask rather than remember: an older
     * client against a newer deployment learns that deployment's triggers,
     * actions and condition kinds, and the same lists build the zod schemas
     * that refuse anything outside them.
     */
    catalog: (): Promise<{
      triggers: Array<{
        trigger: string;
        proactive: boolean;
        allowedActions: string[];
      }>;
      actions: string[];
      conditionKinds: string[];
      conditionLogic: string[];
      actionsWithSettings: string[];
      notes: string[];
    }> => this.request("GET", "/flows/catalog"),
    /**
     * Check a patch, or a whole Flow, without storing it. Both mutate nothing
     * and both return what *would* be stored, which is the only way to see the
     * human-review action the runtime inserts ahead of a Connector write.
     */
    draft: (input: {
      summary: string;
      currentTrigger?: string;
      patch: FlowPatch;
    }): Promise<{ applied: "draft"; summary: string; patch: FlowPatch }> =>
      this.request("POST", "/flows/draft", { body: input }),
    validate: (
      assistantId: string,
      input: { rationale: string; flow: FlowInput }
    ): Promise<{ proposal: FlowInput; rationale: string; assistantId: string }> =>
      this.request(
        "POST",
        p`/assistants/${assistantId}/flows/validate`,
        { body: input }
      ),

    /** Recent inbound runs of an HTTP-triggered Flow (#843). */
    runs: (
      flowId: string,
      limit?: number
    ): Promise<{ data: HttpFlowRun[] }> =>
      this.request("GET", p`/flows/${flowId}/runs`, {
        query: { limit },
      }),

    /** The key holder's own Flows Agent thread; no `flowId` = the new-Flow canvas. */
    agentThread: (
      assistantId: string,
      flowId?: string
    ): Promise<{ data: Conversation[] }> =>
      this.request(
        "GET",
        p`/assistants/${assistantId}/flows-agent/thread`,
        { query: { flowId } }
      ),
    agentConversation: (
      assistantId: string,
      conversationId: string
    ): Promise<{ conversation: Conversation; messages: StoredMessage[] }> =>
      this.request(
        "GET",
        p`/assistants/${assistantId}/flows-agent/conversations/${conversationId}`
      ),
    list: (assistantId: string): Promise<{ data: Flow[] }> =>
      this.request("GET", p`/assistants/${assistantId}/flows`),
    get: (id: string): Promise<Flow> => this.request("GET", p`/flows/${id}`),
    create: (assistantId: string, input: FlowInput): Promise<Flow> =>
      this.request("POST", p`/assistants/${assistantId}/flows`, { body: input }),
    update: (id: string, patch: FlowPatch): Promise<Flow> =>
      this.request("PATCH", p`/flows/${id}`, { body: patch }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", p`/flows/${id}`),
    reorder: (assistantId: string, orderedIds: string[]): Promise<{ data: Flow[] }> =>
      this.request("POST", p`/assistants/${assistantId}/flows/reorder`, {
        body: { orderedIds },
      }),
  };

  readonly knowledge = {
    collections: (assistantId: string): Promise<{ data: KnowledgeCollection[] }> =>
      this.request("GET", p`/assistants/${assistantId}/collections`),
    sources: (collectionId: string): Promise<{ data: ApiSource[] }> =>
      this.request("GET", p`/collections/${collectionId}/sources`),
    /**
     * PRD #726: knowledge reaches Assistants only through explicit links, so
     * every add names them and the endpoint refuses an empty set. Required
     * here rather than optional, so a caller that forgets fails to compile
     * instead of failing at runtime on every call.
     */
    addTextSource: (
      collectionId: string,
      input: { name?: string; text: string; assistantIds: string[] }
    ): Promise<ApiSource> =>
      this.request("POST", p`/collections/${collectionId}/sources`, {
        body: { kind: "text", ...input },
      }),
    addUrlSource: (
      collectionId: string,
      url: string,
      assistantIds: string[]
    ): Promise<ApiSource> =>
      this.request("POST", p`/collections/${collectionId}/sources`, {
        body: { kind: "url", url, assistantIds },
      }),
    /** Multipart file upload; pass a File/Blob (Node 20+ has both). */
    addFileSource: (
      collectionId: string,
      file: File,
      assistantIds: string[]
    ): Promise<ApiSource> =>
      this.request("POST", p`/collections/${collectionId}/sources`, {
        form: linkedForm(file, assistantIds),
      }),
    getSource: (id: string): Promise<ApiSource> =>
      this.request("GET", p`/sources/${id}`),
    deleteSource: (id: string): Promise<void> =>
      this.request("DELETE", p`/sources/${id}`),
    recrawlSource: (id: string): Promise<{ ok: true }> =>
      this.request("POST", p`/sources/${id}/recrawl`),
    addFaq: (
      collectionId: string,
      input: { question: string; answer: string; assistantIds: string[] }
    ): Promise<{ id: string; question: string; answer: string; path: string }> =>
      this.request("POST", p`/collections/${collectionId}/faqs`, { body: input }),
    importFaqs: (
      collectionId: string,
      csv: File,
      assistantIds: string[]
    ): Promise<{ imported: number; skipped: string[] }> =>
      this.request("POST", p`/collections/${collectionId}/faqs/import`, {
        form: linkedForm(csv, assistantIds),
      }),

    // --- Org-level knowledge hub (PRD #726) --------------------------------
    /** Org-wide knowledge items (the hub's table). */
    orgSources: (
      params: {
        kinds?: string[];
        status?: string;
        assistantId?: string;
        q?: string;
        page?: number;
        pageSize?: number;
      } = {}
    ): Promise<{
      items: Array<{
        id: string;
        collectionId: string;
        name: string;
        kind: string;
        status: string;
        conceptCount: number;
        answerPreview: string;
        linkedAssistants: Array<{
          assistantId: string;
          assistantName: string;
          directAccess: boolean;
        }>;
        lastCrawledAt: string | null;
        createdAt: string;
        updatedAt: string;
      }>;
      total: number;
      statusCounts: { processing: number; ready: number; error: number };
    }> => {
      const search = new URLSearchParams();
      if (params.kinds?.length) search.set("kinds", params.kinds.join(","));
      if (params.status) search.set("status", params.status);
      if (params.assistantId) search.set("assistantId", params.assistantId);
      if (params.q) search.set("q", params.q);
      if (params.page) search.set("page", String(params.page));
      if (params.pageSize) search.set("pageSize", String(params.pageSize));
      const qs = search.toString();
      return this.request("GET", `/knowledge/sources${qs ? `?${qs}` : ""}`);
    },
    /** Replace a Source's linked-assistant set. */
    setSourceLinks: (
      sourceId: string,
      assistantIds: string[]
    ): Promise<{
      links: Array<{
        assistantId: string;
        assistantName: string;
        directAccess: boolean;
      }>;
    }> =>
      this.request("PUT", p`/sources/${sourceId}/links`, {
        body: { assistantIds },
      }),
    /** Flip Direct access for one assistant on a file Source. */
    setDirectAccess: (
      sourceId: string,
      assistantId: string,
      directAccess: boolean
    ): Promise<{
      links: Array<{
        assistantId: string;
        assistantName: string;
        directAccess: boolean;
      }>;
    }> =>
      this.request("PUT", p`/sources/${sourceId}/direct-access`, {
        body: { assistantId, directAccess },
      }),
    /**
     * Org-level Source add: no Collection id, the server resolves the
     * Knowledge Library. The add path for a caller that holds an Assistant id
     * and nothing else, since `collections()` lists only Collections that
     * already hold Sources linked to that Assistant.
     */
    addOrgTextSource: (input: {
      name?: string;
      text: string;
      assistantIds: string[];
    }): Promise<ApiSource> =>
      this.request("POST", "/knowledge/sources", {
        body: { kind: "text", ...input },
      }),
    addOrgUrlSource: (url: string, assistantIds: string[]): Promise<ApiSource> =>
      this.request("POST", "/knowledge/sources", {
        body: { kind: "url", url, assistantIds },
      }),
    addOrgFileSource: (file: File, assistantIds: string[]): Promise<ApiSource> =>
      this.request("POST", "/knowledge/sources", { form: linkedForm(file, assistantIds) }),
    /** Org-level FAQ create (Knowledge Library + explicit links). */
    addOrgFaq: (input: {
      question: string;
      answer: string;
      assistantIds: string[];
    }): Promise<{
      id: string;
      sourceId: string | null;
      question: string;
      answer: string;
      path: string;
    }> => this.request("POST", "/knowledge/faqs", { body: input }),
    /** Org-level bulk FAQ import. */
    importOrgFaqs: (
      csv: File,
      assistantIds: string[]
    ): Promise<{ imported: number; skipped: string[] }> =>
      this.request("POST", "/knowledge/faqs/import", { form: linkedForm(csv, assistantIds) }),
    /** Org-wide FAQ CSV export (raw CSV text). */
    exportOrgFaqs: (): Promise<string> =>
      this.request("GET", "/knowledge/faqs/export", { parseText: true }),
    /**
     * The passages that answer `query`, each with its Document and Source:
     * retrieval without an answer, for a caller that brings its own model.
     * `assistantId` narrows the search to that Assistant's linked Sources.
     */
    search: (input: { query: string; assistantId?: string }): Promise<KnowledgeSearchResponse> =>
      this.request("POST", "/knowledge/search", { body: input }),
  };

  readonly publish = {
    status: (assistantId: string): Promise<PublicationStatus> =>
      this.request("GET", p`/assistants/${assistantId}/publish`),
    publish: (
      assistantId: string
    ): Promise<{ version: number; publicationId: string }> =>
      this.request("POST", p`/assistants/${assistantId}/publish`),
    unpublish: (assistantId: string): Promise<void> =>
      this.request("DELETE", p`/assistants/${assistantId}/publish`),
    republish: (
      assistantId: string,
      publicationId: string
    ): Promise<{ version: number; publicationId: string }> =>
      this.request("POST", p`/assistants/${assistantId}/republish`, {
        body: { publicationId },
      }),
  };

  readonly conversations = {
    list: (
      params: ListParams & { assistantId?: string } = {}
    ): Promise<Page<{ id: string; assistantId: string }>> =>
      this.request("GET", "/conversations", { query: { ...params } }),
    get: (id: string): Promise<{ conversation: unknown; messages: unknown[] }> =>
      this.request("GET", p`/conversations/${id}`),
    export: (conversationIds: string[]): Promise<{ data: unknown[] }> =>
      this.request("POST", "/conversations/export", { body: { conversationIds } }),
    setPinned: (id: string, pinned: boolean): Promise<unknown> =>
      this.request("PATCH", p`/conversations/${id}`, {
        body: { pinned },
      }),
    feedback: (id: string, text: string): Promise<unknown> =>
      this.request("POST", p`/conversations/${id}/feedback`, {
        body: { text },
      }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", p`/conversations/${id}`),
  };

  readonly messages = {
    setFeedback: (id: string, feedback: -1 | 0 | 1): Promise<unknown> =>
      this.request("PATCH", p`/messages/${id}/feedback`, {
        body: { feedback },
      }),
  };

  readonly improvements = {
    list: (params: ListParams = {}): Promise<Page<{ id: string }>> =>
      this.request("GET", "/improvements", { query: { ...params } }),
    get: (id: string): Promise<unknown> =>
      this.request("GET", p`/improvements/${id}`),
    update: (id: string, patch: ImprovementPatch): Promise<unknown> =>
      this.request("PATCH", p`/improvements/${id}`, { body: patch }),
  };

  readonly memories = {
    settings: (): Promise<{ enabled: boolean }> =>
      this.request("GET", "/memories/settings"),
    setEnabled: (enabled: boolean): Promise<{ enabled: boolean }> =>
      this.request("PATCH", "/memories/settings", { body: { enabled } }),
    subjects: (params: ListParams = {}): Promise<Page<MemorySubjectSummary>> =>
      this.request("GET", "/memories/subjects", { query: { ...params } }),
    list: (subjectId: string): Promise<{ data: Memory[] }> =>
      this.request("GET", p`/memories/subjects/${subjectId}`),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", p`/memories/${id}`),
    wipe: (subjectId: string): Promise<void> =>
      this.request("DELETE", p`/memories/subjects/${subjectId}`),
  };

  readonly sso = {
    identity: (): Promise<
      | { connected: false }
      | {
          connected: true;
          provider: string;
          identityClaim: string | null;
          validationStatus: string;
        }
    > => this.request("GET", "/sso/identity"),
    setIdentityClaim: (
      identityClaim: string | null
    ): Promise<{ identityClaim: string | null }> =>
      this.request("PATCH", "/sso/identity", { body: { identityClaim } }),
    validate: (): Promise<{ ok: boolean; error?: string }> =>
      this.request("POST", "/sso/identity/validate"),
    connection: (): Promise<
      | { connected: false }
      | {
          connected: true;
          provider: string;
          config: { clientId: string; tenantId: string; identityClaim?: string };
          hasClientSecret: boolean;
          validationStatus: string;
          validatedAt: string | null;
        }
    > => this.request("GET", "/sso/connection"),
    connect: (input: {
      provider: "entra" | "clerk" | "workos";
      clientId: string;
      tenantId: string;
      clientSecret: string;
      identityClaim?: string;
    }): Promise<unknown> =>
      this.request("PUT", "/sso/connection", { body: input }),
    disconnect: (): Promise<void> =>
      this.request("DELETE", "/sso/connection"),
  };

  /**
   * AI Teammates (#768). A key acts as the Member who minted it, so `list`
   * hides the private Teammates that Member may not see and `conversations`
   * returns that Member's own thread, never a colleague's.
   */
  readonly teammates = {
    list: (): Promise<{ data: Teammate[] }> => this.request("GET", "/teammates"),
    get: (id: string): Promise<Teammate> =>
      this.request("GET", p`/teammates/${id}`),
    runtime: (id: string): Promise<{ config: TeammateRuntimeConfig; computerConfigured: boolean; harnesses: { id: string; name: string }[] }> =>
      this.request("GET", p`/teammates/${id}/runtime`),
    setRuntime: (id: string, config: TeammateRuntimeConfig): Promise<Teammate> =>
      this.request("PUT", p`/teammates/${id}/runtime`, { body: config }),
    /** The caller's AG-UI library decodes SSE; cancellation reaches the persisted turn. */
    agUi: (id: string, input: unknown, options: { signal?: AbortSignal } = {}): Promise<Response> =>
      this.requestResponse("POST", p`/teammates/${id}/ag-ui`, { body: input, signal: options.signal, accept: "text/event-stream" }),
    create: (input: Omit<TeammateInput, "organizationId" | "ownerId">): Promise<Teammate> =>
      this.request("POST", "/teammates", { body: input }),

    /**
     * Persona, grants and routines in one call. `create` leaves a colleague
     * that answers and cannot act, because grants are absence-is-refusal; this
     * is the call that finishes the job. It adds no reach: granting still needs
     * an admin-tier key and comes back as `partial: "grants"` rather than
     * discarding the Teammate that was already created.
     */
    provision: (
      input: Omit<TeammateInput, "organizationId" | "ownerId"> & {
        grants?: string[];
        ceiling?: string;
        approvalBypass?: boolean;
        routines?: Array<{
          instruction: string;
          cadence: string;
          hour?: number;
        }>;
      },
      opts: { idempotencyKey?: string } = {}
    ): Promise<{
      teammate: Teammate;
      governance: TeammateGovernance | null;
      routines: TeammateRoutine[];
      partial: "grants" | "routines" | null;
      reason: string | null;
    }> => this.request("POST", "/teammates/provision", { body: input, ...opts }),
    update: (id: string, patch: TeammatePatch): Promise<Teammate> =>
      this.request("PATCH", p`/teammates/${id}`, { body: patch }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", p`/teammates/${id}`),
    conversations: (id: string): Promise<{ data: Conversation[] }> =>
      this.request("GET", p`/teammates/${id}/conversations`),
    conversation: (
      id: string,
      conversationId: string
    ): Promise<ApiTeammateConversation> =>
      this.request(
        "GET",
        p`/teammates/${id}/conversations/${conversationId}`
      ),

    /**
     * Governance (#770). Reading is a Member right; `setGrants` needs an
     * admin-tier key, a rung above the `edit` that renames the Teammate,
     * because arming an agent is the same kind of decision as handing a person
     * a Role. The write replaces the whole set.
     */
    grants: (id: string): Promise<TeammateGovernance> =>
      this.request("GET", p`/teammates/${id}/grants`),
    setGrants: (
      id: string,
      input: {
        domains: string[];
        ceiling?: string;
        approvalBypass?: boolean;
      }
    ): Promise<TeammateGovernance> =>
      this.request("PUT", p`/teammates/${id}/grants`, {
        body: input,
      }),

    /** Routines (#772): unattended recurring runs, max 5 per Teammate. */
    routines: (id: string): Promise<{ data: TeammateRoutine[] }> =>
      this.request("GET", p`/teammates/${id}/routines`),
    addRoutine: (
      id: string,
      input: { instruction: string; cadence: string; hour?: number },
      opts: { idempotencyKey?: string } = {}
    ): Promise<TeammateRoutine> =>
      this.request("POST", p`/teammates/${id}/routines`, {
        body: input,
        ...opts,
      }),
    updateRoutine: (
      routineId: string,
      patch: {
        instruction?: string;
        cadence?: string;
        hour?: number;
        enabled?: boolean;
      }
    ): Promise<TeammateRoutine> =>
      this.request("PATCH", p`/routines/${routineId}`, {
        body: patch,
      }),
    deleteRoutine: (routineId: string): Promise<void> =>
      this.request("DELETE", p`/routines/${routineId}`),

    /**
     * The Agent memory layer (#771). Its sibling, the User layer, has no
     * endpoint on purpose: that document is the Member's alone, and a key acts
     * as the Member who minted it.
     */
    memory: (id: string): Promise<ApiMemoryDocumentView> =>
      this.request("GET", p`/teammates/${id}/memory`),
    setMemory: (
      id: string,
      input: { body: string; note?: string }
    ): Promise<MemoryDocument> =>
      this.request("PUT", p`/teammates/${id}/memory`, {
        body: input,
      }),
  };

  /**
   * Projects (#771): the shared workspace a Teammate attaches to, and the owner
   * of the Project memory layer. `get` returns the row with its document and
   * that document's history, because for a Teammate they are one thing.
   */
  readonly projects = {
    list: (): Promise<{ data: Project[] }> => this.request("GET", "/projects"),
    get: (
      id: string
    ): Promise<{ project: Project } & ApiMemoryDocumentView> =>
      this.request("GET", p`/projects/${id}`),
    create: (
      input: { name: string; description?: string },
      opts: { idempotencyKey?: string } = {}
    ): Promise<Project> =>
      this.request("POST", "/projects", { body: input, ...opts }),
    update: (id: string, patch: ProjectPatch): Promise<Project> =>
      this.request("PATCH", p`/projects/${id}`, {
        body: patch,
      }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", p`/projects/${id}`),
    setDocument: (
      id: string,
      input: { body: string; note?: string }
    ): Promise<MemoryDocument> =>
      this.request("PUT", p`/projects/${id}/document`, {
        body: input,
      }),
  };

  /**
   * Teammate channels (#778): the group threads Members share with Teammates.
   *
   * Membership is the visibility rule, and a key acts as the Member who minted
   * it, so `list` returns that Member's channels and nobody else's. There is no
   * `post`: a message starts a bounded chain of model turns, which belongs to
   * the console's streaming route rather than to a request/response API.
   */
  readonly channels = {
    /**
     * Owner/Admin oversight: every channel in the Organization, and any one
     * channel's transcript, without being seated in it. Deliberately separate
     * paths rather than a flag on the ordinary reads, because a flag on a read
     * is how an oversight surface quietly becomes the default one.
     */
    oversight: (): Promise<{ data: ApiChannelSummary[] }> =>
      this.request("GET", "/channels/oversight"),
    oversightRead: (id: string): Promise<ApiChannelView> =>
      this.request("GET", p`/channels/oversight/${id}`),

    list: (): Promise<{ data: ApiChannelSummary[] }> =>
      this.request("GET", "/channels"),
    get: (id: string): Promise<ApiChannelView> =>
      this.request("GET", p`/channels/${id}`),
    create: (input: {
      name: string;
      memberIds?: string[];
      teammateIds?: string[];
      projectId?: string | null;
    }): Promise<TeammateChannel> => this.request("POST", "/channels", { body: input }),
    update: (
      id: string,
      patch: { name?: string; projectId?: string | null }
    ): Promise<TeammateChannel> =>
      this.request("PATCH", p`/channels/${id}`, { body: patch }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", p`/channels/${id}`),
    addMembers: (id: string, userIds: string[]): Promise<void> =>
      this.request("POST", p`/channels/${id}/members`, {
        body: { userIds },
      }),
    removeMember: (id: string, userId: string): Promise<void> =>
      this.request(
        "DELETE",
        p`/channels/${id}/members/${userId}`
      ),
    addTeammates: (id: string, teammateIds: string[]): Promise<void> =>
      this.request("POST", p`/channels/${id}/teammates`, {
        body: { teammateIds },
      }),
    removeTeammate: (id: string, teammateId: string): Promise<void> =>
      this.request(
        "DELETE",
        p`/channels/${id}/teammates/${teammateId}`
      ),
  };

  readonly helpDesks = {
    list: (): Promise<{ data: ApiHelpDesk[] }> =>
      this.request("GET", "/help-desks"),
    get: (id: string): Promise<{ desk: ApiHelpDesk; channels: ApiSupportChannel[] }> =>
      this.request("GET", p`/help-desks/${id}`),
    create: (input: { name: string; description?: string }): Promise<ApiHelpDesk> =>
      this.request("POST", "/help-desks", { body: input }),
    update: (
      id: string,
      patch: {
        name?: string;
        description?: string;
        autoGenerateImprovements?: boolean;
      }
    ): Promise<ApiHelpDesk> =>
      this.request("PATCH", p`/help-desks/${id}`, { body: patch }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", p`/help-desks/${id}`),
    addChannel: (helpDeskId: string, input: SupportChannelInput): Promise<ApiSupportChannel> =>
      this.request("POST", p`/help-desks/${helpDeskId}/channels`, {
        body: input,
      }),
    updateChannel: (
      helpDeskId: string,
      channelId: string,
      patch: SupportChannelPatch
    ): Promise<ApiSupportChannel> =>
      this.request(
        "PATCH",
        p`/help-desks/${helpDeskId}/channels/${channelId}`,
        { body: patch }
      ),
    deleteChannel: (helpDeskId: string, channelId: string): Promise<void> =>
      this.request(
        "DELETE",
        p`/help-desks/${helpDeskId}/channels/${channelId}`
      ),
    reorderChannels: (
      helpDeskId: string,
      orderedIds: string[]
    ): Promise<{ data: ApiSupportChannel[] }> =>
      this.request(
        "POST",
        p`/help-desks/${helpDeskId}/channels/reorder`,
        { body: { orderedIds } }
      ),
    connectServiceNow: (
      helpDeskId: string,
      input: {
        name: string;
        baseUrl: string;
        clientId: string;
        clientSecret: string;
        username: string;
        password: string;
      }
    ): Promise<ApiHelpDesk> =>
      this.request(
        "POST",
        p`/help-desks/${helpDeskId}/ticketing/servicenow`,
        { body: input }
      ),
    disconnectTicketing: (helpDeskId: string): Promise<ApiHelpDesk> =>
      this.request(
        "DELETE",
        p`/help-desks/${helpDeskId}/ticketing`
      ),
  };

  readonly skills = {
    list: (): Promise<{ data: Skill[] }> => this.request("GET", "/skills"),
    create: (input: SkillInput): Promise<Skill> =>
      this.request("POST", "/skills", { body: input }),
    update: (id: string, patch: SkillPatch): Promise<Skill> =>
      this.request("PATCH", p`/skills/${id}`, { body: patch }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", p`/skills/${id}`),
  };

  readonly goals = {
    list: (assistantId: string): Promise<{ data: AssistantGoal[] }> =>
      this.request("GET", p`/assistants/${assistantId}/goals`),
    create: (
      assistantId: string,
      input: { question: string; expectations: GoalExpectations }
    ): Promise<AssistantGoal> =>
      this.request("POST", p`/assistants/${assistantId}/goals`, {
        body: input,
      }),
    update: (
      assistantId: string,
      goalId: string,
      patch: {
        question?: string;
        expectations?: GoalExpectations;
        status?: GoalStatus;
      }
    ): Promise<AssistantGoal> =>
      this.request(
        "PATCH",
        p`/assistants/${assistantId}/goals/${goalId}`,
        { body: patch }
      ),
    delete: (assistantId: string, goalId: string): Promise<void> =>
      this.request(
        "DELETE",
        p`/assistants/${assistantId}/goals/${goalId}`
      ),
  };

  readonly alerts = {
    list: (): Promise<{ data: Alert[] }> => this.request("GET", "/alerts"),
    resolve: (id: string): Promise<Alert> =>
      this.request("POST", p`/alerts/${id}/resolve`),
  };

  readonly organization = {
    get: (): Promise<Organization> => this.request("GET", "/organization"),
    update: (patch: OrganizationPatch): Promise<Organization> =>
      this.request("PATCH", "/organization", { body: patch }),
  };

  readonly members = {
    list: (): Promise<{ data: Member[] }> => this.request("GET", "/members"),
    setRole: (userId: string, role: Role): Promise<Member> =>
      this.request("PATCH", p`/members/${userId}`, {
        body: { role },
      }),
    remove: (userId: string): Promise<void> =>
      this.request("DELETE", p`/members/${userId}`),
  };

  readonly invites = {
    list: (): Promise<{ data: Invite[] }> => this.request("GET", "/invites"),
    create: (input: { role: Role; email?: string }): Promise<Invite> =>
      this.request("POST", "/invites", { body: input }),
    revoke: (id: string): Promise<void> =>
      this.request("DELETE", p`/invites/${id}`),
  };

  readonly apiKeys = {
    list: (): Promise<{ data: OrgApiKey[] }> => this.request("GET", "/api-keys"),
    create: (input: {
      name: string;
      role: Role;
    }): Promise<{ apiKey: OrgApiKey; secret: string }> =>
      this.request("POST", "/api-keys", { body: input }),
    revoke: (id: string): Promise<void> =>
      this.request("DELETE", p`/api-keys/${id}`),
  };

  /**
   * Usage (#853), read-only. A purchase has no client method on purpose: it
   * belongs to a surface where a person confirms an amount.
   */
  readonly usage = {
    meters: (): Promise<unknown> => this.request("GET", "/usage/meters"),
    spenders: (window: { from?: string; to?: string } = {}): Promise<unknown> =>
      this.request("GET", "/usage/spenders", {
        query: { from: window.from || undefined, to: window.to || undefined },
      }),
  };

  readonly apiIntegrations = {
    get: (assistantId: string): Promise<ApiIntegrationView | null> =>
      this.request(
        "GET",
        p`/assistants/${assistantId}/api-integration`
      ),
    set: (
      assistantId: string,
      input: {
        name: string;
        baseUrl: string;
        authType: ApiIntegrationAuthType;
        authHeaderName?: string;
        authUsername?: string;
        credential?: string;
        endpoints: ApiEndpointSpec[];
      }
    ): Promise<ApiIntegrationView> =>
      this.request(
        "PUT",
        p`/assistants/${assistantId}/api-integration`,
        { body: input }
      ),
    delete: (assistantId: string): Promise<void> =>
      this.request(
        "DELETE",
        p`/assistants/${assistantId}/api-integration`
      ),
  };

  /** Application Connections as the Connector action sees them (#839). */
  readonly applications = {
    list: (provider?: string): Promise<{ data: ApplicationConnectionView[] }> =>
      this.request("GET", "/applications/connections", {
        query: { provider: provider || undefined },
      }),
    connectors: (provider?: string): Promise<{ data: ConnectorActionView[] }> =>
      this.request("GET", "/applications/connectors", {
        query: { provider: provider || undefined },
      }),
    reconsent: (
      id: string,
      input: { actions?: string[]; scopes?: string[] } = {}
    ): Promise<ApplicationReconsentView> =>
      this.request("POST", p`/applications/connections/${id}/reconsent`, {
        body: input,
      }),
  };

  /** Human review requests (#841). */
  readonly reviews = {
    list: (
      params: { status?: string; conversationId?: string; assistantId?: string } = {}
    ): Promise<{ data: ReviewRequestView[] }> =>
      this.request("GET", "/reviews", { query: { ...params } }),
    get: (id: string): Promise<ReviewRequestView> =>
      this.request("GET", p`/reviews/${id}`),
    decide: (
      id: string,
      input: { decision: "approved" | "rejected"; inputs?: Record<string, string> }
    ): Promise<ReviewRequestView> =>
      this.request("POST", p`/reviews/${id}/decide`, { body: input }),
  };

  readonly providers = {
    list: (): Promise<{ data: ProviderConnectionView[] }> =>
      this.request("GET", "/providers"),
    createApiKey: (input: {
      provider: "anthropic" | "openai" | "google" | "elevenlabs" | "ai_gateway";
      apiKey: string;
      displayName?: string;
    }): Promise<{ connection?: ProviderConnectionView; error?: string }> =>
      this.request("POST", "/providers/api-key", { body: input }),
    createCompatible: (input: {
      displayName?: string;
      baseUrl: string;
      apiKey?: string;
      chatModel: string;
      embeddingModel?: string;
    }): Promise<{ connection?: ProviderConnectionView; error?: string }> =>
      this.request("POST", "/providers/openai-compatible", { body: input }),
    createFederated: (input: Record<string, unknown>): Promise<ProviderConnectionView> =>
      this.request("POST", "/providers/federated", { body: input }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", p`/providers/${id}`),
    setEmbedding: (connectionId: string | null): Promise<{ connectionId: string | null }> =>
      this.request("PATCH", "/providers/embedding", { body: { connectionId } }),
  };
}
