import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { API_KEY_PREFIX, hashApiKeySecret } from "@agent-hub/core";
import { createDb, type Db } from "@agent-hub/db";
import { createPgliteSupabaseClient, createSchemaLoadedPglite } from "@agent-hub/db/testing";
import { createHttpRemoteExecutor, registerRemoteExecutor } from "@ciele/ops";
import { GET as listAlerts } from "@/app/api/v1/alerts/route";

/**
 * p50/p95 of `GET /api/v1/alerts`, through the route handler and straight
 * from the Rust service (#1134). Opt-in, it is a measurement, not a gate:
 *
 *   CIELE_RUST_BENCH=1 CIELE_RUST_API_BIN=<target>/release/ciele-api \
 *     pnpm --filter @agent-hub/web exec vitest run rust-direct.latency
 *
 * Results are appended to CIELE_RUST_BENCH_OUT (default
 * /tmp/ciele-api-latency.txt), one line per side and round.
 *
 * Both sides answer over HTTP on loopback and read one schema-loaded PGlite:
 * the route handler behind a bare `node:http` server, in process, through the
 * PostgREST shim; the binary over PGlite's socket server. So "before" has no
 * PostgREST hop and no Next.js router, and "after" pays a socket to a
 * single-session database the test process also serves. "forward" is the
 * route handler with the operation forwarded to the service over `/v1/ops`,
 * what a deployment with the service on did before #1134. Neither is the
 * self-host stack; the numbers compare the two code paths on one machine.
 */

const BIN = process.env.CIELE_RUST_API_BIN;
const RUN = process.env.CIELE_RUST_BENCH === "1" && !!BIN;
const WARMUP = 50;
const SAMPLES = Number(process.env.CIELE_RUST_BENCH_SAMPLES ?? 500);

const state = vi.hoisted(() => ({ db: null as unknown as Db }));
vi.mock("@/lib/api-v1/db", () => ({ getApiV1Db: () => state.db }));

type PG = Awaited<ReturnType<typeof createSchemaLoadedPglite>>;
let pg: PG;
let socket: PGLiteSocketServer;
let service: ChildProcess | null = null;
let next: Server;
let rustUrl: string;
let nextUrl: string;
let secret: string;
let serviceSecret: string;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject()));
    });
  });
}

async function sample(url: string): Promise<{ p50: number; p95: number; mean: number }> {
  const once = async () => {
    const started = performance.now();
    const response = await fetch(`${url}/api/v1/alerts`, { headers: { authorization: `Bearer ${secret}` } });
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    return performance.now() - started;
  };
  for (let i = 0; i < WARMUP; i++) await once();
  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i++) times.push(await once());
  times.sort((a, b) => a - b);
  const at = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
  return { p50: at(0.5), p95: at(0.95), mean: times.reduce((a, b) => a + b, 0) / times.length };
}

describe.skipIf(!RUN)("GET /api/v1/alerts latency, route handler vs Rust service", { timeout: 600_000 }, () => {
  beforeAll(async () => {
    pg = await createSchemaLoadedPglite();
    await pg.exec(`
      grant usage on schema public, private to authenticated, service_role;
      grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
      alter role service_role bypassrls;
    `);
    const org = randomUUID();
    const owner = randomUUID();
    await pg.query(`insert into public.organizations (id, name) values ($1, 'Bench Org')`, [org]);
    await pg.query(`insert into auth.users (id, email) values ($1, 'owner@bench.test')`, [owner]);
    await pg.query(`insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'owner')`, [
      org,
      owner,
    ]);
    secret = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
    await pg.query(
      `insert into public.organization_api_keys (organization_id, name, secret_hash, secret_hint, role, created_by)
       values ($1, 'bench', $2, 'ciele_sk_', 'viewer', $3)`,
      [org, hashApiKeySecret(secret), owner]
    );
    // A realistic page: twenty Alerts.
    await pg.query(
      `insert into public.alerts (id, organization_id, type, title, detail, status, source_key, detected_at)
       select 'al-' || n, $1, 'crawl', 'Crawl failed', 'Timed out after 30 s', 'active', 'src:' || n,
              now() - make_interval(mins => n) from generate_series(1, 20) n`,
      [org]
    );
    state.db = createDb(createPgliteSupabaseClient(pg, { id: owner, email: "owner@bench.test" }, "service_role"));

    next = createHttpServer(async (req, res) => {
      const response = await listAlerts(
        new Request(`http://bench.local${req.url}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
        })
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    const nextPort = await freePort();
    await new Promise<void>((resolve) => next.listen(nextPort, "127.0.0.1", resolve));
    nextUrl = `http://127.0.0.1:${nextPort}`;

    serviceSecret = randomBytes(32).toString("hex");
    const dbPort = await freePort();
    socket = new PGLiteSocketServer({ db: pg, port: dbPort, host: "127.0.0.1" });
    await socket.start();
    const port = await freePort();
    rustUrl = `http://127.0.0.1:${port}`;
    service = spawn(BIN!, [], {
      env: {
        ...process.env,
        DATABASE_URL: `postgres://postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable`,
        DATABASE_MAX_CONNECTIONS: "1",
        CIELE_RUST_API_SECRET: serviceSecret,
        PORT: String(port),
        RUST_LOG: "error",
      },
      stdio: ["ignore", "inherit", "inherit"],
    });
    for (let tries = 0; ; tries++) {
      if (await fetch(`${rustUrl}/healthz`).then((r) => r.ok, () => false)) break;
      if (tries > 100) throw new Error("ciele-api did not start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }, 600_000);

  afterAll(async () => {
    service?.kill();
    next?.close();
    await socket?.stop();
    await pg?.close();
  });

  it("measures both, alternating rounds so drift in machine load hits both", async () => {
    const rounds = 3;
    const results: Record<string, { p50: number; p95: number; mean: number }[]> = { next: [], forward: [], rust: [] };
    const forwarding = (on: boolean) =>
      registerRemoteExecutor(
        on ? createHttpRemoteExecutor({ baseUrl: rustUrl, secret: serviceSecret }) : null,
        ["alerts.list"]
      );
    for (let round = 0; round < rounds; round++) {
      results.next.push(await sample(nextUrl));
      // The route handler authenticates, then forwards the operation to the
      // service over /v1/ops: the path before #1134 once the service was on.
      forwarding(true);
      results.forward.push(await sample(nextUrl));
      forwarding(false);
      results.rust.push(await sample(rustUrl));
    }
    const fmt = (r: { p50: number; p95: number; mean: number }) =>
      `p50 ${r.p50.toFixed(2)} ms, p95 ${r.p95.toFixed(2)} ms, mean ${r.mean.toFixed(2)} ms`;
    for (const [side, list] of Object.entries(results)) {
      for (const [i, r] of list.entries()) {
        appendFileSync(
          process.env.CIELE_RUST_BENCH_OUT ?? "/tmp/ciele-api-latency.txt",
          `[latency] ${side} round ${i + 1} (${SAMPLES} req): ${fmt(r)}\n`
        );
      }
    }
  });
});
