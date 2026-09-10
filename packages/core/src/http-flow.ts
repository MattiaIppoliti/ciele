import type { Flow, FlowAction, FlowTrigger, RespondSettings } from "./types";

/**
 * The inbound-HTTP trigger (#843): a Flow another system calls.
 *
 * A Flow with a caller waiting on a status code is a third kind of thing. It
 * is not a Visitor's message: there is no chat window, no transcript, nobody
 * to apologise to. It is not a widget event either. Those are unprompted
 * nudges *into* a chat, and this one is a request *for* an answer. Sweeping it
 * into either funnel would be wrong in a way that only shows up in production,
 * so the kind is explicit and every rule below reads it.
 *
 * Everything here is a fact about the Flow and the request, not about the
 * network: which actions the trigger may run, which methods the endpoint
 * accepts, what the actions can read, and what the caller may be told. The
 * route does the I/O and asks these.
 */

/** What starts a Flow, in the three shapes the runtime actually distinguishes. */
export type FlowTriggerKind = "message" | "proactive" | "http";

export function flowTriggerKind(trigger: FlowTrigger): FlowTriggerKind {
  if (trigger === "message") return "message";
  if (trigger === "http_request") return "http";
  return "proactive";
}

export function isHttpTrigger(trigger: FlowTrigger): boolean {
  return flowTriggerKind(trigger) === "http";
}

/**
 * The actions an inbound Flow may run: the ones that do something to the world
 * or to the caller, and none that write to a chat nobody is reading.
 *
 * `search_knowledge` is deliberately absent even though it produces text: it
 * is a model loop that cites Sources into a transcript, and a caller holding a
 * socket is the wrong place for it. If that turns out to be wanted, it wants
 * its own decision about latency and cost, not an entry in this list.
 *
 * So are the two gates, `human_review` and `http_webhook`. Both stop a turn and
 * resume it later from a Conversation, and an inbound run has no Conversation
 * to resume into: the caller is holding a socket, and there is nowhere to
 * continue *to*. Offering them would be offering a step that halts the Flow and
 * answers 204. Making them work is a different feature, one where the endpoint
 * answers "accepted" and calls back later.
 */
export const HTTP_FLOW_ACTIONS: readonly FlowAction[] = [
  "api_request",
  "connector",
  "send_email",
  "improvement",
  "respond",
] as const;

/** Methods this build will serve on a Flow endpoint. */
export const HTTP_FLOW_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpFlowMethod = (typeof HTTP_FLOW_METHODS)[number];

/**
 * POST only unless the Flow says otherwise. A default of "everything" would
 * make an endpoint answer verbs its author never thought about.
 */
export const DEFAULT_HTTP_FLOW_METHODS: HttpFlowMethod[] = ["POST"];

export function httpFlowMethods(flow: Pick<Flow, "triggerSettings">): HttpFlowMethod[] {
  const configured = flow.triggerSettings?.httpRequest?.methods ?? [];
  const kept = configured.filter((method): method is HttpFlowMethod =>
    HTTP_FLOW_METHODS.includes(method as HttpFlowMethod)
  );
  return kept.length > 0 ? kept : DEFAULT_HTTP_FLOW_METHODS;
}

/**
 * Headers a Flow may never read.
 *
 * `authorization` is how the caller proved it may run this Flow at all, and an
 * Organization API key echoed into an outbound `api_request` would hand the
 * org's own credential to whatever that request targets. `cookie` is the same
 * argument for a browser-borne credential. Neither is data the Flow needs.
 */
const UNREADABLE_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);

/**
 * Headers a Response may not set: the ones whose value the route derives from
 * the body it is about to send, and the hop-by-hop ones that belong to the
 * connection rather than to the answer.
 */
const UNWRITABLE_HEADERS = new Set([
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
]);

export interface HttpFlowRequest {
  method: string;
  body: string;
  query: Record<string, string>;
  headers: Record<string, string>;
}

/**
 * How far into a JSON body `request.body.<path>` reaches, and how many leaves
 * it offers. A body is a caller's document, not a schema the Flow agreed to,
 * so both are bounded: a deep or wide payload still resolves its first levels
 * and the whole text stays available as `request.body`.
 */
const BODY_PATH_MAX_DEPTH = 4;
const BODY_PATH_MAX_LEAVES = 200;

