import { describe, expect, it } from "vitest";
import type { PlanCatalogEntry } from "@agent-hub/agent";
import {
  currentPlanEntry,
  maxPublishedAnswers,
  planTierViews,
  recommendedTierSlug,
  selfServeTiers,
  upgradeOptions,
} from "@/lib/plan-pricing";

const entry = (
  slug: string,
  priceEur: number,
  overrides: Partial<PlanCatalogEntry> = {}
): PlanCatalogEntry => ({
  slug,
  priceEur,
  salesLed: false,
  checkout: true,
  volumes: { answers: 1_000, pages: 200, documents: 300 },
  ...overrides,
});

const CATALOG: PlanCatalogEntry[] = [
  entry("go", 49),
  entry("business", 199),
  entry("enterprise", 999, { salesLed: true, checkout: false }),
];

describe("planTierViews", () => {
  it("prints the tier slug as the tier name, so copy and invoice agree", () => {
    expect(planTierViews(CATALOG).map((tier) => tier.name)).toEqual([
      "Go",
      "Business",
      "Enterprise",
    ]);
    expect(planTierViews(CATALOG).map((tier) => tier.slug)).toEqual([
      "go",
      "business",
      "enterprise",
    ]);
  });

  it("shows a self-serve price exactly and a sales-led price as a floor", () => {
    const views = planTierViews(CATALOG);
    expect(views[0].priceLabel).toBe("€49");
    expect(views[0].pricePrefix).toBeNull();
    expect(views[2].priceLabel).toBe("€999");
    expect(views[2].pricePrefix).toBe("from");
  });

  it("states the volumes the catalog derived, never a number of its own", () => {
    const views = planTierViews([
      entry("go", 49, { volumes: { answers: 7_900, pages: 1_500, documents: 1_100 } }),
    ]);
    expect(views[0].volumes).toEqual([
      "About 7,900 assistant answers a month",
      "1,500 pages crawled a month",
      "1,100 documents indexed a month",
    ]);
  });

  it("sends a sales-led tier to a conversation and a self-serve tier to checkout", () => {
    const views = planTierViews(CATALOG);
    expect(views[0].cta).toBe("checkout");
    expect(views[2].cta).toBe("contact");
  });

  it("falls back to the contact path when a self-serve tier cannot be bought yet", () => {
    // Stripe not configured for this tier: offering a button that 500s is worse
    // than offering the conversation.
    const views = planTierViews([entry("go", 49, { checkout: false })]);
    expect(views[0].cta).toBe("contact");
  });

  it("keeps sales-led separate from can-be-bought-now", () => {
    // The public page branches on the tier being self-serve; only an in-product
    // upgrade button cares whether Stripe is wired. Conflating them would send a
    // self-serve visitor to sales on any deployment with no Price configured.
    const views = planTierViews([entry("go", 49, { checkout: false })]);
    expect(views[0].salesLed).toBe(false);
    expect(views[0].cta).toBe("contact");
    expect(planTierViews(CATALOG)[2].salesLed).toBe(true);
  });

  it("orders tiers by price, whatever order the catalog arrived in", () => {
    const views = planTierViews([CATALOG[2], CATALOG[0], CATALOG[1]]);
    expect(views.map((tier) => tier.slug)).toEqual([
      "go",
      "business",
      "enterprise",
    ]);
  });

  it("has nothing to show when there is nothing to sell", () => {
    expect(planTierViews(null)).toEqual([]);
    expect(planTierViews([])).toEqual([]);
  });

  it("describes an unrecognized tier without inventing an audience for it", () => {
    const views = planTierViews([entry("legacy", 79)]);
    expect(views[0].name).toBe("Legacy");
    expect(views[0].audience).toBe("");
  });
});

describe("selfServeTiers", () => {
  it("is the tiers a customer can pay for without talking to anyone", () => {
    expect(selfServeTiers(CATALOG).map((tier) => tier.slug)).toEqual([
      "go",
      "business",
    ]);
  });

  it("excludes a self-serve tier whose Stripe Price is not configured", () => {
    // The pending card branches on this to decide between a card field and a
    // conversation: a "pay now" button that redirects to sales is a dead end.
    expect(selfServeTiers([entry("go", 49, { checkout: false })])).toEqual([]);
  });

  it("is empty with no catalog, which is how the open-source edition reads", () => {
    expect(selfServeTiers(null)).toEqual([]);
  });
});

