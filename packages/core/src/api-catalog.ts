import type {
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
  if (segments.some((segment) => segment === "." || segment === "..")) {
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
        if (!value || /%2f/i.test(value)) {
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
  };
}
