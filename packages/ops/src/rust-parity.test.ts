import { listImprovementsOp, listImprovementsPageOp, proposeSuggestedFixOp, dismissSuggestedFixOp } from "./improvements";
import { createTaskLabelOp, deleteTaskLabelOp, listTaskLabelsOp, updateTaskLabelOp } from "./task-labels";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { IMPROVEMENT_STATUS_VALUES, WORK_COLORS, roleAllowsCapability, type Role } from "@agent-hub/core";
import { createDb, createOrgPinnedDb, type Db } from "@agent-hub/db";
import { createPgliteSupabaseClient, createSchemaLoadedPglite } from "@agent-hub/db/testing";
import { listAlertsOp, resolveAlertOp, updateAlertOp } from "./configuration";
import type { Operation, OperationContext, OperationPorts } from "./operation";
import { operationsByName } from "./platform-actions";
import {
  ASSERTION_HEADER,
  createHttpRemoteExecutor,
  registerRemoteExecutor,
  RUST_OPERATIONS,
  signAssertion,
  type DbScope,
} from "./remote";

/**
 * TypeScript and Rust answer the same (#1121).
 *
 * One schema-loaded Postgres serves both sides: the TypeScript operation reads
 * it in-process through the PostgREST shim, the Rust binary over a socket.
 * Every case runs the operation twice, once with no executor registered and
 * once routed to the service, and the two answers must match. A mutation runs
 * on two identical twin rows, so neither side sees the other's write.
 *
 * Beyond the per-domain cases, `PORTS` below holds what every ported operation
 * owes, and the service's own table (`GET /v1/ops`) must name exactly its
 * keys: its role against the TypeScript `capability`, another Organization's
 * rows in both scopes, and zod's verdict on malformed inputs.
 *
 * Needs the built binary, so it runs only where `CIELE_RUST_API_BIN` names it.
 * Where it is the gate (`rust.yml`, `pnpm verify`), `CIELE_RUST_PARITY_REQUIRED=1`
 * turns a missing binary into a failure instead of a skip:
 *
 *   cargo build --manifest-path services/ciele-api/Cargo.toml
 *   CIELE_RUST_PARITY_REQUIRED=1 CIELE_RUST_API_BIN=<target>/debug/ciele-api \
 *     pnpm --filter @ciele/ops exec vitest run rust-parity
 */

const BIN = process.env.CIELE_RUST_API_BIN;
const REQUIRED = process.env.CIELE_RUST_PARITY_REQUIRED === "1";
const SECRET = randomBytes(32).toString("hex");
const ROLES: Role[] = ["viewer", "editor", "admin", "owner"];
const REPO = new URL("../../../", import.meta.url);

/** PostgREST's `max_rows`, which caps every TypeScript list read in production. */
const MAX_ROWS = Number(/^max_rows\s*=\s*(\d+)/m.exec(readFileSync(new URL("supabase/config.toml", REPO), "utf8"))?.[1]);

let pg: PGlite;
let socket: PGLiteSocketServer;
let service: ChildProcess | null = null;
let serviceUrl: string;
let serviceOperations: { name: string; role: Role }[];
let organizationId: string;
let foreignOrganizationId: string;
let crowdedOrganizationId: string;
let editor: { id: string; email: string };

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject()));
    });
  });
}

async function seedUser(email: string, role: string): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  await pg.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  await pg.query(
    `insert into public.organization_members (organization_id, user_id, role) values ($1, $2, $3)
     on conflict (organization_id, user_id) do update set role = excluded.role`,
    [organizationId, id, role]
  );
  return { id, email };
}

async function seedAlert(id: string, org: string, minutesAgo: number, status = "active") {
  await pg.query(
    `insert into public.alerts (id, organization_id, type, title, detail, status, source_key, detected_at, resolved_at)
     values ($1, $2, 'crawl', 'Crawl failed', 'Timed out after 30 s', $3, $4,
             timestamptz '2026-10-20 12:00:00+00' - make_interval(mins => $5),
             case when $3 = 'resolved' then timestamptz '2026-10-20 13:00:00+00' end)`,
    [id, org, status, `website-source:${id}`, minutesAgo]
  );
}

/** Every port the TypeScript body reached. A forwarded operation must reach none. */
let portsReached: string[] = [];
const ports = new Proxy({} as OperationPorts, {
  get(_target, key) {
    portsReached.push(String(key));
    return undefined;
  },
});

function context(scope: DbScope, org = organizationId): OperationContext {
  const db: Db =
    scope === "session"
      ? createDb(createPgliteSupabaseClient(pg, editor))
      : createOrgPinnedDb(createDb(createPgliteSupabaseClient(pg, editor, "service_role")), org);
  return { organizationId: org, userId: editor.id, role: "editor", db, dbScope: scope, ports };
}

const TIMESTAMPS = ["detectedAt", "resolvedAt", "createdAt", "updatedAt"] as const;

