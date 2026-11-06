/**
 * Which requests skip Next.js for the Rust service (map #1111): the one place
 * the web app decides it, for every surface the service answers.
 *
 * - `/api/v1` endpoints whose route runs exactly one ported operation (#1134),
 *   while the operation is named in `CIELE_RUST_OPERATIONS`;
 * - the hosted MCP endpoint, `/api/mcp`, every method, under `CIELE_RUST_MCP=1`
 *   (#1135);
 * - the public widget endpoints named in `CIELE_RUST_WIDGET_ROUTES` (#1136).
 *
 * The service mounts each one at the path the client already calls, so a
 * rewrite only swaps the origin. That is why the same routing also works as
 * `services/ciele-api/vercel.rewrites.json` or a reverse proxy, and why
 * `rustServiceUrl` is the only URL join here.
 *
 * Imported by the middleware, so it imports nothing: no `@ciele/ops`, no zod.
 * `rust-routing.test.ts` derives `RUST_DIRECT_ENDPOINTS` again from the route
 * files and `RUST_OPERATIONS`, and holds the rewrites file to both lists; the
 * `/api/v1` and widget parity tests hold the lists to the service's own
 * (`GET /v1/routes`, `GET /v1/widget`).
 */

export interface RustDirectEndpoint {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Relative to /api/v1, as the OpenAPI registry writes it. */
  path: string;
  /** The operation the route runs, a name in `RUST_OPERATIONS`. */
  operation: string;
}

export const RUST_DIRECT_ENDPOINTS: readonly RustDirectEndpoint[] = [
  { method: "GET", path: "/alerts", operation: "alerts.list" },
  { method: "POST", path: "/alerts/{id}/resolve", operation: "alerts.resolve" },
  { method: "GET", path: "/improvements", operation: "improvements.listPage" },
  { method: "GET", path: "/task-labels", operation: "taskLabels.list" },
  { method: "POST", path: "/task-labels", operation: "taskLabels.create" },
  { method: "PATCH", path: "/task-labels/{id}", operation: "taskLabels.update" },
  { method: "DELETE", path: "/task-labels/{id}", operation: "taskLabels.delete" },
];

/** The widget endpoints the service answers, by the name `CIELE_RUST_WIDGET_ROUTES` uses. */
export const RUST_WIDGET_ROUTES = [
  "config",
  "session",
  "feedback",
  "conversation-feedback",
  "conversations",
  "help-desks",
  "memories",
  "sources",
] as const;

export type RustWidgetRoute = (typeof RUST_WIDGET_ROUTES)[number];

