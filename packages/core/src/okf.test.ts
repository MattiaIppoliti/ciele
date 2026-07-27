import { describe, expect, it } from "vitest";
import {
  OKF_VERSION,
  conceptGeneratedAt,
  conceptStatus,
  isHumanActor,
  isStale,
  lastVerifiedAt,
  okfActor,
  trustTier,
  verificationEvents,
  type ConceptFrontmatter,
} from "./okf";

const bare: ConceptFrontmatter = { type: "FAQ" };

describe("OKF version", () => {
  it("declares v0.2", () => {
    expect(OKF_VERSION).toBe("0.2");
  });
});

describe("actor convention (§7)", () => {
  it("builds the three actor forms", () => {
    expect(okfActor.human("ahormati")).toBe("human:ahormati");
    expect(okfActor.process("finance-nightly")).toBe("process:finance-nightly");
    expect(okfActor.agent("okf-enricher", "claude-opus-5")).toBe(
      "okf-enricher/claude-opus-5"
    );
  });

  it("classifies people by the human: prefix only", () => {
    expect(isHumanActor("human:ahormati")).toBe(true);
    expect(isHumanActor("process:nightly")).toBe(false);
    // The prefix is load-bearing: a look-alike must NOT read as a person, or a
    // machine stamp would silently claim the human-reviewed tier.
    expect(isHumanActor("humanoid/v1")).toBe(false);
    expect(isHumanActor("reviewer-human:x")).toBe(false);
  });
});

describe("verificationEvents (§5.2)", () => {
  it("reads a bare mapping as a one-element list — a §11 MUST", () => {
    expect(
      verificationEvents({ verified: { by: "human:a", at: "2026-06-25T09:00:00Z" } })
    ).toEqual([{ by: "human:a", at: "2026-06-25T09:00:00Z" }]);
  });

  it("passes a list through and treats absence as no events", () => {
    const events = [{ by: "human:a" }, { by: "process:nightly" }];
    expect(verificationEvents({ verified: events })).toEqual(events);
    expect(verificationEvents(bare)).toEqual([]);
  });

  it("drops entries with no actor rather than inventing one", () => {
    expect(
      verificationEvents({ verified: [{ by: "" }, { by: "human:a" }] })
    ).toEqual([{ by: "human:a" }]);
  });
});

describe("trustTier (§5.3)", () => {
  it("is unverified with no verified key", () => {
    expect(trustTier(bare)).toBe("unverified");
  });

  it("is machine-confirmed for non-human actors only", () => {
    expect(trustTier({ verified: [{ by: "process:finance-nightly" }] })).toBe(
      "machine-confirmed"
    );
    expect(trustTier({ verified: { by: "reference_agent/gemini-2.5-pro" } })).toBe(
      "machine-confirmed"
    );
  });

  it("is human-reviewed when any event has a human actor", () => {
    expect(
      trustTier({ verified: [{ by: "process:nightly" }, { by: "human:a" }] })
    ).toBe("human-reviewed");
  });

  it("never rejects a concept carrying no trust frontmatter (§11)", () => {
    expect(() => trustTier({ type: "Metric" } as ConceptFrontmatter)).not.toThrow();
  });
});

describe("lastVerifiedAt (§5.2 'how recently')", () => {
  it("returns the latest at across independent checks", () => {
    expect(
      lastVerifiedAt({
        verified: [
          { by: "human:a", at: "2026-06-25T09:00:00Z" },
          { by: "process:nightly", at: "2026-06-26T02:00:00Z" },
        ],
      })
    ).toBe("2026-06-26T02:00:00Z");
  });

  it("is null when verified events carry no timestamp", () => {
    expect(lastVerifiedAt({ verified: [{ by: "human:a" }] })).toBeNull();
    expect(lastVerifiedAt(bare)).toBeNull();
  });
});

describe("conceptGeneratedAt (§13.1 legacy fallback)", () => {
  it("prefers generated.at", () => {
    expect(
      conceptGeneratedAt({
        generated: { by: "human:a", at: "2026-06-20T22:53:05Z" },
        timestamp: "2026-01-01T00:00:00Z",
      })
    ).toBe("2026-06-20T22:53:05Z");
  });

  it("falls back to a v0.1 timestamp so pre-upgrade rows stay readable", () => {
    expect(conceptGeneratedAt({ timestamp: "2026-01-01T00:00:00Z" })).toBe(
      "2026-01-01T00:00:00Z"
    );
  });

  it("is null when neither is present", () => {
    expect(conceptGeneratedAt(bare)).toBeNull();
  });
});

describe("conceptStatus (§5.4)", () => {
  it("defaults an absent status to stable", () => {
    expect(conceptStatus(bare)).toBe("stable");
  });

  it("passes an explicit status through", () => {
    expect(conceptStatus({ status: "deprecated" })).toBe("deprecated");
  });
});

describe("isStale (§5.5)", () => {
  it("is stale on and after the date, never before", () => {
    expect(isStale({ stale_after: "2026-09-23" }, "2026-09-22")).toBe(false);
    expect(isStale({ stale_after: "2026-09-23" }, "2026-09-23")).toBe(true);
    expect(isStale({ stale_after: "2026-09-23" }, "2026-09-24")).toBe(true);
  });

  it("is never stale without a stale_after", () => {
    expect(isStale(bare, "2099-01-01")).toBe(false);
  });
});
