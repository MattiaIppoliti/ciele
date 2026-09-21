import type {
  ApiEndpointIdempotency,
  ApiEndpointParam,
  ApiEndpointSpec,
  ApiIntegration,
} from "./types";

/**
 * The API catalogue's pure half (spec #559): what the model is told the
 * integration can do, and, the part that matters for security, whether a
 * path the model produced is one the catalogue actually describes.
 *
 * This lives in the domain, not the runtime, for one reason: **a path the
 * catalogue does not describe must never reach the network**, and that is a
 * decision about the catalogue, testable with no fetch, no egress guard and no
 * model in sight. The runtime calls {@link resolveCatalogPath} before it builds
 * a URL; the guardrails in `@agent-hub/agent` then apply as they always did.
 */

/** How the model is asked to write a path parameter in a catalogue path. */
const PATH_PARAM_RE = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/;

/**
 * A dot segment, however it is spelled. The WHATWG URL parser treats `%2e` as a
 * dot when it collapses `..` segments, so a literal-only check leaves
 * `/%2e%2e/users` looking like an ordinary segment here and like a traversal to
 * `new URL()` later, which is how an undescribed path used to reach the network.
 */
const DOT_SEGMENT_RE = /^(?:\.|%2e){1,2}$/i;

/** Why a model-supplied path was refused. Each maps to a message the model reads. */
export type CatalogPathRejection =
  | "empty"
  | "absolute"
  | "traversal"
  | "unknown_endpoint"
  | "method_mismatch"
  | "missing_path_param";

export interface CatalogPathMatch {
  ok: true;
  endpoint: ApiEndpointSpec;
  /**
   * The path to request, normalized to a single leading slash and with the
   * query string dropped (query parameters are passed separately, so a model
   * that appends its own cannot smuggle one past the catalogue).
   */
  path: string;
  /** The substituted path parameters, by name, for the transcript and citation. */
  pathParams: Record<string, string>;
}

export interface CatalogPathRefusal {
  ok: false;
  reason: CatalogPathRejection;
}

/** Path parameters an endpoint declares, derived from its path template. */
export function endpointPathParams(endpoint: ApiEndpointSpec): string[] {
  return splitPath(endpoint.path)
    .map((segment) => PATH_PARAM_RE.exec(segment)?.[1])
    .filter((name): name is string => Boolean(name));
}

/** Query parameters an endpoint declares (everything not in the path). */
export function endpointQueryParams(
  endpoint: ApiEndpointSpec
): ApiEndpointParam[] {
  const inPath = new Set(endpointPathParams(endpoint));
  return (endpoint.params ?? []).filter(
    (param) =>
      param.in !== "path" &&
      param.in !== "header" &&
      !inPath.has(param.name) &&
      param.value === undefined
  );
}

