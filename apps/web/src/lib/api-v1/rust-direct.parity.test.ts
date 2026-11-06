import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
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

/**
 * /api/v1 answered by Next.js and by the Rust service, compared (#1134).
 *
 * One schema-loaded Postgres serves both: the route handlers read it through
 * the PostgREST shim as the service-role client `getApiV1Db` returns, the
 * binary over a socket. Every case sends one request to the route handler and
 * the same request to `services/ciele-api`, and the two answers must match: the
 * status always, an error body byte for byte, a success body as JSON once the
 * shim's `Date`s are read back as instants. A write runs on twin rows, so
 * neither side sees the other's.
 *
 * Needs the built binary, like `packages/ops/src/rust-parity.test.ts`:
 *
 *   cargo build --manifest-path services/ciele-api/Cargo.toml
 *   CIELE_RUST_PARITY_REQUIRED=1 CIELE_RUST_API_BIN=<target>/debug/ciele-api \
 *     pnpm --filter @agent-hub/web exec vitest run rust-direct.parity
 */

const BIN = process.env.CIELE_RUST_API_BIN;
const REQUIRED = process.env.CIELE_RUST_PARITY_REQUIRED === "1";

const state = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock("@/lib/api-v1/db", () => ({ getApiV1Db: () => state.db }));

type PG = Awaited<ReturnType<typeof createSchemaLoadedPglite>>;
let pg: PG;
let socket: PGLiteSocketServer;
let service: ChildProcess | null = null;
let serviceUrl: string;
let organizationId: string;
let foreignOrganizationId: string;
let elsewhereOrganizationId: string;
const keys: Record<string, string> = {};

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
  await pg.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@parity-test.edu`]);
  await pg.query(`insert into public.organization_members (organization_id, user_id, role) values ($1, $2, $3)`, [
    org,
    id,
    role,
  ]);
  return id;
}

/** A key as `createApiKeyOp` stores one: only the hash. */
async function seedKey(name: string, org: string, role: Role, createdBy: string, revoked = false) {
  const secret = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  await pg.query(
    `insert into public.organization_api_keys (organization_id, name, secret_hash, secret_hint, role, created_by, revoked_at)
     values ($1, $2, $3, $4, $5, $6, case when $7 then now() end)`,
    [org, name, hashApiKeySecret(secret), secret.slice(0, 13), role, createdBy, revoked]
  );
  keys[name] = secret;
}

async function seedAlert(id: string, org: string, minutesAgo: number, status = "active") {
  await pg.query(
    `insert into public.alerts (id, organization_id, type, title, detail, status, source_key, detected_at, resolved_at)
     values ($1, $2, 'crawl', 'Crawl failed', 'Timed out', $3, $4,
             timestamptz '2026-10-20 12:00:00+00' - make_interval(mins => $5),
             case when $3 = 'resolved' then timestamptz '2026-10-20 13:00:00+00' end)`,
    [id, org, status, `website-source:${id}`, minutesAgo]
  );
}

async function seedLabel(id: string, org: string, name: string, color = "gray") {
  await pg.query(
    `insert into public.task_labels (id, organization_id, name, color, created_at, updated_at)
     values ($1, $2, $3, $4, timestamptz '2026-10-20 12:00:00+00', timestamptz '2026-10-20 12:00:00+00')`,
    [id, org, name, color]
  );
}

async function seedImprovement(id: string, org: string, seq: number, status = "to_do") {
  await pg.query(
    `insert into public.improvements (id, organization_id, seq, title, status, priority, tags, due_date, created_at, updated_at)
     values ($1, $2, $3, $4, $5, 'medium', '["faq"]', date '2026-11-01',
             timestamptz '2026-10-20 12:00:00+00', timestamptz '2026-10-20 12:00:00+00')`,
    [id, org, seq, `Answer ${seq} was wrong`, status]
  );
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** The route files under test, by the path the registry gives them. */
const ROUTES: Record<string, Partial<Record<Method, Handler>>> = {
  "/alerts": alertsRoute as Partial<Record<Method, Handler>>,
  "/alerts/{id}/resolve": resolveAlertRoute as Partial<Record<Method, Handler>>,
  "/improvements": improvementsRoute as Partial<Record<Method, Handler>>,
  "/task-labels": taskLabelsRoute as Partial<Record<Method, Handler>>,
  "/task-labels/{id}": taskLabelRoute as Partial<Record<Method, Handler>>,
};

/** The route file that serves `path`, and its parameters, as Next.js would decode them. */
function routeFor(path: string): { template: string; params: Record<string, string> } {
  const pathname = path.split("?")[0];
  for (const template of Object.keys(ROUTES)) {
    const names: string[] = [];
    const pattern = new RegExp(
      `^${template.replace(/\{(\w+)\}/g, (_, name: string) => {
        names.push(name);
        return "([^/]+)";
      })}$`
    );
    const match = pattern.exec(pathname);
    if (match) {
      return {
        template,
        params: Object.fromEntries(names.map((name, i) => [name, decodeURIComponent(match[i + 1])])),
      };
    }
  }
  throw new Error(`no route file serves ${path}`);
}

interface Sent {
  /** A key name from `keys`, a raw Authorization value, or nothing. */
  key?: string;
  authorization?: string;
  body?: string;
}

interface Answer {
  status: number;
  type: string | null;
  text: string;
}

function headersFor({ key, authorization }: Sent): Record<string, string> {
  if (authorization !== undefined) return { authorization };
  return key ? { authorization: `Bearer ${keys[key]}` } : {};
}

async function viaNext(method: Method, path: string, sent: Sent): Promise<Answer> {
  const { template, params } = routeFor(path);
  const handler = ROUTES[template][method];
  if (!handler) throw new Error(`${method} ${template} has no handler`);
  const request = new Request(`http://ciele.test/api/v1${path}`, {
    method,
    headers: headersFor(sent),
    body: sent.body,
  });
  const response = await handler(request, { params: Promise.resolve(params) });
  return { status: response.status, type: response.headers.get("content-type"), text: await response.text() };
}