/**
 * Scalar leaves of a parsed JSON body as dotted paths: `{"order":{"id":"A-1"}}`
 * becomes `order.id` = `A-1`, arrays index numerically (`items.0.sku`). Only
 * an object or array body has paths; a bare string or number is the body
 * itself and is already offered whole.
 */
export function jsonBodyPaths(body: string): Record<string, string> {
  const paths: Record<string, string> = {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return paths;
  }
  if (parsed === null || typeof parsed !== "object") return paths;
  let leaves = 0;
  const walk = (value: unknown, prefix: string, depth: number) => {
    if (leaves >= BODY_PATH_MAX_LEAVES) return;
    if (value === null || typeof value !== "object") {
      if (value === undefined) return;
      paths[prefix] = typeof value === "string" ? value : String(value);
      leaves += 1;
      return;
    }
    if (depth >= BODY_PATH_MAX_DEPTH) return;
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key, item] of entries) {
      if (!/^[A-Za-z0-9_]+$/.test(key)) continue;
      walk(item, prefix ? `${prefix}.${key}` : key, depth + 1);
    }
  };
  walk(parsed, "", 0);
  return paths;
}

/**
 * What the Flow's actions may interpolate about the request that started them.
 * Shaped like the rest of the template catalogue (`user.name`, `webhook.body`)
 * so an author who has written one Flow can write this one. A JSON body is
 * also offered by path, so `{{request.body.orderId}}` reads the way
 * `{{user.name}}` does instead of needing a JSON-path step first.
 */
export function httpFlowRequestVariables(request: HttpFlowRequest): Record<string, string> {
  const vars: Record<string, string> = {
    "request.method": request.method.toUpperCase(),
    "request.body": request.body,
  };
  for (const [path, value] of Object.entries(jsonBodyPaths(request.body))) {
    vars[`request.body.${path}`] = value;
  }
  for (const [name, value] of Object.entries(request.query)) {
    vars[`request.query.${name}`] = value;
  }
  for (const [name, value] of Object.entries(request.headers)) {
    const key = name.toLowerCase();
    if (UNREADABLE_HEADERS.has(key)) continue;
    vars[`request.header.${key}`] = value;
  }
  return vars;
}

/**
 * Statuses a Response may send. 1xx is refused because it is not a final
 * answer: the platform's `Response` constructor throws on it, which would turn
 * a Flow that ran its side effects into a 500 the author never configured.
 */
const MIN_RESPOND_STATUS = 200;
const MAX_RESPOND_STATUS = 599;

/**
 * The status the caller receives, or null when the Response never said. Null
 * rather than a default: the status is the one required field, and a Flow that
 * omits it is misconfigured, not asking for 200.
 */
export function respondStatus(settings: RespondSettings | undefined): number | null {
  const raw = Number(settings?.status);
  if (!Number.isFinite(raw)) return null;
  const status = Math.floor(raw);
  return status >= MIN_RESPOND_STATUS && status <= MAX_RESPOND_STATUS ? status : null;
}

/**
 * The Needs-setup rule the canvas, the form and Publish share. `null` means
 * configured: a status the route can send, and no header the route must own.
 */
export function respondSettingsIssue(settings: RespondSettings | undefined): string | null {
  if (respondStatus(settings) === null) {
    return `Give the response a status code between ${MIN_RESPOND_STATUS} and ${MAX_RESPOND_STATUS}.`;
  }
  for (const header of settings?.headers ?? []) {
    const name = header.name.trim().toLowerCase();
    if (!name) continue;
    if (UNWRITABLE_HEADERS.has(name)) {
      return `The response can't set ${name}; the server owns that header.`;
    }
  }
  return null;
}

/**
 * Response headers with the ones the route owns removed, names lower-cased and
 * values stripped of line breaks. The strip is here rather than left to the
 * resolver because a header value is the one slot where a resolved variable
 * becomes protocol: `{{request.body}}` carrying a CRLF would otherwise end
 * the header and start another.
 */
export function respondHeaders(
  settings: RespondSettings | undefined,
  resolve: (value: string) => string
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of settings?.headers ?? []) {
    const name = header.name.trim().toLowerCase();
    if (!name || UNWRITABLE_HEADERS.has(name)) continue;
    headers[name] = resolve(header.value).replace(/[\r\n\0]/g, "");
  }
  return headers;
}
