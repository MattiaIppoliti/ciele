import type {
  AssistantPatch,
  Flow,
  FlowInput,
  FlowPatch,
  ImprovementPatch,
  KnowledgeCollection,
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
    this.baseUrl = (options.baseUrl ?? "https://platform.ciele.app").replace(/\/+$/, "");
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
  };

  readonly improvements = {
    list: (params: ListParams = {}): Promise<Page<{ id: string }>> =>
      this.request("GET", "/improvements", { query: { ...params } }),
    get: (id: string): Promise<unknown> =>
      this.request("GET", `/improvements/${id}`),
    update: (id: string, patch: ImprovementPatch): Promise<unknown> =>
      this.request("PATCH", `/improvements/${id}`, { body: patch }),
  };
}
