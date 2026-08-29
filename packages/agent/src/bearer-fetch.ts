/**
 * The one bearer-authenticated JSON request the provider adapters share
 * (Apify, the Crawl4AI worker, the graph worker): POST/GET with a timeout,
 * a non-2xx body surfaced as a capped error message (optionally scrubbed of
 * secrets by the adapter's redactor), and the parsed JSON body on success.
 * The token only ever travels in the `Authorization` header.
 */
export interface BearerRequestOptions {
  token: string;
  /** JSON request body; its presence makes the request a POST. */
  body?: unknown;
  timeoutMs: number;
  /** Error-message prefix, e.g. "Apify run failed to start". */
  errorLabel: string;
  /** Scrubs adapter secrets out of provider error detail before it escapes. */
  redact?: (text: string) => string;
}

export async function bearerRequest<T>(
  url: string,
  options: BearerRequestOptions
): Promise<T> {
  const hasBody = options.body !== undefined;
  const response = await fetch(url, {
    method: hasBody ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${options.token}`,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const scrubbed = options.redact ? options.redact(detail) : detail;
    throw new Error(
      `${options.errorLabel} (${response.status}): ${scrubbed.slice(0, 200)}`
    );
  }
  return (await response.json().catch(() => ({}))) as T;
}
