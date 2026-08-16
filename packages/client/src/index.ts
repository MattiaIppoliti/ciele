import type {
  AssistantPatch,
  Flow,
  FlowInput,
  FlowPatch,
  ImprovementPatch,
  Entity,
  EntityInput,
  EntityRecord,
  EntityRecordQuery,
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
  ProviderConnection,
  TicketingPlatform,
} from "@agent-hub/core";

/**
 * `@ciele/client` — the typed /api/v1 client the CLI (#627) and the MCP
 * server (#629) share. Mirrors the endpoint registry in the web app's
 * `api-v1/openapi.ts` method-for-method; the drift test there keeps the
 * registry honest against the routes, and this package mirrors the registry.
 *
 * Works identically against the SaaS and a self-hosted deployment — the
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

export const DEFAULT_CIELE_BASE_URL = "https://platform.ciele.app";

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

/** `GET /whoami` — the key's own identity (#627). */
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

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
    };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

    const response = await this.fetchImpl(url.toString(), {
      method,
      headers,
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
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** Like `request`, for endpoints that answer raw text (e.g. CSV exports). */
  private async requestText(path: string): Promise<string> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    const response = await this.fetchImpl(url.toString(), {
      method: "GET",
      headers: { authorization: `Bearer ${this.apiKey}` },
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
    return response.text();
  }

  /**
   * Walks a paginated listing to exhaustion — `for await` over every item.
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

  /** `GET /meta` — what this deployment speaks. Useful before anything else. */
  meta(): Promise<ApiMeta> {
    return this.request("GET", "/meta");
  }

  /** `GET /whoami` — the Organization and Role this key acts with. */
  whoami(): Promise<ApiWhoami> {
    return this.request("GET", "/whoami");
  }

  readonly assistants = {
    list: (params: ListParams = {}): Promise<Page<ApiAssistant>> =>
      this.request("GET", "/assistants", { query: { ...params } }),
    listAll: (): AsyncGenerator<ApiAssistant> => this.paginate("/assistants"),
    get: (id: string): Promise<ApiAssistant> =>
      this.request("GET", `/assistants/${id}`),
    create: (
      input: { title: string; nickname?: string; description?: string },
      opts: { idempotencyKey?: string } = {}
    ): Promise<ApiAssistant> =>
      this.request("POST", "/assistants", { body: input, ...opts }),
    update: (id: string, patch: AssistantPatch): Promise<ApiAssistant> =>
      this.request("PATCH", `/assistants/${id}`, { body: patch }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", `/assistants/${id}`),
    duplicate: (id: string): Promise<ApiAssistant> =>
      this.request("POST", `/assistants/${id}/duplicate`),
    entities: (id: string): Promise<{ entityIds: string[] }> =>
      this.request("GET", `/assistants/${encodeURIComponent(id)}/entities`),
    setEntities: (id: string, entityIds: string[]): Promise<{ entityIds: string[] }> =>
      this.request("PATCH", `/assistants/${encodeURIComponent(id)}/entities`, {
        body: { entityIds },
      }),
    skills: (id: string): Promise<{ data: Skill[] }> =>
      this.request("GET", `/assistants/${encodeURIComponent(id)}/skills`),
    setSkills: (id: string, skillIds: string[]): Promise<{ data: Skill[] }> =>
      this.request("PATCH", `/assistants/${encodeURIComponent(id)}/skills`, {
        body: { skillIds },
      }),
  };

  readonly flows = {
    list: (assistantId: string): Promise<{ data: Flow[] }> =>
      this.request("GET", `/assistants/${assistantId}/flows`),
    get: (id: string): Promise<Flow> => this.request("GET", `/flows/${id}`),
    create: (assistantId: string, input: FlowInput): Promise<Flow> =>
      this.request("POST", `/assistants/${assistantId}/flows`, { body: input }),
    update: (id: string, patch: FlowPatch): Promise<Flow> =>
      this.request("PATCH", `/flows/${id}`, { body: patch }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", `/flows/${id}`),
    reorder: (assistantId: string, orderedIds: string[]): Promise<{ data: Flow[] }> =>
      this.request("POST", `/assistants/${assistantId}/flows/reorder`, {
        body: { orderedIds },
      }),
  };

  readonly knowledge = {
    collections: (assistantId: string): Promise<{ data: KnowledgeCollection[] }> =>
      this.request("GET", `/assistants/${assistantId}/collections`),
    sources: (collectionId: string): Promise<{ data: ApiSource[] }> =>
      this.request("GET", `/collections/${collectionId}/sources`),
    addTextSource: (
      collectionId: string,
      input: { name?: string; text: string }
    ): Promise<ApiSource> =>
      this.request("POST", `/collections/${collectionId}/sources`, {
        body: { kind: "text", ...input },
      }),
    addUrlSource: (collectionId: string, url: string): Promise<ApiSource> =>
      this.request("POST", `/collections/${collectionId}/sources`, {
        body: { kind: "url", url },
      }),
    /** Multipart file upload; pass a File/Blob (Node 20+ has both). */
    addFileSource: (collectionId: string, file: File): Promise<ApiSource> => {
      const form = new FormData();
      form.set("file", file);
      return this.request("POST", `/collections/${collectionId}/sources`, { form });
    },
    getSource: (id: string): Promise<ApiSource> =>
      this.request("GET", `/sources/${id}`),
    deleteSource: (id: string): Promise<void> =>
      this.request("DELETE", `/sources/${id}`),
    recrawlSource: (id: string): Promise<{ ok: true }> =>
      this.request("POST", `/sources/${id}/recrawl`),
    addFaq: (
      collectionId: string,
      input: { question: string; answer: string }
    ): Promise<{ id: string; question: string; answer: string; path: string }> =>
      this.request("POST", `/collections/${collectionId}/faqs`, { body: input }),
    importFaqs: (
      collectionId: string,
      csv: File
    ): Promise<{ imported: number; skipped: string[] }> => {
      const form = new FormData();
      form.set("file", csv);
      return this.request("POST", `/collections/${collectionId}/faqs/import`, {
        form,
      });
    },

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
      this.request("PUT", `/sources/${sourceId}/links`, {
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
      this.request("PUT", `/sources/${sourceId}/direct-access`, {
        body: { assistantId, directAccess },
      }),
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
    ): Promise<{ imported: number; skipped: string[] }> => {
      const form = new FormData();
      form.set("file", csv);
      form.set("assistantIds", JSON.stringify(assistantIds));
      return this.request("POST", "/knowledge/faqs/import", { form });
    },
    /** Org-wide FAQ CSV export (raw CSV text). */
    exportOrgFaqs: (): Promise<string> =>
      this.requestText("/knowledge/faqs/export"),
  };

  readonly publish = {
    status: (assistantId: string): Promise<PublicationStatus> =>
      this.request("GET", `/assistants/${assistantId}/publish`),
    publish: (
      assistantId: string
    ): Promise<{ version: number; publicationId: string }> =>
      this.request("POST", `/assistants/${assistantId}/publish`),
    unpublish: (assistantId: string): Promise<void> =>
      this.request("DELETE", `/assistants/${assistantId}/publish`),
    republish: (
      assistantId: string,
      publicationId: string
    ): Promise<{ version: number; publicationId: string }> =>
      this.request("POST", `/assistants/${assistantId}/republish`, {
        body: { publicationId },
      }),
  };

  readonly conversations = {
    list: (
      params: ListParams & { assistantId?: string } = {}
    ): Promise<Page<{ id: string; assistantId: string }>> =>
      this.request("GET", "/conversations", { query: { ...params } }),
    get: (id: string): Promise<{ conversation: unknown; messages: unknown[] }> =>
      this.request("GET", `/conversations/${id}`),
    export: (conversationIds: string[]): Promise<{ data: unknown[] }> =>
      this.request("POST", "/conversations/export", { body: { conversationIds } }),
    setPinned: (id: string, pinned: boolean): Promise<unknown> =>
      this.request("PATCH", `/conversations/${encodeURIComponent(id)}`, {
        body: { pinned },
      }),
    feedback: (id: string, text: string): Promise<unknown> =>
      this.request("POST", `/conversations/${encodeURIComponent(id)}/feedback`, {
        body: { text },
      }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", `/conversations/${encodeURIComponent(id)}`),
  };

  readonly messages = {
    setFeedback: (id: string, feedback: -1 | 0 | 1): Promise<unknown> =>
      this.request("PATCH", `/messages/${encodeURIComponent(id)}/feedback`, {
        body: { feedback },
      }),
  };

  readonly improvements = {
    list: (params: ListParams = {}): Promise<Page<{ id: string }>> =>
      this.request("GET", "/improvements", { query: { ...params } }),
    get: (id: string): Promise<unknown> =>
      this.request("GET", `/improvements/${id}`),
    update: (id: string, patch: ImprovementPatch): Promise<unknown> =>
      this.request("PATCH", `/improvements/${id}`, { body: patch }),
  };

  readonly entities = {
    list: (params: ListParams = {}): Promise<Page<Entity>> =>
      this.request("GET", "/entities", { query: { ...params } }),
    get: (id: string): Promise<Entity> =>
      this.request("GET", `/entities/${encodeURIComponent(id)}`),
    create: (input: EntityInput): Promise<Entity> =>
      this.request("POST", "/entities", { body: input }),
    update: (
      id: string,
      patch: { name?: string; description?: string }
    ): Promise<Entity> =>
      this.request("PATCH", `/entities/${encodeURIComponent(id)}`, { body: patch }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", `/entities/${encodeURIComponent(id)}`),
    listRecords: (
      entityId: string,
      params: { limit?: number; offset?: number } = {}
    ): Promise<{ data: EntityRecord[]; total: number }> =>
      this.request("GET", `/entities/${encodeURIComponent(entityId)}/records`, {
        query: params,
      }),
    queryRecords: (
      entityId: string,
      query: EntityRecordQuery
    ): Promise<{ data: EntityRecord[] }> =>
      this.request("POST", `/entities/${encodeURIComponent(entityId)}/records/query`, {
        body: query,
      }),
    importRecords: (
      entityId: string,
      csv: string
    ): Promise<{ upserted: number; rejected: string[] }> =>
      this.request("POST", `/entities/${encodeURIComponent(entityId)}/records/import`, {
        body: { csv },
      }),
  };

  readonly memories = {
    settings: (): Promise<{ enabled: boolean }> =>
      this.request("GET", "/memories/settings"),
    setEnabled: (enabled: boolean): Promise<{ enabled: boolean }> =>
      this.request("PATCH", "/memories/settings", { body: { enabled } }),
    subjects: (params: ListParams = {}): Promise<Page<MemorySubjectSummary>> =>
      this.request("GET", "/memories/subjects", { query: { ...params } }),
    list: (subjectId: string): Promise<{ data: Memory[] }> =>
      this.request("GET", `/memories/subjects/${encodeURIComponent(subjectId)}`),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", `/memories/${encodeURIComponent(id)}`),
    wipe: (subjectId: string): Promise<void> =>
      this.request("DELETE", `/memories/subjects/${encodeURIComponent(subjectId)}`),
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

  readonly helpDesks = {
    list: (): Promise<{ data: ApiHelpDesk[] }> =>
      this.request("GET", "/help-desks"),
    get: (id: string): Promise<{ desk: ApiHelpDesk; channels: ApiSupportChannel[] }> =>
      this.request("GET", `/help-desks/${encodeURIComponent(id)}`),
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
      this.request("PATCH", `/help-desks/${encodeURIComponent(id)}`, { body: patch }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", `/help-desks/${encodeURIComponent(id)}`),
    addChannel: (helpDeskId: string, input: SupportChannelInput): Promise<ApiSupportChannel> =>
      this.request("POST", `/help-desks/${encodeURIComponent(helpDeskId)}/channels`, {
        body: input,
      }),
    updateChannel: (
      helpDeskId: string,
      channelId: string,
      patch: SupportChannelPatch
    ): Promise<ApiSupportChannel> =>
      this.request(
        "PATCH",
        `/help-desks/${encodeURIComponent(helpDeskId)}/channels/${encodeURIComponent(channelId)}`,
        { body: patch }
      ),
    deleteChannel: (helpDeskId: string, channelId: string): Promise<void> =>
      this.request(
        "DELETE",
        `/help-desks/${encodeURIComponent(helpDeskId)}/channels/${encodeURIComponent(channelId)}`
      ),
    reorderChannels: (
      helpDeskId: string,
      orderedIds: string[]
    ): Promise<{ data: ApiSupportChannel[] }> =>
      this.request(
        "POST",
        `/help-desks/${encodeURIComponent(helpDeskId)}/channels/reorder`,
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
        `/help-desks/${encodeURIComponent(helpDeskId)}/ticketing/servicenow`,
        { body: input }
      ),
    disconnectTicketing: (helpDeskId: string): Promise<ApiHelpDesk> =>
      this.request(
        "DELETE",
        `/help-desks/${encodeURIComponent(helpDeskId)}/ticketing`
      ),
  };

  readonly skills = {
    list: (): Promise<{ data: Skill[] }> => this.request("GET", "/skills"),
    create: (input: SkillInput): Promise<Skill> =>
      this.request("POST", "/skills", { body: input }),
    update: (id: string, patch: SkillPatch): Promise<Skill> =>
      this.request("PATCH", `/skills/${encodeURIComponent(id)}`, { body: patch }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", `/skills/${encodeURIComponent(id)}`),
  };

  readonly goals = {
    list: (assistantId: string): Promise<{ data: AssistantGoal[] }> =>
      this.request("GET", `/assistants/${encodeURIComponent(assistantId)}/goals`),
    create: (
      assistantId: string,
      input: { question: string; expectations: GoalExpectations }
    ): Promise<AssistantGoal> =>
      this.request("POST", `/assistants/${encodeURIComponent(assistantId)}/goals`, {
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
        `/assistants/${encodeURIComponent(assistantId)}/goals/${encodeURIComponent(goalId)}`,
        { body: patch }
      ),
    delete: (assistantId: string, goalId: string): Promise<void> =>
      this.request(
        "DELETE",
        `/assistants/${encodeURIComponent(assistantId)}/goals/${encodeURIComponent(goalId)}`
      ),
  };

  readonly alerts = {
    list: (): Promise<{ data: Alert[] }> => this.request("GET", "/alerts"),
    resolve: (id: string): Promise<Alert> =>
      this.request("POST", `/alerts/${encodeURIComponent(id)}/resolve`),
  };

  readonly organization = {
    get: (): Promise<Organization> => this.request("GET", "/organization"),
    update: (patch: OrganizationPatch): Promise<Organization> =>
      this.request("PATCH", "/organization", { body: patch }),
  };

  readonly members = {
    list: (): Promise<{ data: Member[] }> => this.request("GET", "/members"),
    setRole: (userId: string, role: Role): Promise<Member> =>
      this.request("PATCH", `/members/${encodeURIComponent(userId)}`, {
        body: { role },
      }),
    remove: (userId: string): Promise<void> =>
      this.request("DELETE", `/members/${encodeURIComponent(userId)}`),
  };

  readonly invites = {
    list: (): Promise<{ data: Invite[] }> => this.request("GET", "/invites"),
    create: (input: { role: Role; email?: string }): Promise<Invite> =>
      this.request("POST", "/invites", { body: input }),
    revoke: (id: string): Promise<void> =>
      this.request("DELETE", `/invites/${encodeURIComponent(id)}`),
  };

  readonly apiKeys = {
    list: (): Promise<{ data: OrgApiKey[] }> => this.request("GET", "/api-keys"),
    create: (input: {
      name: string;
      role: Role;
    }): Promise<{ apiKey: OrgApiKey; secret: string }> =>
      this.request("POST", "/api-keys", { body: input }),
    revoke: (id: string): Promise<void> =>
      this.request("DELETE", `/api-keys/${encodeURIComponent(id)}`),
  };

  readonly apiIntegrations = {
    get: (assistantId: string): Promise<ApiIntegrationView | null> =>
      this.request(
        "GET",
        `/assistants/${encodeURIComponent(assistantId)}/api-integration`
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
        `/assistants/${encodeURIComponent(assistantId)}/api-integration`,
        { body: input }
      ),
    delete: (assistantId: string): Promise<void> =>
      this.request(
        "DELETE",
        `/assistants/${encodeURIComponent(assistantId)}/api-integration`
      ),
  };

  readonly providers = {
    list: (): Promise<{ data: ProviderConnectionView[] }> =>
      this.request("GET", "/providers"),
    createApiKey: (input: {
      provider: "anthropic" | "openai" | "google";
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
      embeddingDims?: number;
    }): Promise<{ connection?: ProviderConnectionView; error?: string }> =>
      this.request("POST", "/providers/openai-compatible", { body: input }),
    createFederated: (input: Record<string, unknown>): Promise<ProviderConnectionView> =>
      this.request("POST", "/providers/federated", { body: input }),
    delete: (id: string): Promise<void> =>
      this.request("DELETE", `/providers/${encodeURIComponent(id)}`),
    setEmbedding: (connectionId: string | null): Promise<{ connectionId: string | null }> =>
      this.request("PATCH", "/providers/embedding", { body: { connectionId } }),
  };
}
