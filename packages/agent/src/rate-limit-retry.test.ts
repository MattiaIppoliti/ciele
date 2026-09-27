import { APICallError, RetryError } from "ai";
import { describe, expect, it, vi } from "vitest";

import {
  INTERACTIVE_RATE_LIMIT_RETRY,
  ProviderRateLimitedError,
  capacityBackoffMs,
  capacityRefusalOf,
  retryAfterMsOf,
  retryOnCapacityRefusal,
} from "./rate-limit-retry";

function apiError(statusCode: number, headers: Record<string, string> = {}) {
  return new APICallError({
    message: `status ${statusCode}`,
    url: "https://provider.test/v1/messages",
    requestBodyValues: {},
    statusCode,
    responseHeaders: headers,
    isRetryable: statusCode === 429 || statusCode >= 500,
  });
}

const noSleep = { sleep: vi.fn(async () => {}), random: () => 0.5 };

describe("capacityRefusalOf", () => {
  it("recognises 429 and 529, and nothing else", () => {
    expect(capacityRefusalOf(apiError(429))).toEqual({ statusCode: 429, retryAfterMs: null });
    expect(capacityRefusalOf(apiError(529))?.statusCode).toBe(529);
    expect(capacityRefusalOf(apiError(500))).toBeNull();
    expect(capacityRefusalOf(new Error("socket hang up"))).toBeNull();
  });

  it("finds a refusal the SDK or the agent loop wrapped", () => {
    const wrapped = new RetryError({
      message: "gave up",
      reason: "maxRetriesExceeded",
      errors: [apiError(429, { "retry-after": "7" })],
    });
    expect(capacityRefusalOf(wrapped)).toEqual({ statusCode: 429, retryAfterMs: 7000 });
    const nested = new Error("tool failed", { cause: new Error("step", { cause: apiError(429) }) });
    expect(capacityRefusalOf(nested)?.statusCode).toBe(429);
  });
});

describe("retryAfterMsOf", () => {
  it("reads milliseconds, seconds and HTTP dates", () => {
    expect(retryAfterMsOf({ "retry-after-ms": "1500" })).toBe(1500);
    expect(retryAfterMsOf({ "Retry-After": "3" })).toBe(3000);
    const at = new Date(Date.now() + 10_000).toUTCString();
    expect(retryAfterMsOf({ "retry-after": at })).toBeGreaterThan(8_000);
    expect(retryAfterMsOf({ "retry-after": "soon" })).toBeNull();
    expect(retryAfterMsOf(undefined)).toBeNull();
  });
});

describe("capacityBackoffMs", () => {
  it("spreads a crowd across the exponential window", () => {
    const policy = INTERACTIVE_RATE_LIMIT_RETRY;
    expect(capacityBackoffMs(0, null, policy, () => 0.999)).toBeLessThan(1_000);
    expect(capacityBackoffMs(3, null, policy, () => 0.999)).toBeLessThan(8_000);
    // The window stops growing at maxDelayMs.
    expect(capacityBackoffMs(10, null, policy, () => 0.999)).toBeLessThan(16_000);
    expect(capacityBackoffMs(2, null, policy, () => 0)).toBe(0);
  });

  it("treats Retry-After as a floor and still jitters above it", () => {
    const policy = INTERACTIVE_RATE_LIMIT_RETRY;
    expect(capacityBackoffMs(0, 5_000, policy, () => 0)).toBe(5_000);
    expect(capacityBackoffMs(0, 5_000, policy, () => 0.5)).toBe(5_500);
  });
});

describe("retryOnCapacityRefusal", () => {
  it("retries a 429 and returns the eventual answer", async () => {
    const call = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(apiError(429))
      .mockRejectedValueOnce(apiError(529))
      .mockResolvedValue("ok");
    await expect(retryOnCapacityRefusal(call, noSleep)).resolves.toBe("ok");
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("leaves every other error to the SDK's own retry", async () => {
    const failure = apiError(500);
    const call = vi.fn(async () => {
      throw failure;
    });
    await expect(retryOnCapacityRefusal(call, noSleep)).rejects.toBe(failure);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("gives up with a non-APICallError so the SDK does not retry again", async () => {
    const call = vi.fn(async () => {
      throw apiError(429, { "retry-after": "2" });
    });
    const error = await retryOnCapacityRefusal(call, noSleep).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderRateLimitedError);
    expect(APICallError.isInstance(error)).toBe(false);
    expect(error.retryAfterMs).toBe(2000);
    expect(call).toHaveBeenCalledTimes(INTERACTIVE_RATE_LIMIT_RETRY.retries + 1);
  });

  it("stops early when the provider asks for more than the wait budget", async () => {
    const call = vi.fn(async () => {
      throw apiError(429, { "retry-after": "120" });
    });
    await expect(retryOnCapacityRefusal(call, noSleep)).rejects.toBeInstanceOf(
      ProviderRateLimitedError
    );
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("does not retry once the turn was aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const refusal = apiError(429);
    const call = vi.fn(async () => {
      throw refusal;
    });
    await expect(
      retryOnCapacityRefusal(call, { ...noSleep, signal: controller.signal })
    ).rejects.toBe(refusal);
    expect(call).toHaveBeenCalledTimes(1);
  });
});
