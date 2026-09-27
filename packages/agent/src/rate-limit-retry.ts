import { APICallError, type LanguageModelMiddleware } from "ai";

/**
 * Retry a provider call that was refused for capacity, with jitter.
 *
 * The AI SDK already retries a retryable call twice (2s, then 4s, or the
 * provider's `Retry-After` when it is under a minute). That is fine for one
 * caller and wrong for a crowd: when the platform key hits its rate limit,
 * every turn in flight is refused in the same second, and a fixed schedule
 * sends them all back in the same second too. A 429 storm then repeats itself
 * until the SDK gives up and every Visitor gets an error at once.
 *
 * So capacity refusals (429, and Anthropic's 529 "overloaded") are taken out of
 * the SDK's hands and retried here with **full jitter**: attempt N waits a
 * random time in `[0, min(maxDelay, base * 2^N)]`, or the provider's
 * `Retry-After` plus a little jitter when it sent one. Everything else (a 500,
 * a dropped socket) still goes through the SDK's own retry.
 *
 * When the budget runs out the error becomes a {@link ProviderRateLimitedError}.
 * It is deliberately not an `APICallError`, so the SDK does not retry it a
 * second time (retries would multiply), and it carries the wait the provider
 * asked for, which the turn forwards to the client as `retryAfterMs`.
 *
 * It wraps the model call (`doGenerate`/`doStream`), which returns once the
 * provider has accepted the request and before any token is streamed, so a
 * retry never duplicates text the Visitor has already seen.
 */

export interface RateLimitRetryPolicy {
  /** Retries after the first attempt. */
  retries: number;
  baseDelayMs: number;
  /** Ceiling for one backoff step (the jitter window's upper bound). */
  maxDelayMs: number;
  /**
   * Total time this call may spend waiting. A `Retry-After` that would push
   * past it ends the retries early: a Visitor would rather hear "busy" at 45s
   * than wait for a slot at 90s.
   */
  maxTotalWaitMs: number;
}

/**
 * Interactive turns: at most ~45s of waiting, well inside the chat route's
 * 300s `maxDuration` even when a multi-step turn is refused on two steps.
 */
export const INTERACTIVE_RATE_LIMIT_RETRY: RateLimitRetryPolicy = {
  retries: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 16_000,
  maxTotalWaitMs: 45_000,
};

/** A provider refused for capacity and the retry budget is spent. */
export class ProviderRateLimitedError extends Error {
  override readonly name = "ProviderRateLimitedError";
  /** What the provider asked for last, null when it said nothing. */
  readonly retryAfterMs: number | null;
  readonly statusCode: number;

  constructor(options: {
    statusCode: number;
    retryAfterMs: number | null;
    attempts: number;
    cause: unknown;
  }) {
    super(
      `Provider rate limit (${options.statusCode}) after ${options.attempts} attempt${
        options.attempts === 1 ? "" : "s"
      }`,
      { cause: options.cause }
    );
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** 429 is a rate limit everywhere; 529 is Anthropic's "overloaded". */
const CAPACITY_STATUS = new Set([429, 529]);

export interface CapacityRefusal {
  statusCode: number;
  retryAfterMs: number | null;
}

/**
 * The capacity refusal in `error`, if it is one. Walks `cause` because the
 * SDK and the agentic loop both wrap errors (a `RetryError`, a tool failure)
 * and the turn's catch only sees the outermost one.
 */
export function capacityRefusalOf(error: unknown): CapacityRefusal | null {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth++) {
    if (current instanceof ProviderRateLimitedError) {
      return {
        statusCode: current.statusCode,
        retryAfterMs: current.retryAfterMs,
      };
    }
    if (
      APICallError.isInstance(current) &&
      current.statusCode !== undefined &&
      CAPACITY_STATUS.has(current.statusCode)
    ) {
      return {
        statusCode: current.statusCode,
        retryAfterMs: retryAfterMsOf(current.responseHeaders),
      };
    }
    const next = current as { cause?: unknown; lastError?: unknown };
    current = next.lastError ?? next.cause;
  }
  return null;
}

/**
 * `retry-after-ms` (OpenAI) or `retry-after` in seconds or as an HTTP date.
 * Null for anything unparseable or negative.
 */
export function retryAfterMsOf(
  headers: Record<string, string> | undefined
): number | null {
  if (!headers) return null;
  const lower = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  const ms = Number.parseFloat(lower["retry-after-ms"] ?? "");
  if (Number.isFinite(ms) && ms >= 0) return ms;
  const raw = lower["retry-after"]?.trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : null;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - Date.now());
}

export interface RetryDeps {
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** `[0, 1)`, injectable so the schedule is testable. */
  random?: () => number;
}

/**
 * The wait before retry number `attempt` (0-based). Full jitter over the
 * exponential window; a provider's `Retry-After` is a floor, with up to one
 * base delay of jitter on top so a crowd told "wait 20s" does not come back
 * in the same millisecond either.
 */
export function capacityBackoffMs(
  attempt: number,
  retryAfterMs: number | null,
  policy: RateLimitRetryPolicy,
  random: () => number
): number {
  const window = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  if (retryAfterMs !== null) {
    return retryAfterMs + random() * policy.baseDelayMs;
  }
  return random() * window;
}

export async function retryOnCapacityRefusal<T>(
  call: () => PromiseLike<T>,
  options: {
    policy?: RateLimitRetryPolicy;
    signal?: AbortSignal;
  } & RetryDeps = {}
): Promise<T> {
  const policy = options.policy ?? INTERACTIVE_RATE_LIMIT_RETRY;
  const sleep = options.sleep ?? abortableSleep;
  const random = options.random ?? Math.random;
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const refusal = capacityRefusalOf(error);
      if (!refusal || options.signal?.aborted) throw error;
      const delay = capacityBackoffMs(attempt, refusal.retryAfterMs, policy, random);
      if (attempt >= policy.retries || waited + delay > policy.maxTotalWaitMs) {
        throw new ProviderRateLimitedError({
          statusCode: refusal.statusCode,
          retryAfterMs: refusal.retryAfterMs,
          attempts: attempt + 1,
          cause: error,
        });
      }
      waited += delay;
      await sleep(delay, options.signal);
    }
  }
}

/**
 * The middleware `buildModel` puts around every hosted provider model. A local
 * CLI subscription is not wrapped: it has no HTTP status to read and is one
 * Member's own process.
 */
export function capacityRetryMiddleware(
  policy: RateLimitRetryPolicy = INTERACTIVE_RATE_LIMIT_RETRY,
  deps: RetryDeps = {}
): LanguageModelMiddleware {
  return {
    wrapGenerate: ({ doGenerate, params }) =>
      retryOnCapacityRefusal(doGenerate, {
        policy,
        signal: params.abortSignal,
        ...deps,
      }),
    wrapStream: ({ doStream, params }) =>
      retryOnCapacityRefusal(doStream, {
        policy,
        signal: params.abortSignal,
        ...deps,
      }),
  };
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
