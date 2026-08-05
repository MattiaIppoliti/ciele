import { describe, expect, it } from "vitest";
import {
  API_KEY_PREFIX,
  apiKeySecretHint,
  generateApiKeySecret,
  hashApiKeySecret,
} from "./api-keys";

describe("organization API key secrets", () => {
  it("generates prefixed, URL-safe, unique secrets", () => {
    const a = generateApiKeySecret();
    const b = generateApiKeySecret();
    expect(a).toMatch(/^ciele_sk_[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
  });

  it("round-trips generate → hash → verify by hash equality", () => {
    const secret = generateApiKeySecret();
    const stored = hashApiKeySecret(secret);
    // Verification is a lookup: hashing the presented secret must reproduce
    // the stored hash, and nothing else may.
    expect(hashApiKeySecret(secret)).toBe(stored);
    expect(hashApiKeySecret(secret + "x")).not.toBe(stored);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(secret);
  });

  it("hint keeps only the prefix plus a few characters", () => {
    const secret = generateApiKeySecret();
    const hint = apiKeySecretHint(secret);
    expect(hint).toBe(secret.slice(0, API_KEY_PREFIX.length + 4));
    expect(hint.length).toBeLessThan(secret.length);
  });
});
