import {
  openSecret,
  resolveCatalogPath,
  type ApiEndpointSpec,
  type ApiIntegration,
  type CatalogPathRejection,
} from "@agent-hub/core";
import {
  assertAllowedHeaders,
  egressFetch,
  EgressPolicyError,
  sanitizeHeaderValue,
} from "./egress";
import { getRuntimeHost } from "./host";
import { API_REQUEST_MAX_BYTES, API_REQUEST_TIMEOUT_MS } from "./api-request";

/**
 * The API catalogue integration's execution core (spec #559): turning a
 * model-supplied *relative* path into one guarded outbound request.
 *
 * The order here is the security property. The path is matched against the
 * catalogue **first** (`resolveCatalogPath`, in the domain package, no I/O), and
 * only a described path is turned into a URL at all. The base URL is then
 * prepended server-side and the result re-checked against the configured origin
 * and base path, so neither a catalogue entry nor a substituted parameter can
 * move the request off the host the admin registered. The shared egress guard
 * (`egress.ts`) applies on top, unchanged, this module adds a check, it never
 * replaces one.
 *
 * The credential is opened here and leaves only as an outbound header.
 */

/** Why a query could not be made. Catalogue refusals plus the request-time ones. */
export type ApiQueryErrorCode =
  | CatalogPathRejection
  | "not_configured"
  | "base_url"
  | "escapes_base"
  | "blocked_host"
  | "forbidden_header"
  | "network";

/** What the model is told, per refusal. Never mentions hosts or addresses. */
export const API_QUERY_ERROR_MESSAGES: Record<ApiQueryErrorCode, string> = {
  empty: "No path was given. Pass a relative path from the endpoint catalogue.",
  absolute:
    "Pass a relative path only, the base URL is added for you and cannot be changed.",
  traversal: "That path is not allowed. Pass a path exactly as the catalogue describes it.",
  unknown_endpoint:
    "That path is not in this integration's endpoint catalogue. Call the catalogue tool to see what exists.",
  method_mismatch:
    "That endpoint does not accept this method. Check its details for the method it declares.",
  missing_path_param:
    "The path still contains a {placeholder}. Substitute the real value before querying.",
  not_configured: "This assistant has no API integration configured.",
  base_url: "This integration's base URL is not valid, an admin needs to fix it.",
  escapes_base:
    "That path resolves outside the integration's base URL and was not sent.",
  blocked_host: "This API is not reachable from the assistant.",
  forbidden_header: "This integration's configured headers are not allowed.",
  network: "The request to the API could not be completed.",
};

/** Composes the auth header, opening the sealed credential at the last moment. */
function integrationAuthHeaders(
  integration: ApiIntegration
): Record<string, string> {
  if (integration.authType === "none" || !integration.encryptedCredential) {
    return {};
  }
  let credential: string;
  try {
    credential = openSecret(integration.encryptedCredential);
  } catch {
    // An unreadable credential (rotated key) must not leak as a stack trace to
    // the model; the request goes out unauthenticated and the API refuses it,
    // which is the honest outcome.
    return {};
  }
  if (integration.authType === "bearer") {
    return { authorization: `Bearer ${credential}` };
  }
  if (integration.authType === "api_key") {
    return integration.authHeaderName
      ? { [integration.authHeaderName]: sanitizeHeaderValue(credential) }
      : {};
  }
  const encoded = Buffer.from(
    `${integration.authUsername}:${credential}`
  ).toString("base64");
  return { authorization: `Basic ${encoded}` };
}

/**
 * Joins the configured base URL and a catalogue-validated relative path, then
 * re-asserts that the result stayed inside the base. The second check is
 * deliberate redundancy: `resolveCatalogPath` already refused anything that
 * could escape, and this catches a *catalogue* whose own entry does.
 */
export function resolveIntegrationUrl(
  baseUrl: string,
  path: string
): { ok: true; url: URL } | { ok: false; code: "base_url" | "escapes_base" } {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return { ok: false, code: "base_url" };
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    return { ok: false, code: "base_url" };
  }
  const basePath = base.pathname.replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(`${base.origin}${basePath}${path}`);
  } catch {
    return { ok: false, code: "base_url" };
  }
  if (url.origin !== base.origin) return { ok: false, code: "escapes_base" };
  const prefix = basePath === "" ? "/" : `${basePath}/`;
  if (!url.pathname.startsWith(prefix) && url.pathname !== basePath) {
    return { ok: false, code: "escapes_base" };
  }
  return { ok: true, url };
}

export interface ApiQueryOutcome {
  ok: boolean;
  /** The matched catalogue entry; null when the path was refused. */
  endpoint: ApiEndpointSpec | null;
  /** Path actually requested, base URL included, safe to show an operator. */
  requestUrl: string | null;
  status: number | null;
  bodyText: string | null;
  errorCode: ApiQueryErrorCode | null;
}

