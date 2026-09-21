import {
  endpointIdempotencyKey,
  openSecret,
  validateEndpointIdempotency,
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

/** Non-empty path segments, so a collapse shows up as a smaller count. */
function countPathSegments(path: string): number {
  return path.split("/").filter(Boolean).length;
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
  // Nothing may collapse on the way through the parser. A dot segment in any
  // spelling (`..`, `%2e%2e`, `.%2e`) shortens the path, so an unchanged
  // segment count proves the URL we send is the one the catalogue approved.
  // Counting rather than string-comparing keeps a legitimately
  // percent-encoded parameter value from being refused here.
  const expectedSegments =
    countPathSegments(basePath) + countPathSegments(path);
  if (countPathSegments(url.pathname) !== expectedSegments) {
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

/**
 * Where a catalogued call sits, so its idempotency key can be derived (#901).
 *
 * Absent means no key is sent at all, which is what the builder's test run
 * wants: a test must never present the key a real call would, or it burns it
 * and the real call silently gets the test's response back.
 */
export interface ApiQueryOrigin {
  conversationId: string;
  /** The call's slot within the Conversation: a tool call id or action index. */
  callSlot: string;
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
  identity?: ApiQueryIdentity,
  origin?: ApiQueryOrigin
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
  const endpoints = integration.endpoints.flatMap((endpoint) => {
    let path = endpoint.path;
    for (const param of endpoint.params ?? []) {
      if (param.value === undefined || param.in !== "path") continue;
      const value = pinnedValue(param.value, identity);
      // An unresolvable pin makes this endpoint uncallable, never
      // model-fillable: leaving `{name}` in the template would hand the model
      // the very value the pin exists to take away from it. Dropping only this
      // endpoint (rather than refusing outright) keeps one broken pin from
      // disabling the unrelated entries the loop still has to walk.
      if (value === null) return [];
      path = path.replace(`{${param.name}}`, encodeURIComponent(value));
    }
    if (requestedPath === endpoint.path) requestedPath = path;
    return [{ ...endpoint, path }];
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

  // The idempotency key, if this endpoint's catalogue entry declares one and
  // the caller said where the call sits (#901). Nothing is guessed: the header
  // or body field is the name the organization's own API reads, because we
  // cannot know it. An endpoint that declares nothing gets a byte-identical
  // request to the one it got before this existed.
  const declaration = match.endpoint.idempotency;
  const idempotencyKey =
    declaration && origin && validateEndpointIdempotency(declaration).ok
      ? endpointIdempotencyKey({
          conversationId: origin.conversationId,
          callSlot: origin.callSlot,
          endpointId: match.endpoint.id,
        })
      : null;
  if (idempotencyKey && declaration?.in === "header") {
    // Never over a header the request already has. `api_key` auth puts the
    // integration's credential under an ADMIN-NAMED header, so a declaration
    // naming that same header would replace the credential with a derived
    // hash: no leak, but every call fails to authenticate and the catalogue
    // entry looks innocent. The reserved-name list cannot catch that one,
    // because the name is whatever the admin chose. Comparing against what is
    // already in the map covers it, and covers a pinned parameter header and
    // `accept` with the same line (#901).
    const taken = new Set(Object.keys(headers).map((name) => name.toLowerCase()));
    // The integration's own auth header by NAME as well as by presence. A
    // credential that failed to open leaves no header in the map, and relying
    // on the map alone would then write the key under the credential's name
    // on exactly the calls that were already misconfigured.
    if (integration.authType === "api_key" && integration.authHeaderName) {
      taken.add(integration.authHeaderName.toLowerCase());
    }
    if (!taken.has(declaration.name.toLowerCase())) {
      headers[declaration.name] = sanitizeHeaderValue(idempotencyKey);
    }
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
      body: requestBody(request, isBodyless, {
        key: idempotencyKey,
        field: declaration?.in === "body" ? declaration.name : null,
      }),
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

/**
 * The JSON body, with the idempotency key merged in when the endpoint wants it
 * there rather than in a header (#901).
 *
 * The key is written under the declared field and nothing else moves. A body
 * that already carries that field keeps the model's value: the catalogue says
 * where the key GOES, and an endpoint whose own parameter collides with it is
 * a catalogue mistake to fix in the editor, not a value to silently overwrite
 * on the way out.
 */
function requestBody(
  request: ApiQueryRequest,
  isBodyless: boolean,
  idempotency: { key: string | null; field: string | null }
): string | undefined {
  if (isBodyless) return undefined;
  const merge = idempotency.key !== null && idempotency.field !== null;
  if (request.body === undefined) {
    return merge ? JSON.stringify({ [idempotency.field!]: idempotency.key }) : undefined;
  }
  if (!merge) return JSON.stringify(request.body);
  const body = request.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    // A scalar or array body has nowhere to put a named field. Send it
    // unchanged rather than reshaping what the catalogue described.
    return JSON.stringify(body);
  }
  // The key OVERWRITES whatever is under that name. The body is the model's,
  // and the model's input can be steered by the content it just read, so
  // deferring to a value it supplied would let a crafted page replay an
  // earlier write's key and receive that write's response, or supply a
  // constant and defeat deduplication entirely. The key is ours; where it goes
  // is the catalogue's; neither is the model's to choose.
  const record = body as Record<string, unknown>;
  return JSON.stringify({ ...record, [idempotency.field!]: idempotency.key });
}
