import { describe, expect, it } from "vitest";
import {
  APPLICATION_OAUTH_DEFAULT_SCOPES,
  applicationOAuthScopes,
  invalidApplicationOAuthScope,
} from "./application-oauth";

/**
 * A Connector re-consent (#839) widens a grant: the request is the provider's
 * defaults plus the extra scopes, never a replacement, and never anything
 * that could splice into the provider's query string.
 */
describe("applicationOAuthScopes", () => {
  it("returns the defaults for a fresh authorization", () => {
    expect(applicationOAuthScopes({ provider: "slack" })).toEqual(
      APPLICATION_OAUTH_DEFAULT_SCOPES.slack
    );
  });

  it("unions extra scopes after the defaults, deduplicated", () => {
    expect(
      applicationOAuthScopes({
        provider: "slack",
        scopes: ["chat:write", "channels:read", " chat:write ", ""],
      })
    ).toEqual([...APPLICATION_OAUTH_DEFAULT_SCOPES.slack, "chat:write"]);
  });

  it("refuses a scope carrying whitespace or a comma", () => {
    expect(() =>
      applicationOAuthScopes({ provider: "slack", scopes: ["chat:write users:read"] })
    ).toThrow(/Invalid OAuth scope/);
    expect(() =>
      applicationOAuthScopes({ provider: "salesforce", scopes: ["api,web"] })
    ).toThrow(/Invalid OAuth scope/);
  });
});

/**
 * The same rule as a question rather than a throw, so the start route can
 * answer a caller's typo with a 400 before any I/O instead of the 503 the
 * throw used to surface as from inside the authorization URL builder.
 */
describe("invalidApplicationOAuthScope", () => {
  it("names the first offending scope", () => {
    expect(invalidApplicationOAuthScope(["chat:write", "a b", "c,d"])).toBe("a b");
    expect(invalidApplicationOAuthScope(["c,d"])).toBe("c,d");
    expect(invalidApplicationOAuthScope(["x".repeat(201)])).toBe("x".repeat(201));
  });

  it("accepts bare tokens, blanks and nothing at all", () => {
    expect(invalidApplicationOAuthScope(["chat:write", " users:read ", ""])).toBeNull();
    expect(invalidApplicationOAuthScope([])).toBeNull();
    expect(invalidApplicationOAuthScope(undefined)).toBeNull();
  });

  it("agrees with applicationOAuthScopes about what is refused", () => {
    for (const scopes of [["ok"], ["a b"], ["a,b"], [" trimmed "]]) {
      const invalid = invalidApplicationOAuthScope(scopes) !== null;
      const throws = (() => {
        try {
          applicationOAuthScopes({ provider: "slack", scopes });
          return false;
        } catch {
          return true;
        }
      })();
      expect(throws).toBe(invalid);
    }
  });
});
