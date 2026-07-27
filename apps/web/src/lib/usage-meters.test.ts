import { describe, expect, it } from "vitest";
import type { UsageLimitsSnapshot, UsageMeterSnapshot } from "@/lib/runtime";
import {
  budgetMeterView,
  planGlanceRows,
  resetLabel,
  usageLimitsView,
  type MeterTone,
} from "./usage-meters";

const NOW = "2026-07-10T12:00:00.000Z";

const meter = (over: Partial<UsageMeterSnapshot> = {}): UsageMeterSnapshot => ({
  resource: "ai",
  window: {
    name: "week",
    from: "2026-07-08T00:00:00.000Z",
    to: "2026-07-15T00:00:00.000Z",
  },
  cap: 1_000,
  usedCredits: 100,
  ...over,
});

const monthWindow = {
  name: "month" as const,
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-08-01T00:00:00.000Z",
};

const snapshot = (meters: UsageMeterSnapshot[]): UsageLimitsSnapshot => ({
  plan: "business",
  meters,
});

describe("resetLabel", () => {
  it("counts whole days when the window is days away", () => {
    expect(resetLabel("2026-07-15T00:00:00.000Z", NOW)).toMatch(/in 4 days/);
  });

  it("says one day in the singular", () => {
    expect(resetLabel("2026-07-11T13:00:00.000Z", NOW)).toMatch(/in 1 day/);
  });

  it("counts hours when the window is closer than a day", () => {
    expect(resetLabel("2026-07-10T18:30:00.000Z", NOW)).toMatch(/in 6 hours/);
  });

  it("counts minutes in the last hour", () => {
    expect(resetLabel("2026-07-10T12:20:00.000Z", NOW)).toMatch(/in 20 minutes/);
  });

  it("says a passed window resets now, never a negative time", () => {
    // The window rolls over on the next request; showing "in -3 hours" would
    // read as a bug.
    expect(resetLabel("2026-07-10T09:00:00.000Z", NOW)).toBe("Resets now");
  });

  it("names the instant as well as the distance", () => {
    // An admin deciding whether to wait needs the actual time, in UTC, because
    // that is the frame every window in the product uses.
    const label = resetLabel("2026-07-15T00:00:00.000Z", NOW);
    expect(label).toMatch(/15 Jul/);
    expect(label).toMatch(/UTC/);
  });
});

describe("usageLimitsView — tones", () => {
  const toneAt = (usedCredits: number, cap = 100): MeterTone =>
    usageLimitsView(snapshot([meter({ cap, usedCredits })]), NOW).cards[0].rings[0]
      .tone;

  it("is calm below the warning threshold", () => {
    expect(toneAt(79)).toBe("ok");
  });

  it("turns amber at exactly the threshold the alert warns at", () => {
    expect(toneAt(80)).toBe("warn");
    expect(toneAt(99)).toBe("warn");
  });

  it("turns red at the cap and stays red past it", () => {
    expect(toneAt(100)).toBe("over");
    expect(toneAt(250)).toBe("over");
  });

  it("treats a zero cap as full, matching the ladder", () => {
    expect(toneAt(0, 0)).toBe("over");
  });

  it("reads an uncapped meter as calm, not as full", () => {
    const view = usageLimitsView(
      snapshot([meter({ cap: null, usedCredits: 9_999 })]),
      NOW
    );
    expect(view.cards[0].rings[0].tone).toBe("ok");
    expect(view.cards[0].rings[0].uncapped).toBe(true);
    expect(view.cards[0].rings[0].fraction).toBe(0);
  });

  it("takes a card's tone from its worst window", () => {
    const view = usageLimitsView(
      snapshot([
        meter({ cap: 100, usedCredits: 10 }),
        meter({ window: monthWindow, cap: 100, usedCredits: 100 }),
      ]),
      NOW
    );
    expect(view.cards[0].tone).toBe("over");
  });
});

