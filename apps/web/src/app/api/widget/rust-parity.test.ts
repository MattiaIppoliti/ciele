import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createServer as createHttpServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { sealSecret } from "@agent-hub/core";
import { createDb, type Db } from "@agent-hub/db";
import { createPgliteSupabaseClient, createSchemaLoadedPglite } from "@agent-hub/db/testing";
import { RUST_WIDGET_ROUTES } from "@/lib/rust-routing";
import { sealGate } from "@/lib/sso/session";

/**
 * The widget endpoints answer the same from TypeScript and from the Rust
 * service (#1136).
 *
 * One schema-loaded Postgres serves both: the Next.js route handler runs
 * in-process over the PostgREST shim, the service over a socket. Every case
 * sends the same request to both and compares the status, the headers the
 * widget depends on and the body. The TypeScript answers are also recorded in
 * `__golden__/rust-parity.json`, so a change to a route shows up as a diff
 * there before it shows up as a parity failure (`UPDATE_GOLDEN=1` rewrites it).
 *
 * Needs the built binary, like `packages/ops/src/rust-parity.test.ts`:
 *
 *   cargo build --manifest-path services/ciele-api/Cargo.toml
 *   CIELE_RUST_PARITY_REQUIRED=1 CIELE_RUST_API_BIN=<target>/debug/ciele-api \
 *     pnpm --filter @agent-hub/web exec vitest run src/app/api/widget/rust-parity
 */

const BIN = process.env.CIELE_RUST_API_BIN;
const REQUIRED = process.env.CIELE_RUST_PARITY_REQUIRED === "1";
const GOLDEN = new URL("./__golden__/rust-parity.json", import.meta.url);

// The environment both sides read: one platform key, nothing else.
const ENV: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "http://supabase.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  APP_ENCRYPTION_KEY: "widget-parity-key",
  APP_ENCRYPTION_KEY_PREVIOUS: "",
  GOOGLE_GENERATIVE_AI_API_KEY: "platform-google",
  ANTHROPIC_API_KEY: "",
  OPENAI_API_KEY: "",
  AI_GATEWAY_API_KEY: "",
  OPENAI_COMPATIBLE_BASE_URL: "",
  OPENAI_COMPATIBLE_CHAT_MODEL: "",
};
for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);

const holder = vi.hoisted(() => ({ db: null as Db | null, memo: null as Map<string, unknown> | null }));
vi.mock("@/lib/service-db", () => ({ getServiceRoleDb: () => holder.db }));
// Next's data cache needs a running server; the route's own cache is not what
// this compares.
vi.mock("next/cache", () => ({
  // `holder.memo` stands in for a warm data cache in the opt-in benchmark only.
  unstable_cache: (fn: () => unknown, key: string[]) => () => {
    if (!holder.memo) return fn();
    const k = key.join("/");
    if (!holder.memo.has(k)) holder.memo.set(k, fn());
    return holder.memo.get(k);
  },
  revalidateTag: () => {},
  updateTag: () => {},
}));

import * as configRoute from "./[assistantId]/config/route";
import * as sessionRoute from "./[assistantId]/session/route";
import * as feedbackRoute from "./[assistantId]/feedback/route";
import * as conversationFeedbackRoute from "./[assistantId]/conversation-feedback/route";
import * as conversationsRoute from "./[assistantId]/conversations/route";
import * as helpDesksRoute from "./[assistantId]/help-desks/route";
import * as memoriesRoute from "./[assistantId]/memories/route";
import * as downloadRoute from "./[assistantId]/sources/[sourceId]/download/route";

type Handler = (request: NextRequest, context: { params: Promise<{ assistantId: string }> }) => Promise<Response>;
const ROUTES: Record<string, Partial<Record<"GET" | "POST" | "DELETE" | "OPTIONS", Handler>>> = {
  config: configRoute as never,
  session: sessionRoute as never,
  feedback: feedbackRoute as never,
  "conversation-feedback": conversationFeedbackRoute as never,
  conversations: conversationsRoute as never,
  "help-desks": helpDesksRoute as never,
  memories: memoriesRoute as never,
  sources: downloadRoute as never,
};

/** The headers a browser or the widget acts on. */
const HEADERS = [
  "content-disposition",
  "access-control-allow-origin",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "cache-control",
  "vary",
  "content-type",
];

interface Answer {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

async function read(response: Response): Promise<Answer> {
  const text = await response.text();
  const headers = Object.fromEntries(
    HEADERS.flatMap((name) => {
      const value = response.headers.get(name);
      return value === null ? [] : [[name, value]];
    })
  );
  const json = (response.headers.get("content-type") ?? "").includes("json");
  return { status: response.status, headers, body: json && text ? instants(JSON.parse(text)) : text };
}

const STAMPS = new Set(["createdAt", "updatedAt", "feedbackAt"]);

/**
 * PostgREST, and so the service, write a timestamp as Postgres prints it
 * (`2026-10-20T12:00:00+00:00`); the shim hands the route a `Date`, which
 * serialises as `…000Z`. Compare the instants.
 */
function instants(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(instants);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      STAMPS.has(key) && typeof item === "string" ? new Date(item).toISOString() : instants(item),
    ])
  );
}