function splitPath(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

/**
 * Matches one model-supplied relative path against the catalogue. Nothing is
 * fetched here, the answer is only "which described endpoint is this, if any".
 *
 * Refused, before any URL exists:
 *  - an absolute or protocol-relative path (the base URL is not the model's to
 *    choose, so anything carrying a scheme or authority is out);
 *  - `.` / `..` segments, or an encoded slash inside a substituted parameter,
 *    both are ways to walk out of a described path;
 *  - a shape no catalogue entry describes;
 *  - a described shape requested with a different method than it declares;
 *  - an unsubstituted `{placeholder}` left in the path.
 */
export function resolveCatalogPath(
  endpoints: ApiEndpointSpec[],
  rawPath: string,
  method?: string
): CatalogPathMatch | CatalogPathRefusal {
  const withoutQuery = String(rawPath ?? "")
    .trim()
    .split(/[?#]/)[0];
  if (!withoutQuery) return { ok: false, reason: "empty" };
  // A scheme, an authority (`//host`), or a backslash-escaped variant of either
  // means the model is choosing a host, which is never its decision.
  if (
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(withoutQuery) ||
    /^[/\\]{2}/.test(withoutQuery) ||
    withoutQuery.includes("\\")
  ) {
    return { ok: false, reason: "absolute" };
  }
  const segments = splitPath(withoutQuery);
  if (segments.some((segment) => DOT_SEGMENT_RE.test(segment))) {
    return { ok: false, reason: "traversal" };
  }
  // A `{placeholder}` still in the path means the model described the endpoint
  // instead of calling it. Caught here so the refusal names the real mistake.
  if (/\{[^}]*\}/.test(withoutQuery)) {
    return { ok: false, reason: "missing_path_param" };
  }

  let methodMismatch = false;
  for (const endpoint of endpoints) {
    const template = splitPath(endpoint.path);
    if (template.length !== segments.length) continue;
    const pathParams: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < template.length; i += 1) {
      const placeholder = PATH_PARAM_RE.exec(template[i])?.[1];
      if (placeholder) {
        const value = segments[i];
        // A substituted value is ONE segment: a percent-encoded slash or a dot
        // segment hiding inside it would otherwise reach a path the catalogue
        // never described.
        if (!value || /%2f/i.test(value) || DOT_SEGMENT_RE.test(value)) {
          matched = false;
          break;
        }
        pathParams[placeholder] = value;
        continue;
      }
      if (template[i] !== segments[i]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (method && method.toUpperCase() !== endpoint.method) {
      methodMismatch = true;
      continue;
    }
    return {
      ok: true,
      endpoint,
      path: `/${segments.join("/")}`,
      pathParams,
    };
  }
  return {
    ok: false,
    reason: methodMismatch ? "method_mismatch" : "unknown_endpoint",
  };
}

/** The catalogue summary the discovery tool returns: base URL + every endpoint. */
export interface ApiCatalogSummary {
  integration: string;
  baseUrl: string;
  endpoints: Array<{
    id: string;
    name: string;
    method: string;
    path: string;
    purpose: string;
    pathParams: string[];
    queryParams: string[];
    responseKeys: string[];
  }>;
}

/**
 * Summarizes the whole catalogue for the discovery tool, enough for the model
 * to decide which endpoints it needs, without the per-parameter detail that
 * would make this one tool result enormous on a 21-endpoint integration.
 */
export function apiCatalogSummary(
  integration: Pick<ApiIntegration, "name" | "baseUrl" | "endpoints">
): ApiCatalogSummary {
  return {
    integration: integration.name,
    baseUrl: integration.baseUrl,
    endpoints: integration.endpoints.map((endpoint) => ({
      id: endpoint.id,
      name: endpoint.name,
      method: endpoint.method,
      path: endpoint.path,
      purpose: endpoint.purpose,
      pathParams: endpointPathParams(endpoint).filter(
        (name) => !endpoint.params?.some((param) => param.name === name && param.value !== undefined)
      ),
      queryParams: endpointQueryParams(endpoint).map((p) => p.name),
      responseKeys: endpoint.responseKeys ?? [],
    })),
  };
}

/** One endpoint's full contract, as the detail tool returns it. */
export interface ApiEndpointDetail {
  id: string;
  name: string;
  method: string;
  path: string;
  purpose: string;
  parameters: Array<{
    name: string;
    in: "path" | "query" | "header";
    type: string;
    required: boolean;
    description: string;
  }>;
  responseKeys: string[];
  /**
   * Whether a repeat of this call can write twice (#901). Carried on the
   * detail the model reads BEFORE it sends anything, so "this endpoint is not
   * deduplicated" is a fact available at the moment it matters rather than one
   * buried in an admin form.
   */
  duplicateWrites: "protected" | "unprotected" | "read_only";
}

/** The full parameter-level contract for one endpoint. */
export function apiEndpointDetail(endpoint: ApiEndpointSpec): ApiEndpointDetail {
  const pathNames = endpointPathParams(endpoint);
  const declared = new Map(
    (endpoint.params ?? []).map((param) => [param.name, param])
  );
  const parameters: ApiEndpointDetail["parameters"] = pathNames.flatMap((name) => {
    const param = declared.get(name);
    if (param?.value !== undefined) return [];
    return [{
      name,
      in: "path" as const,
      type: param?.type ?? "string",
      // A path parameter is structurally required: the path cannot be built
      // without it, whatever the catalogue happens to say.
      required: true,
      description: param?.description ?? "",
    }];
  });
  for (const param of endpointQueryParams(endpoint)) {
    parameters.push({
      name: param.name,
      in: "query",
      type: param.type ?? "string",
      required: param.required === true,
      description: param.description ?? "",
    });
  }
  return {
    id: endpoint.id,
    name: endpoint.name,
    method: endpoint.method,
    path: endpoint.path,
    purpose: endpoint.purpose,
    parameters,
    responseKeys: endpoint.responseKeys ?? [],
    duplicateWrites: endpointIdempotencyExposure(endpoint),
  };
}

/**
 * Header names an endpoint may never claim for its idempotency key.
 *
 * The declaration is admin-supplied, and it lands in the same header map as
 * the integration's sealed credential. Letting it name `authorization` would
 * let an endpoint description overwrite the credential with a derived hash,
 * which is a way to leak nothing and break everything; letting it name `host`
 * or `content-length` is a request-smuggling shape. Refused by NAME here
 * rather than filtered at send time, so the refusal is visible in the editor
 * instead of a silent no-op in production.
 */
const RESERVED_IDEMPOTENCY_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "content-type",
]);

export type IdempotencyRejection =
  | "empty_name"
  | "reserved_header"
  | "illegal_header_name"
  | "illegal_body_field";

/**
 * Is this idempotency declaration safe to send? Pure, so the editor and the
 * request path reach the same verdict rather than two similar ones.
 */
export function validateEndpointIdempotency(
  declaration: ApiEndpointIdempotency
): { ok: true } | { ok: false; reason: IdempotencyRejection } {
  const name = declaration.name.trim();
  if (!name) return { ok: false, reason: "empty_name" };
  if (declaration.in === "header") {
    if (RESERVED_IDEMPOTENCY_HEADERS.has(name.toLowerCase()))
      return { ok: false, reason: "reserved_header" };
    // RFC 9110 token: no spaces, no separators, no control characters, which
    // is also what stops a newline turning one header into two.
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name))
      return { ok: false, reason: "illegal_header_name" };
    return { ok: true };
  }
  // A body field is a JSON key, and a nested path would need a merge rule
  // nobody asked for. One top-level key, plainly named.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    return { ok: false, reason: "illegal_body_field" };
  return { ok: true };
}

