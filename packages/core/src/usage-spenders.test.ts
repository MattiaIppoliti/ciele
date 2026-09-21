import { describe, expect, it } from "vitest";
import type { UsageSpenderRow } from "./types";
import { rankSpenders, spenderDimensions } from "./usage-spenders";

/**
 * A Gemini Flash row costs a known number of credits, so the expectations below
 * are ratios rather than magic numbers: what matters is that the pivot adds the
 * right rows together, not what Google charges.
 */
function row(over: Partial<UsageSpenderRow> = {}): UsageSpenderRow {
  return {
    spenders: {},
    assistantId: null,
    surface: null,
    credentialKind: "platform",
    provider: "google",
    modelId: "gemini-2.5-flash",
    calls: 1,
    inputTokens: 1_000_000,
    outputTokens: 0,
    units: 0,
    ...over,
  };
}

describe("rankSpenders", () => {
  it("groups by the requested dimension and sums credits", () => {
    const ranked = rankSpenders(
      [
        row({ spenders: { teammateId: "t-ada" } }),
        row({ spenders: { teammateId: "t-ada" } }),
        row({ spenders: { teammateId: "t-bo" } }),
      ],
      "teammate"
    );
    expect(ranked.map((r) => r.id)).toEqual(["t-ada", "t-bo"]);
    expect(ranked[0].credits).toBeCloseTo(ranked[1].credits * 2);
    expect(ranked[0].calls).toBe(2);
  });

  it("ranks by credits spent, not by call count", () => {
    const ranked = rankSpenders(
      [
        row({ spenders: { memberId: "m-cheap" }, calls: 9, inputTokens: 1_000 }),
        row({ spenders: { memberId: "m-dear" }, calls: 1 }),
      ],
      "member"
    );
    expect(ranked.map((r) => r.id)).toEqual(["m-dear", "m-cheap"]);
  });

  it("splits platform-funded from the customer's own credentials", () => {
    const [entry] = rankSpenders(
      [
        row({ spenders: { teammateId: "t-ada" } }),
        row({ spenders: { teammateId: "t-ada" }, credentialKind: "api_key" }),
        row({
          spenders: { teammateId: "t-ada" },
          credentialKind: "local_subscription",
        }),
      ],
      "teammate"
    );
    // Everything but `platform` is the customer's own cost: it is attributed
    // here and counted against no meter anywhere.
    expect(entry.ownCredits).toBeCloseTo(entry.platformCredits * 2);
    expect(entry.credits).toBeCloseTo(entry.platformCredits * 3);
  });

  it("collects rows with no value for the dimension as one unattributed entry", () => {
    const ranked = rankSpenders(
      [
        row({ spenders: { teammateId: "t-ada" } }),
        row({ spenders: { memberId: "m-mattia" } }),
        row(),
      ],
      "teammate"
    );
    expect(ranked).toHaveLength(2);
    const unattributed = ranked.find((r) => r.id === null);
    // A Member-attributed row still has no Teammate, so it is unattributed on
    // this dimension: hiding it would make the column stop adding up.
    expect(unattributed?.calls).toBe(2);
  });

  it("omits the unattributed entry when every row is attributed", () => {
    const ranked = rankSpenders(
      [row({ spenders: { teammateId: "t-ada" } })],
      "teammate"
    );
    expect(ranked.every((r) => r.id !== null)).toBe(true);
  });

  it("reads the Assistant from its own column rather than the spender tuple", () => {
    const [entry] = rankSpenders([row({ assistantId: "a-support" })], "assistant");
    expect(entry.id).toBe("a-support");
  });

  it("prices crawled pages, which have no tokens", () => {
    const [entry] = rankSpenders(
      [
        row({
          spenders: { memberId: "m-mattia" },
          provider: "apify",
          modelId: "",
          inputTokens: 0,
          outputTokens: 0,
          units: 100,
        }),
      ],
      "member"
    );
    expect(entry.credits).toBeGreaterThan(0);
  });

  it("totals one dimension without double counting a row attributed twice", () => {
    // A Teammate turn names both the Teammate and the Member who asked. Summing
    // a single dimension must count it once; summing across dimensions is what
    // the pivot exists to prevent.
    const rows = [row({ spenders: { teammateId: "t-ada", memberId: "m-mattia" } })];
    const byTeammate = rankSpenders(rows, "teammate");
    const byMember = rankSpenders(rows, "member");
    expect(byTeammate).toHaveLength(1);
    expect(byMember).toHaveLength(1);
    expect(byTeammate[0].credits).toBeCloseTo(byMember[0].credits);
  });

  it("offers every dimension the ledger can attribute", () => {
    expect(spenderDimensions).toEqual([
      "assistant",
      "teammate",
      "member",
      "api_key",
      "routine",
      "flow",
    ]);
  });
});