describe("usageLimitsView — shape", () => {
  it("lists the three meters in plan order, whatever order they arrive in", () => {
    const view = usageLimitsView(
      snapshot([
        meter({ resource: "scraping" }),
        meter({ resource: "embedding" }),
        meter({ resource: "ai" }),
      ]),
      NOW
    );
    expect(view.cards.map((c) => c.resource)).toEqual([
      "ai",
      "embedding",
      "scraping",
    ]);
  });

  it("puts the week ring before the month ring", () => {
    const view = usageLimitsView(
      snapshot([meter({ window: monthWindow }), meter()]),
      NOW
    );
    expect(view.cards[0].rings.map((r) => r.window)).toEqual(["week", "month"]);
  });

  it("leads a card with the percentage of its tightest window", () => {
    // 60% of a week is more urgent than 20% of a month, and it is the number
    // that decides whether answering stops in the next few days.
    const view = usageLimitsView(
      snapshot([
        meter({ cap: 100, usedCredits: 60 }),
        meter({ window: monthWindow, cap: 1_000, usedCredits: 200 }),
      ]),
      NOW
    );
    expect(view.cards[0].leadPercent).toBe("60%");
  });

  it("shows credits used against credits included, rounded for reading", () => {
    const ring = usageLimitsView(
      snapshot([meter({ cap: 5_600, usedCredits: 1_234.56 })]),
      NOW
    ).cards[0].rings[0];
    expect(ring.usedLabel).toBe("1,235");
    expect(ring.capLabel).toBe("5,600");
  });

  it("labels an uncapped meter as uncapped rather than as a number", () => {
    const ring = usageLimitsView(
      snapshot([meter({ cap: null, usedCredits: 12 })]),
      NOW
    ).cards[0].rings[0];
    expect(ring.capLabel).toMatch(/no limit/i);
  });

  it("totals the month's credits across resources, with the plan named", () => {
    const view = usageLimitsView(
      snapshot([
        meter({ resource: "ai", window: monthWindow, cap: 100, usedCredits: 40 }),
        meter({
          resource: "scraping",
          window: monthWindow,
          cap: 50,
          usedCredits: 5,
        }),
        // The week must not be double-counted into the monthly total.
        meter({ resource: "ai", cap: 40, usedCredits: 30 }),
      ]),
      NOW
    );
    expect(view.plan).toBe("business");
    expect(view.total.usedLabel).toBe("45");
    expect(view.total.capLabel).toBe("150");
    expect(view.total.percentLabel).toBe("30%");
  });

  it("leaves an uncapped resource out of the total, numerator and denominator both", () => {
    // Adding usage to a denominator that does not include its cap would
    // overstate the percentage — sometimes to a red figure that means nothing.
    const view = usageLimitsView(
      snapshot([
        meter({ resource: "ai", window: monthWindow, cap: 100, usedCredits: 50 }),
        meter({
          resource: "scraping",
          window: monthWindow,
          cap: null,
          usedCredits: 9_000,
        }),
      ]),
      NOW
    );
    expect(view.total.usedLabel).toBe("50");
    expect(view.total.capLabel).toBe("100");
    expect(view.total.percentLabel).toBe("50%");
    expect(view.total.partial).toBe(true);
  });

  it("flags a snapshot where nothing is capped, so the page can say so in words", () => {
    const view = usageLimitsView(
      snapshot([
        meter({ cap: null }),
        meter({ window: monthWindow, cap: null }),
      ]),
      NOW
    );
    expect(view.allUncapped).toBe(true);
  });

  it("does not flag a snapshot where one meter still has a cap", () => {
    const view = usageLimitsView(
      snapshot([meter({ cap: null }), meter({ window: monthWindow, cap: 10 })]),
      NOW
    );
    expect(view.allUncapped).toBe(false);
  });

  it("reports the total as uncapped when every meter is", () => {
    const view = usageLimitsView(
      snapshot([
        meter({ resource: "ai", window: monthWindow, cap: null, usedCredits: 3 }),
        meter({
          resource: "scraping",
          window: monthWindow,
          cap: null,
          usedCredits: 7,
        }),
      ]),
      NOW
    );
    expect(view.total.uncapped).toBe(true);
    expect(view.total.capLabel).toMatch(/no limit/i);
    expect(view.allUncapped).toBe(true);
  });

  it("keeps a card even when the snapshot omits that resource", () => {
    // A partial snapshot must not silently drop a meter from the page.
    const view = usageLimitsView(snapshot([meter({ resource: "ai" })]), NOW);
    expect(view.cards).toHaveLength(3);
    const scraping = view.cards.find((c) => c.resource === "scraping");
    expect(scraping?.rings).toHaveLength(0);
    expect(scraping?.tone).toBe("ok");
  });
});