/**
 * The key itself: stable for the same logical call, different for any other.
 *
 * Rooted in the Conversation and the call slot within it, so a retry of the
 * SAME call, by us, by a durable job, or by anything above us that reissues
 * the request, presents the value the organization's API already saw. Two
 * different calls to the same endpoint in the same Conversation are two
 * different writes and get two different keys, which is what stops a Member
 * being told their second order was a duplicate of their first.
 *
 * The endpoint id is in the material so that two endpoints reached from one
 * call slot cannot collide.
 */
export function endpointIdempotencyKey(input: {
  conversationId: string;
  /** The call's slot: a Flow action index, or a tool call id. */
  callSlot: string;
  endpointId: string;
}): string {
  const material = [
    input.conversationId,
    input.callSlot,
    input.endpointId,
  ]
    .map((part) => encodeURIComponent(part))
    .join(":");
  // The checksum leads, so the cap below can only ever remove the tail of a
  // readable suffix. Two calls whose ids differ only past the cap still get
  // different keys, which a plain truncation could not promise. It is a dedup
  // key and not a secret, so a short non-cryptographic digest is the right
  // size of tool, and it stays out of `node:crypto` because this module is in
  // the browser bundle (the endpoint editor reads `endpointPathParams`).
  return `ciele-${checksum(material)}-${material}`.slice(0, IDEMPOTENCY_KEY_MAX);
}

/**
 * The cap every implementation shares: Resend and Stripe both take 255-256,
 * and the three other places that set an idempotency header all slice to this.
 */
export const IDEMPOTENCY_KEY_MAX = 256;

/** FNV-1a, 32-bit, hex. Deterministic, dependency-free, browser-safe. */
function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * What an endpoint's catalogue entry says about duplicate writes.
 *
 * An endpoint that declares nothing is **unprotected**, and #901 asks for that
 * to be documented rather than silently treated as safe. A GET is a different
 * case and says so: replaying a read duplicates nothing.
 */
export function endpointIdempotencyExposure(
  endpoint: ApiEndpointSpec
): "protected" | "unprotected" | "read_only" {
  if (endpoint.idempotency) return "protected";
  return endpoint.method === "GET" ? "read_only" : "unprotected";
}
