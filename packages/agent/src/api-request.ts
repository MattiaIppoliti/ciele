import type { FlowActionSettings } from "@agent-hub/core";
import { resolveOpenApiOperation } from "@agent-hub/core";
import {
  assertAllowedHeaders,
  egressFetch,
  EgressPolicyError,
  sanitizeHeaderValue,
} from "./egress";
import { getRuntimeHost } from "./host";
import {
  TEMPLATE_VARIABLES,
  resolveTemplate,
  type TemplateContext,
} from "./template";

/**
 * The API request Flow Action's execution core, shared by the runtime handler
 * (actions.ts) and the builder's "Test request" action. Everything SSRF- and
 * secret-sensitive lives here: URL/query/header/body interpolation, the static
 * -origin guard, auth composition, the egress-guarded fetch, and JSON-path
 * extraction. Internal to the runtime deep module.
 */

type ApiRequestSettings = NonNullable<FlowActionSettings["api_request"]>;

export const API_REQUEST_TIMEOUT_MS = 10_000;
export const API_REQUEST_MAX_BYTES = 1024 * 1024;

/** A machine code for a request that could not run or complete. */
export type ApiRequestErrorCode =
  | "invalid_url"
  | "template_in_origin"
  | "scheme"
  | "credentials"
  | "blocked_host"
  | "blocked_address"
  | "resolution_failed"
  | "redirect"
  | "forbidden_header"
  | "network"
  /** The OpenAPI document could not be fetched, or is not a document. */
  | "swagger_unreadable"
  /** The document does not describe the operation the step names. */
  | "swagger_no_operation"
  /** The document places the API on another site than the one it is served from. */
  | "swagger_foreign_origin";

export interface ApiRequestOutcome {
  ok: boolean;
  status: number | null;
  bodyText: string | null;
  errorCode: ApiRequestErrorCode | null;
}

/**
 * Composes the Authorization/API-key header for the configured auth type.
 * Secrets are read here and only ever leave as the outbound header.
 */
function authHeaders(auth: ApiRequestSettings["auth"]): Record<string, string> {
  if (!auth || auth.type === "none") return {};
  if (auth.type === "bearer") {
    return auth.token ? { authorization: `Bearer ${auth.token}` } : {};
  }
  if (auth.type === "api_key") {
    return auth.header && auth.key ? { [auth.header]: auth.key } : {};
  }
  if (auth.type === "basic") {
    if (!auth.username && !auth.password) return {};
    const encoded = Buffer.from(
      `${auth.username ?? ""}:${auth.password ?? ""}`
    ).toString("base64");
    return { authorization: `Basic ${encoded}` };
  }
  return {};
}