interface Case {
  method?: "GET" | "POST" | "DELETE" | "OPTIONS";
  /** The path under the Assistant, when it is not the route's name. */
  path?: string;
  /** Route params beyond the Assistant id. */
  params?: Record<string, string>;
  assistantId: string;
  route: keyof typeof ROUTES;
  query?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

let pg: Awaited<ReturnType<typeof createSchemaLoadedPglite>>;
let socket: PGLiteSocketServer;
let service: ChildProcess | null = null;
let serviceUrl: string;
let storage: Server;
/** What the fake object storage was asked, in order. */
const storageRequests: string[] = [];
const ORIGINAL = "%PDF-1.4 parity original";

async function viaTypeScript(c: Case): Promise<Answer> {
  const method = c.method ?? "GET";
  const handler = ROUTES[c.route][method];
  if (!handler) throw new Error(`${c.route} has no ${method}`);
  const request = new NextRequest(`https://ciele.test/api/widget/${c.assistantId}/${c.path ?? c.route}${c.query ?? ""}`, {
    method,
    headers: c.headers,
    body: c.body === undefined ? undefined : JSON.stringify(c.body),
  });
  return read(await handler(request, { params: Promise.resolve({ assistantId: c.assistantId, ...c.params }) }));
}

async function viaRust(c: Case): Promise<Answer> {
  return read(
    await fetch(`${serviceUrl}/api/widget/${c.assistantId}/${c.path ?? c.route}${c.query ?? ""}`, {
      method: c.method ?? "GET",
      headers: c.headers,
      body: c.body === undefined ? undefined : JSON.stringify(c.body),
    })
  );
}

const recorded: Record<string, Answer> = {};
/** Starts the binary with `extra` over the shared environment; set in `beforeAll`. */
let startService: (extra: Record<string, string>) => Promise<void>;

/** Both answers, after checking they agree and the TypeScript one is the recorded one. */
async function same(name: string, c: Case): Promise<Answer> {
  const typescript = await viaTypeScript(c);
  const rust = await viaRust(c);
  expect(rust, name).toEqual(typescript);
  recorded[name] = typescript;
  return typescript;
}

/**
 * A write, run on twin rows: each side gets its own copy so neither sees the
 * other's change, and the answers must still agree.
 */
async function sameWrite(name: string, typescriptCase: Case, rustCase: Case): Promise<Answer> {
  const typescript = await viaTypeScript(typescriptCase);
  const rust = await viaRust(rustCase);
  expect(rust, name).toEqual(typescript);
  recorded[name] = typescript;
  return typescript;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject()));
    });
  });
}

const ORG = "00000000-0000-4000-8000-00000000000a";
const FOREIGN_ORG = "00000000-0000-4000-8000-00000000000b";

function assistantConfig(overrides: Record<string, unknown>) {
  return {
    id: "as-published",
    organizationId: ORG,
    title: "Campus help",
    nickname: "",
    avatarUrl: null,
    welcomeMessage: "Hi! Ask me anything.",
    aiDisclaimer: "Answers can be wrong.",
    suggestedQuestions: ["Where is the library?"],
    chatLauncherEnabled: true,
    style: { brandColor: "#1f6feb", position: "bottom-right" },
    allowedDomains: ["school.edu"],
    requireSignIn: false,
    modelProvider: "google",
    modelId: "gemini-3.5-flash",
    allowedModels: [],
    ...overrides,
  };
}

const NOTIFY = (id: string, trigger: string, position: number, timeOnPage?: object) => ({
  id,
  name: id,
  enabled: true,
  isDefault: false,
  trigger,
  position,
  actions: ["notification"],
  ...(timeOnPage ? { triggerSettings: { timeOnPage } } : {}),
});

/** The published Assistant's snapshot: a model picker, proactive flows, a refusing origin list. */
const PUBLISHED = () => ({
  assistant: assistantConfig({
    nickname: "Campus bot",
    helpDeskSettings: { selectedIds: ["hd-2", "hd-1", "hd-foreign", "hd-missing"] },
    quickReplies: [{ id: "qr-1", label: "Library hours", type: "send_text", text: "When is the library open?" }],
    allowedModels: [
      { provider: "anthropic", modelId: "claude-sonnet-5" },
      { provider: "openai", modelId: "gpt-5.1" },
      { provider: "openai", modelId: "gpt-5.4-mini", source: "api_key" },
      { provider: "google", modelId: "gemini-9-pro" },
      { provider: "anthropic", modelId: "claude-opus-4-8", source: "api_key" },
      { provider: "google", modelId: "gemini-3.5-flash" },
    ],
  }),
  collections: [{ id: "kc-1", name: "Handbook" }],
  flows: [
    NOTIFY("fl-open", "chat_open", 2),
    NOTIFY("fl-dwell-90", "time_on_page", 3, { minutes: 1, seconds: 30 }),
    NOTIFY("fl-dwell-default", "time_on_page", 4),
    { ...NOTIFY("fl-off", "page_load", 5), enabled: false },
    { id: "fl-msg", name: "Courses", enabled: true, trigger: "message", position: 1, actions: ["search_knowledge"] },
  ],
  skills: [],
});

async function publish(id: string, assistantId: string, version: number, config: object) {
  await pg.query(`insert into public.publications (id, assistant_id, version, config) values ($1, $2, $3, $4)`, [
    id,
    assistantId,
    version,
    JSON.stringify(config),
  ]);
}

function gateCookie(organizationId: string, exp = Math.floor(Date.now() / 1000) + 3600): string {
  const sealed = sealGate({ organizationId, subjectId: "sso-sub-1", provider: "entra", exp });
  return `sso_gate=${encodeURIComponent(sealed)}`;
}