describe("budgetMeterView", () => {
  it("reports nothing when no daily budget is configured", () => {
    expect(
      budgetMeterView({ tokenLimit: null, euroLimit: null, usedTokens: 5, usedEur: 1 })
    ).toBeNull();
  });

  it("reads the token limit as its own meter", () => {
    const view = budgetMeterView({
      tokenLimit: 1_000,
      euroLimit: null,
      usedTokens: 850,
      usedEur: 0,
    });
    expect(view?.rings[0]).toMatchObject({
      tone: "warn",
      usedLabel: "850",
      capLabel: "1,000",
      // Not a plan window: the daily budget is the org's own ceiling.
      window: null,
    });
  });

  it("reads a euro limit alongside, in euros", () => {
    const view = budgetMeterView({
      tokenLimit: null,
      euroLimit: 10,
      usedTokens: 0,
      usedEur: 10.5,
    });
    expect(view?.rings[0].tone).toBe("over");
    expect(view?.rings[0].usedLabel).toMatch(/€/);
  });

  it("takes the worse of the two limits for the card's tone", () => {
    const view = budgetMeterView({
      tokenLimit: 1_000,
      euroLimit: 10,
      usedTokens: 10,
      usedEur: 10,
    });
    expect(view?.tone).toBe("over");
    expect(view?.rings).toHaveLength(2);
  });
});

describe("planGlanceRows", () => {
  it("reports the window closest to its cap, not a fixed one", () => {
    // The week is calmer than the period here, so the period is what Billing
    // must show: it is the window that stops this meter next.
    const view = usageLimitsView(
      snapshot([
        meter({ resource: "ai", cap: 1_000, usedCredits: 100 }),
        meter({
          resource: "ai",
          window: monthWindow,
          cap: 1_000,
          usedCredits: 900,
        }),
      ]),
      NOW
    );
    const ai = planGlanceRows(view).find((row) => row.resource === "ai");
    expect(ai).toMatchObject({
      windowLabel: "This billing period",
      percentLabel: "90%",
      tone: "warn",
      detail: "900 / 1,000 credits",
    });
  });

  it("agrees with the Usage page's gauge about which window leads", () => {
    // Both surfaces must lead with the same window for the same snapshot. Here
    // AI's month is tighter and scraping's week is, so a row that always picked
    // one window would disagree with the card on one of the two.
    const view = usageLimitsView(
      snapshot([
        meter({ resource: "ai", cap: 100, usedCredits: 10 }),
        meter({
          resource: "ai",
          window: monthWindow,
          cap: 100,
          usedCredits: 90,
        }),
        meter({ resource: "scraping", cap: 100, usedCredits: 70 }),
        meter({
          resource: "scraping",
          window: monthWindow,
          cap: 100,
          usedCredits: 20,
        }),
      ]),
      NOW
    );
    const byResource = Object.fromEntries(
      planGlanceRows(view).map((row) => [row.resource, row])
    );
    expect(byResource.ai.windowLabel).toBe("This billing period");
    expect(byResource.ai.percentLabel).toBe("90%");
    expect(byResource.scraping.windowLabel).toBe("This week");
    expect(byResource.scraping.percentLabel).toBe("70%");
    for (const row of planGlanceRows(view)) {
      const card = view.cards.find((c) => c.resource === row.resource);
      expect(row.percentLabel).toBe(card?.leadPercent);
    }
  });

  it("says a meter has no limit rather than drawing it as empty", () => {
    const view = usageLimitsView(
      snapshot([meter({ resource: "ai", cap: null, usedCredits: 4_000 })]),
      NOW
    );
    const ai = planGlanceRows(view).find((row) => row.resource === "ai");
    expect(ai?.uncapped).toBe(true);
    expect(ai?.detail).toMatch(/no limit/i);
    expect(ai?.fraction).toBe(0);
  });

  it("drops a resource the snapshot carried no window for", () => {
    // Billing is a summary: a row that says nothing costs a reader more than
    // its absence. The Usage page still keeps all three cards.
    const view = usageLimitsView(snapshot([meter({ resource: "ai" })]), NOW);
    expect(planGlanceRows(view).map((row) => row.resource)).toEqual(["ai"]);
    expect(view.cards).toHaveLength(3);
  });
});
