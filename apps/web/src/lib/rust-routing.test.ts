import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as ops from "@ciele/ops";
import { RUST_OPERATIONS } from "@ciele/ops";
import { middleware } from "@/middleware";
import {
  RUST_DIRECT_ENDPOINTS,
  RUST_WIDGET_ROUTES,
  rustDirectUrl,
  rustMcpUrl,
  rustOperationsFromEnv,
  rustRewrite,
  rustServiceUrl,
  rustWidgetUrl,
  widgetRouteName,
} from "./rust-routing";

/**
 * Which requests skip Next.js for the Rust service (#1134, #1135, #1136).
 *
 * The /api/v1 list in `rust-routing.ts` is written out because the middleware cannot
 * import `@ciele/ops`. This derives it again: every route method that runs
 * exactly one operation, where that operation is one the service ports
 * (`RUST_OPERATIONS`, itself held to the service's table by the parity test).
 * Porting an operation whose route exists therefore fails here until the
 * endpoint is listed, and the service answers it (`src/v1.rs`, held to this
 * list by `rust-direct.parity.test.ts`).
 */

const API_ROOT = join(__dirname, "..", "app", "api", "v1");

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

/** apps/web/src/app/api/v1/alerts/[id]/resolve/route.ts → "/alerts/{id}/resolve" */
function routePath(file: string): string {
  const folder = relative(API_ROOT, join(file, ".."));
  return `/${folder.split(sep).map((seg) => seg.replace(/^\[(\w+)\]$/, "{$1}")).join("/")}`;
}

/** Exported binding name → operation name, for every operation `@ciele/ops` exports. */
const OPERATION_NAMES = new Map(
  Object.entries(ops)
    .filter(([, value]) => typeof value === "object" && value !== null && "capability" in value && "name" in value)
    .map(([exported, value]) => [exported, (value as { name: string }).name])
);

function derived() {
  const found: { method: string; path: string; operation: string }[] = [];
  for (const file of routeFiles(API_ROOT)) {
    const blocks = readFileSync(file, "utf8").split(/export async function (?=GET|POST|PATCH|PUT|DELETE)/);
    for (const block of blocks.slice(1)) {
      const method = /^(GET|POST|PATCH|PUT|DELETE)/.exec(block)![1];
      const names = [
        ...new Set([...block.matchAll(/\b([a-zA-Z]+Op)\b/g)].map(([, name]) => OPERATION_NAMES.get(name))),
      ].filter((name): name is string => !!name);
      if (names.length === 1 && RUST_OPERATIONS.has(names[0])) {
        found.push({ method, path: routePath(file), operation: names[0] });
      }
    }
  }
  return found;
}

const key = (endpoint: { method: string; path: string; operation: string }) =>
  `${endpoint.method} ${endpoint.path} ${endpoint.operation}`;

