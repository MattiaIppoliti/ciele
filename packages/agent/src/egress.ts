import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { pinnedRequest, type PinnedFetchResponse } from "./pinned-fetch";

/**
 * Shared egress guard: the one policy gate for every server-side fetch of an
 * admin/model-supplied URL (SSRF surface). Validation happens at
 * DNS-resolution time (`validateEgressTarget`), and `egressFetch` closes the
 * validate/connect gap by pinning the connection to the validated addresses
 * (`pinned-fetch.ts`) and re-validating every redirect hop.
 *
 * Policy: docs/audits/api-request-egress-policy.md (issue #173). Consumers:
 * the website crawlers (`local-crawl.ts`, `ingest.ts`), knowledge URL extraction
 * (`extract.ts`), the `fetchUrl` built-in (`tools.ts`), the API catalogue's
 * query tool (`api-integration.ts`, which validates the path against the
 * catalogue *before* reaching this gate, #559) and the `api_request` Flow
 * Action executor (`api-request.ts`, #177).
 */

export type EgressPolicyCode =
  | "scheme"
  | "credentials"
  | "blocked_host"
  | "blocked_address"
  | "resolution_failed"
  | "redirect"
  | "forbidden_header";

export class EgressPolicyError extends Error {
  readonly code: EgressPolicyCode;
  constructor(message: string, code: EgressPolicyCode) {
    super(message);
    this.name = "EgressPolicyError";
    this.code = code;
  }
}

export interface EgressPolicy {
  /** Permit `http:` in addition to `https:` (crawl/page-fetch parity). */
  allowHttp?: boolean;
  /** Permit loopback targets (dev-only carve-out; never set in production). */
  allowLoopback?: boolean;
}

/**
 * Private/internal ranges as a `net.BlockList`; a v4-mapped IPv6 address
 * (`::ffff:10.1.2.3`) matches the IPv4 subnet rules directly, so no manual
 * unwrapping is needed. Loopback ranges are only added on the strict list.
 */
function buildBlockList(allowLoopback: boolean): BlockList {
  const list = new BlockList();
  list.addSubnet("0.0.0.0", 8, "ipv4");
  list.addSubnet("10.0.0.0", 8, "ipv4");
  list.addSubnet("100.64.0.0", 10, "ipv4");
  list.addSubnet("169.254.0.0", 16, "ipv4");
  list.addSubnet("172.16.0.0", 12, "ipv4");
  list.addSubnet("192.168.0.0", 16, "ipv4");
  list.addSubnet("198.18.0.0", 15, "ipv4");
  list.addSubnet("224.0.0.0", 3, "ipv4");
  list.addSubnet("::", 128, "ipv6");
  list.addSubnet("fc00::", 7, "ipv6");
  list.addSubnet("fe80::", 10, "ipv6");
  list.addSubnet("ff00::", 8, "ipv6");
  if (!allowLoopback) {
    list.addSubnet("127.0.0.0", 8, "ipv4");
    list.addSubnet("::1", 128, "ipv6");
  }
  return list;
}

const strictBlockList = buildBlockList(false);
const loopbackAllowedBlockList = buildBlockList(true);

function normalizedHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function isBlockedHostname(hostname: string, allowLoopback: boolean): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return !allowLoopback;
  }
  return (
    hostname === "metadata.google.internal" ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local")
  );
}

function isBlockedAddress(address: string, allowLoopback: boolean): boolean {
  const plain = address.split("%")[0];
  const family = isIP(plain);
  if (!family) return false;
  const list = allowLoopback ? loopbackAllowedBlockList : strictBlockList;
  return list.check(plain, family === 6 ? "ipv6" : "ipv4");
}

export interface ValidatedEgressTarget {
  url: URL;
  addresses: string[];
}

/**
 * Rejects unsafe targets before anything connects to them: scheme allowlist,
 * embedded credentials, blocked hostnames, and blocked IP ranges checked
 * against **every** resolved address (one private record among public ones is
 * a DNS-rebinding primitive). IP-literal hostnames, including decimal/hex
 * forms the OS resolver normalizes, end up address-checked either way.
 */