describe("upgradeOptions", () => {
  it("offers a payer only the tiers above the one they pay for, cheapest first", () => {
    expect(
      upgradeOptions("go", CATALOG, { paying: true }).map((tier) => tier.slug)
    ).toEqual(["business", "enterprise"]);
    expect(
      upgradeOptions("business", CATALOG, { paying: true }).map((t) => t.slug)
    ).toEqual(["enterprise"]);
  });

  it("offers a non-payer the tier they are on as well", () => {
    // A comped evaluation of Go is not paying for Go, so Go is the single most
    // likely thing they want to buy. Excluding it would hide the conversion.
    expect(upgradeOptions("go", CATALOG).map((tier) => tier.slug)).toEqual([
      "go",
      "business",
      "enterprise",
    ]);
  });

  it("offers a payer nothing above the top tier", () => {
    expect(upgradeOptions("enterprise", CATALOG, { paying: true })).toEqual([]);
  });

  it("offers the whole ladder when the current plan is not in the catalog", () => {
    // A retired or hand-edited slug: every tier is a step forward from unknown,
    // which is the safe direction — it never hides a plan the org could buy.
    expect(upgradeOptions("legacy", CATALOG, { paying: true })).toHaveLength(3);
    expect(upgradeOptions(null, CATALOG)).toHaveLength(3);
  });

  it("offers nothing when there is no catalog", () => {
    expect(upgradeOptions("go", null)).toEqual([]);
  });
});

describe("currentPlanEntry", () => {
  it("finds the tier an organization is on", () => {
    expect(currentPlanEntry("business", CATALOG)?.priceEur).toBe(199);
  });

  it("is null for a plan the catalog does not know, and for no catalog", () => {
    expect(currentPlanEntry("legacy", CATALOG)).toBeNull();
    expect(currentPlanEntry(null, CATALOG)).toBeNull();
    expect(currentPlanEntry("go", null)).toBeNull();
  });
});

/**
 * The pricing page's answers picker, whose whole job is these two numbers. Kept
 * here rather than in the component so the rule the page recommends by is
 * testable at all — the page itself is a `.tsx` this suite cannot reach.
 *
 * Answers deliberately differ per tier and the ladder is deliberately out of
 * price order: the recommendation is a question about allowances, and the tier
 * order must not be taken on trust from however the catalog was enumerated.
 */
const LADDER: PlanCatalogEntry[] = [
  entry("enterprise", 999, {
    salesLed: true,
    checkout: false,
    volumes: { answers: 100_000, pages: 200, documents: 300 },
  }),
  entry("go", 49, { volumes: { answers: 5_000, pages: 200, documents: 300 } }),
  entry("business", 199, {
    volumes: { answers: 25_000, pages: 200, documents: 300 },
  }),
];

/** The slugs the pricing page has a card for. */
const CARDS = ["go", "business", "enterprise"] as const;

describe("recommendedTierSlug", () => {
  it("recommends the cheapest tier whose allowance funds the estimate", () => {
    expect(recommendedTierSlug(LADDER, 1_000, CARDS)).toBe("go");
    expect(recommendedTierSlug(LADDER, 5_000, CARDS)).toBe("go");
    expect(recommendedTierSlug(LADDER, 5_001, CARDS)).toBe("business");
    expect(recommendedTierSlug(LADDER, 25_000, CARDS)).toBe("business");
    expect(recommendedTierSlug(LADDER, 90_000, CARDS)).toBe("enterprise");
  });

  it("recommends nothing above the dearest published allowance", () => {
    // Past the top of the ladder the honest answer is a conversation, not the
    // dearest card — so there is nothing for the page to highlight.
    expect(recommendedTierSlug(LADDER, 100_001, CARDS)).toBeNull();
  });

  it("walks the ladder by price, not by the order the catalog arrived in", () => {
    // LADDER lists Enterprise first. A tier order taken on trust recommends it
    // for a 1,000-answer pilot.
    expect(recommendedTierSlug(LADDER, 1_000, CARDS)).not.toBe("enterprise");
  });

  it("skips a tier the caller has no card for, and keeps walking", () => {
    // A catalog can carry a tier this page does not render — a slug added on
    // the enterprise side, or a retired one. Recommending it would ring no card
    // at all and tell the reader their estimate is off the ladder when a plan
    // covering it is sitting right there.
    const withStranger = [
      ...LADDER,
      entry("startup", 99, {
        volumes: { answers: 10_000, pages: 200, documents: 300 },
      }),
    ];
    expect(recommendedTierSlug(withStranger, 6_000, CARDS)).toBe("business");
  });

  it("recommends nothing when there is no ladder to recommend from", () => {
    expect(recommendedTierSlug(null, 1_000, CARDS)).toBeNull();
    expect(recommendedTierSlug([], 1_000, CARDS)).toBeNull();
    expect(recommendedTierSlug(LADDER, 1_000, [])).toBeNull();
  });
});

describe("maxPublishedAnswers", () => {
  it("is the dearest published allowance — the top of the picker's range", () => {
    expect(maxPublishedAnswers(LADDER)).toBe(100_000);
  });

  it("has no ceiling to offer with no catalog, so the caller picks one", () => {
    expect(maxPublishedAnswers(null)).toBeNull();
    expect(maxPublishedAnswers([])).toBeNull();
  });
});
