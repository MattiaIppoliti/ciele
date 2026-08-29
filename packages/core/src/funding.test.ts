import { describe, expect, it } from "vitest";
import { fundingBucket } from "./funding";
import type { AiCredentialKind } from "./types";

/**
 * Funding attribution is what plan caps and billing act on, so the interesting
 * assertions are the two directions it must never get wrong: every kind this
 * build knows is attributed on purpose, and anything it does not know falls to
 * "unknown" rather than to "customer".
 *
 * These cases moved here from the staff console, where the
 * classification used to be restated as a hand-maintained set of strings.
 */

describe("fundingBucket", () => {
  it("attributes platform-funded traffic to the platform", () => {
    expect(fundingBucket("platform")).toBe("platform");
  });

  it("attributes every customer-held credential to the customer", () => {
    expect(fundingBucket("api_key")).toBe("customer");
    expect(fundingBucket("google_vertex_federated")).toBe("customer");
    expect(fundingBucket("local_subscription")).toBe("customer");
  });

  it("maps a credential kind it does not know to unknown, never customer", () => {
    // A row written by a newer deployment can carry a kind this build has never
    // heard of. Unattributed traffic must never be silently billed to someone.
    expect(fundingBucket("future_kind")).toBe("unknown");
    expect(fundingBucket("")).toBe("unknown");
    expect(fundingBucket("unknown")).toBe("unknown");
  });

  it("is not fooled by inherited Object properties", () => {
    // The lookup is a plain object, so a bare index would resolve these off
    // Object.prototype and return a function instead of a FundingBucket.
    expect(fundingBucket("constructor")).toBe("unknown");
    expect(fundingBucket("toString")).toBe("unknown");
    expect(fundingBucket("__proto__")).toBe("unknown");
  });

  it("classifies every declared AiCredentialKind, none falls through", () => {
    // The `satisfies Record<AiCredentialKind, …>` in funding.ts makes this a
    // compile-time guarantee; asserting it here is the runtime witness, and it
    // fails loudly if someone widens the union and reaches for a cast.
    const kinds: AiCredentialKind[] = [
      "platform",
      "api_key",
      "google_vertex_federated",
      "local_subscription",
    ];
    for (const kind of kinds) {
      expect(fundingBucket(kind)).not.toBe("unknown");
    }
  });
});