/** Minimal JSON-path reader: `$.a.b`, `$.a[0].c`. Blank path returns the root. */
export function readJsonPath(root: unknown, path: string): unknown {
  const normalized = path
    .trim()
    .replace(/^\$\.?/, "")
    .replace(/\[(\d+)\]/g, ".$1");
  if (!normalized) return root;
  let current: unknown = root;
  for (const segment of normalized.split(".")) {
    if (!segment) continue;
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function stringifyExtracted(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** How long to wait for the OpenAPI document itself. */
const SWAGGER_TIMEOUT_MS = 10_000;
/** A spec is text, and a large one is a mistake rather than a large API. */
const SWAGGER_MAX_BYTES = 4 * 1024 * 1024;

/**
 * A Swagger-sourced step's endpoint, resolved into the `method`/`url` a typed
 * step carries directly. A typed step is returned untouched.
 *
 * The document is fetched through the same egress guard as the request itself,
 * because it is the same kind of thing: an admin-configured URL the server
 * fetches. It is *not* cached: a spec is the authority on where the operation
 * lives, and a cached one is exactly the stale path this feature exists to
 * stop. One extra round trip per run is the price of that.
 */
async function resolveSettingsEndpoint(
  settings: ApiRequestSettings,
  signal?: AbortSignal
): Promise<{ settings: ApiRequestSettings } | { errorCode: ApiRequestErrorCode }> {
  if (settings.endpoint !== "swagger") return { settings };
  const documentUrl = settings.swaggerUrl?.trim();
  if (!documentUrl) return { errorCode: "swagger_unreadable" };

  let document: unknown;
  try {
    const { response } = await egressFetch(documentUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      timeoutMs: SWAGGER_TIMEOUT_MS,
      maxResponseBytes: SWAGGER_MAX_BYTES,
      signal,
      allowHttp: getRuntimeHost().allowRelaxedEgress(),
      allowLoopback: getRuntimeHost().allowRelaxedEgress(),
    });
    if (!response.ok) return { errorCode: "swagger_unreadable" };
    document = JSON.parse(response.text) as unknown;
  } catch (error) {
    // A policy refusal on the document is still that policy's refusal: report
    // it as itself rather than flattening every failure into "unreadable".
    if (error instanceof EgressPolicyError) return { errorCode: error.code };
    return { errorCode: "swagger_unreadable" };
  }

  const operation = resolveOpenApiOperation(
    document,
    settings.operationId ?? "",
    documentUrl
  );
  if (!operation.ok) {
    return {
      errorCode:
        operation.error === "no_operation"
          ? "swagger_no_operation"
          : operation.error === "foreign_origin"
            ? "swagger_foreign_origin"
            : "swagger_unreadable",
    };
  }
  // The document's method wins over any left on the step: the operation is
  // what was chosen, and a POST cannot be talked into being a GET by a stale
  // field the builder hid.
  return {
    settings: {
      ...settings,
      method: operation.operation.method as ApiRequestSettings["method"],
      url: operation.operation.url,
    },
  };
}

/**
 * Builds and sends the configured request through the shared egress guard.
 * Never throws for policy/network failures, they come back as `errorCode`
 * with `ok:false`, so callers decide how to surface them.
 */
export async function executeApiRequest(
  settings: ApiRequestSettings,
  context: TemplateContext,
  signal?: AbortSignal,
  idempotencyKey?: string
): Promise<ApiRequestOutcome> {
  // A Swagger-sourced step carries an operation, not a URL: resolve it into
  // the same method-and-URL pair a typed step already has, then run the one
  // request path below. Everything after this point is unaware of which of the
  // two the step was configured as, which is the point of resolving here.
  const resolved = await resolveSettingsEndpoint(settings, signal);
  if ("errorCode" in resolved) {
    return { ok: false, status: null, bodyText: null, errorCode: resolved.errorCode };
  }
  settings = resolved.settings;

  if (!settings.url) {
    return { ok: false, status: null, bodyText: null, errorCode: "invalid_url" };
  }
  const method = (settings.method || "POST").toUpperCase();

  // URL: template variables may reach the path/query but never the origin,
  // assert the resolved origin equals the config-time origin.
  let url: URL;
  try {
    const staticOrigin = new URL(
      settings.url.replace(/\{\{[^}]+\}\}/g, "x")
    ).origin;
    url = new URL(resolveTemplate(settings.url, context));
    if (url.origin !== staticOrigin) {
      return {
        ok: false,
        status: null,
        bodyText: null,
        errorCode: "template_in_origin",
      };
    }
  } catch {
    return { ok: false, status: null, bodyText: null, errorCode: "invalid_url" };
  }
  for (const param of settings.queryParams ?? []) {
    if (!param.name.trim()) continue;
    url.searchParams.set(param.name, resolveTemplate(param.value, context));
  }

  const adminHeaders: Record<string, string> = {};
  for (const header of settings.headers ?? []) {
    if (!header.name.trim()) continue;
    adminHeaders[header.name] = sanitizeHeaderValue(
      resolveTemplate(header.value, context)
    );
  }

  try {
    assertAllowedHeaders(adminHeaders);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...adminHeaders,
      ...authHeaders(settings.auth),
      ...(idempotencyKey
        ? { "idempotency-key": idempotencyKey.slice(0, 256) }
        : {}),
    };
    const isBodyless = method === "GET" || method === "HEAD";
    const body = settings.bodyTemplate?.trim()
      ? resolveTemplate(settings.bodyTemplate, context, "json-string")
      : JSON.stringify({ message: context["workflow.message"] ?? "" });
    const { response } = await egressFetch(url.toString(), {
      method,
      headers,
      body: isBodyless ? undefined : body,
      timeoutMs: API_REQUEST_TIMEOUT_MS,
      maxResponseBytes: API_REQUEST_MAX_BYTES,
      signal,
      allowHttp: getRuntimeHost().allowRelaxedEgress(),
      allowLoopback: getRuntimeHost().allowRelaxedEgress(),
    });
    return {
      ok: response.ok,
      status: response.status,
      bodyText: response.text,
      errorCode: null,
    };
  } catch (error) {
    const errorCode: ApiRequestErrorCode =
      error instanceof EgressPolicyError ? error.code : "network";
    return { ok: false, status: null, bodyText: null, errorCode };
  }
}

