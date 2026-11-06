import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { API_KEY_PREFIX, hashApiKeySecret, type Role } from "@agent-hub/core";
import { createDb, type Db } from "@agent-hub/db";
import { createPgliteSupabaseClient, createSchemaLoadedPglite } from "@agent-hub/db/testing";
import * as alertsRoute from "@/app/api/v1/alerts/route";
import * as resolveAlertRoute from "@/app/api/v1/alerts/[id]/resolve/route";
import * as improvementsRoute from "@/app/api/v1/improvements/route";
import * as taskLabelsRoute from "@/app/api/v1/task-labels/route";
import * as taskLabelRoute from "@/app/api/v1/task-labels/[id]/route";
import { RUST_DIRECT_ENDPOINTS } from "@/lib/rust-routing";
import { POST as tsMcp, GET as tsMcpGet, DELETE as tsMcpDelete } from "./route";
import { mcpRouteContract } from "./route-contract.suite";

/**
 * The hosted MCP endpoint, TypeScript and Rust, compared (#1135).
 *
 * Both servers are driven with the same requests. Their tools reach `/api/v1`
 * at a recorder standing in for the web app: an endpoint the service answers
 * itself is passed to its real route handler there, over one schema-loaded
 * PGlite the binary also reads, and every other endpoint answers with an echo
 * of what it was sent. So for each call we compare the answer, and the
 * requests that reached the web app: for an unported endpoint the two servers
 * must send the same one, for a ported one the Rust server must send none.
 *
 * Needs the built binary, like the other parity tests:
 *
 *   CIELE_RUST_PARITY_REQUIRED=1 CIELE_RUST_API_BIN=<target>/debug/ciele-api \
 *     pnpm --filter @agent-hub/web exec vitest run rust-mcp.parity
 */

const BIN = process.env.CIELE_RUST_API_BIN;
const REQUIRED = process.env.CIELE_RUST_PARITY_REQUIRED === "1";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock("@/lib/api-v1/db", () => ({ getApiV1Db: () => state.db }));

type PG = Awaited<ReturnType<typeof createSchemaLoadedPglite>>;
let pg: PG;
let socket: PGLiteSocketServer;
const services: ChildProcess[] = [];
let recorder: Server;
let recorderUrl: string;
let rustUrl: string;
let rustReadOnlyUrl: string;
let startService: (extra: Record<string, string>) => Promise<string>;
const keys: Record<string, string> = {};

interface Recorded {
  method: string;
  url: string;
  authorization: string | null;
  accept: string | null;
  contentType: string | null;
  body: unknown;
}
let recorded: Recorded[] = [];

const GOLDEN = readFileSync(new URL("../../../../../../packages/mcp/golden/tools-list.json", import.meta.url), "utf8");
const GOLDEN_READ_ONLY = readFileSync(
  new URL("../../../../../../packages/mcp/golden/tools-list.read-only.json", import.meta.url),
  "utf8"
);

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject()));
    });
  });
}