/** Every variable the routing reads. */
export interface RustRoutingEnv {
  CIELE_RUST_API_URL?: string;
  CIELE_RUST_API_SECRET?: string;
  CIELE_RUST_OPERATIONS?: string;
  CIELE_RUST_MCP?: string;
  CIELE_RUST_WIDGET_ROUTES?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

/**
 * The routing variables from `process.env`, each read by name. An Edge
 * bundle is only guaranteed the variables it names, so passing `process.env`
 * whole would work in development and route nothing in production.
 */
export function rustRoutingEnv(): RustRoutingEnv {
  return {
    CIELE_RUST_API_URL: process.env.CIELE_RUST_API_URL,
    CIELE_RUST_API_SECRET: process.env.CIELE_RUST_API_SECRET,
    CIELE_RUST_OPERATIONS: process.env.CIELE_RUST_OPERATIONS,
    CIELE_RUST_MCP: process.env.CIELE_RUST_MCP,
    CIELE_RUST_WIDGET_ROUTES: process.env.CIELE_RUST_WIDGET_ROUTES,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/** A comma-separated list of names, spaces and empty entries dropped. */
function names(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/** `CIELE_RUST_OPERATIONS`, read the one way both of its readers read it. */
export function rustOperationsFromEnv(env: Pick<RustRoutingEnv, "CIELE_RUST_OPERATIONS">): string[] {
  return names(env.CIELE_RUST_OPERATIONS);
}

/**
 * `path` and `search` on the service: its origin and any path prefix of
 * `CIELE_RUST_API_URL`, then the request's own path and query. Null when the
 * variable is unset or is not an http(s) URL, so a typo routes nothing rather than
 * failing every request in the middleware.
 */
export function rustServiceUrl(env: RustRoutingEnv, pathname: string, search: string): URL | null {
  const base = env.CIELE_RUST_API_URL?.trim();
  if (!base || !URL.canParse(base)) return null;
  const url = new URL(base);
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${pathname}`;
  url.search = search;
  return url;
}

/**
 * Whether the web app forwards operations to the service at all: the same
 * variables `instrumentation.ts` reads, outside the mock demo. The `/api/v1`
 * and MCP doors run operations, so they follow it; the widget endpoints need
 * only the service's URL.
 */
function forwardsOperations(env: RustRoutingEnv): boolean {
  return !!(
    env.CIELE_RUST_API_URL?.trim() &&
    env.CIELE_RUST_API_SECRET &&
    env.NEXT_PUBLIC_SUPABASE_URL &&
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

const DIRECT_PATTERNS = RUST_DIRECT_ENDPOINTS.map((endpoint) => ({
  endpoint,
  // A path parameter is one non-empty segment, as the route's `[id]` folder is.
  pattern: new RegExp(`^/api/v1${endpoint.path.replace(/\{\w+\}/g, "[^/]+")}$`),
}));

/** An `/api/v1` endpoint the service answers itself, while its operation is listed. */
export function rustDirectUrl(method: string, pathname: string, search: string, env: RustRoutingEnv): URL | null {
  if (!forwardsOperations(env)) return null;
  const match = DIRECT_PATTERNS.find(({ endpoint, pattern }) => endpoint.method === method && pattern.test(pathname));
  if (!match || !rustOperationsFromEnv(env).includes(match.endpoint.operation)) return null;
  return rustServiceUrl(env, pathname, search);
}

/**
 * The hosted MCP endpoint in the service. Its own switch, because it is not
 * one operation: the service answers every tool, running the ported ones
 * itself and sending the rest to this app's /api/v1 with the caller's key.
 * Every method goes, so GET and DELETE get the same 405 from either side.
 */
export function rustMcpUrl(pathname: string, search: string, env: RustRoutingEnv): URL | null {
  if (pathname !== "/api/mcp" || !["1", "true"].includes((env.CIELE_RUST_MCP ?? "").toLowerCase())) return null;
  return forwardsOperations(env) ? rustServiceUrl(env, pathname, search) : null;
}

const WIDGET_PATH = /^\/api\/widget\/[^/]+\/([^/]+)(?:\/|$)/;

/** The endpoint a widget path addresses (`sources` for a Source download), or null. */
export function widgetRouteName(pathname: string): string | null {
  return WIDGET_PATH.exec(pathname)?.[1] ?? null;
}

/** A widget endpoint the service answers, while it is listed and ported. */
export function rustWidgetUrl(pathname: string, search: string, env: RustRoutingEnv): URL | null {
  const name = widgetRouteName(pathname);
  if (!name || !(RUST_WIDGET_ROUTES as readonly string[]).includes(name)) return null;
  if (!names(env.CIELE_RUST_WIDGET_ROUTES).includes(name)) return null;
  return rustServiceUrl(env, pathname, search);
}

/**
 * Where the middleware sends this request instead of a Next.js route, or null
 * to let it through. With every variable unset this is always null.
 */
export function rustRewrite(
  method: string,
  url: { pathname: string; search: string },
  env: RustRoutingEnv = rustRoutingEnv()
): URL | null {
  return (
    rustDirectUrl(method, url.pathname, url.search, env) ??
    rustMcpUrl(url.pathname, url.search, env) ??
    rustWidgetUrl(url.pathname, url.search, env)
  );
}