/** The subset of a support channel's config an API-endpoint escalation uses. */
export interface EscalationEndpointConfig {
  url?: string;
  authType?: "none" | "api_key" | "bearer" | "basic";
  apiKeyHeaderName?: string;
  apiKeyValue?: string;
  bearerToken?: string;
  basicUsername?: string;
  basicPassword?: string;
  headers?: Array<{ name: string; value: string }>;
  queryParams?: Array<{ name: string; value: string }>;
}

function escalationAuthHeaders(
  config: EscalationEndpointConfig
): Record<string, string> {
  if (config.authType === "bearer" && config.bearerToken) {
    return { authorization: `Bearer ${config.bearerToken}` };
  }
  if (config.authType === "api_key" && config.apiKeyHeaderName && config.apiKeyValue) {
    return { [config.apiKeyHeaderName]: config.apiKeyValue };
  }
  if (
    config.authType === "basic" &&
    (config.basicUsername || config.basicPassword)
  ) {
    const encoded = Buffer.from(
      `${config.basicUsername ?? ""}:${config.basicPassword ?? ""}`
    ).toString("base64");
    return { authorization: `Basic ${encoded}` };
  }
  return {};
}

/**
 * Sends a widget escalation to an API-endpoint support channel (#315): the
 * configured URL/auth/headers/query with the escalation payload as the JSON
 * body, through the shared egress guard. No templating, the payload is
 * visitor-provided data, never interpolated. Never throws; failures come
 * back as `errorCode` so the route can answer honestly.
 */
export async function sendEscalationApiRequest(
  config: EscalationEndpointConfig,
  payload: unknown,
  signal?: AbortSignal,
  idempotencyKey?: string
): Promise<ApiRequestOutcome> {
  if (!config.url) {
    return { ok: false, status: null, bodyText: null, errorCode: "invalid_url" };
  }
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    return { ok: false, status: null, bodyText: null, errorCode: "invalid_url" };
  }
  for (const param of config.queryParams ?? []) {
    if (!param.name.trim()) continue;
    url.searchParams.set(param.name, param.value);
  }
  const adminHeaders: Record<string, string> = {};
  for (const header of config.headers ?? []) {
    if (!header.name.trim()) continue;
    adminHeaders[header.name] = sanitizeHeaderValue(header.value);
  }
  try {
    assertAllowedHeaders(adminHeaders);
    const { response } = await egressFetch(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...adminHeaders,
        ...escalationAuthHeaders(config),
        ...(idempotencyKey
          ? { "idempotency-key": idempotencyKey.slice(0, 256) }
          : {}),
      },
      body: JSON.stringify(payload),
      timeoutMs: API_REQUEST_TIMEOUT_MS,
      maxResponseBytes: API_REQUEST_MAX_BYTES,
      signal,
      allowHttp: getRuntimeHost().allowRelaxedEgress(),
      allowLoopback: getRuntimeHost().allowRelaxedEgress(),
    });
    return {
      ok: response.ok,
      status: response.status,
      bodyText: response.text,
      errorCode: null,
    };
  } catch (error) {
    const errorCode: ApiRequestErrorCode =
      error instanceof EgressPolicyError ? error.code : "network";
    return { ok: false, status: null, bodyText: null, errorCode };
  }
}

