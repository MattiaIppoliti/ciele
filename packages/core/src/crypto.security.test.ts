import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  isLegacyPlaintextSecret,
  openSecret,
  sealSecret,
} from "./crypto";

/**
 * Sealing is the only thing standing between a stored provider credential and
 * anyone who can read the row, so the properties worth pinning are: a
 * round-trip returns the input, two seals of the same plaintext differ (fresh
 * IV), a tampered ciphertext throws rather than returning garbage, and an
 * unconfigured deployment refuses the write instead of downgrading it.
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

  it("produces a different ciphertext each time, the IV is fresh per call", () => {
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

  it("refuses the write when no key is configured, rather than storing plaintext", () => {
    // #801 CYB-02. The old fallback wrote `plain:<secret>` and warned, which
    // turned a missing env var into a silent, permanent plaintext credential
    // store. A refused save is loud; an unencrypted row is not.
    delete process.env.APP_ENCRYPTION_KEY;
    expect(() => sealSecret("sk-live-1234")).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it("still opens a legacy marked plaintext row, so it can be rotated", () => {
    // Rows written before the fallback was removed must stay readable, or a
    // deployment that sets a key for the first time loses every credential it
    // would otherwise re-seal. They must not be run through the decipher.
    expect(openSecret("plain:sk-legacy")).toBe("sk-legacy");
    expect(isLegacyPlaintextSecret("plain:sk-legacy")).toBe(true);
    expect(isLegacyPlaintextSecret(sealSecret("sk-live-1234"))).toBe(false);
  });
});