/**
 * The shim hands back `Date`s where PostgREST hands back strings, and the
 * TypeScript body stamps `resolved_at` from the JS clock where the service uses
 * `now()`. Compare instants for the first, and presence for a fresh stamp.
 */
function normalize(value: unknown, freshStamp = false): unknown {
  if (Array.isArray(value)) return value.map((item) => normalize(item, freshStamp));
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  const row: Record<string, unknown> = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalize(item, freshStamp)])
  );
  // A `date` column: PostgREST, and so the service, answer the bare day; the
  // shim answers midnight UTC.
  if (row.dueDate) row.dueDate = new Date(row.dueDate as string).toISOString().slice(0, 10);
  for (const key of TIMESTAMPS) {
    const stamp = row[key];
    if (stamp === null || stamp === undefined) continue;
    row[key] = freshStamp && key === "resolvedAt" ? "<stamped>" : new Date(stamp as string).toISOString();
  }
  return row;
}

type Answer<Out> = Out | { error: string };

async function both<In, Out>(
  op: Operation<In, Out>,
  scope: DbScope,
  // Before parsing: the surface parses before `run`, so both sides get zod's output.
  inputs: [typescript: unknown, rust: unknown],
  org = organizationId
): Promise<[Answer<Out>, Answer<Out>]> {
  const attempt = (input: unknown) =>
    op.run(context(scope, org), op.input.parse(input)).catch((error: { code?: string; message: string }) => ({
      error: error.code ?? error.message,
    }));
  registerRemoteExecutor(null);
  portsReached = [];
  const typescript = await attempt(inputs[0]);
  expect(portsReached, `${op.name} reads ctx.ports, so it cannot be forwarded`).toEqual([]);
  registerRemoteExecutor(createHttpRemoteExecutor({ baseUrl: serviceUrl, secret: SECRET }), [op.name]);
  try {
    return [typescript, await attempt(inputs[1])];
  } finally {
    registerRemoteExecutor(null);
  }
}

