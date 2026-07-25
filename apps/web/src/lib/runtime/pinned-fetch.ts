import * as http from "node:http";
import * as https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { ValidatedEgressTarget } from "./egress";

const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface PinnedFetchResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
}

export interface PinnedRequestOptions {
  /** HTTP method (default GET). */
  method?: string;
  headers?: Record<string, string>;
  /** Request body; sent as-is (callers set content-type). */
  body?: string;
  timeoutMs: number;
  /** Streamed response-size cap (default 5 MiB); the request is destroyed past it. */
  maxResponseBytes?: number;
  /** Caller cancellation (e.g. the turn signal); aborts the in-flight request. */
  signal?: AbortSignal;
}

/**
 * Requests through Node's HTTP stack while pinning DNS to an address that has
 * already passed the egress-target checks (`validateEgressTarget`). The URL
 * hostname is retained for Host/SNI and certificate verification, closing the
 * validation/use gap (DNS rebinding). Redirects are never followed — Node's
 * client has none — so 3xx statuses surface to the caller.
 */
export async function pinnedRequest(
  target: ValidatedEgressTarget,
  options: PinnedRequestOptions
): Promise<PinnedFetchResponse> {
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const records = target.addresses.map((address) => ({
    address,
    family: isIP(address) as 4 | 6,
  }));
  const first = records[0];
  if (!first) throw new Error("Egress target has no validated address");
  const lookup: LookupFunction = (_hostname, lookupOptions, callback) => {
    if (typeof lookupOptions === "object" && lookupOptions.all) {
      (
        callback as unknown as (
          error: Error | null,
          addresses: Array<{ address: string; family: 4 | 6 }>
        ) => void
      )(null, records);
      return;
    }
    callback(null, first.address, first.family);
  };
  const transport = target.url.protocol === "https:" ? https : http;
  const requestOptions: http.RequestOptions & {
    autoSelectFamily: boolean;
    autoSelectFamilyAttemptTimeout: number;
  } = {
    method: options.method ?? "GET",
    headers: options.headers ?? {},
    lookup,
    autoSelectFamily: records.length > 1,
    autoSelectFamilyAttemptTimeout: 250,
    ...(target.url.protocol === "https:"
      ? { servername: target.url.hostname }
      : {}),
  };

  return new Promise((resolve, reject) => {
    const request = transport.request(
      target.url,
      requestOptions,
      (response) => {
        const declaredLength = Number(response.headers["content-length"]);
        if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
          request.destroy(new Error("Response exceeded the size limit"));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > maxResponseBytes) {
            request.destroy(new Error("Response exceeded the size limit"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("error", reject);
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            headers: new Headers(response.headers as Record<string, string>),
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    request.on("error", reject);
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error("Request timed out"));
    });
    const signal = options.signal;
    if (signal) {
      const onAbort = () => {
        request.destroy(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("Request aborted")
        );
      };
      if (signal.aborted) onAbort();
      else {
        signal.addEventListener("abort", onAbort, { once: true });
        request.on("close", () => signal.removeEventListener("abort", onAbort));
      }
    }
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

/** GET a crawl page with the crawler's 5 MiB cap (see `pinnedRequest`). */
export async function fetchPinnedPage(
  target: ValidatedEgressTarget,
  timeoutMs: number,
  headers: Record<string, string>
): Promise<PinnedFetchResponse> {
  return pinnedRequest(target, { timeoutMs, headers });
}
