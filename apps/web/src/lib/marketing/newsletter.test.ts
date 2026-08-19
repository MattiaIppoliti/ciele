import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONFIRMATION_TTL_MS,
  confirmationSigningConfigured,
  mintConfirmationToken,
  newsletterConfirmationEmail,
  validateNewsletterEmail,
  verifyConfirmationToken,
} from "./newsletter";

describe("validateNewsletterEmail", () => {
  it("trims and lower-cases so one mailbox cannot enter the list twice", () => {
    expect(validateNewsletterEmail("  Dean@Example.EDU ")).toEqual({
      ok: true,
      email: "dean@example.edu",
    });
  });

  it("rejects empties, non-strings and anything without a domain dot", () => {
    for (const raw of ["", "   ", undefined, 42, "dean", "dean@example"]) {
      expect(validateNewsletterEmail(raw).ok).toBe(false);
    }
  });

  it("rejects an address past the RFC ceiling", () => {
    expect(validateNewsletterEmail(`${"a".repeat(250)}@example.edu`).ok).toBe(false);
  });
});

describe("confirmation tokens", () => {
  beforeEach(() => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "test-signing-secret");
  });

  it("round-trips the address", () => {
    const token = mintConfirmationToken("dean@example.edu");
    expect(verifyConfirmationToken(token)).toEqual({
      ok: true,
      email: "dean@example.edu",
    });
  });

  it("reports a malformed token instead of throwing", () => {
    for (const token of ["", "nodot", undefined, 7, "a.b.c.d"]) {
      expect(verifyConfirmationToken(token).ok).toBe(false);
    }
  });

  it("refuses a token whose payload was edited", () => {
    const token = mintConfirmationToken("dean@example.edu");
    const [, signature] = token.split(".");
    const forged = `${Buffer.from(`${Date.now() + 1000}:attacker@example.com`).toString("base64url")}.${signature}`;
    expect(verifyConfirmationToken(forged)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("refuses a token signed with a different key", () => {
    const token = mintConfirmationToken("dean@example.edu");
    vi.stubEnv("APP_ENCRYPTION_KEY", "a-different-secret");
    expect(verifyConfirmationToken(token)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("expires 48 hours after minting, and the expiry is inside the signature", () => {
    const now = new Date("2026-08-19T10:00:00Z");
    const token = mintConfirmationToken("dean@example.edu", { now });

    const stillValid = new Date(now.getTime() + CONFIRMATION_TTL_MS - 1000);
    expect(verifyConfirmationToken(token, { now: stillValid }).ok).toBe(true);

    const tooLate = new Date(now.getTime() + CONFIRMATION_TTL_MS + 1000);
    expect(verifyConfirmationToken(token, { now: tooLate })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("throws rather than minting a forgeable link with no key", () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "");
    expect(confirmationSigningConfigured()).toBe(false);
    expect(() => mintConfirmationToken("dean@example.edu")).toThrow(
      /APP_ENCRYPTION_KEY/
    );
  });
});

describe("newsletterConfirmationEmail", () => {
  it("carries the link and tells a non-subscriber that ignoring it is enough", () => {
    const email = newsletterConfirmationEmail({
      to: "dean@example.edu",
      confirmUrl: "https://platform.ciele.app/newsletter/confirm?token=abc",
    });
    expect(email.to).toBe("dean@example.edu");
    expect(email.body).toContain("https://platform.ciele.app/newsletter/confirm?token=abc");
    expect(email.body).toContain("ignore this email");
  });
});

describe("verification with no signing key", () => {
  it("reports unconfigured instead of throwing on a page reached from an inbox", () => {
    vi.stubEnv("APP_ENCRYPTION_KEY", "");
    expect(verifyConfirmationToken("payload.signature")).toEqual({
      ok: false,
      reason: "unconfigured",
    });
  });
});

describe("the confirmation email's HTML part", () => {
  const email = newsletterConfirmationEmail({
    to: "dean@example.edu",
    confirmUrl: "https://platform.ciele.app/newsletter/confirm?token=abc&x=1",
  });

  it("carries the same link as the text part, escaped", () => {
    expect(email.html).toContain(
      "https://platform.ciele.app/newsletter/confirm?token=abc&amp;x=1"
    );
    expect(email.body).toContain(
      "https://platform.ciele.app/newsletter/confirm?token=abc&x=1"
    );
  });

  it("keeps a text part, which is what a text-only client and a spam filter read", () => {
    expect(email.body.length).toBeGreaterThan(0);
    expect(email.body).not.toContain("<");
  });

  it("wears the brand shell", () => {
    expect(email.html).toContain(">Ciele</a>");
    expect(email.html).toContain("Confirm subscription");
  });
});
