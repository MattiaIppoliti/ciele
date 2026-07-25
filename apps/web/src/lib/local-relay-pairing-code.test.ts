import { describe, expect, it } from "vitest";
import {
  createRelayPairingCode,
  verifyRelayPairingCode,
} from "./local-relay-pairing-code";

const secret = "service-role-secret";
const origin = "https://ciele.example.com";

describe("relay pairing codes", () => {
  it("creates a URL-safe authenticated 43-character code", () => {
    const code = createRelayPairingCode({ origin, secret });

    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyRelayPairingCode({ code, origin, secret })).toBe(true);
  });

  it("rejects a valid-looking code that was not minted by Ciele", () => {
    expect(
      verifyRelayPairingCode({ code: "a".repeat(43), origin, secret })
    ).toBe(false);
  });

  it("binds the code to the Ciele origin", () => {
    const code = createRelayPairingCode({ origin, secret });

    expect(
      verifyRelayPairingCode({
        code,
        origin: "https://other.example.com",
        secret,
      })
    ).toBe(false);
  });

  it("rejects a code signed with another server secret", () => {
    const code = createRelayPairingCode({ origin, secret });

    expect(
      verifyRelayPairingCode({ code, origin, secret: "different-secret" })
    ).toBe(false);
  });
});