export interface ApiQueryRequest {
  /** Relative path, path parameters already substituted by the model. */
  path: string;
  method?: string;
  /** Query parameters the model supplied. */
  query?: Record<string, string | number | boolean>;
  /** JSON body, for a catalogue entry whose method takes one. */
  body?: unknown;
}

export interface ApiQueryIdentity {
  subjectId: string;
  claimValue: string | null;
}

const IDENTITY_PLACEHOLDER_RE = /\{\{\s*identity\.(subject|claim)\s*\}\}/g;

function pinnedValue(value: string, identity?: ApiQueryIdentity): string | null {
  let unavailable = false;
  const resolved = value.replace(IDENTITY_PLACEHOLDER_RE, (_match, key: string) => {
    const replacement = key === "subject" ? identity?.subjectId : identity?.claimValue;
    if (!replacement) unavailable = true;
    return replacement ?? "";
  });
  return unavailable ? null : resolved;
}

/**
 * Runs one catalogued query. Never throws for a refusal or a network failure,
 * both come back as `errorCode` with `ok: false`, so the tool layer can tell the
 * model the truth (including a real 500 or a timeout) and the transcript can
 * record the real status.
 */
export async function queryApiEndpoint(
  integration: ApiIntegration,
  request: ApiQueryRequest,
  signal?: AbortSignal,
  identity?: ApiQueryIdentity
): Promise<ApiQueryOutcome> {
  const refuse = (errorCode: ApiQueryErrorCode): ApiQueryOutcome => ({
    ok: false,
    endpoint: null,
    requestUrl: null,
    status: null,
    bodyText: null,
    errorCode,
  });

  // 1. The catalogue decides, before a URL exists.
  let requestedPath = request.path;
  const endpoints = integration.endpoints.map((endpoint) => {
    let path = endpoint.path;
    for (const param of endpoint.params ?? []) {
      if (param.value === undefined || param.in !== "path") continue;
      const value = pinnedValue(param.value, identity);
      if (value === null) continue;
      path = path.replace(`{${param.name}}`, encodeURIComponent(value));
    }
    if (requestedPath === endpoint.path) requestedPath = path;
    return { ...endpoint, path };
  });
  const match = resolveCatalogPath(endpoints, requestedPath, request.method);
  if (!match.ok) return refuse(match.reason);

  // 2. The base URL is ours, not the model's.
  const resolved = resolveIntegrationUrl(integration.baseUrl, match.path);
  if (!resolved.ok) return refuse(resolved.code);
  const url = resolved.url;
  for (const [name, value] of Object.entries(request.query ?? {})) {
    if (!name.trim() || value === undefined || value === null) continue;
    url.searchParams.set(name, String(value));
  }
  for (const param of match.endpoint.params ?? []) {
    if (param.value === undefined || param.in !== "query") continue;
    const value = pinnedValue(param.value, identity);
    if (value === null) return refuse("not_configured");
    url.searchParams.set(param.name, value);
  }

  const method = match.endpoint.method;
  const isBodyless = method === "GET" || method === "DELETE";
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    ...(isBodyless ? {} : { "content-type": "application/json" }),
    ...integrationAuthHeaders(integration),
  };
  for (const param of match.endpoint.params ?? []) {
    if (param.value === undefined || param.in !== "header") continue;
    const value = pinnedValue(param.value, identity);
    if (value === null) return refuse("not_configured");
    headers[param.name] = sanitizeHeaderValue(value);
  }
  try {
    // The credential header name is admin-supplied, so it goes through the same
    // allow-list every configured header does.
    assertAllowedHeaders(headers);
  } catch {
    return refuse("forbidden_header");
  }

  try {
    const { response } = await egressFetch(url.toString(), {
      method,
      headers,
      body:
        isBodyless || request.body === undefined
          ? undefined
          : JSON.stringify(request.body),
      timeoutMs: API_REQUEST_TIMEOUT_MS,
      maxResponseBytes: API_REQUEST_MAX_BYTES,
      signal,
      allowHttp: getRuntimeHost().allowRelaxedEgress(),
      allowLoopback: getRuntimeHost().allowRelaxedEgress(),
    });
    return {
      // A 4xx/5xx is a completed request with a real status, not a refusal,
      // the transcript card and the model both need to see it as such.
      ok: response.ok,
      endpoint: match.endpoint,
      requestUrl: url.toString(),
      status: response.status,
      bodyText: response.text,
      errorCode: null,
    };
  } catch (error) {
    return {
      ok: false,
      endpoint: match.endpoint,
      requestUrl: url.toString(),
      status: null,
      bodyText: null,
      errorCode:
        error instanceof EgressPolicyError ? "blocked_host" : "network",
    };
  }
}