describe.skipIf(!BIN && !REQUIRED)("widget endpoints: Rust service parity with the Next.js routes", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    if (!BIN) {
      throw new Error("CIELE_RUST_PARITY_REQUIRED=1 but CIELE_RUST_API_BIN is unset: build the service and point at it");
    }
    pg = await createSchemaLoadedPglite();
    await pg.exec(`
      grant usage on schema public, private to authenticated, service_role;
      grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
      alter role service_role bypassrls;
    `);
    holder.db = createDb(createPgliteSupabaseClient(pg, { id: randomUUID(), email: "service@parity.test" }, "service_role"));

    await pg.query(`insert into public.organizations (id, name, memory_enabled) values ($1, 'Parity', true), ($2, 'Foreign', true)`, [
      ORG,
      FOREIGN_ORG,
    ]);
    await pg.query(
      `insert into public.assistants (id, organization_id, title) values
         ('as-published', $1, 'Campus help'), ('as-gated', $1, 'Staff only'),
         ('as-unpublished', $1, 'Draft'), ('as-foreign', $2, 'Elsewhere')`,
      [ORG, FOREIGN_ORG]
    );
    await pg.query(`insert into public.sso_connections (organization_id, provider) values ($1, 'entra')`, [ORG]);
    // Conversations: two of Visitor v-1's, one of v-2's, an SSO subject's, and
    // v-1's in another Assistant and in another Organization.
    await pg.query(
      `insert into public.conversations (id, assistant_id, subject_type, subject_id, title, created_at, updated_at) values
         ('cv-v1', 'as-published', 'visitor', 'v-1', 'Library', '2026-10-20T10:00:00Z', '2026-10-20T12:00:00Z'),
         ('cv-v1-old', 'as-published', 'visitor', 'v-1', 'Parking', '2026-10-19T10:00:00Z', '2026-10-19T11:00:00Z'),
         ('cv-v2', 'as-published', 'visitor', 'v-2', 'Fees', '2026-10-20T10:00:00Z', '2026-10-20T13:00:00Z'),
         ('cv-sso', 'as-gated', 'sso', 'sso-sub-1', 'Payroll', '2026-10-20T10:00:00Z', '2026-10-20T14:00:00Z'),
         ('cv-other-assistant', 'as-gated', 'visitor', 'v-1', 'Elsewhere', '2026-10-20T10:00:00Z', '2026-10-20T10:00:00Z'),
         ('cv-foreign', 'as-foreign', 'visitor', 'v-1', 'Foreign', '2026-10-20T10:00:00Z', '2026-10-20T10:00:00Z')`
    );
    await pg.query(
      `insert into public.messages (id, conversation_id, role, content, flow_id, flow_name, created_at) values
         ('m-user', 'cv-v1', 'user', '[{"type":"text","text":"When is the library open?"}]', null, null, '2026-10-20T11:00:00Z'),
         ('m-bot-ts', 'cv-v1', 'assistant', '[{"type":"text","text":"From 8 to 20."}]', 'fl-msg', 'Courses', '2026-10-20T11:00:01Z'),
         ('m-bot-rs', 'cv-v1', 'assistant', '[{"type":"text","text":"From 8 to 20."}]', 'fl-msg', 'Courses', '2026-10-20T11:00:02Z'),
         ('m-v2', 'cv-v2', 'assistant', '[]', null, null, '2026-10-20T11:00:00Z'),
         ('m-sso-ts', 'cv-sso', 'assistant', '[]', null, null, '2026-10-20T11:00:00Z'),
         ('m-sso-rs', 'cv-sso', 'assistant', '[]', null, null, '2026-10-20T11:00:01Z'),
         ('m-other-assistant', 'cv-other-assistant', 'assistant', '[]', null, null, '2026-10-20T11:00:00Z'),
         ('m-foreign', 'cv-foreign', 'assistant', '[]', null, null, '2026-10-20T11:00:00Z')`
    );
    await pg.query(
      `insert into public.memories (id, organization_id, subject_id, text, created_at) values
         ('mem-1', $1, 'sso-sub-1', 'Prefers email', '2026-10-20T10:00:00Z'),
         ('mem-2', $1, 'sso-sub-1', 'Works in payroll', '2026-10-20T11:00:00Z'),
         ('mem-tie-a', $1, 'sso-sub-1', 'Tied A', '2026-10-20T09:00:00Z'),
         ('mem-tie-b', $1, 'sso-sub-1', 'Tied B', '2026-10-20T09:00:00Z'),
         ('mem-ts', $1, 'sso-sub-1', 'Delete me (TS)', '2026-10-19T10:00:00Z'),
         ('mem-rs', $1, 'sso-sub-1', 'Delete me (Rust)', '2026-10-19T10:00:00Z'),
         ('mem-other-subject', $1, 'sso-sub-2', 'Someone else', '2026-10-20T10:00:00Z'),
         ('mem-foreign', $2, 'sso-sub-1', 'Another Organization', '2026-10-20T10:00:00Z')`,
      [ORG, FOREIGN_ORG]
    );
    await pg.query(
      `insert into public.knowledge_collections (id, organization_id, name) values ('kc-1', $1, 'Handbook'), ('kc-foreign', $2, 'Theirs')`,
      [ORG, FOREIGN_ORG]
    );
    await pg.query(
      `insert into public.sources (id, collection_id, name, kind, status, original_object_path) values
         ('src-open', 'kc-1', 'Handbook "2026".pdf', 'file', 'ready', 'org/handbook.pdf'),
         ('src-closed', 'kc-1', 'Closed.pdf', 'file', 'ready', 'org/closed.pdf'),
         ('src-unlinked', 'kc-1', 'Unlinked.pdf', 'file', 'ready', 'org/unlinked.pdf'),
         ('src-url', 'kc-1', 'Website', 'url', 'ready', null),
         ('src-no-original', 'kc-1', 'Text.pdf', 'file', 'ready', null),
         ('src-gone', 'kc-1', 'Gone.pdf', 'file', 'ready', 'org/missing.pdf'),
         ('src-foreign', 'kc-foreign', 'Foreign.pdf', 'file', 'ready', 'foreign/f.pdf')`
    );
    await pg.query(
      `insert into public.assistant_sources (assistant_id, source_id, direct_access) values
         ('as-published', 'src-open', true), ('as-published', 'src-closed', false),
         ('as-published', 'src-url', true), ('as-published', 'src-no-original', true),
         ('as-published', 'src-gone', true), ('as-foreign', 'src-foreign', true)`
    );
    await pg.query(
      `insert into public.help_desks (id, organization_id, name) values
         ('hd-1', $1, 'IT support'), ('hd-2', $1, 'Admissions'), ('hd-unselected', $1, 'Unselected'),
         ('hd-foreign', $2, 'Foreign desk')`,
      [ORG, FOREIGN_ORG]
    );
    await pg.query(
      `insert into public.support_channels (id, help_desk_id, kind, name, position, enabled, config, form_title, form, availability) values
         ('ch-email', 'hd-1', 'email', 'Email us', 1, true, '{"destinationEmail":"it@school.edu"}', '  ',
          '[{"id":"f-email","type":"user_email","label":"Email","required":true},
            {"id":"f-subject","type":"short_text","label":"Subject","placeholder":"What is it about?"},
            {"id":"f-hidden","type":"short_text","label":"Hidden","showInForm":false},
            {"id":"f-file","type":"file","label":"Attachment"}]', '{}'),
         ('ch-email-empty', 'hd-1', 'email', 'Email, no form', 2, true, '{"destinationEmail":"desk@school.edu"}', 'Help', '[]', '{}'),
         ('ch-email-dead', 'hd-1', 'email', 'No address', 3, true, '{}', 'Help', '[]', '{}'),
         ('ch-phone', 'hd-1', 'phone', 'Call', 0, true, '{"phoneNumber":"+39 (06) 1234-567"}', 'Help', '[]',
          '{"mode":"limited","timezone":"Europe/Rome","hours":{"monday":{"enabled":true,"opensHour":9,"closesHour":17},
            "tuesday":{"enabled":true,"ranges":[{"opensHour":8,"closesHour":12},{"id":"x","opensHour":"bad","closesHour":3}]}}}'),
         ('ch-off', 'hd-1', 'live_chat', 'Off', 4, false, '{"url":"https://chat.school.edu"}', 'Help', '[]', '{}'),
         ('ch-api', 'hd-1', 'api_endpoint', 'Ticket', 5, true, '{"url":"https://tickets.school.edu","authType":"bearer","token":"secret"}',
          'Open a ticket', '[{"id":"f-desc","type":"long_text","label":"Description"}]', '{}'),
         ('ch-link', 'hd-2', 'external_link', 'Portal', 0, true, '{"url":"https://apply.school.edu"}', 'Help', '[]', '{}'),
         ('ch-foreign', 'hd-foreign', 'phone', 'Foreign line', 0, true, '{"phoneNumber":"123"}', 'Help', '[]', '{}')`
    );
    await pg.query(
      `insert into public.provider_connections (organization_id, type, provider, display_name, encrypted_key, created_at)
       values ($1, 'api_key', 'anthropic', 'Anthropic', $2, '2026-10-01T00:00:00Z'),
              ($1, 'api_key', 'openai', 'Broken', $3, '2026-10-02T00:00:00Z')`,
      [ORG, sealSecret("sk-ant"), "not-a-sealed-value"]
    );
    await pg.query(
      `insert into public.platform_eval_models (provider, model_id, label, input_eur_per_million, output_eur_per_million, added_by)
       values ('google', 'gemini-9-pro', 'Gemini 9 Pro', 1, 2, 'owner@ciele.test')`
    );

    await publish("pub-published-1", "as-published", 1, PUBLISHED());
    await publish("pub-gated-1", "as-gated", 1, {
      assistant: assistantConfig({ id: "as-gated", title: "Staff only", requireSignIn: true, allowedDomains: [] }),
      collections: [],
      flows: [],
    });
    await publish("pub-foreign-1", "as-foreign", 1, {
      assistant: assistantConfig({ id: "as-foreign", organizationId: FOREIGN_ORG, requireSignIn: true }),
      collections: [],
      flows: [],
    });

    // Object storage: sign, then serve the signed URL, as Supabase Storage does.
    storage = createHttpServer((req, res) => {
      const url = req.url ?? "";
      storageRequests.push(`${req.method} ${url}`);
      const authorized = req.headers.authorization === "Bearer service-key";
      const sign = /^\/storage\/v1\/object\/sign\/knowledge-originals\/(.+)$/.exec(url);
      if (req.method === "POST" && sign && authorized) {
        if (sign[1].includes("missing")) {
          res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not_found"}');
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ signedURL: `/object/sign/knowledge-originals/${sign[1]}?token=t-1` }));
        return;
      }
      if (req.method === "GET" && url.includes("?token=t-1")) {
        res.writeHead(200, { "content-type": "application/pdf", "content-length": String(ORIGINAL.length) }).end(ORIGINAL);
        return;
      }
      res.writeHead(400).end();
    });
    await new Promise<void>((resolve) => storage.listen(0, "127.0.0.1", resolve));
    const storagePort = (storage.address() as { port: number }).port;
    ENV.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${storagePort}`;
    ENV.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", ENV.NEXT_PUBLIC_SUPABASE_URL);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", ENV.SUPABASE_SERVICE_ROLE_KEY);

    // Two connections: the operation pool opens one at start, the widget pool another.
    const dbPort = await freePort();
    socket = new PGLiteSocketServer({ db: pg, port: dbPort, host: "127.0.0.1", maxConnections: 4 });
    await socket.start();
    startService = async (extra: Record<string, string>) => {
      const port = await freePort();
      serviceUrl = `http://127.0.0.1:${port}`;
      service = spawn(BIN!, [], {
        env: {
          ...process.env,
          ...ENV,
          DATABASE_URL: `postgres://postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable`,
          // PGlite has one session: no second pool with its own role.
          DATABASE_DIRECT_ROLE: "",
          DATABASE_MAX_CONNECTIONS: "1",
          WIDGET_DATABASE_MAX_CONNECTIONS: "1",
          CIELE_RUST_API_SECRET: "x".repeat(32),
          PORT: String(port),
          RUST_LOG: "warn",
          ...extra,
        },
        stdio: ["ignore", "inherit", "inherit"],
      });
      for (let tries = 0; ; tries++) {
        const ready = await fetch(`${serviceUrl}/healthz`).then((r) => r.ok, () => false);
        if (ready) break;
        if (tries > 100) throw new Error("ciele-api did not start");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    await startService({});
  }, 600_000);

  afterAll(async () => {
    service?.kill();
    storage?.close();
    await socket?.stop();
    await pg?.close();
  });

  it("serves exactly the endpoints the web app routes to it", async () => {
    const served = (await (await fetch(`${serviceUrl}/v1/widget`)).json()) as string[];
    expect([...served].sort()).toEqual([...RUST_WIDGET_ROUTES].sort());
    expect(Object.keys(ROUTES).sort()).toEqual([...RUST_WIDGET_ROUTES].sort());
  });

  describe("config", () => {
    it("answers a published Assistant, its model picker and proactive triggers", async () => {
      const answer = await same("config: published, allowed origin", {
        route: "config",
        assistantId: "as-published",
        headers: { origin: "https://www.school.edu" },
      });
      expect(answer.status).toBe(200);
      const body = answer.body as { models: { selector: string }[]; proactiveTriggers: string[]; proactiveDwellSeconds: number[] };
      expect(body.models.map((m) => m.selector)).toEqual([
        "google:gemini-3.5-flash",
        "anthropic:claude-sonnet-5",
        // Counted as a key by having one; a pinned choice must also open it.
        "openai:gpt-5.1",
        "google:gemini-9-pro",
        "anthropic:claude-opus-4-8#api_key",
      ]);
      expect(body.proactiveTriggers).toEqual(["time_on_page", "chat_open"]);
      expect(body.proactiveDwellSeconds).toEqual([30, 90]);
    });

    it("refuses an origin outside the allowed domains the same way", async () => {
      const answer = await same("config: published, foreign origin", {
        route: "config",
        assistantId: "as-published",
        headers: { origin: "https://evil.example" },
      });
      expect(answer.headers["access-control-allow-origin"]).toBe("null");
      await same("config: published, no origin", { route: "config", assistantId: "as-published" });
    });

    it("answers an Assistant with no picker, an unpublished one and an unknown id", async () => {
      await same("config: gated", { route: "config", assistantId: "as-gated", headers: { origin: "https://any.example" } });
      const unpublished = await same("config: unpublished", {
        route: "config",
        assistantId: "as-unpublished",
        headers: { origin: "https://www.school.edu" },
      });
      expect(unpublished.status).toBe(404);
      await same("config: unknown", { route: "config", assistantId: "as-nope" });
    });

    it("answers the preflight", async () => {
      await same("config: preflight", {
        route: "config",
        method: "OPTIONS",
        assistantId: "as-published",
        headers: { origin: "https://evil.example" },
      });
    });

    it("serves a new Publication on the very next load", async () => {
      const before = (await viaRust({ route: "config", assistantId: "as-published" })).body as { version: number };
      expect(before.version).toBe(1);
      // Cached now. A republish must not wait for anything to expire.
      await publish("pub-published-2", "as-published", 2, {
        assistant: assistantConfig({ nickname: "", title: "Campus help v2", welcomeMessage: "New welcome" }),
        collections: [],
        flows: [],
      });
      const after = await same("config: republished", { route: "config", assistantId: "as-published" });
      expect(after.body).toMatchObject({ version: 2, nickname: "Campus help v2", welcomeMessage: "New welcome", models: [] });
      // And an unpublish is not served from the cache either.
      await pg.query(`delete from public.publications where assistant_id = 'as-published'`);
      expect((await viaRust({ route: "config", assistantId: "as-published" })).status).toBe(404);
      await publish("pub-published-1", "as-published", 1, PUBLISHED());
    });
  });

  describe("session", () => {
    it("answers an open Assistant and an anonymous Visitor of a gated one", async () => {
      await same("session: open", { route: "session", assistantId: "as-published", headers: { origin: "https://school.edu" } });
      const gated = await same("session: gated, anonymous", { route: "session", assistantId: "as-gated" });
      expect(gated.body).toEqual({ requireSignIn: true, authenticated: false, provider: "entra", memories: false });
    });

    it("accepts a gate minted for the Assistant's Organization only", async () => {
      const signed = await same("session: gated, signed in", {
        route: "session",
        assistantId: "as-gated",
        headers: { cookie: gateCookie(ORG) },
      });
      expect(signed.body).toMatchObject({ authenticated: true, memories: true });
      const foreign = await same("session: gated, another Organization's gate", {
        route: "session",
        assistantId: "as-gated",
        headers: { cookie: gateCookie(FOREIGN_ORG) },
      });
      expect(foreign.body).toMatchObject({ authenticated: false, memories: false });
      await same("session: gated, expired gate", {
        route: "session",
        assistantId: "as-gated",
        headers: { cookie: gateCookie(ORG, 1) },
      });
      await same("session: another Organization's Assistant, this one's gate", {
        route: "session",
        assistantId: "as-foreign",
        headers: { cookie: gateCookie(ORG) },
      });
      await same("session: unpublished", { route: "session", assistantId: "as-unpublished" });
    });
  });

  /**
   * Opt-in (`CIELE_WIDGET_BENCH=1`): p50/p95 of a config load with a model
   * picker (so the live connection read runs), both sides on this PGlite. The
   * TypeScript handler runs in-process over the PostgREST shim, so it pays no
   * HTTP and no PostgREST hop; the service pays a loopback HTTP request. Not a
   * production number.
   */
  it.runIf(process.env.CIELE_WIDGET_BENCH === "1")("benchmark: config load", { timeout: 600_000 }, async () => {
    const c: Case = { route: "config", assistantId: "as-published", headers: { origin: "https://www.school.edu" } };
    const N = Number(process.env.CIELE_WIDGET_BENCH_N ?? 300);
    const time = async (run: () => Promise<Answer>) => {
      for (let i = 0; i < 20; i++) await run();
      const samples: number[] = [];
      for (let i = 0; i < N; i++) {
        const start = performance.now();
        const answer = await run();
        samples.push(performance.now() - start);
        expect(answer.status).toBe(200);
      }
      samples.sort((a, b) => a - b);
      const at = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))].toFixed(2);
      return `p50 ${at(0.5)} ms, p95 ${at(0.95)} ms (n=${N})`;
    };
    const results: Record<string, string> = {};
    results["TypeScript, Publication read every load"] = await time(() => viaTypeScript(c));
    holder.memo = new Map();
    try {
      results["TypeScript, Publication from a warm data cache"] = await time(() => viaTypeScript(c));
    } finally {
      holder.memo = null;
    }
    results["Rust service over loopback HTTP"] = await time(() => viaRust(c));
    console.log(JSON.stringify(results, null, 2));
  });

  describe("feedback", () => {
    const rate = (assistantId: string, body: unknown, headers?: Record<string, string>): Case => ({
      route: "feedback",
      method: "POST",
      assistantId,
      body,
      headers: { "content-type": "application/json", ...headers },
    });
    const stored = async (id: string) =>
      (
        await pg.query<{ feedback: number; feedback_reaction: string | null }>(
          `select feedback, feedback_reaction from public.messages where id = $1`,
          [id]
        )
      ).rows[0];

    it("rates the Visitor's own answer, by reaction and by the legacy score", async () => {
      await sameWrite(
        "feedback: own answer, reaction",
        rate("as-published", { messageId: "m-bot-ts", visitorId: "v-1", reaction: "positive" }),
        rate("as-published", { messageId: "m-bot-rs", visitorId: "v-1", reaction: "positive" })
      );
      expect(await stored("m-bot-rs")).toEqual(await stored("m-bot-ts"));
      expect(await stored("m-bot-rs")).toEqual({ feedback: 1, feedback_reaction: "positive" });
      await sameWrite(
        "feedback: own answer, legacy score",
        rate("as-published", { messageId: "m-bot-ts", visitorId: "v-1", feedback: -1 }),
        rate("as-published", { messageId: "m-bot-rs", visitorId: "v-1", feedback: -1 })
      );
      expect(await stored("m-bot-rs")).toEqual({ feedback: -1, feedback_reaction: null });
      await sameWrite(
        "feedback: own answer, reaction cleared",
        rate("as-published", { messageId: "m-bot-ts", visitorId: "v-1", reaction: null }),
        rate("as-published", { messageId: "m-bot-rs", visitorId: "v-1", reaction: null })
      );
      expect(await stored("m-bot-rs")).toEqual(await stored("m-bot-ts"));
    });

    it("refuses a malformed rating", async () => {
      for (const [name, body] of [
        ["no message", { visitorId: "v-1", reaction: "positive" }],
        ["unknown reaction", { messageId: "m-bot-ts", visitorId: "v-1", reaction: "love" }],
        ["score out of range", { messageId: "m-bot-ts", visitorId: "v-1", feedback: 2 }],
        ["score as text", { messageId: "m-bot-ts", visitorId: "v-1", feedback: "1" }],
        ["no visitor", { messageId: "m-bot-ts", reaction: "positive" }],
      ] as const) {
        const answer = await same(`feedback: ${name}`, rate("as-published", body));
        expect(answer.status, name).toBe(400);
      }
    });

    it("never rates another Visitor's, another Assistant's or another Organization's answer", async () => {
      for (const [name, assistantId, messageId] of [
        ["another Visitor", "as-published", "m-v2"],
        ["another Assistant", "as-published", "m-other-assistant"],
        ["another Organization", "as-published", "m-foreign"],
        ["an SSO subject's, claimed by its id", "as-gated", "m-sso-ts"],
        ["a missing message", "as-published", "m-missing"],
      ] as const) {
        const visitorId = name.startsWith("an SSO") ? "sso-sub-1" : "v-1";
        const answer = await same(`feedback: ${name}`, rate(assistantId, { messageId, visitorId, reaction: "negative" }));
        expect(answer.status, name).toBe(404);
      }
      const untouched = await pg.query(
        `select id from public.messages where id in ('m-v2', 'm-other-assistant', 'm-foreign', 'm-sso-ts') and feedback <> 0`
      );
      expect(untouched.rows).toEqual([]);
    });

    it("rates as the SSO subject a valid gate names", async () => {
      await sameWrite(
        "feedback: SSO subject's own answer",
        rate("as-gated", { messageId: "m-sso-ts", reaction: "neutral" }, { cookie: gateCookie(ORG) }),
        rate("as-gated", { messageId: "m-sso-rs", reaction: "neutral" }, { cookie: gateCookie(ORG) })
      );
      expect(await stored("m-sso-rs")).toEqual(await stored("m-sso-ts"));
      await same(
        "feedback: SSO answer, another Organization's gate",
        rate("as-gated", { messageId: "m-sso-ts", reaction: "neutral" }, { cookie: gateCookie(FOREIGN_ORG) })
      );
      await same("feedback: unpublished", rate("as-unpublished", { messageId: "m-bot-ts", visitorId: "v-1", feedback: 1 }));
    });
  });

  describe("conversation feedback", () => {
    const send = (assistantId: string, body: unknown, headers?: Record<string, string>): Case => ({
      route: "conversation-feedback",
      method: "POST",
      assistantId,
      body,
      headers: { "content-type": "application/json", ...headers },
    });

    it("records the Visitor's text on their own Conversation", async () => {
      const answer = await same(
        "conversation feedback: own",
        send("as-published", { conversationId: "cv-v1", visitorId: "v-1", text: "  Very helpful \u3000" })
      );
      expect(answer.status).toBe(200);
      const metadata = (
        await pg.query<{ metadata: Record<string, string> }>(`select metadata from public.conversations where id = 'cv-v1'`)
      ).rows[0].metadata;
      expect(metadata.feedbackText).toBe("Very helpful");
      expect(Number.isNaN(Date.parse(metadata.feedbackAt))).toBe(false);
    });

    it("cuts the text at 2000 characters", async () => {
      await same("conversation feedback: long", send("as-published", { conversationId: "cv-v1-old", visitorId: "v-1", text: "a".repeat(2500) }));
      const metadata = (
        await pg.query<{ metadata: Record<string, string> }>(`select metadata from public.conversations where id = 'cv-v1-old'`)
      ).rows[0].metadata;
      expect(metadata.feedbackText).toHaveLength(2000);
    });

    it("refuses a malformed request and every Conversation that is not the Visitor's", async () => {
      for (const [name, body] of [
        ["no conversation", { visitorId: "v-1", text: "x" }],
        ["no visitor", { conversationId: "cv-v1", text: "x" }],
        ["blank text", { conversationId: "cv-v1", visitorId: "v-1", text: "   " }],
      ] as const) {
        expect((await same(`conversation feedback: ${name}`, send("as-published", body))).status, name).toBe(400);
      }
      for (const [name, conversationId] of [
        ["another Visitor", "cv-v2"],
        ["another Assistant", "cv-other-assistant"],
        ["another Organization", "cv-foreign"],
        ["missing", "cv-missing"],
      ] as const) {
        const answer = await same(`conversation feedback: ${name}`, send("as-published", { conversationId, visitorId: "v-1", text: "x" }));
        expect(answer.status, name).toBe(404);
      }
      const touched = await pg.query(
        `select id from public.conversations where id in ('cv-v2', 'cv-other-assistant', 'cv-foreign') and metadata ? 'feedbackText'`
      );
      expect(touched.rows).toEqual([]);
    });
  });

  describe("conversations", () => {
    const list = (assistantId: string, query: string, headers?: Record<string, string>): Case => ({
      route: "conversations",
      assistantId,
      query,
      headers,
    });

    it("lists the Visitor's own Conversations, newest first, and nobody else's", async () => {
      const answer = await same("conversations: v-1", list("as-published", "?visitorId=v-1"));
      expect((answer.body as { conversations: { id: string }[] }).conversations.map((c) => c.id)).toEqual(["cv-v1", "cv-v1-old"]);
      await same("conversations: unknown visitor", list("as-published", "?visitorId=v-9"));
      expect((await same("conversations: no visitor", list("as-published", ""))).status).toBe(400);
    });

    it("lists an SSO subject's from the gate, never from a claimed visitor id", async () => {
      const signed = await same("conversations: SSO gate", list("as-gated", "?visitorId=v-1", { cookie: gateCookie(ORG) }));
      expect((signed.body as { conversations: { id: string }[] }).conversations.map((c) => c.id)).toEqual(["cv-sso"]);
      const claimed = await same("conversations: SSO id claimed anonymously", list("as-gated", "?visitorId=sso-sub-1"));
      expect(claimed.body).toEqual({ conversations: [] });
    });

    it("reads the transcript of the Visitor's own Conversation only", async () => {
      const answer = await same("conversations: own transcript", list("as-published", "?visitorId=v-1&messages=cv-v1"));
      expect((answer.body as { messages: { id: string }[] }).messages.map((m) => m.id)).toEqual(["m-user", "m-bot-ts", "m-bot-rs"]);
      for (const [name, assistantId, query] of [
        ["another Visitor's transcript", "as-published", "?visitorId=v-1&messages=cv-v2"],
        ["another Assistant's transcript", "as-published", "?visitorId=v-1&messages=cv-other-assistant"],
        ["another Organization's transcript", "as-published", "?visitorId=v-1&messages=cv-foreign"],
        ["an SSO transcript by its id", "as-gated", "?visitorId=sso-sub-1&messages=cv-sso"],
      ] as const) {
        expect((await same(`conversations: ${name}`, list(assistantId, query))).status, name).toBe(404);
      }
      await same("conversations: SSO transcript with the gate", list("as-gated", "?messages=cv-sso", { cookie: gateCookie(ORG) }));
    });
  });

  describe("help desks", () => {
    it("answers the selected desks of the Assistant's Organization with their widget-safe channels", async () => {
      const answer = await same("help desks: published", { route: "help-desks", assistantId: "as-published", headers: { origin: "https://school.edu" } });
      const desks = (answer.body as { helpDesks: { id: string; channels: { id: string }[] }[] }).helpDesks;
      expect(desks.map((d) => d.id)).toEqual(["hd-2", "hd-1"]);
      expect(desks[1].channels.map((c) => c.id)).toEqual(["ch-phone", "ch-email", "ch-email-empty", "ch-api"]);
      expect(JSON.stringify(answer.body)).not.toContain("secret");
      await same("help desks: none selected", { route: "help-desks", assistantId: "as-gated" });
      await same("help desks: unpublished", { route: "help-desks", assistantId: "as-unpublished" });
    });
  });

  describe("memories", () => {
    const memories = (assistantId: string, method: "GET" | "DELETE", query = "", cookie?: string): Case => ({
      route: "memories",
      method,
      assistantId,
      query,
      headers: cookie ? { cookie } : undefined,
    });

    it("lists the signed-in subject's memories in their own Organization only", async () => {
      const own = await same("memories: SSO subject", memories("as-gated", "GET", "", gateCookie(ORG)));
      expect((own.body as { memories: { id: string }[] }).memories.map((m) => m.id)).toEqual([
        "mem-2",
        "mem-1",
        "mem-tie-b",
        "mem-tie-a",
        "mem-ts",
        "mem-rs",
      ]);
      const foreign = await same("memories: another Organization's Assistant", memories("as-foreign", "GET", "", gateCookie(FOREIGN_ORG)));
      expect((foreign.body as { memories: { id: string }[] }).memories.map((m) => m.id)).toEqual(["mem-foreign"]);
      for (const [name, assistantId, cookie] of [
        ["anonymous", "as-gated", undefined],
        ["another Organization's gate", "as-gated", gateCookie(FOREIGN_ORG)],
        ["expired gate", "as-gated", gateCookie(ORG, 1)],
        ["unpublished", "as-unpublished", gateCookie(ORG)],
      ] as const) {
        const answer = await same(`memories: ${name}`, memories(assistantId, "GET", "", cookie));
        expect(answer.status, name).toBe(404);
      }
    });

    it("answers 404 while the Organization's memory is off", async () => {
      await pg.query(`update public.organizations set memory_enabled = false where id = $1`, [ORG]);
      try {
        expect((await same("memories: memory off", memories("as-gated", "GET", "", gateCookie(ORG)))).status).toBe(404);
      } finally {
        await pg.query(`update public.organizations set memory_enabled = true where id = $1`, [ORG]);
      }
    });

    it("deletes the subject's own memory and nobody else's", async () => {
      await sameWrite(
        "memories: delete own",
        memories("as-gated", "DELETE", "?id=mem-ts", gateCookie(ORG)),
        memories("as-gated", "DELETE", "?id=mem-rs", gateCookie(ORG))
      );
      const left = await pg.query(`select id from public.memories where id in ('mem-ts', 'mem-rs')`);
      expect(left.rows).toEqual([]);
      for (const [name, query] of [
        ["another subject's", "?id=mem-other-subject"],
        ["another Organization's", "?id=mem-foreign"],
        ["missing", "?id=mem-missing"],
        ["no id", ""],
      ] as const) {
        const answer = await same(`memories: delete ${name}`, memories("as-gated", "DELETE", query, gateCookie(ORG)));
        expect(answer.status, name).toBe(404);
      }
      expect((await same("memories: delete anonymously", memories("as-gated", "DELETE", "?id=mem-1"))).status).toBe(404);
      const kept = await pg.query(`select id from public.memories where id in ('mem-other-subject', 'mem-foreign', 'mem-1')`);
      expect(kept.rows).toHaveLength(3);
    });
  });

  describe("source downloads", () => {
    const download = (sourceId: string, query = "", ip = "198.51.100.7", headers: Record<string, string> = {}): Case => ({
      route: "sources",
      path: `sources/${sourceId}/download`,
      params: { sourceId },
      assistantId: "as-published",
      query,
      headers: { "x-forwarded-for": ip, "user-agent": "parity-agent", "x-request-id": "req-1", ...headers },
    });
    type LedgerRow = Record<string, unknown>;
    const ledger = async (): Promise<LedgerRow[]> =>
      (
        await pg.query<LedgerRow>(
          `select organization_id, actor_kind, actor_id, object_kind, object_path, source_id, result, bytes::int as bytes,
                  ip, user_agent, request_id
             from public.object_access_events order by created_at, id`
        )
      ).rows;
    /** Waits for the row a finished stream writes after the response. */
    const settled = async (count: number) => {
      for (let i = 0; i < 100 && (await ledger()).length < count; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return ledger();
    };

    /** The same request to both, and the same ledger row from both. */
    async function sameDownload(name: string, c: Case, rows = 1) {
      const before = (await ledger()).length;
      const typescript = await viaTypeScript(c);
      const afterTypeScript = await settled(before + rows);
      const rust = await viaRust(c);
      const afterRust = await settled(afterTypeScript.length + rows);
      expect(rust, name).toEqual(typescript);
      expect(afterRust.slice(afterTypeScript.length), name).toEqual(afterTypeScript.slice(before));
      recorded[name] = typescript;
      return { answer: typescript, rows: afterTypeScript.slice(before) };
    }

    it("streams a Direct access original and records the transfer", async () => {
      const { answer, rows } = await sameDownload("download: served", download("src-open", "?visitorId=%20v-1%20"));
      expect(answer.status).toBe(200);
      expect(answer.body).toBe(ORIGINAL);
      expect(answer.headers["content-disposition"]).toBe('attachment; filename="Handbook 2026.pdf"');
      expect(rows).toEqual([
        expect.objectContaining({ actor_id: "v-1", result: "served", bytes: ORIGINAL.length, ip: "198.51.100.7", request_id: "req-1" }),
      ]);
      // The app signs for itself and never answers with the signed URL.
      expect(storageRequests.filter((r) => r.startsWith("POST")).length).toBeGreaterThan(0);
      expect(JSON.stringify(answer)).not.toContain("token=");
      // A Response object carries no length until it is sent, so the length
      // is checked on the wire, where only the service's is.
      const rowsBefore = (await ledger()).length;
      const wire = await fetch(`${serviceUrl}/api/widget/as-published/sources/src-open/download`, {
        headers: { "x-forwarded-for": "198.51.100.6" },
      });
      expect(wire.headers.get("content-length")).toBe(String(ORIGINAL.length));
      await wire.arrayBuffer();
      await settled(rowsBefore + 1);
    });

    it("records the SSO subject when the gate is valid, and anonymous otherwise", async () => {
      const gated = await sameDownload("download: SSO subject", download("src-open", "?visitorId=v-1", "198.51.100.8", { cookie: gateCookie(ORG) }));
      expect(gated.rows[0]).toMatchObject({ actor_id: "sso-sub-1" });
      const anonymous = await sameDownload("download: anonymous", download("src-open", "", "198.51.100.8"));
      expect(anonymous.rows[0]).toMatchObject({ actor_id: "anonymous" });
    });

    it("refuses every other Source with one 404, and records each refusal", async () => {
      for (const sourceId of ["src-closed", "src-unlinked", "src-url", "src-no-original", "src-foreign", "src-missing"]) {
        const { answer, rows } = await sameDownload(`download: refused ${sourceId}`, download(sourceId, "?visitorId=v-1", "198.51.100.9"));
        expect(answer.status, sourceId).toBe(404);
        expect(answer.body, sourceId).toBe("Not found");
        expect(rows, sourceId).toEqual([expect.objectContaining({ result: "refused", organization_id: ORG })]);
      }
      const { answer, rows } = await sameDownload("download: storage has no object", download("src-gone", "", "198.51.100.9"));
      expect(answer.status).toBe(404);
      expect(rows).toEqual([expect.objectContaining({ result: "failed", object_path: "org/missing.pdf" })]);
    });

    it("stops at thirty per address in ten minutes, without a ledger row", async () => {
      const ip = "203.0.113.30";
      for (let i = 0; i < 30; i++) {
        await sameDownload(`download: budget ${i}`, download("src-closed", "", ip));
        delete recorded[`download: budget ${i}`];
      }
      const before = (await ledger()).length;
      const limited = await same("download: over budget", download("src-open", "", ip));
      expect(limited.status).toBe(429);
      expect((await ledger()).length).toBe(before);
    });

    it("answers an unpublished Assistant before anything else", async () => {
      await same("download: unpublished", { ...download("src-open"), assistantId: "as-unpublished" });
    });

    // Last in this block: it leaves the service running without storage.
    it("records the failure when no object storage is configured, on both sides", async () => {
      const running = service!;
      await new Promise<void>((resolve) => {
        running.once("exit", () => resolve());
        running.kill();
      });
      // PGlite is one backend session: the first binary's prepared statements
      // outlive its connection and would collide with the next one's.
      await pg.exec("deallocate all");
      await startService({ SUPABASE_SERVICE_ROLE_KEY: "" });
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
      try {
        const { answer, rows } = await sameDownload("download: no storage", download("src-open", "?visitorId=v-1", "198.51.100.10"));
        // The answer is the 404 it always was; the row is what changed.
        delete recorded["download: no storage"];
        expect(answer.status).toBe(404);
        expect(answer.body).toBe("Not found");
        expect(rows).toEqual([expect.objectContaining({ result: "failed", source_id: "src-open", actor_id: "v-1" })]);
      } finally {
        vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", ENV.SUPABASE_SERVICE_ROLE_KEY);
      }
    });
  });

  it("matches the recorded TypeScript answers", () => {
    if (process.env.UPDATE_GOLDEN === "1" || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, `${JSON.stringify(recorded, null, 2)}\n`);
    }
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, Answer>;
    expect(recorded).toEqual(golden);
  });
});
