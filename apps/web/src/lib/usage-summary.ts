import {
  USAGE_RESOURCES,
  creditsFor,
  usageResourceOf,
  type MeteredUnit,
  type Provider,
  type UsageDailyRow,
  type UsageResource,
} from "@agent-hub/core";

/**
 * Folds the org's daily usage rows into what the Usage page shows (#506).
 *
 * Lives outside the page component for two reasons: the app's vitest only picks
 * up `.test.ts`, so logic in a `.tsx` page is untestable; and the same fold is
 * what the plan gauges (#509) will read. Everything here is a pure function of
 * the rows, no dates, no environment.
 *
 * Every total is reported in **credits** as well as in raw units, because
 * credits are the unit a plan is denominated in and the only one that compares
 * a crawled page against a model call. Rows are priced through the one shared
 * conversion, so this page can never disagree with cap enforcement about cost.
 */

export interface ResourceUsage {
  resource: UsageResource;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Crawled pages, on the scraping meter only. */
  pages: number;
  /** Every credit spent on this resource, however it was funded. */
  credits: number;
  /**
   * The part the platform funded: the only part a plan allowance bounds, and
   * therefore the number a meter should lead with. Work on the customer's own
   * credentials is their own cost and is never counted against a cap.
   */
  platformCredits: number;
}

export interface FundingUsage {
  credits: number;
  tokens: number;
  /**
   * Crawled pages. Kept apart from tokens rather than folded into a "calls"
   * count: a fetched web page is not a model call, and adding the two would
   * report a number that means nothing.
   */
  pages: number;
}

export interface UsageSummary {
  byResource: Record<UsageResource, ResourceUsage>;
  /** Work the platform funds, the only work a plan allowance bounds. */
  platform: FundingUsage;
  /** Work the customer's own credentials funded; never counted against a plan. */
  own: FundingUsage;
}

/** The metered unit one daily row represents, for pricing. */
function unitOf(row: UsageDailyRow): MeteredUnit {
  return row.kind === "crawl"
    ? { kind: "crawl", crawler: row.provider, pages: row.units }
    : {
        kind: "model",
        // The rollup stores the provider as free text. A value this build does
        // not know, a retired provider, or the empty string on a row
        // aggregated before provider attribution existed, prices at the
        // unknown-model fallback, which costs more rather than less.
        provider: row.provider as Provider,
        modelId: row.modelId,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      };
}

const emptyResource = (resource: UsageResource): ResourceUsage => ({
  resource,
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  pages: 0,
  credits: 0,
  platformCredits: 0,
});

export function summarizeUsage(rows: readonly UsageDailyRow[]): UsageSummary {
  const byResource = Object.fromEntries(
    USAGE_RESOURCES.map((r) => [r, emptyResource(r)])
  ) as Record<UsageResource, ResourceUsage>;
  const platform: FundingUsage = { credits: 0, tokens: 0, pages: 0 };
  const own: FundingUsage = { credits: 0, tokens: 0, pages: 0 };

  for (const row of rows) {
    const credits = creditsFor([unitOf(row)]);
    const platformFunded = row.credentialKind === "platform";
    const at = byResource[usageResourceOf(row.kind)];
    at.calls += row.calls;
    at.inputTokens += row.inputTokens;
    at.outputTokens += row.outputTokens;
    at.pages += row.units;
    at.credits += credits;
    if (platformFunded) at.platformCredits += credits;

    const funding = platformFunded ? platform : own;
    funding.tokens += row.inputTokens + row.outputTokens;
    funding.pages += row.units;
    funding.credits += credits;
  }

  return { byResource, platform, own };
}

/**
 * Credits as a page shows them. Below a tenth of a credit the honest answer is
 * "some, but not much" rather than a rounded zero, which would read as free.
 */
export function formatCredits(credits: number): string {
  if (credits === 0) return "0";
  if (credits < 0.1) return "<0.1";
  return credits.toLocaleString("en-US", {
    maximumFractionDigits: credits < 100 ? 1 : 0,
  });
}
