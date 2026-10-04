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
  /** Exact response bytes for file connectors; text remains the UTF-8 view. */
  bytes?: Uint8Array;
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
 * validation/use gap (DNS rebinding). Redirects are never followed, Node's
 * client has none, so 3xx statuses surface to the caller.
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
          const body = Buffer.concat(chunks);
          resolve({
            status,
            ok: status >= 200 && status < 300,
            headers: new Headers(response.headers as Record<string, string>),
            text: body.toString("utf8"),
            bytes: body,
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

/** AG-UI needs a live response body, with the same DNS pin and redirect refusal. */
export async function pinnedStreamingRequest(
  target: ValidatedEgressTarget,
  options: PinnedRequestOptions
): Promise<Response> {
  const first = target.addresses[0];
  if (!first) throw new Error("Egress target has no validated address");
  const transport = target.url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(target.url, {
      method: options.method ?? "POST", headers: options.headers,
      // Pin one address, retaining the hostname for Host/SNI and certificate checks.
      lookup: (_host, lookupOptions, callback) => {
        if (typeof lookupOptions === "object" && lookupOptions.all) {
          callback(null, [{ address: first, family: isIP(first) }]);
        } else callback(null, first, isIP(first));
      },
      ...(target.url.protocol === "https:" ? { servername: target.url.hostname } : {}),
    }, response => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const status = response.statusCode ?? 502;
      if ([204, 205, 304].includes(status)) {
        response.resume();
        resolve(new Response(null, { status, headers }));
        return;
      }
      let bytes = 0;
      let closed = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const fail = (error: Error) => {
            if (closed) return;
            closed = true;
            controller.error(error);
          };
          response.on("data", (chunk: Buffer) => {
            if (closed) return;
            bytes += chunk.byteLength;
            if (bytes > (options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES)) {
              const error = new Error("Response exceeded the size limit");
              fail(error);
              response.destroy(error);
              return;
            }
            controller.enqueue(new Uint8Array(chunk));
          });
          response.on("end", () => { if (!closed) { closed = true; controller.close(); } });
          response.on("error", fail);
          response.on("aborted", () => fail(new Error("Harness response aborted")));
        },
        cancel() { closed = true; request.destroy(); response.destroy(); },
      });
      resolve(new Response(body, { status, headers }));
    });
    request.on("error", reject);
    request.setTimeout(options.timeoutMs, () => request.destroy(new Error("Harness response timed out")));
    const abort = () => request.destroy(new Error("Harness request cancelled"));
    if (options.signal?.aborted) { abort(); return; }
    options.signal?.addEventListener("abort", abort, { once: true });
    request.on("close", () => options.signal?.removeEventListener("abort", abort));
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}