export async function validateEgressTarget(
  rawUrl: string,
  policy: EgressPolicy = {}
): Promise<ValidatedEgressTarget> {
  const { allowHttp = true, allowLoopback = false } = policy;
  const url = new URL(rawUrl);
  const schemeAllowed =
    url.protocol === "https:" || (allowHttp && url.protocol === "http:");
  if (!schemeAllowed) {
    throw new EgressPolicyError(
      allowHttp
        ? "Only HTTP(S) URLs are allowed"
        : "Only HTTPS URLs are allowed",
      "scheme"
    );
  }
  if (url.username || url.password) {
    throw new EgressPolicyError(
      "URLs with embedded credentials are not allowed",
      "credentials"
    );
  }
  const hostname = normalizedHostname(url.hostname);
  if (isBlockedHostname(hostname, allowLoopback)) {
    throw new EgressPolicyError("This hostname is not allowed", "blocked_host");
  }
  const addressKind = isIP(hostname);
  let addresses: string[];
  if (addressKind) {
    addresses = [hostname];
  } else {
    try {
      addresses = (await lookup(hostname, { all: true, verbatim: true })).map(
        ({ address }) => address
      );
    } catch {
      throw new EgressPolicyError(
        "This hostname did not resolve to any address",
        "resolution_failed"
      );
    }
  }
  if (addresses.length === 0) {
    throw new EgressPolicyError(
      "This hostname did not resolve to any address",
      "resolution_failed"
    );
  }
  if (addresses.some((address) => isBlockedAddress(address, allowLoopback))) {
    throw new EgressPolicyError(
      "Private or internal addresses are not allowed",
      "blocked_address"
    );
  }
  return { url, addresses };
}

/**
 * Framing/smuggling and routing headers an admin may never set on an outbound
 * request; `authorization`, `cookie`, `content-type` and custom `x-*` names
 * stay allowed (calling the org's own APIs is the point). Node's HTTP client
 * does not police these, so the guard owns the denylist (policy §6).
 */
const FORBIDDEN_HEADER_NAMES = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "keep-alive",
  "te",
  "trailer",
  "expect",
]);

const HTTP_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Rejects header names that are malformed or denylisted (throws EgressPolicyError). */
export function assertAllowedHeaders(headers: Record<string, string>): void {
  for (const name of Object.keys(headers)) {
    const lower = name.toLowerCase();
    if (
      !HTTP_TOKEN.test(name) ||
      FORBIDDEN_HEADER_NAMES.has(lower) ||
      lower.startsWith("proxy-") ||
      lower.startsWith("sec-")
    ) {
      throw new EgressPolicyError(
        `The header "${name}" cannot be set`,
        "forbidden_header"
      );
    }
  }
}

/** Strips CR/LF/NUL from a header value (response-splitting / injection guard). */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n\0]/g, "");
}

export interface EgressFetchOptions extends EgressPolicy {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  /** Redirect hops to follow, each re-validated and re-pinned. Default 0: any 3xx fails. */
  maxRedirects?: number;
  signal?: AbortSignal;
}

export interface EgressFetchResult {
  response: PinnedFetchResponse;
  /** URL of the response actually returned (after any followed redirects). */
  finalUrl: string;
}

/**
 * The guarded fetch: validate → DNS-pinned request → redirect policy.
 * Redirects are never followed implicitly; when `maxRedirects` allows them,
 * every hop's Location goes back through `validateEgressTarget`, so a public
 * endpoint cannot bounce the request into a private network.
 */
export async function egressFetch(
  rawUrl: string,
  options: EgressFetchOptions
): Promise<EgressFetchResult> {
  const maxRedirects = options.maxRedirects ?? 0;
  let currentUrl = rawUrl;
  for (let hop = 0; ; hop += 1) {
    const target = await validateEgressTarget(currentUrl, options);
    const response = await pinnedRequest(target, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      timeoutMs: options.timeoutMs,
      maxResponseBytes: options.maxResponseBytes,
      signal: options.signal,
    });
    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: target.url.toString() };
    }
    const location = response.headers.get("location");
    if (!location || hop >= maxRedirects) {
      throw new EgressPolicyError(
        maxRedirects === 0
          ? "The URL redirected, and redirects are not allowed here"
          : "The URL redirected too many times",
        "redirect"
      );
    }
    currentUrl = new URL(location, target.url).toString();
  }
}