const ENV = {
  CIELE_RUST_API_URL: "http://ciele-api:8080/",
  CIELE_RUST_API_SECRET: "s".repeat(32),
  CIELE_RUST_OPERATIONS: RUST_DIRECT_ENDPOINTS.map((endpoint) => endpoint.operation).join(", "),
  NEXT_PUBLIC_SUPABASE_URL: "http://localhost:8000",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

describe("the endpoints the Rust service answers itself (#1134)", () => {
  it("are every route method that runs one ported operation, and only those", () => {
    expect(RUST_DIRECT_ENDPOINTS.map(key).sort()).toEqual(derived().map(key).sort());
  });

  it("is a non-empty list", () => {
    // A derivation that finds nothing would pass the test above vacuously.
    expect(RUST_DIRECT_ENDPOINTS.length).toBeGreaterThan(0);
  });
});

/**
 * The Vercel half, prepared but not deployed (RUNBOOK, "Rewrites on Vercel"):
 * one file for every surface. A `vercel.json` rewrite matches a path, never a
 * method, so an /api/v1 path is listed only when the service answers its every
 * route method; /api/mcp moves whole; every ported widget endpoint is listed.
 * The origin is a placeholder until the service has a public home (#1126).
 */
describe("services/ciele-api/vercel.rewrites.json", () => {
  const prepared = JSON.parse(
    readFileSync(join(__dirname, "../../../../services/ciele-api/vercel.rewrites.json"), "utf8")
  ) as { rewrites: { source: string; destination: string }[] };
  const sources = prepared.rewrites.map((rewrite) => rewrite.source);

  it("names exactly the /api/v1 paths whose every method goes to the service", () => {
    const direct = new Set(RUST_DIRECT_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`));
    const whole = routeFiles(API_ROOT)
      .map((file) => {
        const methods = [...readFileSync(file, "utf8").matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)];
        return { path: routePath(file), methods: methods.map(([, method]) => method) };
      })
      .filter(({ path, methods }) => methods.length > 0 && methods.every((method) => direct.has(`${method} ${path}`)))
      .map(({ path }) => `/api/v1${path.replace(/\{(\w+)\}/g, ":$1")}`);
    expect(sources.filter((source) => source.startsWith("/api/v1/")).sort()).toEqual(whole.sort());
  });

  it("moves the hosted MCP endpoint whole, as rustMcpUrl does", () => {
    expect(sources).toContain("/api/mcp");
  });

  it("names exactly the ported widget endpoints", () => {
    const widget = sources.filter((source) => source.startsWith("/api/widget/"));
    const named = widget.map((source) => widgetRouteName(source.replace(/:\w+/g, "x-1")));
    expect(named.sort()).toEqual([...RUST_WIDGET_ROUTES].sort());
  });

  it("lists nothing else, and sends each path to the same path on the service", () => {
    for (const source of sources) expect(source).toMatch(/^\/api\/(v1\/|mcp$|widget\/)/);
    for (const { source, destination } of prepared.rewrites) {
      expect(destination).toBe(`https://ciele-api.invalid${source}`);
    }
  });
});

describe("rustServiceUrl, the one URL join", () => {
  it("keeps the service's path prefix and the request's path and query", () => {
    const env = { CIELE_RUST_API_URL: " https://internal.example/ciele-api/ " };
    expect(rustServiceUrl(env, "/api/widget/as-1/session", "?x=1")?.href).toBe(
      "https://internal.example/ciele-api/api/widget/as-1/session?x=1"
    );
    expect(rustServiceUrl({ CIELE_RUST_API_URL: "http://ciele-api:8080" }, "/api/v1/task-labels/lb%2F1", "")?.href).toBe(
      "http://ciele-api:8080/api/v1/task-labels/lb%2F1"
    );
  });

  it("is null for an unset or unparsable base, so a typo routes nothing", () => {
    expect(rustServiceUrl({}, "/api/mcp", "")).toBeNull();
    expect(rustServiceUrl({ CIELE_RUST_API_URL: "ciele-api:8080 typo" }, "/api/mcp", "")).toBeNull();
    expect(rustServiceUrl({ CIELE_RUST_API_URL: "ciele-api:8080" }, "/api/mcp", "")).toBeNull();
  });
});

describe("rustDirectUrl", () => {
  it("sends a listed endpoint to the service, query string and all", () => {
    expect(rustDirectUrl("GET", "/api/v1/improvements", "?limit=2&cursor=9", ENV)?.href).toBe(
      "http://ciele-api:8080/api/v1/improvements?limit=2&cursor=9"
    );
    expect(rustDirectUrl("PATCH", "/api/v1/task-labels/lb%2F1", "", ENV)?.href).toBe(
      "http://ciele-api:8080/api/v1/task-labels/lb%2F1"
    );
    expect(rustDirectUrl("POST", "/api/v1/alerts/al-1/resolve", "", ENV)).not.toBeNull();
  });

  it("lets everything else through to the route handler", () => {
    // A method the service does not answer on that path.
    expect(rustDirectUrl("GET", "/api/v1/task-labels/lb-1", "", ENV)).toBeNull();
    // An operation that is not ported: GET /improvements/{id} runs improvements.get.
    expect(rustDirectUrl("GET", "/api/v1/improvements/imp-1", "", ENV)).toBeNull();
    // Not the exact path.
    expect(rustDirectUrl("GET", "/api/v1/alerts/", "", ENV)).toBeNull();
    expect(rustDirectUrl("POST", "/api/v1/alerts//resolve", "", ENV)).toBeNull();
    expect(rustDirectUrl("GET", "/api/v2/alerts", "", ENV)).toBeNull();
  });

  it("is off unless the web app would forward the operation itself", () => {
    const without = (name: keyof typeof ENV) => ({ ...ENV, [name]: "" });
    for (const name of Object.keys(ENV) as (keyof typeof ENV)[]) {
      expect(rustDirectUrl("GET", "/api/v1/alerts", "", without(name)), name).toBeNull();
    }
    // Taking one name off the list puts that endpoint back on the route handler.
    const listed = { ...ENV, CIELE_RUST_OPERATIONS: "alerts.resolve" };
    expect(rustDirectUrl("GET", "/api/v1/alerts", "", listed)).toBeNull();
    expect(rustDirectUrl("POST", "/api/v1/alerts/a/resolve", "", listed)).not.toBeNull();
  });

  it("reads CIELE_RUST_OPERATIONS as instrumentation.ts does", () => {
    expect(rustOperationsFromEnv({ CIELE_RUST_OPERATIONS: " alerts.list, ,taskLabels.list " })).toEqual([
      "alerts.list",
      "taskLabels.list",
    ]);
    expect(rustOperationsFromEnv({})).toEqual([]);
  });
});

describe("rustMcpUrl (#1135)", () => {
  const MCP = { ...ENV, CIELE_RUST_MCP: "1" };

  it("sends the hosted MCP endpoint to the service when switched on", () => {
    expect(rustMcpUrl("/api/mcp", "", MCP)?.href).toBe("http://ciele-api:8080/api/mcp");
    expect(rustMcpUrl("/api/mcp", "", { ...MCP, CIELE_RUST_MCP: "true" })).not.toBeNull();
  });

  it("keeps the TypeScript endpoint serving otherwise", () => {
    expect(rustMcpUrl("/api/mcp", "", ENV)).toBeNull();
    expect(rustMcpUrl("/api/mcp", "", { ...MCP, CIELE_RUST_MCP: "0" })).toBeNull();
    expect(rustMcpUrl("/api/mcp", "", { ...MCP, CIELE_RUST_API_URL: "" })).toBeNull();
    expect(rustMcpUrl("/api/mcp", "", { ...MCP, NEXT_PUBLIC_SUPABASE_URL: "" })).toBeNull();
    expect(rustMcpUrl("/api/mcp/x", "", MCP)).toBeNull();
  });
});

describe("the middleware", () => {
  afterEach(() => vi.unstubAllEnvs());

  const send = (method: string, url: string) => middleware(new NextRequest(url, { method }));

  it("rewrites a listed endpoint to the service before its auth gate runs", async () => {
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
    const response = await send("GET", "https://ciele.test/api/v1/alerts?x=1");
    expect(response.headers.get("x-middleware-rewrite")).toBe("http://ciele-api:8080/api/v1/alerts?x=1");
  });

  it("rewrites the hosted MCP endpoint, any method, only under CIELE_RUST_MCP", async () => {
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
    expect((await send("POST", "https://ciele.test/api/mcp")).headers.get("x-middleware-rewrite")).toBeNull();
    vi.stubEnv("CIELE_RUST_MCP", "1");
    for (const method of ["POST", "GET", "DELETE"]) {
      expect((await send(method, "https://ciele.test/api/mcp")).headers.get("x-middleware-rewrite")).toBe(
        "http://ciele-api:8080/api/mcp"
      );
    }
  });

  it("leaves every endpoint on Next.js when the service is not configured", async () => {
    for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
    vi.stubEnv("CIELE_RUST_API_URL", "");
    const response = await send("GET", "https://ciele.test/api/v1/alerts");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("rustWidgetUrl (#1136)", () => {
  const env = (routes: string, url = "http://ciele-api:8080") => ({
    CIELE_RUST_API_URL: url,
    CIELE_RUST_WIDGET_ROUTES: routes,
  });

  it("names the endpoint under one Assistant", () => {
    expect(widgetRouteName("/api/widget/as-1/config")).toBe("config");
    expect(widgetRouteName("/api/widget/as-1/conversation-feedback")).toBe("conversation-feedback");
    expect(widgetRouteName("/api/widget/as-1/sources/src-1/download")).toBe("sources");
    expect(widgetRouteName("/api/widget/as-1/voice/speech")).toBe("voice");
    expect(widgetRouteName("/api/widget/as-1")).toBeNull();
    expect(widgetRouteName("/api/widget//config")).toBeNull();
    expect(widgetRouteName("/api/v1/alerts")).toBeNull();
    expect(widgetRouteName("/widget/as-1/config")).toBeNull();
  });

  it("sends a listed, ported endpoint to the service with its path and query intact", () => {
    expect(rustWidgetUrl("/api/widget/as-1/config", "?x=1", env("config,session"))?.href).toBe(
      "http://ciele-api:8080/api/widget/as-1/config?x=1"
    );
    expect(rustWidgetUrl("/api/widget/as-1/session", "", env("session", "https://internal.example/ciele-api/"))?.href).toBe(
      "https://internal.example/ciele-api/api/widget/as-1/session"
    );
  });

  it("needs only the service URL and the list, not the operation forwarding variables", () => {
    const path = "/api/widget/as-1/config";
    expect(rustWidgetUrl(path, "", {})).toBeNull();
    expect(rustWidgetUrl(path, "", { CIELE_RUST_WIDGET_ROUTES: "config" })).toBeNull();
    expect(rustWidgetUrl(path, "", { CIELE_RUST_API_URL: "http://ciele-api:8080" })).toBeNull();
    expect(rustWidgetUrl(path, "", env(" , config "))).not.toBeNull();
  });

  it("leaves an unlisted endpoint, and a listed one the service does not run, in Next.js", () => {
    expect(rustWidgetUrl("/api/widget/as-1/session", "", env("config"))).toBeNull();
    // The chat turn is not ported, whatever the list says.
    expect(rustWidgetUrl("/api/widget/as-1/chat", "", env("chat,config"))).toBeNull();
    for (const name of ["chat", "voice", "attachments", "escalation", "trigger"]) {
      expect(RUST_WIDGET_ROUTES).not.toContain(name);
    }
  });
});

describe("rustRewrite, what the middleware asks", () => {
  it("routes each surface by its own switch", () => {
    const all = { ...ENV, CIELE_RUST_MCP: "1", CIELE_RUST_WIDGET_ROUTES: "config" };
    const route = (method: string, pathname: string) => rustRewrite(method, { pathname, search: "" }, all)?.href ?? null;
    expect(route("GET", "/api/v1/alerts")).toBe("http://ciele-api:8080/api/v1/alerts");
    expect(route("DELETE", "/api/mcp")).toBe("http://ciele-api:8080/api/mcp");
    expect(route("GET", "/api/widget/as-1/config")).toBe("http://ciele-api:8080/api/widget/as-1/config");
    expect(route("GET", "/api/widget/as-1/session")).toBeNull();
    expect(route("GET", "/assistants")).toBeNull();
  });

  /**
   * An Edge bundle is only guaranteed the variables it names (#1134), so a
   * routing decision made from `process.env` whole works in development and
   * routes nothing on Vercel. Every variable the routing reads is read by name,
   * in one function, and nothing else here touches `process.env`.
   */
  it("reads every routing variable by name", () => {
    const source = readFileSync(join(__dirname, "rust-routing.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const declared = [...source.slice(source.indexOf("interface RustRoutingEnv")).matchAll(/^\s+(\w+)\?: string;$/gm)]
      .map(([, name]) => name)
      .slice(0, 7);
    expect(declared.length).toBe(7);
    for (const name of declared) expect(source).toContain(`${name}: process.env.${name},`);
    expect(source.match(/process\.env(?!\.\w)/g)).toBeNull();
    expect(source.match(/process\.env\./g)).toHaveLength(declared.length);
    const middleware = readFileSync(join(__dirname, "..", "middleware.ts"), "utf8");
    expect(middleware).not.toMatch(/rustRewrite\([^)]*process\.env/);
  });
});

describe("the middleware, for a widget endpoint", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rewrites a listed widget endpoint to the service before anything else runs", async () => {
    vi.stubEnv("CIELE_RUST_API_URL", "http://ciele-api:8080");
    vi.stubEnv("CIELE_RUST_WIDGET_ROUTES", "config");
    const response = await middleware(new NextRequest("https://ciele.app/api/widget/as-1/config"));
    expect(response.headers.get("x-middleware-rewrite")).toBe("http://ciele-api:8080/api/widget/as-1/config");
    const untouched = await middleware(new NextRequest("https://ciele.app/api/widget/as-1/chat", { method: "POST" }));
    expect(untouched.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

/**
 * rust.yml runs the Rust gate on a pull request only for the paths it lists,
 * and the widget parity test compares the service with what the widget routes
 * import. A route that starts importing a file outside the list would change
 * what the service must match with the gate not running, which is how
 * rate-limit.ts and storage/deliver-object.ts went unwatched. This walks the
 * ported routes' imports inside apps/web/src and holds the list to them.
 */
const RUST_WORKFLOW = join(__dirname, "..", "..", "..", "..", ".github", "workflows", "rust.yml");

// The public mirror ships its own CI in place of this repo's workflows, so
// there is no rust.yml to hold to the list there, and the release gate runs
// this suite. A skipped describe still runs its body to collect the tests, so
// the read is guarded too.
const hasRustWorkflow = existsSync(RUST_WORKFLOW);
describe.skipIf(!hasRustWorkflow)(".github/workflows/rust.yml", () => {
  const SRC = join(__dirname, "..");
  const REPO = join(SRC, "..", "..", "..");
  const workflow = hasRustWorkflow ? readFileSync(RUST_WORKFLOW, "utf8") : "";
  const filters = [...workflow.slice(workflow.indexOf("paths:"), workflow.indexOf("push:")).matchAll(/^ {6}- (\S+)$/gm)].map(
    ([, glob]) => glob
  );
  // GitHub's filter syntax, as far as this list uses it: `**` crosses folders, `*` does not.
  const matches = (glob: string, path: string) =>
    new RegExp(
      `^${glob
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\u0000")
        .replace(/\*/g, "[^/]*")
        .replace(/\u0000/g, ".*")}$`
    ).test(path);

  function resolve(from: string, specifier: string): string | null {
    const base = specifier.startsWith("@/") ? join(SRC, specifier.slice(2)) : join(from, "..", specifier);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  function closure(entries: string[]): Set<string> {
    const seen = new Set<string>();
    const queue = [...entries];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const [, specifier] of readFileSync(file, "utf8").matchAll(/\bfrom "((?:@\/|\.)[^"]+)"/g)) {
        const target = resolve(file, specifier);
        if (target) queue.push(target);
      }
    }
    return seen;
  }

  it("covers every file the ported widget routes import", () => {
    const widget = join(SRC, "app", "api", "widget", "[assistantId]");
    const entries = RUST_WIDGET_ROUTES.flatMap((name) => routeFiles(join(widget, name)));
    expect(entries.length).toBeGreaterThanOrEqual(RUST_WIDGET_ROUTES.length);
    const uncovered = [...closure(entries)]
      .map((file) => relative(REPO, file).split(sep).join("/"))
      .filter((path) => !filters.some((glob) => matches(glob, path)));
    expect(uncovered).toEqual([]);
  });
});
