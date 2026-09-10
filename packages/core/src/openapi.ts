/**
 * Resolving one operation out of an OpenAPI / Swagger document (#837).
 *
 * A Flow's HTTP step can take an endpoint two ways: a URL typed into the
 * builder, or an `operationId` looked up in a document the organization
 * already publishes. The second exists because the first makes an admin
 * hand-copy a method and a path that the spec already states, and a
 * hand-copied path is one that silently rots when the API moves.
 *
 * The resolution is here rather than in the runtime because "where does this
 * operation live" is a fact about the document, not about the network: it is
 * the same answer whether the builder is testing the step or a Conversation is
 * running it, and the runtime's job is only to fetch the document and make the
 * request that comes out.
 *
 * Nothing here fetches anything. The document arrives already parsed, which is
 * what lets every branch below be a test rather than a live API.
 */

/** The method and absolute URL an operation resolves to. */
export interface ResolvedOperation {
  method: string;
  url: string;
}

/**
 * Why an operation could not be resolved. Distinct codes because they are
 * different mistakes: the document is not one, the operation is not in it, or
 * the document never says where the API actually lives.
 */
export type OpenApiResolveError =
  | "unreadable"
  | "no_operation"
  | "no_server"
  /**
   * The document places the API on a different site than the one it was
   * fetched from. Refused rather than followed: the step's configured auth
   * header goes with the request, and a definition that could point it at any
   * host would hand that credential to whoever edits the definition.
   */
  | "foreign_origin";

export type OpenApiResolution =
  | { ok: true; operation: ResolvedOperation }
  | { ok: false; error: OpenApiResolveError };

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The base URL the document declares, absolute.
 *
 * OpenAPI 3 states `servers[].url`, which may be relative to where the
 * document itself is served; Swagger 2 states `host` + `basePath` + `schemes`,
 * and omits any of the three to mean "same as this document". Both therefore
 * resolve against `documentUrl`, which is the one thing always known.
 */
export function openApiBaseUrl(document: unknown, documentUrl: string): string | null {
  if (!isRecord(document)) return null;
  let base: string | null = null;

  const servers = document.servers;
  if (Array.isArray(servers) && servers.length > 0) {
    const first = servers[0];
    if (isRecord(first) && typeof first.url === "string" && first.url.trim()) {
      base = first.url.trim();
    }
  }

  if (base === null && typeof document.host === "string" && document.host.trim()) {
    const schemes = document.schemes;
    const scheme =
      Array.isArray(schemes) && typeof schemes[0] === "string" ? schemes[0] : "https";
    const basePath = typeof document.basePath === "string" ? document.basePath : "";
    base = `${scheme}://${document.host.trim()}${basePath}`;
  }

  if (base === null && typeof document.basePath === "string" && document.basePath.trim()) {
    base = document.basePath.trim();
  }

  // An absolute server URL says where the API is on its own, and must not
  // depend on the document's location parsing: `new URL(absolute, badBase)`
  // still throws on the base. Only a relative one needs the document.
  if (base !== null) {
    try {
      return new URL(base).toString();
    } catch {
      /* relative; resolved below */
    }
  }
  try {
    // "servers: [{ url: '/v2' }]" means "/v2 on this host", and the only host
    // known is the one the document was fetched from.
    return new URL(base ?? "./", documentUrl).toString();
  } catch {
    return null;
  }
}

/**
 * The site a host belongs to: its last two labels, so `docs.acme.test` and
 * `api.acme.test` are one site and `acme.test` is the same one. An IP address
 * or a single-label host is its own site. Deliberately not the public suffix
 * list: this is a lock, not a cookie jar, and a definition served from a
 * shared suffix is a rarer mistake than one served from a developer portal
 * beside the API it describes.
 */
function siteOf(host: string): string {
  const labels = host.toLowerCase().split(".");
  if (labels.length < 2 || /^[\d.]+$/.test(host) || host.includes(":")) return host.toLowerCase();
  return labels.slice(-2).join(".");
}

/**
 * Whether the API the document describes lives where the document does. The
 * typed-URL step locks its origin at configuration time; this is the same
 * lock for a definition-sourced step, applied to the one place a definition
 * could move the request: its `servers` entry. Same scheme and same site, so
 * an organization's developer portal may describe its API host, and a
 * definition cannot send the step's credential to a third party.
 */
function sameSite(base: string, documentUrl: string): boolean {
  try {
    const api = new URL(base);
    const doc = new URL(documentUrl);
    return api.protocol === doc.protocol && siteOf(api.hostname) === siteOf(doc.hostname);
  } catch {
    return false;
  }
}

/**
 * OpenAPI writes a path parameter as `{id}`; a Flow writes a template variable
 * as `{{id}}`. Rewriting one into the other is what lets a parameterised
 * operation take its value from an earlier action's extracted variable,
 * instead of resolving to a URL with a literal brace in it.
 */
export function templatizePath(path: string): string {
  return path.replace(/\{([^{}]+)\}/g, "{{$1}}");
}

/**
 * The method and URL for `operationId`, or why not.
 *
 * `documentUrl` is where the document was fetched from, and is what a relative
 * server URL is relative to.
 */
export function resolveOpenApiOperation(
  document: unknown,
  operationId: string,
  documentUrl: string
): OpenApiResolution {
  if (!isRecord(document)) return { ok: false, error: "unreadable" };
  const paths = document.paths;
  if (!isRecord(paths)) return { ok: false, error: "unreadable" };

  const wanted = operationId.trim();
  if (!wanted) return { ok: false, error: "no_operation" };

  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) continue;
    for (const method of METHODS) {
      const operation = item[method];
      if (!isRecord(operation)) continue;
      if (operation.operationId !== wanted) continue;

      // The base is already absolute and normalised; the path is joined as a
      // string rather than through `new URL`, which would percent-encode the
      // braces of a `{{variable}}` and leave nothing for the runtime to fill.
      const base = openApiBaseUrl(document, documentUrl);
      if (base === null) return { ok: false, error: "no_server" };
      if (!sameSite(base, documentUrl)) return { ok: false, error: "foreign_origin" };
      const url = `${base.replace(/\/+$/, "")}/${templatizePath(path).replace(/^\/+/, "")}`;
      return { ok: true, operation: { method: method.toUpperCase(), url } };
    }
  }
  return { ok: false, error: "no_operation" };
}
