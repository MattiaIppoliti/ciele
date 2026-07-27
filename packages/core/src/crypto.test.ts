import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, openSecret, sealSecret } from "./crypto";

/**
 * Sealing is the only thing standing between a stored provider credential and
 * anyone who can read the row, so the properties worth pinning are: a
 * round-trip returns the input, two seals of the same plaintext differ (fresh
 * IV), a tampered ciphertext throws rather than returning garbage, and the
 * unconfigured fallback is *marked* so `openSecret` can tell the two apart.
 */

const KEY = "test-encryption-key";

beforeEach(() => {
  process.env.APP_ENCRYPTION_KEY = KEY;
});

afterEach(() => {
  delete process.env.APP_ENCRYPTION_KEY;
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a secret", () => {
    expect(decryptSecret(encryptSecret("sk-live-1234"))).toBe("sk-live-1234");
  });

  it("round-trips unicode and empty strings", () => {
    expect(decryptSecret(encryptSecret("clé—🔐"))).toBe("clé—🔐");
    expect(decryptSecret(encryptSecret(""))).toBe("");
  });

  it("produces a different ciphertext each time — the IV is fresh per call", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("rejects a tampered ciphertext instead of returning wrong plaintext", () => {
    const [iv, tag, data] = encryptSecret("sk-live-1234").split(".");
    const flipped = Buffer.from(data!, "base64");
    flipped[0] = flipped[0]! ^ 0xff;
    expect(() =>
      decryptSecret(`${iv}.${tag}.${flipped.toString("base64")}`)
    ).toThrow();
  });

  it("refuses to run without APP_ENCRYPTION_KEY", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it("cannot decrypt with a different key", () => {
    const sealed = encryptSecret("sk-live-1234");
    process.env.APP_ENCRYPTION_KEY = "a-different-key";
    expect(() => decryptSecret(sealed)).toThrow();
  });
});

describe("sealSecret / openSecret", () => {
  it("round-trips through the encrypted path when a key is configured", () => {
    const sealed = sealSecret("sk-live-1234");
    expect(sealed.startsWith("plain:")).toBe(false);
    expect(openSecret(sealed)).toBe("sk-live-1234");
  });

  it("falls back to a MARKED plaintext when no key is configured", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    const sealed = sealSecret("sk-live-1234");
    // The marker is what lets openSecret read pre-key rows after a key is set.
    expect(sealed).toBe("plain:sk-live-1234");
    expect(openSecret(sealed)).toBe("sk-live-1234");
  });

  it("still opens a marked plaintext row once a key is configured", () => {
    // The rollout case: rows written before APP_ENCRYPTION_KEY existed must stay
    // readable, and must not be run through the decipher.
    expect(openSecret("plain:sk-legacy")).toBe("sk-legacy");
  });
});