async function seedMember(org: string, role: Role): Promise<string> {
  const id = randomUUID();
  await pg.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@mcp-parity.test`]);
  await pg.query(`insert into public.organization_members (organization_id, user_id, role) values ($1, $2, $3)`, [
    org,
    id,
    role,
  ]);
  return id;
}

async function seedKey(name: string, org: string, role: Role, createdBy: string, revoked = false) {
  const secret = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  await pg.query(
    `insert into public.organization_api_keys (organization_id, name, secret_hash, secret_hint, role, created_by, revoked_at)
     values ($1, $2, $3, $4, $5, $6, case when $7 then now() end)`,
    [org, name, hashApiKeySecret(secret), secret.slice(0, 13), role, createdBy, revoked]
  );
  keys[name] = secret;
}

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ROUTES: Record<string, Partial<Record<string, Handler>>> = {
  "/alerts": alertsRoute as unknown as Partial<Record<string, Handler>>,
  "/alerts/{id}/resolve": resolveAlertRoute as unknown as Partial<Record<string, Handler>>,
  "/improvements": improvementsRoute as unknown as Partial<Record<string, Handler>>,
  "/task-labels": taskLabelsRoute as unknown as Partial<Record<string, Handler>>,
  "/task-labels/{id}": taskLabelRoute as unknown as Partial<Record<string, Handler>>,
};

/** The route handler for a ported endpoint, as Next.js would pick it. */
function portedRoute(method: string, pathname: string) {
  const relative = pathname.replace(/^\/api\/v1/, "");
  for (const endpoint of RUST_DIRECT_ENDPOINTS) {
    if (endpoint.method !== method) continue;
    const names: string[] = [];
    const pattern = new RegExp(
      `^${endpoint.path.replace(/\{(\w+)\}/g, (_, name: string) => {
        names.push(name);
        return "([^/]+)";
      })}$`
    );
    const match = pattern.exec(relative);
    if (!match) continue;
    const handler = ROUTES[endpoint.path][method];
    if (!handler) continue;
    return { handler, params: Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(match[i + 1])])) };
  }
  return null;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** A request as the comparison sees it: multipart by its parsed fields, JSON by value. */
async function describeBody(req: IncomingMessage, raw: Buffer): Promise<unknown> {
  const type = req.headers["content-type"] ?? "";
  if (raw.length === 0) return null;
  if (type.startsWith("multipart/form-data")) {
    const form = await new Request("http://x", { method: "POST", headers: { "content-type": type }, body: new Uint8Array(raw) }).formData();
    const fields: Record<string, unknown> = {};
    for (const [name, value] of form.entries()) {
      fields[name] =
        typeof value === "string" ? value : { filename: value.name, type: value.type, text: await value.text() };
    }
    return fields;
  }
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return raw.toString("utf8");
  }
}

/** The stand-in web app. */
async function answer(req: IncomingMessage, raw: Buffer): Promise<Response> {
  const url = new URL(req.url ?? "/", recorderUrl);
  const method = req.method ?? "GET";
  const ported = portedRoute(method, url.pathname);
  if (ported) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
    const request = new Request(url, { method, headers, body: raw.length > 0 ? new Uint8Array(raw) : undefined });
    return ported.handler(request, { params: Promise.resolve(ported.params) });
  }
  const target = `${url.pathname}${url.search}`;
  if (target.includes("fail-envelope")) {
    return Response.json({ error: { code: "not_found", message: "Nope" } }, { status: 404 });
  }
  if (target.includes("fail-plain")) return new Response("bad gateway", { status: 502 });
  if (url.pathname.endsWith("/knowledge/faqs/export")) {
    return new Response("question,answer\nQ,A\n", { headers: { "content-type": "text/csv" } });
  }
  if (url.pathname.endsWith("/ag-ui")) {
    return new Response("data: {\"type\":\"RUN_STARTED\"}\n\n", { headers: { "content-type": "text/event-stream" } });
  }
  if (method === "DELETE") return new Response(null, { status: 204 });
  return Response.json({ echo: { method, target } });
}

const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "parity", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

function modernRequest(url: string, secret: string | undefined, method: string, params: object = {}, name?: string) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-method": method,
      ...(name ? { "mcp-name": name } : {}),
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: META } }),
  });
}

function legacyRequest(url: string, secret: string, method: string, params: object) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

/** One JSON-RPC payload, from a JSON or an SSE body. */
async function payload(response: Response) {
  const text = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse(line?.slice(5).trim() ?? "null");
  }
  return JSON.parse(text);
}

const viaTs = (request: Request) => tsMcp(request);
const viaRust = (request: Request, base = rustUrl) =>
  fetch(`${base}/api/mcp`, { method: request.method, headers: request.headers, body: request.body, duplex: "half" } as RequestInit);

/** Instants read back from either side's text, so the shim's `Date`s and Postgres's strings compare. */
function normalizeText(text: string): unknown {
  try {
    const walk = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(walk);
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return new Date(value).toISOString();
      if (!value || typeof value !== "object") return value;
      const row = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
      if (typeof row.dueDate === "string") row.dueDate = row.dueDate.slice(0, 10);
      return row;
    };
    return walk(JSON.parse(text));
  } catch {
    return text;
  }
}

interface ToolAnswer {
  text: string;
  isError: boolean;
  requests: Recorded[];
}

async function callBoth(name: string, args: Record<string, unknown>): Promise<[ToolAnswer, ToolAnswer]> {
  const once = async (send: (request: Request) => Promise<Response>): Promise<ToolAnswer> => {
    recorded = [];
    const body = await payload(await send(modernRequest("http://ciele.test/api/mcp", keys.owner, "tools/call", { name, arguments: args }, name)));
    const content = body.result?.content?.[0];
    return { text: content?.text ?? JSON.stringify(body.error), isError: body.result?.isError === true, requests: recorded };
  };
  const ts = await once(viaTs);
  const rust = await once((request) => viaRust(request));
  return [ts, rust];
}

const PORTED_PATHS = (method: string, url: string) => portedRoute(method, new URL(url, "http://x").pathname) !== null;

/** Values for one property of a tool's schema, of the type it declares. */
function sample(key: string, schema: Record<string, unknown>, text: string): unknown {
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf as Record<string, unknown>[];
    const constant = branches.find((branch) => "const" in branch);
    if (constant) return constant.const;
    return sample(key, branches.find((branch) => branch.type !== "null") ?? {}, text);
  }
  if (Array.isArray(schema.enum)) return schema.enum[0];
  switch (schema.type) {
    case "string":
      return key === "fileBase64" ? "aGVsbG8gd29ybGQ=" : `${text}-${key}`;
    case "number":
      return 2;
    case "boolean":
      return true;
    case "array": {
      const items = (schema.items ?? {}) as Record<string, unknown>;
      return items.type === "object" ? [sample(key, items, text)] : [`${text}-a`, `${text}-b`];
    }
    case "object":
      if (schema.properties) {
        return Object.fromEntries(
          Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(([name, inner]) => [
            name,
            sample(name, inner, text),
          ])
        );
      }
      return { field: `${text}-value` };
    default:
      return `${text}-${key}`;
  }
}

const TOOLS = JSON.parse(GOLDEN) as { name: string; inputSchema: { properties: Record<string, Record<string, unknown>> } }[];

/** The ported writes, whose generic cases would collide on one database. Covered by twin cases below. */
const TWIN_WRITES = new Set(["manage_tasks set_label", "manage_configuration alert_resolve"]);

describe.skipIf(!BIN && !REQUIRED)("the hosted MCP endpoint in Rust", { timeout: 600_000 }, () => {
  beforeAll(async () => {
    if (!BIN) throw new Error("CIELE_RUST_PARITY_REQUIRED=1 but CIELE_RUST_API_BIN is unset");
    pg = await createSchemaLoadedPglite();
    await pg.exec(`
      grant usage on schema public, private to authenticated, service_role;
      grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
      alter role service_role bypassrls;
    `);
    const org = randomUUID();
    await pg.query(`insert into public.organizations (id, name) values ($1, 'MCP Parity Org')`, [org]);
    const owner = await seedMember(org, "owner");
    await seedKey("owner", org, "owner", owner);
    await seedKey("viewer", org, "viewer", owner);
    await seedKey("revoked", org, "owner", owner, true);
    state.db = createDb(createPgliteSupabaseClient(pg, { id: owner, email: "owner@mcp-parity.test" }, "service_role"));
    await pg.query(
      `insert into public.alerts (id, organization_id, type, title, detail, status, source_key, detected_at)
       select 'al-' || n, $1, 'crawl', 'Crawl failed', 'Timed out', 'active', 'src:' || n,
              timestamptz '2026-10-20 12:00:00+00' - make_interval(mins => n) from generate_series(1, 4) n`,
      [org]
    );
    await pg.query(
      `insert into public.task_labels (id, organization_id, name, color, created_at, updated_at)
       values ('lb-bug', $1, 'Bug', 'red', timestamptz '2026-10-20 12:00:00+00', timestamptz '2026-10-20 12:00:00+00'),
              ('lb-ts', $1, 'Twin ts', 'blue', timestamptz '2026-10-20 12:00:00+00', timestamptz '2026-10-20 12:00:00+00'),
              ('lb-rs', $1, 'Twin rs', 'blue', timestamptz '2026-10-20 12:00:00+00', timestamptz '2026-10-20 12:00:00+00'),
              ('lb-del-ts', $1, 'Gone ts', 'gray', timestamptz '2026-10-20 12:00:00+00', timestamptz '2026-10-20 12:00:00+00'),
              ('lb-del-rs', $1, 'Gone rs', 'gray', timestamptz '2026-10-20 12:00:00+00', timestamptz '2026-10-20 12:00:00+00')`,
      [org]
    );
    await pg.query(
      `insert into public.improvements (id, organization_id, seq, title, status, priority, tags, created_at, updated_at)
       select 'imp-' || n, $1, n, 'Answer ' || n, 'to_do', 'medium', '[]',
              timestamptz '2026-10-20 12:00:00+00', timestamptz '2026-10-20 12:00:00+00' from generate_series(1, 3) n`,
      [org]
    );

    recorder = createHttpServer(async (req, res) => {
      const raw = await readBody(req);
      recorded.push({
        method: req.method ?? "GET",
        url: req.url ?? "/",
        authorization: req.headers.authorization ?? null,
        accept: req.headers.accept ?? null,
        contentType: (req.headers["content-type"] ?? "").split(";")[0] || null,
        body: await describeBody(req, raw),
      });
      const response = await answer(req, raw);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    const recorderPort = await freePort();
    await new Promise<void>((resolve) => recorder.listen(recorderPort, "127.0.0.1", resolve));
    recorderUrl = `http://127.0.0.1:${recorderPort}`;
    process.env.CIELE_INTERNAL_API_ORIGIN = recorderUrl;

    const dbPort = await freePort();
    socket = new PGLiteSocketServer({ db: pg, port: dbPort, host: "127.0.0.1" });
    await socket.start();
    // PGlite's socket server holds one client and refuses the next until it
    // has seen the previous one close, so a binary that connects too soon
    // exits at startup. It is started again, a few times, until one stays up.
    startService = async (extra: Record<string, string>) => {
      for (let attempt = 0; ; attempt++) {
        const url = await spawnService(extra);
        if (url) return url;
        if (attempt >= 20) throw new Error("ciele-api did not start");
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    };
    const spawnService = async (extra: Record<string, string>): Promise<string | null> => {
      const port = await freePort();
      const child = spawn(BIN, [], {
        env: {
          ...process.env,
          DATABASE_URL: `postgres://postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable`,
          // PGlite has one session: no second pool with its own role.
          DATABASE_DIRECT_ROLE: "",
          DATABASE_MAX_CONNECTIONS: "1",
          CIELE_RUST_API_SECRET: randomBytes(32).toString("hex"),
          CIELE_MCP_API_ORIGIN: recorderUrl,
          PORT: String(port),
          RUST_LOG: "warn",
          ...extra,
        },
        stdio: ["ignore", "inherit", "inherit"],
      });
      services.push(child);
      const url = `http://127.0.0.1:${port}`;
      for (let tries = 0; ; tries++) {
        if (child.exitCode !== null) return null;
        if (await fetch(`${url}/healthz`).then((r) => r.ok, () => false)) return url;
        if (tries > 100) throw new Error("ciele-api did not start");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    // PGlite's socket server holds one client, so the read-only binary starts
    // in its own test, after this one stops.
    rustUrl = await startService({});
  }, 600_000);

  afterAll(async () => {
    for (const child of services) child.kill();
    recorder?.close();
    await socket?.stop();
    await pg?.close();
    delete process.env.CIELE_INTERNAL_API_ORIGIN;
    delete process.env.CIELE_MCP_READ_ONLY;
  });

  describe("the transport, both eras", () => {
    it("refuses a missing, unknown or revoked key with the same 401 bytes", async () => {
      for (const secret of [undefined, "ciele_sk_not_a_real_key", keys.revoked]) {
        const ts = await viaTs(modernRequest("http://ciele.test/api/mcp", secret, "tools/list"));
        const rust = await viaRust(modernRequest("http://ciele.test/api/mcp", secret, "tools/list"));
        expect(rust.status).toBe(401);
        expect(ts.status).toBe(401);
        expect(await rust.text()).toBe(await ts.text());
      }
    });

    it("lists the recorded tools, byte for byte, to a modern client", async () => {
      for (const send of [viaTs, (request: Request) => viaRust(request)]) {
        const body = await payload(await send(modernRequest("http://ciele.test/api/mcp", keys.viewer, "tools/list")));
        expect(`${JSON.stringify(body.result.tools, null, 2)}\n`).toBe(GOLDEN);
        expect(body.result.resultType).toBe("complete");
        expect(body.result.ttlMs).toBe(60 * 60 * 1000);
        expect(body.result.cacheScope).toBe("private");
      }
    });

    it("answers server/discover as the TypeScript server does", async () => {
      const ts = await payload(await viaTs(modernRequest("http://ciele.test/api/mcp", keys.owner, "server/discover")));
      const rust = await payload(await viaRust(modernRequest("http://ciele.test/api/mcp", keys.owner, "server/discover")));
      expect(rust.result).toEqual(ts.result);
      expect(Object.keys(rust.result.capabilities)).toEqual(["tools"]);
    });

    it("serves a 2025-era client: initialize, then tools/list", async () => {
      const init = { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "parity", version: "1" } };
      const ts = await payload(await viaTs(legacyRequest("http://ciele.test/api/mcp", keys.owner, "initialize", init)));
      const rust = await payload(await viaRust(legacyRequest("http://ciele.test/api/mcp", keys.owner, "initialize", init)));
      expect(rust.result).toEqual(ts.result);
      for (const send of [viaTs, (request: Request) => viaRust(request)]) {
        const listed = await payload(await send(legacyRequest("http://ciele.test/api/mcp", keys.owner, "tools/list", {})));
        expect(`${JSON.stringify(listed.result.tools, null, 2)}\n`).toBe(GOLDEN);
      }
    });

    it("frames tools/list and tools/call results as the SDK does, in both eras", async () => {
      const frame = (result: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(result).filter(([key]) => key !== "tools" && key !== "content"));
      const call = { name: "manage_configuration", arguments: { action: "alert_list" } };
      const requests = [
        () => modernRequest("http://ciele.test/api/mcp", keys.owner, "tools/list"),
        () => modernRequest("http://ciele.test/api/mcp", keys.owner, "tools/call", call, call.name),
        () => legacyRequest("http://ciele.test/api/mcp", keys.owner, "tools/list", {}),
        () => legacyRequest("http://ciele.test/api/mcp", keys.owner, "tools/call", call),
      ];
      for (const request of requests) {
        const ts = await payload(await viaTs(request()));
        const rust = await payload(await viaRust(request()));
        expect(frame(rust.result)).toEqual(frame(ts.result));
      }
    });

    it("answers GET and DELETE with the SDK's 405", async () => {
      for (const [ts, method] of [[tsMcpGet, "GET"], [tsMcpDelete, "DELETE"]] as const) {
        const expected = await ts(new Request("http://ciele.test/api/mcp", { method }));
        const actual = await fetch(`${rustUrl}/api/mcp`, { method });
        expect(actual.status).toBe(expected.status);
        expect(await actual.text()).toBe(await expected.text());
      }
    });

    it("refuses null arguments with a JSON-RPC error, as the SDK does", async () => {
      const request = () =>
        modernRequest("http://ciele.test/api/mcp", keys.owner, "tools/call", { name: "manage_assistants", arguments: null }, "manage_assistants");
      const ts = await payload(await viaTs(request()));
      const rust = await payload(await viaRust(request()));
      expect(ts.error?.code).toBe(-32602);
      expect(rust.error).toEqual(ts.error);
    });

    it("names an unknown tool as the SDK does", async () => {
      const [ts, rust] = await callBoth("manage_alerts", {});
      expect(rust.text).toBe(ts.text);
    });
  });

  // The cases route.test.ts runs against the Next.js route, here against the
  // service: one contract for whichever server answers /api/mcp.
  describe("the route contract, against the service", () => {
    mcpRouteContract(() => ({
      post: (request) => viaRust(request),
      probe: (method) => fetch(`${rustUrl}/api/mcp`, { method }),
      key: async (role) => keys[role],
      outbound: async (send) => {
        recorded = [];
        await send();
        return { urls: recorded.map((request) => `${recorderUrl}${request.url}`), origin: recorderUrl };
      },
    }));
  });

  describe("every action", () => {
    for (const tool of TOOLS) {
      const actions = (tool.inputSchema.properties.action?.enum as string[] | undefined) ?? [""];
      for (const action of actions) {
        const label = `${tool.name} ${action}`;
        it(label, async () => {
          const full = (text: string) => {
            const args: Record<string, unknown> = {};
            for (const [key, schema] of Object.entries(tool.inputSchema.properties)) args[key] = sample(key, schema, text);
            if (action) args.action = action;
            return args;
          };
          const variants: Record<string, unknown>[] = [action ? { action } : {}];
          if (!TWIN_WRITES.has(label)) variants.push(full("x"), full("fail-envelope"), full("fail-plain"));
          for (const args of variants) {
            const [ts, rust] = await callBoth(tool.name, args);
            const context = `${label} ${JSON.stringify(args)}`;
            expect(rust.isError, context).toBe(ts.isError);
            expect(normalizeText(rust.text), context).toEqual(normalizeText(ts.text));
            const ported = ts.requests.filter((r) => PORTED_PATHS(r.method, r.url));
            expect(rust.requests, `${context}: Rust must send only what is not ported`).toEqual(
              ts.requests.filter((r) => !PORTED_PATHS(r.method, r.url))
            );
            for (const request of rust.requests) expect(request.authorization).toBe(`Bearer ${keys.owner}`);
            if (ported.length > 0) expect(rust.requests.filter((r) => PORTED_PATHS(r.method, r.url))).toEqual([]);
          }
        });
      }
    }
  });

  describe("ported writes, on twin rows", () => {
    const twin = async (name: string, ts: Record<string, unknown>, rust: Record<string, unknown>, ignore: string[] = []) => {
      const once = async (send: (request: Request) => Promise<Response>, args: Record<string, unknown>) => {
        recorded = [];
        const body = await payload(await send(modernRequest("http://ciele.test/api/mcp", keys.owner, "tools/call", { name, arguments: args }, name)));
        return { text: body.result.content[0].text as string, isError: body.result.isError === true, requests: recorded };
      };
      const a = await once(viaTs, ts);
      const b = await once((request) => viaRust(request), rust);
      const strip = (text: string) => {
        const value = normalizeText(text);
        if (!value || typeof value !== "object" || Array.isArray(value)) return value;
        return Object.fromEntries(Object.entries(value).filter(([key]) => !ignore.includes(key)));
      };
      expect(b.isError).toBe(a.isError);
      expect(strip(b.text)).toEqual(strip(a.text));
      expect(a.requests.length).toBeGreaterThan(0);
      expect(b.requests).toEqual([]);
    };

    it("creates, renames and deletes a Label without a request to the web app", async () => {
      await twin("manage_tasks", { action: "set_label", name: "Made ts", color: "green" }, { action: "set_label", name: "Made rs", color: "green" }, ["id", "name", "createdAt", "updatedAt"]);
      await twin("manage_tasks", { action: "set_label", name: "bug" }, { action: "set_label", name: "bug" });
      await twin("manage_tasks", { action: "set_label", id: "lb-ts", color: "purple" }, { action: "set_label", id: "lb-rs", color: "purple" }, ["id", "name", "updatedAt"]);
      await twin("manage_tasks", { action: "set_label", id: "lb-del-ts", delete: true }, { action: "set_label", id: "lb-del-rs", delete: true }, ["deleted"]);
      await twin("manage_tasks", { action: "set_label", id: "missing", name: "x" }, { action: "set_label", id: "missing", name: "x" });
    });

    it("resolves an Alert without a request to the web app", async () => {
      await twin("manage_configuration", { action: "alert_resolve", id: "al-1" }, { action: "alert_resolve", id: "al-2" }, ["id", "sourceKey", "title", "detectedAt", "resolvedAt", "updatedAt"]);
      await twin("manage_configuration", { action: "alert_resolve", id: "missing" }, { action: "alert_resolve", id: "missing" });
    });
  });

  describe("read-only mode", () => {
    it("lists the read-only descriptions and refuses a write before any request leaves", async () => {
      const running = services.find((child) => child.exitCode === null)!;
      await new Promise<void>((resolve) => {
        running.once("exit", () => resolve());
        running.kill();
      });
      // PGlite is one backend session, so the first binary's prepared
      // statements outlive its connection and collide with the next one's.
      await pg.exec("deallocate all");
      rustReadOnlyUrl = await startService({ CIELE_MCP_READ_ONLY: "1" });
      // The TypeScript side is the route itself, under the same variable.
      process.env.CIELE_MCP_READ_ONLY = "1";
      const listed = await payload(await viaRust(modernRequest("http://ciele.test/api/mcp", keys.owner, "tools/list"), rustReadOnlyUrl));
      expect(`${JSON.stringify(listed.result.tools, null, 2)}\n`).toBe(GOLDEN_READ_ONLY);
      for (const [name, args] of [
        ["manage_assistants", { action: "delete", id: "a" }],
        ["manage_tasks", { action: "set_label", name: "Nope" }],
        ["manage_configuration", { action: "alert_resolve", id: "al-3" }],
        ["manage_memories", { action: "wipe", subjectId: "s" }],
      ] as const) {
        const request = () => modernRequest("http://ciele.test/api/mcp", keys.owner, "tools/call", { name, arguments: args }, name);
        recorded = [];
        const ts = await payload(await viaTs(request()));
        const rust = await payload(await viaRust(request(), rustReadOnlyUrl));
        expect(rust.result.content).toEqual(ts.result.content);
        expect(rust.result.isError).toBe(true);
        expect(recorded).toEqual([]);
      }
      delete process.env.CIELE_MCP_READ_ONLY;
      const alert = await pg.query<{ status: string }>(`select status from public.alerts where id = 'al-3'`);
      expect(alert.rows[0].status).toBe("active");
    });
  });
});