async function viaRust(method: Method, path: string, sent: Sent): Promise<Answer> {
  const response = await fetch(`${serviceUrl}/api/v1${path}`, {
    method,
    headers: headersFor(sent),
    body: sent.body,
  });
  return { status: response.status, type: response.headers.get("content-type"), text: await response.text() };
}

/** Timestamps as instants, a `date` column as its day: the shim's `Date`s against Postgres's text. */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return new Date(value).toISOString();
  }
  if (!value || typeof value !== "object") return value;
  const row = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  if (typeof row.dueDate === "string") row.dueDate = row.dueDate.slice(0, 10);
  return row;
}

function without(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

/**
 * One request both ways. An error must be the same bytes; a success the same
 * JSON, minus `ignore` (the fields a twin row is allowed to differ in).
 */
async function same(
  method: Method,
  path: string | [next: string, rust: string],
  sent: Sent | [next: Sent, rust: Sent],
  ignore: string[] = []
): Promise<unknown> {
  const [nextPath, rustPath] = typeof path === "string" ? [path, path] : path;
  const [nextSent, rustSent] = Array.isArray(sent) ? sent : [sent, sent];
  const next = await viaNext(method, nextPath, nextSent);
  const rust = await viaRust(method, rustPath, rustSent);
  const label = `${method} ${rustPath} ${JSON.stringify(rustSent.body ?? null)}`;
  expect(rust.status, label).toBe(next.status);
  expect(rust.type, label).toBe(next.type);
  if (next.status >= 400) {
    expect(rust.text, label).toBe(next.text);
    return JSON.parse(rust.text);
  }
  const parsed = [JSON.parse(next.text), JSON.parse(rust.text)].map((body) => without(normalize(body), ignore));
  expect(parsed[1], label).toEqual(parsed[0]);
  return JSON.parse(rust.text);
}

describe.skipIf(!BIN && !REQUIRED)("/api/v1 straight from the Rust service", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    if (!BIN) {
      throw new Error("CIELE_RUST_PARITY_REQUIRED=1 but CIELE_RUST_API_BIN is unset: build the service and point at it");
    }
    pg = await createSchemaLoadedPglite();
    // Supabase grants these out of band; without them `set role` fails.
    await pg.exec(`
      grant usage on schema public, private to authenticated, service_role;
      grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
      alter role service_role bypassrls;
    `);
    organizationId = randomUUID();
    foreignOrganizationId = randomUUID();
    elsewhereOrganizationId = randomUUID();
    await pg.query(
      `insert into public.organizations (id, name) values ($1, 'Parity Org'), ($2, 'Foreign Org'), ($3, 'Elsewhere Org')`,
      [organizationId, foreignOrganizationId, elsewhereOrganizationId]
    );
    const owner = await seedMember(organizationId, "owner");
    const demoted = await seedMember(organizationId, "viewer");
    const gone = await seedMember(organizationId, "admin");
    const foreigner = await seedMember(foreignOrganizationId, "owner");
    state.db = createDb(createPgliteSupabaseClient(pg, { id: owner, email: "owner@parity-test.edu" }, "service_role"));

    await seedKey("owner", organizationId, "owner", owner);
    await seedKey("editor", organizationId, "editor", owner);
    await seedKey("viewer", organizationId, "viewer", owner);
    // Minted as admin by a Member since demoted to viewer: it acts as a viewer.
    await seedKey("demoted", organizationId, "admin", demoted);
    await seedKey("revoked", organizationId, "owner", owner, true);
    await seedKey("orphan", organizationId, "owner", gone);
    await pg.query(`delete from public.organization_members where user_id = $1`, [gone]);
    await seedKey("foreign", foreignOrganizationId, "owner", foreigner);
    await seedKey("elsewhere", elsewhereOrganizationId, "owner", await seedMember(elsewhereOrganizationId, "owner"));
    await seedKey("unstampable", organizationId, "viewer", owner);
    // The stamp of this one key always fails, as a lock timeout or a
    // read-only replica would make it fail.
    await pg.exec(`
      create function public.refuse_stamp() returns trigger language plpgsql as $$
      begin raise exception 'stamp refused'; end $$;
      create trigger refuse_stamp before update of last_used_at on public.organization_api_keys
        for each row when (old.name = 'unstampable') execute function public.refuse_stamp();
    `);

    await seedAlert("al-old", organizationId, 90, "resolved");
    await seedAlert("al-new", organizationId, 5);
    await seedAlert("al-foreign", foreignOrganizationId, 1);
    for (const twin of ["ts", "rs"]) {
      await seedAlert(`al-resolve-${twin}`, organizationId, 30);
      await seedLabel(`lb-rename-${twin}`, organizationId, `Rename ${twin}`, "blue");
      await seedLabel(`lb-delete-${twin}`, organizationId, `Delete ${twin}`);
    }
    await seedLabel("lb-bug", organizationId, "Bug", "red");
    await seedLabel("lb-foreign", foreignOrganizationId, "Foreign");
    for (let seq = 1; seq <= 5; seq++) {
      await seedImprovement(`imp-${seq}`, organizationId, seq, seq === 2 ? "in_progress" : "to_do");
    }
    await seedImprovement("imp-foreign", foreignOrganizationId, 1);

    const dbPort = await freePort();
    socket = new PGLiteSocketServer({ db: pg, port: dbPort, host: "127.0.0.1" });
    await socket.start();
    const port = await freePort();
    serviceUrl = `http://127.0.0.1:${port}`;
    service = spawn(BIN, [], {
      env: {
        ...process.env,
        DATABASE_URL: `postgres://postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable`,
        // PGlite has one session: no second pool with its own role.
        DATABASE_DIRECT_ROLE: "",
        DATABASE_MAX_CONNECTIONS: "1",
        CIELE_RUST_API_SECRET: randomBytes(32).toString("hex"),
        PORT: String(port),
        RUST_LOG: "warn",
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
    for (let tries = 0; ; tries++) {
      if (await fetch(`${serviceUrl}/healthz`).then((r) => r.ok, () => false)) break;
      if (tries > 100) throw new Error("ciele-api did not start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, 600_000);

  afterAll(async () => {
    service?.kill();
    await socket?.stop();
    await pg?.close();
  });

  it("answers exactly the endpoints the web app routes to it", async () => {
    const served = (await (await fetch(`${serviceUrl}/v1/routes`)).json()) as typeof RUST_DIRECT_ENDPOINTS;
    const key = (endpoint: { method: string; path: string; operation: string }) =>
      `${endpoint.method} ${endpoint.path} ${endpoint.operation}`;
    expect(served.map(key).sort()).toEqual(RUST_DIRECT_ENDPOINTS.map(key).sort());
  });

  it("refuses a missing, malformed, unknown, revoked or orphaned key with the same 401", async () => {
    const refused: Sent[] = [
      {},
      { authorization: "" },
      { authorization: "Bearer" },
      { authorization: "Bearer " },
      { authorization: `Basic ${keys.owner}` },
      { authorization: `Bearer  ${keys.owner}` },
      { authorization: `Bearer ${keys.owner} extra` },
      { authorization: keys.owner },
      { authorization: "Bearer not-a-ciele-key" },
      { authorization: `Bearer ${API_KEY_PREFIX}never-minted` },
      { key: "revoked" },
      // Its creator left the Organization, so the delegation ended with them.
      { key: "orphan" },
    ];
    for (const sent of refused) {
      for (const [method, path] of [
        ["GET", "/alerts"],
        ["GET", "/improvements"],
        ["DELETE", "/task-labels/lb-bug"],
        ["POST", "/alerts/al-new/resolve"],
      ] as const) {
        const body = await same(method, path, sent);
        expect(body).toEqual({ error: { code: "unauthorized", message: "Provide a valid API key as a Bearer token" } });
      }
    }
  });

  it("checks the body before the key, as the route does", async () => {
    for (const body of ["", "nope", "null", "{"]) {
      await same("POST", "/task-labels", { body });
      await same("PATCH", "/task-labels/lb-bug", { body });
      await same("POST", "/task-labels", { key: "owner", body });
    }
    // A JSON scalar is not an object: the PATCH route refuses it as a body.
    await same("PATCH", "/task-labels/lb-bug", { key: "owner", body: "5" });
    await same("PATCH", "/task-labels/lb-bug", { key: "owner", body: '"x"' });
  });

  it("refuses a key without the operation's Capability with the same 403, naming the Capability", async () => {
    for (const key of ["viewer", "demoted"]) {
      await same("POST", "/task-labels", { key, body: '{"name":"Nope"}' });
      await same("PATCH", "/task-labels/lb-bug", { key, body: '{"color":"blue"}' });
      await same("DELETE", "/task-labels/lb-bug", { key });
      const body = await same("POST", "/alerts/al-new/resolve", { key });
      expect(body).toEqual({
        error: { code: "forbidden", message: "This API key's role does not allow this operation: it needs alerts:edit" },
      });
    }
    // A viewer may read.
    await same("GET", "/alerts", { key: "demoted" });
  });

  it("reads the same rows, and only the key's Organization's", async () => {
    const alerts = (await same("GET", "/alerts", { key: "viewer" })) as { data: { id: string }[] };
    expect(alerts.data.map((alert) => alert.id)).toContain("al-new");
    await same("GET", "/task-labels", { key: "editor" });
    const foreign = (await same("GET", "/task-labels", { key: "foreign" })) as { data: { id: string }[] };
    expect(foreign.data.map((label) => label.id)).toEqual(["lb-foreign"]);
    await same("GET", "/alerts", { key: "foreign" });
  });

  it("pages Improvements the same, reading ?limit and ?cursor as parseListParams does", async () => {
    const first = (await same("GET", "/improvements?limit=2", { key: "viewer" })) as { nextCursor: string | null };
    expect(first.nextCursor).toBe("4");
    for (const query of [
      "",
      "?limit=2&cursor=4",
      "?limit=2&cursor=2",
      "?limit=0",
      "?limit=",
      "?limit=abc",
      "?limit=1e3",
      "?limit=-3",
      "?limit=2.9",
      "?limit=0x2",
      "?limit=Infinity",
      "?limit=1&limit=3",
      "?cursor=",
      "?cursor=abc",
      "?cursor=3.5",
      "?cursor=%20",
      "?limit=1&cursor=+5",
      // The board's filters: run before paging, with `counts` under the same filters.
      "?status=to_do",
      "?status=other",
      "?search=answer&limit=1",
      "?search=%20%20",
      "?priority=medium",
      "?priority=urgent",
      "?assigneeId=",
      "?assigneeId=nobody",
      "?projectId=missing",
      "?projectId=",
      "?assistantId=missing",
      "?search=answer&status=done&priority=medium",
    ]) {
      await same("GET", `/improvements${query}`, { key: "viewer" });
    }
    await same("GET", "/improvements", { key: "foreign" });
  });

  it("creates a Label the same, and refuses what zod refuses with zod's own words", async () => {
    await same(
      "POST",
      "/task-labels",
      [
        { key: "editor", body: '{"name":"  Created ts  ","color":"green","extra":1}' },
        { key: "editor", body: '{"name":"  Created rs  ","color":"green","extra":1}' },
      ],
      ["id", "name", "createdAt", "updatedAt"]
    );
    await same(
      "POST",
      "/task-labels",
      [
        { key: "editor", body: '{"name":"Default ts"}' },
        { key: "editor", body: '{"name":"Default rs"}' },
      ],
      ["id", "name", "createdAt", "updatedAt"]
    );
    for (const body of [
      "[]",
      "1",
      '"x"',
      "true",
      "{}",
      '{"name":1}',
      '{"name":null}',
      '{"name":"  "}',
      `{"name":"${"x".repeat(61)}"}`,
      `{"name":"${"😀".repeat(31)}"}`,
      '{"name":"ok","color":"teal"}',
      '{"name":"ok","color":null}',
      '{"color":"teal","name":[]}',
      // The duplicate check ignores case.
      '{"name":"bug"}',
      '{"name":" Bug "}',
    ]) {
      await same("POST", "/task-labels", { key: "editor", body });
    }
    // A Label of another Organization is no conflict here. Each side writes
    // into an Organization of its own, so neither meets the other's "Bug".
    await same(
      "POST",
      "/task-labels",
      [
        { key: "foreign", body: '{"name":"Bug","color":"red"}' },
        { key: "elsewhere", body: '{"name":"Bug","color":"red"}' },
      ],
      ["id", "organizationId", "createdAt", "updatedAt"]
    );
  });

  it("updates and deletes a Label the same", async () => {
    await same(
      "PATCH",
      ["/task-labels/lb-rename-ts", "/task-labels/lb-rename-rs"],
      { key: "editor", body: '{"color":"purple"}' },
      ["id", "name", "updatedAt"]
    );
    for (const [path, body] of [
      ["/task-labels/missing", '{"color":"red"}'],
      ["/task-labels/lb-foreign", '{"name":"Mine"}'],
      ["/task-labels/lb-bug", "[]"],
      ["/task-labels/lb-bug", '{"name":""}'],
      ["/task-labels/lb-bug", '{"color":"teal"}'],
      ["/task-labels/lb-rename-ts", '{"name":"bug"}'],
      [`/task-labels/${"x".repeat(65)}`, "{}"],
      ["/task-labels/a%20b", "{}"],
    ]) {
      await same("PATCH", path, { key: "editor", body });
    }
    const deleted = await same(
      "DELETE",
      ["/task-labels/lb-delete-ts", "/task-labels/lb-delete-rs"],
      { key: "editor" },
      ["deleted"]
    );
    expect(deleted).toEqual({ deleted: "lb-delete-rs" });
    for (const path of ["/task-labels/lb-delete-rs", "/task-labels/lb-foreign", `/task-labels/${"x".repeat(65)}`]) {
      await same("DELETE", path, { key: "editor" });
    }
  });

  it("resolves an Alert the same, attributed to the key's creator", async () => {
    const resolved = (await same(
      "POST",
      ["/alerts/al-resolve-ts/resolve", "/alerts/al-resolve-rs/resolve"],
      { key: "editor" },
      ["id", "sourceKey", "resolvedAt", "updatedAt"]
    )) as { status: string; resolvedAt: string | null };
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).toBeTruthy();
    for (const path of ["/alerts/missing/resolve", "/alerts/al-foreign/resolve", "/alerts/a%2Fb/resolve"]) {
      await same("POST", path, { key: "editor" });
    }
  });

  it("stamps the key's last use, as resolveApiKeyContext does", async () => {
    const lastUsed = async () =>
      (
        await pg.query<{ last_used_at: Date | null }>(
          `select last_used_at from public.organization_api_keys where name = 'foreign'`
        )
      ).rows[0].last_used_at;
    await pg.query(`update public.organization_api_keys set last_used_at = null where name = 'foreign'`);
    await viaRust("GET", "/alerts", { key: "foreign" });
    expect(await lastUsed()).not.toBeNull();
    // A revoked key is refused and not stamped.
    await viaRust("GET", "/alerts", { key: "revoked" });
    const revoked = await pg.query<{ last_used_at: Date | null }>(
      `select last_used_at from public.organization_api_keys where name = 'revoked'`
    );
    expect(revoked.rows[0].last_used_at).toBeNull();
  });

  it("answers even when the stamp fails, as the route swallows it", async () => {
    const body = (await same("GET", "/alerts", { key: "unstampable" })) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
    await same("GET", "/improvements?limit=1", { key: "unstampable" });
  });
});