/** A request straight to the service, past zod and past the executor. */
async function raw(
  operation: string,
  body: string,
  options: { role?: Role; scope?: DbScope; token?: string } = {}
): Promise<{ status: number; result?: unknown; code?: string }> {
  const token =
    options.token ??
    (await signAssertion(
      SECRET,
      {
        operation,
        organizationId,
        userId: editor.id,
        role: options.role ?? "owner",
        dbScope: options.scope ?? "pinned",
      },
      body
    ));
  const response = await fetch(`${serviceUrl}/v1/ops/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json", [ASSERTION_HEADER]: token },
    body,
  });
  const answer = (await response.json()) as { result?: unknown; error?: { code: string } };
  return { status: response.status, result: answer.result, code: answer.error?.code };
}

/** The twin's id is the only field allowed to differ. */
function withoutId(value: unknown): unknown {
  return without(value, ["id", "sourceKey"]);
}

function without(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

async function seedImprovement(id: string, org: string, seq: number, status = "to_do") {
  await pg.query(
    `insert into public.improvements (id, organization_id, seq, title, status, priority, tags, due_date, created_at, updated_at)
     values ($1, $2, $3, $4, $5, 'medium', '["faq"]', date '2026-11-01',
             timestamptz '2026-10-20 12:00:00+00', timestamptz '2026-10-20 12:00:00+00')`,
    [id, org, seq, `Answer ${seq} was wrong`, status]
  );
}

async function seedLabel(id: string, org: string, name: string, color = "gray") {
  await pg.query(
    `insert into public.task_labels (id, organization_id, name, color, created_at, updated_at)
     values ($1, $2, $3, $4, timestamptz '2026-10-20 12:00:00+00', timestamptz '2026-10-20 12:00:00+00')`,
    [id, org, name, color]
  );
}


/** The ids in a list answer, a bare array or a page's `items`. */
function idsOf(answer: unknown): string[] {
  const rows = Array.isArray(answer) ? answer : (answer as { items?: unknown[] }).items;
  return (rows ?? []).map((row) => (row as { id: string }).id);
}

/** Every row any table holds for an Organization, to show a refused write changed nothing. */
async function rowsOf(org: string): Promise<unknown[]> {
  const tables = await pg.query<{ table_name: string }>(
    `select table_name from information_schema.columns
     where table_schema = 'public' and column_name = 'organization_id' order by table_name`
  );
  if (tables.rows.length === 0) return [];
  // One statement keeps the full audit without a scheduling round trip per
  // table. Every table has a key, even when empty, and rows sort by their
  // canonical JSON so a query plan cannot change the comparison's order.
  const snapshots = tables.rows.map(({ table_name }) => {
    const name = table_name.replaceAll("'", "''");
    const table = table_name.replaceAll('"', '""');
    return `select '${name}' as table_name,
      coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) as rows
      from public."${table}" t where organization_id = $1`;
  });
  return (await pg.query(`${snapshots.join(" union all ")} order by table_name`, [org])).rows;
}

const shapeOf = (schema: unknown) => (schema as { shape: Record<string, unknown> }).shape;
const optionsOf = (schema: unknown) => (schema as { unwrap(): { options: string[] } }).unwrap().options;

const ALERT_PATCH = shapeOf(shapeOf(updateAlertOp.input).patch);
const ALERT_TYPES = optionsOf(ALERT_PATCH.type);
const ALERT_STATUSES = optionsOf(ALERT_PATCH.status);

interface PortCases {
  op: Operation<unknown, unknown>;
  /**
   * An input that names another Organization's rows. A read answers without
   * any of `hidden`; a write answers `not_found` and changes nothing.
   */
  foreign: { input: unknown; hidden?: string[]; error?: string; pinnedError?: string };
  /**
   * Raw inputs sent past zod: the service refuses exactly those zod refuses.
   * An accepted one names a row that does not exist, so nothing changes.
   */
  inputs: unknown[];
}

const port = <In, Out>(op: Operation<In, Out>, cases: Omit<PortCases, "op">): PortCases => ({
  op: op as unknown as Operation<unknown, unknown>,
  ...cases,
});

/** Not objects: every operation's input is a `z.object`. */
const NOT_OBJECTS = [[], null, "x", 1];

/** What every ported operation owes. The service's table must name exactly these keys. */
const PORTS: Record<string, PortCases> = {
  "improvements.list": port(listImprovementsOp, {
    foreign: { input: {}, hidden: ["imp-foreign"] }, inputs: [{}, ...NOT_OBJECTS],
  }),
  "improvements.listPage": port(listImprovementsPageOp, {
    foreign: { input: { limit: 2 }, hidden: ["imp-foreign"] },
    inputs: [{ limit: 1 }, { limit: 100 }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }, {},
      ...IMPROVEMENT_STATUS_VALUES.map((status) => ({ limit: 1, status })),
      { limit: 1, status: null }, { limit: 1, status: "other" }, { limit: 1, cursor: null },
      { limit: 1, cursor: "" }, { limit: 1, cursor: 1 }, ...NOT_OBJECTS],
  }),
  "improvements.fix.propose": port(proposeSuggestedFixOp, {
    foreign: { input: { improvementId: "imp-foreign", question: "Q", answer: "A" } },
    inputs: [...[{}, { question: "" }, { question: "x".repeat(501) }, { answer: "x".repeat(4001) },
      { rationale: null }, { rationale: "x".repeat(601) }, { rationale: "x".repeat(600) }]
      .map((patch) => ({ improvementId: "missing", question: "Q", answer: "A", ...patch })),
      { improvementId: "", question: "Q", answer: "A" }, {}, ...NOT_OBJECTS],
  }),
  "improvements.fix.dismiss": port(dismissSuggestedFixOp, {
    foreign: { input: { improvementId: "imp-foreign" }, pinnedError: "Db.getImprovementProposal: row does not belong to the pinned Organization" },
    inputs: [{ improvementId: "missing" }, { improvementId: "" }, { improvementId: "missing", reason: null },
      { improvementId: "missing", reason: "x".repeat(1000) }, { improvementId: "missing", reason: "x".repeat(1001) }, {}, ...NOT_OBJECTS],
  }),

  "taskLabels.list": port(listTaskLabelsOp, {
    foreign: { input: {}, hidden: ["lb-foreign"] },
    inputs: [{}, { extra: 1 }, ...NOT_OBJECTS],
  }),
  "taskLabels.create": port(createTaskLabelOp, {
    foreign: { input: { name: "Bug", organizationId: "foreign" }, error: "conflict" },
    inputs: [
      ...WORK_COLORS.map((color) => ({ name: "Bug", color })),
      { name: "Bug" }, {}, { name: "" }, { name: "  " }, { name: null },
      { name: "Bug", color: null }, { name: "Bug", color: "teal" }, ...NOT_OBJECTS,
    ],
  }),
  "taskLabels.update": port(updateTaskLabelOp, {
    foreign: { input: { id: "lb-foreign", patch: { name: "Mine" } } },
    inputs: [
      ...[{}, ...WORK_COLORS.map((color) => ({ color })),
        { name: "x".repeat(60) }, { name: "x".repeat(61) }, { name: "😀".repeat(30) },
        { name: "😀".repeat(31) }, { name: "\u0085" }, { name: "  " },
        { name: null }, { color: null }, { color: "teal" }, { name: 1 }].map((patch) => ({ id: "missing", patch })),
      { id: "missing", patch: [] }, { id: "missing", patch: null },
      { id: "".padEnd(65, "x"), patch: {} }, { id: "", patch: {} }, ...NOT_OBJECTS,
    ],
  }),
  "taskLabels.delete": port(deleteTaskLabelOp, {
    foreign: { input: { id: "lb-foreign" } },
    inputs: [{ id: "missing" }, { id: "" }, { id: "x".repeat(65) }, { id: null }, {}, ...NOT_OBJECTS],
  }),

  "alerts.list": port(listAlertsOp, {
    foreign: { input: {}, hidden: ["al-foreign"] },
    inputs: [{}, { unknownKey: 1 }, ...NOT_OBJECTS],
  }),
  "alerts.resolve": port(resolveAlertOp, {
    foreign: { input: { id: "al-foreign" } },
    inputs: [{ id: "missing" }, { id: "missing", unknownKey: 1 }, { id: "" }, {}, { id: 7 }, { id: null }, ...NOT_OBJECTS],
  }),
  "alerts.update": port(updateAlertOp, {
    foreign: { input: { id: "al-foreign", patch: { title: "Mine now" } } },
    inputs: [
      ...[{}, ...ALERT_TYPES.map((type) => ({ type })), ...ALERT_STATUSES.map((status) => ({ status }))].map((patch) => ({
        id: "missing",
        patch,
      })),
      ...[
        { type: "billing" },
        { status: "snoozed" },
        { title: "x".repeat(500) },
        { title: "x".repeat(501) },
        { title: "   " },
        { title: " a " },
        // JavaScript's trim keeps NEL, so this is a one-character title.
        { title: "\u0085" },
        { title: null },
        { title: 5 },
        { detail: "" },
        { detail: "x".repeat(10_000) },
        { detail: "x".repeat(10_001) },
        // Two UTF-16 code units each.
        { detail: "😀".repeat(5_000) },
        { detail: "😀".repeat(5_001) },
        { detail: null },
        { sourceKey: "x" },
      ].map((patch) => ({ id: "missing", patch })),
      { id: "missing" },
      { id: "missing", patch: [] },
      { id: "missing", patch: null },
      { id: "missing", patch: {}, unknownKey: 1 },
      { id: "", patch: {} },
      ...NOT_OBJECTS,
    ],
  }),
};

describe.skipIf(!BIN && !REQUIRED)("ciele-api parity with the TypeScript operations", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    if (!BIN) {
      throw new Error("CIELE_RUST_PARITY_REQUIRED=1 but CIELE_RUST_API_BIN is unset: build the service and point at it");
    }
    pg = await createSchemaLoadedPglite();
    // Supabase grants these out of band; without them `set role` fails before RLS runs.
    await pg.exec(`
      grant usage on schema public, private to authenticated, service_role;
      grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
      alter role service_role bypassrls;
    `);
    organizationId = randomUUID();
    foreignOrganizationId = randomUUID();
    crowdedOrganizationId = randomUUID();
    await pg.query(
      `insert into public.organizations (id, name) values ($1, 'Parity Org'), ($2, 'Foreign Org'), ($3, 'Crowded Org')`,
      [organizationId, foreignOrganizationId, crowdedOrganizationId]
    );
    editor = await seedUser("editor@parity-test.edu", "editor");
    await seedAlert("al-old", organizationId, 90, "resolved");
    await seedAlert("al-new", organizationId, 5);
    for (const twin of ["ts", "rs"]) {
      await seedAlert(`al-resolve-${twin}`, organizationId, 30);
      await seedAlert(`al-update-${twin}`, organizationId, 40);
      await seedAlert(`al-reopen-${twin}`, organizationId, 50, "resolved");
    }
    await seedAlert("al-foreign", foreignOrganizationId, 1);
    // One more than PostgREST would hand back, each a minute apart.
    await pg.query(
      `insert into public.alerts (id, organization_id, type, title, status, source_key, detected_at)
       select 'al-crowd-' || n, $1, 'crawl', 'Crawl failed', 'active', 'crowd:' || n,
              timestamptz '2026-10-20 12:00:00+00' - make_interval(mins => n)
       from generate_series(1, $2::int + 1) n`,
      [crowdedOrganizationId, MAX_ROWS]
    );

    await pg.query(`insert into public.task_labels (id, organization_id, name, color)
      select 'lb-crowd-' || n, $1, lpad(n::text, 5, '0'), 'gray' from generate_series(1, $2::int + 1) n`,
      [crowdedOrganizationId, MAX_ROWS]);
    await pg.query(`insert into public.improvements (id, organization_id, seq, title, status)
      select 'imp-crowd-' || n, $1, n, 'Crowded', 'to_do' from generate_series(1, $2::int + 1) n`,
      [crowdedOrganizationId, MAX_ROWS]);
    await seedImprovement("imp-1", organizationId, 1);
    await seedImprovement("imp-2", organizationId, 2, "in_progress");
    await seedImprovement("imp-3", organizationId, 3);
    await seedImprovement("imp-4", organizationId, 4, "done");
    await seedImprovement("imp-5", organizationId, 5);
    await seedImprovement("imp-foreign", foreignOrganizationId, 1);
    await pg.query(`insert into public.assistants (id, organization_id, title) values ('as-parity', $1, 'Parity')`, [
      organizationId,
    ]);
    await pg.query(
      `insert into public.conversations (id, assistant_id, subject_type, subject_id)
       values ('cv-parity', 'as-parity', 'visitor', 'v-1')`
    );
    await pg.query(
      `insert into public.messages (id, conversation_id, role, content)
       values ('msg-1', 'cv-parity', 'assistant', '[]'), ('msg-2', 'cv-parity', 'assistant', '[]')`
    );
    await pg.query(
      `insert into public.improvement_messages (id, improvement_id, message_id)
       values ('im-1', 'imp-1', 'msg-1'), ('im-2', 'imp-1', 'msg-2')`
    );
    await seedLabel("lb-bug", organizationId, "Bug", "red");
    await seedLabel("lb-alpha", organizationId, "alpha");
    await seedLabel("lb-foreign", foreignOrganizationId, "Foreign");
    for (const twin of ["ts", "rs"]) {
      await seedLabel(`lb-rename-${twin}`, organizationId, `Rename ${twin}`, "blue");
      await seedLabel(`lb-delete-${twin}`, organizationId, `Delete ${twin}`);
    }

    const dbPort = await freePort();
    socket = new PGLiteSocketServer({ db: pg, port: dbPort, host: "127.0.0.1" });
    await socket.start();

    const port = await freePort();
    serviceUrl = `http://127.0.0.1:${port}`;
    service = spawn(BIN, [], {
      env: {
        ...process.env,
        DATABASE_URL: `postgres://postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable`,
        // PGlite is one backend; the socket server serialises behind it anyway.
        DATABASE_MAX_CONNECTIONS: "1",
        CIELE_RUST_API_SECRET: SECRET,
        PORT: String(port),
        RUST_LOG: "warn",
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
    for (let tries = 0; ; tries++) {
      const ready = await fetch(`${serviceUrl}/healthz`).then((r) => r.ok, () => false);
      if (ready) break;
      if (tries > 100) throw new Error("ciele-api did not start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    serviceOperations = (await (await fetch(`${serviceUrl}/v1/ops`)).json()) as typeof serviceOperations;
  }, 120_000);

  afterAll(async () => {
    service?.kill();
    await socket?.stop();
    await pg?.close();
  });

  describe("every ported operation", () => {
    it("is one this seam forwards, and has its cases here", () => {
      const names = serviceOperations.map((op) => op.name).sort();
      expect([...RUST_OPERATIONS].sort()).toEqual(names);
      expect(Object.keys(PORTS).sort()).toEqual(names);
    });

    it("needs the Role its TypeScript capability names, and the README says so", () => {
      const typescript = new Map(operationsByName().map((op) => [op.name, op]));
      const readme = readFileSync(new URL("services/ciele-api/README.md", REPO), "utf8");
      const table = readme.slice(readme.indexOf("## What runs here"), readme.indexOf("## The contract"));
      const documented = [...table.matchAll(/^\| `([^`]+)` \| (\w+) \|/gm)].map(([, name, capability]) => ({
        name,
        capability,
      }));
      const expected = serviceOperations.map(({ name, role }) => {
        const capability = typescript.get(name)?.capability ?? "<no TypeScript operation>";
        expect(role, name).toBe(ROLES.find((rung) => roleAllowsCapability(rung, capability)));
        return { name, capability };
      });
      const byName = (a: { name?: string }, b: { name?: string }) => (a.name ?? "").localeCompare(b.name ?? "");
      expect(documented.sort(byName)).toEqual(expected.sort(byName));
    });

    it("refuses exactly the Roles the TypeScript capability refuses", async () => {
      const typescript = new Map(operationsByName().map((op) => [op.name, op]));
      for (const { name } of serviceOperations) {
        const capability = typescript.get(name)!.capability;
        for (const role of ROLES) {
          // `{}` is refused by every write's schema, so an allowed write changes nothing.
          const { status } = await raw(name, "{}", { role });
          expect({ name, role, forbidden: status === 403 }).toEqual({
            name,
            role,
            forbidden: !roleAllowsCapability(role, capability),
          });
        }
      }
    });

    it("refuses the inputs zod refuses, and only those", async () => {
      for (const [name, { op, inputs }] of Object.entries(PORTS)) {
        for (const input of inputs) {
          const zodAccepts = op.input.safeParse(input).success;
          const { status, code } = await raw(name, JSON.stringify(input));
          expect({ name, input, refused: code === "invalid_input" }).toEqual({ name, input, refused: !zodAccepts });
          expect(status, `${name} ${JSON.stringify(input)} answered ${code}`).toBeLessThan(500);
        }
      }
    });

    for (const scope of ["session", "pinned"] as const) {
      it(`never reaches another Organization's rows (${scope})`, async () => {
        for (const [name, { op, foreign }] of Object.entries(PORTS)) {
          const before = await rowsOf(foreignOrganizationId);
          const [typescript, rust] = await both(op, scope, [foreign.input, foreign.input]);
          if (foreign.hidden) {
            expect(normalize(rust), name).toEqual(normalize(typescript));
            for (const id of foreign.hidden) expect(idsOf(rust), name).not.toContain(id);
          } else {
            expect([typescript, rust], name).toEqual([{ error: (scope === "pinned" ? foreign.pinnedError : undefined) ?? foreign.error ?? "not_found" }, { error: (scope === "pinned" ? foreign.pinnedError : undefined) ?? foreign.error ?? "not_found" }]);
          }
          expect(await rowsOf(foreignOrganizationId), name).toEqual(before);
        }
      });
    }

    it("refuses an assertion replayed over another body", async () => {
      const token = await signAssertion(
        SECRET,
        { operation: "alerts.resolve", organizationId, userId: editor.id, role: "owner", dbScope: "pinned" },
        JSON.stringify({ id: "missing" })
      );
      expect(await raw("alerts.resolve", JSON.stringify({ id: "missing" }), { token })).toMatchObject({
        code: "not_found",
      });
      expect(await raw("alerts.resolve", JSON.stringify({ id: "al-new" }), { token })).toMatchObject({
        status: 401,
        code: "unauthorized",
      });
      const left = await pg.query<{ status: string }>(`select status from public.alerts where id = 'al-new'`);
      expect(left.rows[0]?.status).toBe("active");
    });
  });

  describe("alerts", () => {
    it("keeps the same cap boundary when Alert timestamps tie", async () => {
      const org = randomUUID();
      await pg.query(`insert into public.organizations (id, name) values ($1, 'Tied alerts')`, [org]);
      await pg.query(`insert into public.alerts (id, organization_id, type, title, status, detected_at)
        select 'al-tied-' || n, $1, 'crawl', 'Tied', 'active', '2026-10-20T12:00:00Z'
        from generate_series(1, $2::int + 1) n`, [org, MAX_ROWS]);
      const [typescript, rust] = await both(listAlertsOp, "pinned", [{}, {}], org);
      expect(idsOf(rust)).toEqual(idsOf(typescript));
      const visible = new Set(idsOf(typescript));
      const id = Array.from({ length: MAX_ROWS + 1 }, (_, i) => `al-tied-${i + 1}`).find((id) => !visible.has(id))!;
      expect(await both(resolveAlertOp, "pinned", [{ id }, { id }], org)).toEqual([
        { error: "not_found" }, { error: "not_found" },
      ]);
      const input = { id, patch: { title: "Unreachable" } };
      expect(await both(updateAlertOp, "pinned", [input, input], org)).toEqual([
        { error: "not_found" }, { error: "not_found" },
      ]);
    });
    it("refuses writes to an Alert beyond PostgREST's list cap", async () => {
      const id = `al-crowd-${MAX_ROWS + 1}`;
      const resolve = { id };
      const update = { id, patch: { title: "Out of range" } };
      expect(await both(resolveAlertOp, "pinned", [resolve, resolve], crowdedOrganizationId)).toEqual([
        { error: "not_found" }, { error: "not_found" },
      ]);
      expect(await both(updateAlertOp, "pinned", [update, update], crowdedOrganizationId)).toEqual([
        { error: "not_found" }, { error: "not_found" },
      ]);
      expect((await pg.query<{ status: string; title: string }>(`select status, title from public.alerts where id = $1`, [id])).rows)
        .toEqual([{ status: "active", title: "Crawl failed" }]);
    });
    for (const scope of ["session", "pinned"] as const) {
      it(`lists the same Alerts, newest first (${scope})`, async () => {
        const [typescript, rust] = await both(listAlertsOp, scope, [{}, {}]);
        expect(normalize(rust)).toEqual(normalize(typescript));
        expect(idsOf(rust)[0]).toBe("al-new");
      });
    }

    it("lists no more Alerts than PostgREST hands the TypeScript body", async () => {
      // The shim applies `max_rows` the way PostgREST does.
      const [typescript, rust] = await both(listAlertsOp, "pinned", [{}, {}], crowdedOrganizationId);
      expect(idsOf(rust)).toHaveLength(MAX_ROWS);
      expect(normalize(rust)).toEqual(normalize(typescript));
    });

    it("runs a session call under RLS, not just under its own organization filter", async () => {
      // A signed-in user with no seat in the Organization: the assertion names the
      // Organization, and only RLS stands between the caller and its rows.
      const outsider = randomUUID();
      await pg.query(`insert into auth.users (id, email) values ($1, 'outsider@parity-test.edu')`, [outsider]);
      const executor = createHttpRemoteExecutor({ baseUrl: serviceUrl, secret: SECRET });
      const call = { organizationId, userId: outsider, role: "owner" as const, input: {} };
      expect(await executor({ ...call, operation: "alerts.list", dbScope: "session" })).toEqual([]);
      await expect(
        executor({ ...call, operation: "alerts.resolve", dbScope: "session", input: { id: "al-new" } })
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("resolves an Alert the same way, stamped with the Member", async () => {
      const [typescript, rust] = await both(resolveAlertOp, "session", [{ id: "al-resolve-ts" }, { id: "al-resolve-rs" }]);
      expect(withoutId(normalize(rust, true))).toEqual(withoutId(normalize(typescript, true)));
      expect(rust).toMatchObject({ status: "resolved", resolvedBy: editor.id });
    });

    it("applies a patch the same way, moving the resolution stamp with the status", async () => {
      const patch = { title: " Crawl failed twice ", detail: "", status: "resolved" as const };
      const [typescript, rust] = await both(updateAlertOp, "pinned", [
        { id: "al-update-ts", patch },
        { id: "al-update-rs", patch },
      ]);
      expect(withoutId(normalize(rust, true))).toEqual(withoutId(normalize(typescript, true)));
      expect(rust).toMatchObject({ title: "Crawl failed twice" });

      const reopen = { status: "active" as const, type: "knowledge" as const };
      const [reopenedTs, reopenedRs] = await both(updateAlertOp, "session", [
        { id: "al-reopen-ts", patch: reopen },
        { id: "al-reopen-rs", patch: reopen },
      ]);
      expect(withoutId(normalize(reopenedRs))).toEqual(withoutId(normalize(reopenedTs)));
      expect(reopenedRs).toMatchObject({ status: "active", type: "knowledge", resolvedAt: null, resolvedBy: null });
    });
  });

  describe("task labels", () => {
    it("lists every Label beyond one PostgREST page", async () => {
      const [typescript, rust] = await both(listTaskLabelsOp, "pinned", [{}, {}], crowdedOrganizationId);
      expect(normalize(rust)).toEqual(normalize(typescript));
      expect(rust).toHaveLength(MAX_ROWS + 1);
    });
    for (const scope of ["session", "pinned"] as const) {
      it(`lists the same Labels by name, never another Organization's (${scope})`, async () => {
        const [typescript, rust] = await both(listTaskLabelsOp, scope, [{}, {}]);
        expect(normalize(rust)).toEqual(normalize(typescript));
        const ids = (rust as { id: string }[]).map((label) => label.id);
        expect(ids).toContain("lb-bug");
        expect(ids).not.toContain("lb-foreign");
      });

      it(`refuses another Organization's Label as not_found (${scope})`, async () => {
        const id = { id: "lb-foreign" };
        expect(await both(deleteTaskLabelOp, scope, [id, id])).toEqual([{ error: "not_found" }, { error: "not_found" }]);
        const rename = { id: "lb-foreign", patch: { name: "Mine" } };
        expect(await both(updateTaskLabelOp, scope, [rename, rename])).toEqual([
          { error: "not_found" },
          { error: "not_found" },
        ]);
      });
    }

    it("creates a Label the same way, trimmed and gray by default", async () => {
      const [typescript, rust] = await both(createTaskLabelOp, "session", [{ name: "  Ops ts " }, { name: "  Ops rs " }]);
      const fresh = ["id", "name", "createdAt", "updatedAt"];
      expect(without(rust, fresh)).toEqual(without(typescript, fresh));
      expect(rust).toMatchObject({ name: "Ops rs", color: "gray", organizationId });
      expect((rust as { id: string }).id).toMatch(/^[A-Za-z0-9]{8}-[A-Za-z0-9]{3}$/);
    });

    it("refuses a name another Label has, ignoring case", async () => {
      expect(await both(createTaskLabelOp, "pinned", [{ name: "bug" }, { name: "bug" }])).toEqual([
        { error: "conflict" },
        { error: "conflict" },
      ]);
      const [typescript, rust] = await both(updateTaskLabelOp, "session", [
        { id: "lb-rename-ts", patch: { name: "BUG" } },
        { id: "lb-rename-rs", patch: { name: "BUG" } },
      ]);
      expect([typescript, rust]).toEqual([{ error: "conflict" }, { error: "conflict" }]);
    });

    it("renames and recolours the same way, keeping its own name free", async () => {
      const [typescript, rust] = await both(updateTaskLabelOp, "pinned", [
        { id: "lb-rename-ts", patch: { name: "rename TS", color: "green" } },
        { id: "lb-rename-rs", patch: { name: "rename RS", color: "green" } },
      ]);
      const fresh = ["id", "name", "updatedAt"];
      expect(without(normalize(rust), fresh)).toEqual(without(normalize(typescript), fresh));
      expect(rust).toMatchObject({ name: "rename RS", color: "green" });
      expect((rust as { updatedAt: string }).updatedAt).not.toBe((rust as { createdAt: string }).createdAt);
    });

    it("deletes a Label the same way", async () => {
      const [typescript, rust] = await both(deleteTaskLabelOp, "session", [{ id: "lb-delete-ts" }, { id: "lb-delete-rs" }]);
      expect(rust ?? undefined).toEqual(typescript);
      const left = await pg.query(`select id from public.task_labels where id like 'lb-delete-%'`);
      expect(left.rows).toEqual([]);
    });
  });

  describe("improvements", () => {
    it("caps the list at PostgREST's max_rows", async () => {
      const [typescript, rust] = await both(listImprovementsOp, "pinned", [{}, {}], crowdedOrganizationId);
      expect(normalize(rust)).toEqual(normalize(typescript));
      expect(rust).toHaveLength(MAX_ROWS);
    });
    it("proposes, refuses a duplicate draft, dismisses idempotently and redrafts", async () => {
      for (const scope of ["session", "pinned"] as const) {
        for (const twin of ["ts", "rs"]) {
          const id = `imp-fix-${scope}-${twin}`;
          await seedImprovement(id, organizationId, 20 + (scope === "pinned" ? 2 : 0) + (twin === "rs" ? 1 : 0));
          await pg.query(`insert into public.improvement_messages (id, improvement_id, message_id) values ($1, $2, 'msg-1')`, [id, id]);
        }
        const inputs = (["ts", "rs"] as const).map((twin) => ({ improvementId: `imp-fix-${scope}-${twin}`, question: "Q", answer: "A" }));
        const [typescript, rust] = await both(proposeSuggestedFixOp, scope, [inputs[0], inputs[1]]);
        const fresh = ["id", "improvementId", "createdAt", "updatedAt"];
        expect(without(normalize(rust), fresh)).toEqual(without(normalize(typescript), fresh));
        expect(await both(proposeSuggestedFixOp, scope, [inputs[0], inputs[1]])).toEqual([{ error: "conflict" }, { error: "conflict" }]);
        const dismiss = inputs.map(({ improvementId }) => ({ improvementId, reason: "  No thanks  " }));
        const [dismissedTs, dismissedRs] = await both(dismissSuggestedFixOp, scope, [dismiss[0], dismiss[1]]);
        expect(without(normalize(dismissedRs), fresh)).toEqual(without(normalize(dismissedTs), fresh));
        expect(dismissedRs).toMatchObject({ status: "dismissed", dismissReason: "No thanks" });
        expect(await both(dismissSuggestedFixOp, scope, [dismiss[0], dismiss[1]])).toEqual([dismissedTs, dismissedRs]);
        const [, redraft] = await both(proposeSuggestedFixOp, scope, [inputs[0], inputs[1]]);
        expect(redraft).toMatchObject({ status: "draft", dismissReason: "", acceptedConceptId: null });
        await pg.query(`delete from public.improvements where id like $1`, [`imp-fix-${scope}-%`]);
      }
    });
    for (const scope of ["session", "pinned"] as const) {
      it(`lists the same Improvements, newest key first, with their message counts (${scope})`, async () => {
        const [typescript, rust] = await both(listImprovementsOp, scope, [{}, {}]);
        expect(normalize(rust)).toEqual(normalize(typescript));
        const items = rust as { id: string; messageCount: number }[];
        expect(items.map((item) => item.id)).toEqual(["imp-5", "imp-4", "imp-3", "imp-2", "imp-1"]);
        expect(items.at(-1)?.messageCount).toBe(2);
        // Before `normalize`, which reads both sides' dates down to the day.
        expect((rust as { dueDate: string }[])[0]?.dueDate).toBe("2026-11-01");
      });

      it(`pages the same way, cursor by cursor (${scope})`, async () => {
        for (const status of [undefined, "to_do"] as const) {
          let cursor: string | null = null;
          const seen: string[] = [];
          do {
            const input = { limit: 2, cursor, ...(status ? { status } : {}) };
            const [typescript, rust] = await both(listImprovementsPageOp, scope, [input, input]);
            expect(normalize((rust as { items: unknown[] }).items)).toEqual(
              normalize((typescript as { items: unknown[] }).items)
            );
            expect((rust as { nextCursor: string | null }).nextCursor).toBe(
              (typescript as { nextCursor: string | null }).nextCursor
            );
            const page = rust as { items: { id: string }[]; nextCursor: string | null };
            seen.push(...page.items.map((item) => item.id));
            cursor = page.nextCursor;
          } while (cursor);
          expect(seen).toEqual(status ? ["imp-5", "imp-3", "imp-1"] : ["imp-5", "imp-4", "imp-3", "imp-2", "imp-1"]);
        }
      });
    }

    it("reads a cursor that is not a number as no cursor, as Number() does", async () => {
      for (const cursor of ["abc", " 4 ", "3.5", "1e1", "0x4", "\u00854"]) {
        const input = { limit: 2, cursor };
        const [typescript, rust] = await both(listImprovementsPageOp, "session", [input, input]);
        expect(normalize((rust as { items: unknown[] }).items)).toEqual(
          normalize((typescript as { items: unknown[] }).items)
        );
        expect((rust as { nextCursor: unknown }).nextCursor).toBe((typescript as { nextCursor: unknown }).nextCursor);
      }
    });
  });
});
