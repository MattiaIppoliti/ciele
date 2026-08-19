import { isIP } from "node:net";
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
 * the website crawler (via `crawl-target.ts`), knowledge URL extraction
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

function ipv4Octets(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  return address.split(".").map(Number);
}

function isBlockedIpv4(address: string, allowLoopback: boolean): boolean {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    (a === 127 && !allowLoopback) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function ipv6Words(address: string): number[] | null {
  let normalized = address.toLowerCase().split("%")[0];
  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    const octets = ipv4Octets(normalized.slice(separator + 1));
    if (!octets) return null;
    normalized = `${normalized.slice(0, separator)}:${(
      (octets[0] << 8) |
      octets[1]
    ).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const zeroCount = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (zeroCount < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const parts = [...left, ...Array(zeroCount).fill("0"), ...right];
  const words = parts.map((part) => Number.parseInt(part, 16));
  return words.length === 8 && words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
    ? words
    : null;
}

function isBlockedIpv6(address: string, allowLoopback: boolean): boolean {
  const words = ipv6Words(address);
  if (!words) return false;
  const unspecified = words.every((word) => word === 0);
  const loopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  const uniqueLocal = (words[0] & 0xfe00) === 0xfc00;
  const linkLocal = (words[0] & 0xffc0) === 0xfe80;
  const multicast = (words[0] & 0xff00) === 0xff00;
  const ipv4Mapped =
    words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (ipv4Mapped) {
    const mapped = `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${
      words[7] & 0xff
    }`;
    return isBlockedIpv4(mapped, allowLoopback);
  }
  return (
    unspecified ||
    (loopback && !allowLoopback) ||
    uniqueLocal ||
    linkLocal ||
    multicast
  );
}

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
  return (
    isBlockedIpv4(address, allowLoopback) ||
    isBlockedIpv6(address, allowLoopback)
  );
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