export interface ExtractedVariable {
  variable: string;
  value: string;
  /** True when the path resolved to no value (admin-visible signal). */
  missed: boolean;
}

/**
 * Evaluates the configured JSON paths against a response body. Parse/lookup
 * failures never throw, they yield empty values flagged `missed`, so the
 * request's own outcome is unaffected.
 */
export function extractApiJsonPaths(
  settings: ApiRequestSettings,
  bodyText: string | null
): { extracted: ExtractedVariable[]; parseFailed: boolean } {
  const rules = (settings.jsonPaths ?? []).filter((p) => p.variable.trim());
  if (rules.length === 0) return { extracted: [], parseFailed: false };
  let parsed: unknown;
  let parseOk = false;
  if (bodyText !== null) {
    try {
      parsed = JSON.parse(bodyText);
      parseOk = true;
    } catch {
      parseOk = false;
    }
  }
  const extracted = rules.map((rule) => {
    const value = parseOk ? readJsonPath(parsed, rule.path) : undefined;
    return {
      variable: rule.variable.trim(),
      value: stringifyExtracted(value),
      missed: value === undefined,
    };
  });
  return { extracted, parseFailed: bodyText !== null && !parseOk };
}

export interface ApiRequestTestResult {
  ok: boolean;
  status: number | null;
  /** Bounded response excerpt (never the full body). */
  excerpt: string | null;
  extracted: ExtractedVariable[];
  parseFailed: boolean;
  /** Admin-facing failure: machine code + human message, never resolved IPs. */
  error: { code: ApiRequestErrorCode; message: string } | null;
}

const TEST_EXCERPT_CHARS = 500;

const ERROR_MESSAGES: Record<ApiRequestErrorCode, string> = {
  invalid_url: "The endpoint URL is not valid.",
  template_in_origin: "Template variables can't be used in the URL host.",
  scheme: "The endpoint must use HTTPS.",
  credentials:
    "Remove credentials from the URL and use the authentication field instead.",
  blocked_host: "Blocked: this hostname is not allowed.",
  blocked_address: "Blocked: the endpoint resolves to a private address.",
  resolution_failed: "The endpoint hostname could not be resolved.",
  redirect: "The endpoint redirected, which is not allowed.",
  forbidden_header: "One of the configured headers is not allowed.",
  network: "The request could not be completed.",
  swagger_unreadable:
    "The Swagger/OpenAPI definition could not be read from that URL.",
  swagger_no_operation:
    "That definition does not describe an operation with this Operation ID.",
  swagger_foreign_origin:
    "That definition places the API on a different site than the one it is served from. Type the endpoint URL instead.",
};

/** Distinguishable placeholder values for every catalog variable. */
export function sampleContext(): TemplateContext {
  const context: TemplateContext = {};
  for (const variable of TEMPLATE_VARIABLES) {
    const name = variable.token.slice(2, variable.token.length - 2);
    context[name] = `«${name}»`;
  }
  return context;
}

/**
 * Runs the configured request with sample template values and returns a
 * secret-free, IP-free summary for the builder's "Test request" control.
 */
export async function testApiRequest(
  settings: ApiRequestSettings,
  signal?: AbortSignal
): Promise<ApiRequestTestResult> {
  const outcome = await executeApiRequest(settings, sampleContext(), signal);
  const { extracted, parseFailed } = extractApiJsonPaths(
    settings,
    outcome.bodyText
  );
  return {
    ok: outcome.ok,
    status: outcome.status,
    excerpt: outcome.bodyText?.slice(0, TEST_EXCERPT_CHARS) ?? null,
    extracted,
    parseFailed,
    error: outcome.errorCode
      ? { code: outcome.errorCode, message: ERROR_MESSAGES[outcome.errorCode] }
      : null,
  };
}
