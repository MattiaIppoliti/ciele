import { describe, expect, it } from "vitest";
import { isKnowledgeMemoryLive, isMemoryLive } from "./memory";

describe("isKnowledgeMemoryLive", () => {
  it("is live until it is forgotten, and live again when that is cleared", () => {
    expect(isKnowledgeMemoryLive({ forgottenAt: null })).toBe(true);
    expect(isKnowledgeMemoryLive({ forgottenAt: "2026-09-20T10:00:00Z" })).toBe(
      false
    );
  });

  it("delegates to the one predicate rather than re-checking the column", () => {
    // The two constants a page-scoped memory implies, asserted where they are
    // named: no version chain, so it is always the latest, and no clock.
    const forgotten = { isLatest: true, forgottenAt: "2026-09-20T10:00:00Z", forgetAfter: null };
    expect(isMemoryLive(forgotten)).toBe(isKnowledgeMemoryLive(forgotten));

    // The other two halves of the shared rule, which a knowledge memory never
    // exercises but the subject memories on ADR-0023's branch do.
    expect(isMemoryLive({ isLatest: false, forgottenAt: null, forgetAfter: null })).toBe(
      false
    );
    expect(
      isMemoryLive(
        { isLatest: true, forgottenAt: null, forgetAfter: "2026-09-01T00:00:00Z" },
        new Date("2026-09-20T00:00:00Z")
      )
    ).toBe(false);
  });
});
