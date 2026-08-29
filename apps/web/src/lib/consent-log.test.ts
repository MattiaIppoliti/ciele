import { describe, expect, it } from "vitest";
import {
  CONSENT_LOG_LIMITS,
  isKnownCategory,
  parseConsentRecord,
  sanitizePageUrl,
  sanitizeUserAgent,
} from "./consent-log";
import { CONSENT_CATEGORIES } from "./cookie-consent";

/**
 * The consent-log endpoint is public and unauthenticated, so this parser is a
 * trust boundary. Everything below is an assertion about hostile input.
 */

const valid = {
  consentId: "6f0d5a2e-1c3b-4a7d-9e11-2b6c8f4a0d33",
  revision: 1,
  acceptedCategories: ["necessary", "analytics"],
  rejectedCategories: ["functional"],
  acceptType: "custom",
  action: "granted",
  consentedAt: "2026-07-26T12:00:00.000Z",
  pageUrl: "https://ciele.app/home",
};

const noHeaders = { userAgent: null };

describe("accepting a well-formed decision", () => {
  it("keeps the decision verbatim", () => {
    const record = parseConsentRecord(valid, { userAgent: "Mozilla/5.0" });
    expect(record).toMatchObject({
      consentId: valid.consentId,
      revision: 1,
      acceptedCategories: ["necessary", "analytics"],
      rejectedCategories: ["functional"],
      acceptType: "custom",
      action: "granted",
      consentedAt: valid.consentedAt,
      pageUrl: "https://ciele.app/home",
      userAgent: "Mozilla/5.0",
    });
  });

  it("records a withdrawal as its own decision", () => {
    const record = parseConsentRecord(
      {
        ...valid,
        action: "changed",
        acceptType: "necessary",
        acceptedCategories: ["necessary"],
        rejectedCategories: ["functional", "analytics"],
      },
      noHeaders
    );
    expect(record?.action).toBe("changed");
    expect(record?.rejectedCategories).toEqual(["functional", "analytics"]);
  });

  it("defaults the visitor's clock and context rather than failing", () => {
    const record = parseConsentRecord(
      { ...valid, consentedAt: undefined, pageUrl: undefined },
      noHeaders
    );
    expect(record?.consentedAt).toBeNull();
    expect(record?.pageUrl).toBe("");
    expect(record?.userAgent).toBe("");
  });
});

describe("rejecting malformed input", () => {
  it.each([
    ["a missing consent id", { ...valid, consentId: "" }],
    ["a non-string consent id", { ...valid, consentId: 42 }],
    ["a fractional revision", { ...valid, revision: 1.5 }],
    ["a negative revision", { ...valid, revision: -1 }],
    ["a made-up accept type", { ...valid, acceptType: "coerced" }],
    ["a made-up action", { ...valid, action: "deleted" }],
    ["a non-ISO timestamp", { ...valid, consentedAt: "yesterday" }],
    ["categories that are not an array", { ...valid, acceptedCategories: "all" }],
    ["a null body", null],
    ["a string body", "granted"],
    ["an empty object", {}],
  ])("refuses %s", (_label, body) => {
    expect(parseConsentRecord(body, noHeaders)).toBeNull();
  });

  it("refuses an over-long consent id rather than truncating it", () => {
    // Truncating would silently corrupt the one field that links the record to
    // the visitor's cookie, making the evidence useless.
    const body = { ...valid, consentId: "x".repeat(CONSENT_LOG_LIMITS.consentId + 1) };
    expect(parseConsentRecord(body, noHeaders)).toBeNull();
  });

  it("refuses a flood of categories", () => {
    const body = {
      ...valid,
      acceptedCategories: Array.from(
        { length: CONSENT_LOG_LIMITS.categories + 1 },
        () => "necessary"
      ),
    };
    expect(parseConsentRecord(body, noHeaders)).toBeNull();
  });
});

describe("category names are checked against the live declaration", () => {
  it("recognises every declared category", () => {
    for (const category of CONSENT_CATEGORIES) {
      expect(isKnownCategory(category.id)).toBe(true);
    }
  });

  it("drops invented categories instead of storing them", () => {
    const record = parseConsentRecord(
      { ...valid, acceptedCategories: ["necessary", "advertising", "<script>"] },
      noHeaders
    );
    // A stale tab on an older bundle still gets its real choice recorded; the
    // junk simply does not enter the log.
    expect(record?.acceptedCategories).toEqual(["necessary"]);
  });
});

describe("page URLs are minimised, not stored whole", () => {
  it("drops the query string and fragment", () => {
    // These routinely carry tokens, emails and search terms the record does not
    // need (Art. 5(1)(c)).
    expect(sanitizePageUrl("https://ciele.app/login?token=secret&email=a@b.c#frag")).toBe(
      "https://ciele.app/login"
    );
  });

  it("keeps origin and path", () => {
    expect(sanitizePageUrl("https://ciele.app/policies/cookies")).toBe(
      "https://ciele.app/policies/cookies"
    );
  });

  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,<script>"],
    ["file:///etc/passwd"],
    ["not a url"],
    [""],
  ])("refuses %s", (raw) => {
    expect(sanitizePageUrl(raw)).toBe("");
  });

  it("handles absent values", () => {
    expect(sanitizePageUrl(null)).toBe("");
    expect(sanitizePageUrl(undefined)).toBe("");
  });

  it("caps a pathological path", () => {
    const long = `https://ciele.app/${"a".repeat(2_000)}`;
    expect(sanitizePageUrl(long).length).toBeLessThanOrEqual(
      CONSENT_LOG_LIMITS.pageUrl
    );
  });
});

describe("user agent comes from the request, not the payload", () => {
  it("ignores a user agent supplied in the body", () => {
    const record = parseConsentRecord(
      { ...valid, userAgent: "spoofed" },
      { userAgent: "real-agent" }
    );
    expect(record?.userAgent).toBe("real-agent");
  });

  it("caps an absurd header", () => {
    const record = parseConsentRecord(valid, {
      userAgent: "u".repeat(CONSENT_LOG_LIMITS.userAgent + 500),
    });
    expect(record?.userAgent.length).toBe(CONSENT_LOG_LIMITS.userAgent);
  });

  it("handles an absent header", () => {
    expect(sanitizeUserAgent(null)).toBe("");
    expect(sanitizeUserAgent(undefined)).toBe("");
  });
});
