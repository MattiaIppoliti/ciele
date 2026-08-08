import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  gateForOrg,
  isGateValidForOrg,
  openGate,
  openTxn,
  sealGate,
  sealTxn,
  type SsoGatePayload,
  type SsoTxnPayload,
} from "./session";

const txn: SsoTxnPayload = {
  state: "s",
  nonce: "n",
  codeVerifier: "v",
  redirectUri: "https://platform.ciele.app/api/sso/entra/callback",
  assistantId: "a1",
  organizationId: "org-1",
  provider: "entra",
};

const gate: SsoGatePayload = {
  organizationId: "org-1",
  subjectId: "sub-1",
  provider: "entra",
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const priorKey = process.env.APP_ENCRYPTION_KEY;
afterEach(() => {
  if (priorKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
  else process.env.APP_ENCRYPTION_KEY = priorKey;
});

describe("SSO cookie sealing", () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = "test-encryption-key";
  });

  it("round-trips a sealed transient", () => {
    expect(openTxn(sealTxn(txn))).toEqual(txn);
  });

  it("round-trips a sealed gate", () => {
    expect(openGate(sealGate(gate))).toEqual(gate);
  });

  it("rejects an expired gate even if the cookie is intact", () => {
    const sealed = sealGate({ ...gate, exp: Math.floor(Date.now() / 1000) - 1 });
    expect(openGate(sealed)).toBeNull();
  });

  it("never trusts an unsigned (plain:) cookie value", () => {
    // A forged, unencrypted payload must not be accepted as a gate.
    const forged = `plain:${JSON.stringify(gate)}`;
    expect(openGate(forged)).toBeNull();
    expect(openTxn(forged)).toBeNull();
  });

  it("refuses to mint cookies without an encryption key", () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(() => sealGate(gate)).toThrow(/APP_ENCRYPTION_KEY/);
    expect(() => sealTxn(txn)).toThrow(/APP_ENCRYPTION_KEY/);
  });

  describe("isGateValidForOrg", () => {
    it("accepts a valid gate for the matching org", () => {
      expect(isGateValidForOrg(sealGate(gate), "org-1")).toBe(true);
    });
    it("rejects a gate for a different org", () => {
      expect(isGateValidForOrg(sealGate(gate), "org-2")).toBe(false);
    });
    it("rejects a missing or expired gate", () => {
      expect(isGateValidForOrg(undefined, "org-1")).toBe(false);
      const expired = sealGate({ ...gate, exp: Math.floor(Date.now() / 1000) - 1 });
      expect(isGateValidForOrg(expired, "org-1")).toBe(false);
    });
    it("never trusts an unsigned gate value", () => {
      expect(isGateValidForOrg(`plain:${JSON.stringify(gate)}`, "org-1")).toBe(false);
    });
  });

  describe("gateForOrg (#662)", () => {
    it("returns the full payload, identity claim included", () => {
      const withClaim: SsoGatePayload = {
        ...gate,
        claim: { name: "email", value: "person@example.com" },
      };
      expect(gateForOrg(sealGate(withClaim), "org-1")).toEqual(withClaim);
    });
    it("returns a claim-free payload as-is", () => {
      expect(gateForOrg(sealGate(gate), "org-1")).toEqual(gate);
    });
    it("rejects an org mismatch and an expired gate", () => {
      expect(gateForOrg(sealGate(gate), "org-2")).toBeNull();
      const expired = sealGate({ ...gate, exp: Math.floor(Date.now() / 1000) - 1 });
      expect(gateForOrg(expired, "org-1")).toBeNull();
      expect(gateForOrg(undefined, "org-1")).toBeNull();
    });
  });
});
