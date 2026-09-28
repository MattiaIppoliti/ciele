import { describe, expect, it } from "vitest";
import type { ApiKeyContext } from "@/lib/api-v1/auth";
import { apiRateLimited } from "@/lib/api-v1/http";
import { perKeyThrottle } from "./throttle";

const key = (keyId: string) => ({ keyId }) as ApiKeyContext;

describe("perKeyThrottle", () => {
  it("lets a key spend its budget, then answers the shared 429 envelope", async () => {
    const throttle = perKeyThrottle("assistant-ask", { limit: 3, message: "Too many" });
    for (let i = 0; i < 3; i += 1) expect(throttle(key("k1"))).toBeNull();
    const refused = throttle(key("k1"));
    expect(refused?.status).toBe(429);
    expect(await refused!.json()).toEqual({
      error: { code: "rate_limited", message: "Too many" },
    });
    expect(Number(refused!.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("keeps one window per key", () => {
    const throttle = perKeyThrottle("knowledge-search", { limit: 1, message: "Too many" });
    expect(throttle(key("a"))).toBeNull();
    expect(throttle(key("a"))?.status).toBe(429);
    expect(throttle(key("b"))).toBeNull();
  });
});

describe("apiRateLimited", () => {
  it("never tells a client to wait zero seconds", () => {
    expect(apiRateLimited("wait", 0).headers.get("retry-after")).toBe("1");
    expect(apiRateLimited("wait", 1).headers.get("retry-after")).toBe("1");
    expect(apiRateLimited("wait", 2_500).headers.get("retry-after")).toBe("3");
  });
});
